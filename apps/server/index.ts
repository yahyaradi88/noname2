import { existsSync } from "node:fs";
import express from "express";
import helmet from "helmet";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { Server } from "socket.io";
import { Store } from "./store.js";
import { commandSchema, RateLimiter } from "./validation.js";
import { execute, findSeat } from "./rooms.js";
import {
  advanceTurn,
  event,
  forfeit,
  migrateHost,
  RuleError,
  sanitizeGameState,
} from "../../packages/game-engine/index.js";
import type {
  ClientEvents,
  ServerEvents,
  Room,
} from "../../packages/shared/types.js";
import { activeStages } from "../../packages/game-engine/questions.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 3000),
  origin = process.env.ORIGIN || `http://localhost:${port}`;
if (production && !origin.startsWith("https://"))
  throw new Error("Set ORIGIN to the public HTTPS origin.");
const app = express();
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: production
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            connectSrc: ["'self'", origin.replace("https:", "wss:")],
            imgSrc: ["'self'", "data:"],
          },
        }
      : false,
  }),
);
const http = createServer(app),
  store = new Store(process.env.DATABASE_PATH || "./data/no-name.sqlite");
const rooms = new Map(store.load().map((r) => [r.code, r]));
const limiter = new RateLimiter();
for (const room of rooms.values()) {
  for (const p of room.players)
    if (!p.left) {
      p.connected = false;
      p.disconnectedAt ??= Date.now();
    }
  store.save(room);
}
function digest(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}
function sessionFrom(cookie: string | undefined) {
  const raw = cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("nn_session="))
    ?.slice(11);
  return raw && /^[a-f0-9]{64}$/.test(raw) && store.session(digest(raw))
    ? digest(raw)
    : null;
}
app.post("/api/session", (req, res) => {
  if (req.headers.origin !== origin) {
    res.status(403).json({ error: "Origin rejected." });
    return;
  }
  if (!limiter.allow(`session:${req.ip}`, 30, 60000)) {
    res.status(429).json({ error: "Too many requests." });
    return;
  }
  if (!sessionFrom(req.headers.cookie)) {
    const raw = randomBytes(32).toString("hex");
    store.addSession(digest(raw));
    res.cookie("nn_session", raw, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      maxAge: 7 * 86400000,
      path: "/",
    });
  }
  res.json({ ok: true });
});
app.get("/health", (_req, res) => res.json({ ok: true }));
const io = new Server<ClientEvents, ServerEvents>(http, {
  maxHttpBufferSize: 8192,
  allowRequest: (req, cb) => cb(null, req.headers.origin === origin),
  cors: { origin, credentials: true },
});
io.use((socket, next) => {
  const session = sessionFrom(socket.request.headers.cookie);
  if (!session) return next(new Error("Session expired. Please reconnect."));
  const ip =
    process.env.TRUST_PROXY === "1"
      ? String(
          socket.request.headers["x-forwarded-for"] || socket.handshake.address,
        )
          .split(",")
          .at(-1)!
          .trim()
      : socket.handshake.address;
  if (!limiter.allow(`connect:${ip}`, 40, 60000))
    return next(new Error("Too many connections. Please wait."));
  socket.data.session = session;
  socket.data.ip = ip;
  next();
});
let queue: Promise<void> = Promise.resolve();
function serial(fn: () => Promise<void> | void) {
  queue = queue
    .then(fn)
    .catch((error) =>
      console.error(
        "Room operation failed:",
        error instanceof Error ? error.message : "Unknown error",
      ),
    );
}
function publish(room: Room) {
  store.save(room);
  for (const socket of io.sockets.sockets.values()) {
    const p = room.players.find(
      (p) => p.session === socket.data.session && !p.left,
    );
    if (p) {
      socket.data.code = room.code;
      socket.emit("state", sanitizeGameState(room, p.id));
    } else if (socket.data.code === room.code) {
      socket.emit("state", null);
      socket.emit(
        "notice",
        "You have left the room or were removed by the host.",
      );
      socket.data.code = null;
    }
  }
}
io.on("connection", (socket) => {
  serial(() => {
    const seat = findSeat(rooms, socket.data.session);
    if (seat) {
      seat.player.connected = true;
      seat.player.disconnectedAt = null;
      migrateHost(seat.room);
      socket.data.code = seat.room.code;
      publish(seat.room);
    } else socket.emit("state", null);
  });
  socket.on("command", (payload, reply) => {
    if (typeof reply !== "function") return;
    if (!limiter.allow(`action:${socket.data.session}`, 30, 10000)) {
      reply({ ok: false, error: "Please slow down." });
      return;
    }
    const parsed = commandSchema.safeParse(payload);
    if (!parsed.success) {
      reply({
        ok: false,
        error: parsed.error.issues[0]?.message || "Invalid request.",
      });
      return;
    }
    if (
      ["join", "create"].includes(parsed.data.type) &&
      (!limiter.allow(`join:${socket.data.ip}`, 10, 60000) ||
        !limiter.allow(`join-session:${socket.data.session}`, 10, 60000))
    ) {
      reply({
        ok: false,
        error: "Too many room attempts. Try again in a minute.",
      });
      return;
    }
    serial(async () => {
      if (!socket.connected) return;
      const before = findSeat(rooms, socket.data.session);
      const affected =
        before?.room ??
        (parsed.data.type === "join" ? rooms.get(parsed.data.code) : null);
      const backup = affected ? structuredClone(affected) : null;
      let changed: Room | null = null;
      try {
        const room = await execute(rooms, socket.data.session, parsed.data);
        changed = room;
        if (room) {
          const seat = findSeat(rooms, socket.data.session);
          socket.data.code = seat?.room.code ?? room.code;
          publish(room);
          if (!seat) socket.emit("state", null);
        }
        reply({ ok: true });
      } catch (error) {
        if (backup) rooms.set(backup.code, backup);
        else if (changed && parsed.data.type === "create")
          rooms.delete(changed.code);
        reply({
          ok: false,
          error:
            error instanceof RuleError
              ? error.message
              : "Something went wrong. Please try again.",
        });
      }
    });
  });
  socket.on("disconnect", () =>
    serial(() => {
      if (
        [...io.sockets.sockets.values()].some(
          (s) => s.data.session === socket.data.session,
        )
      )
        return;
      const seat = findSeat(rooms, socket.data.session);
      if (seat) {
        seat.player.connected = false;
        seat.player.disconnectedAt = Date.now();
        publish(seat.room);
      }
    }),
  );
});
const tick = setInterval(
  () =>
    serial(() => {
      const now = Date.now();
      for (const room of rooms.values()) {
        let changed = false;
        for (const p of [...room.players])
          if (
            !p.left &&
            !p.connected &&
            p.disconnectedAt !== null &&
            now - p.disconnectedAt >= 300000
          ) {
            forfeit(room, p.id, now);
            changed = true;
          }
        if (
          activeStages.includes(room.stage) &&
          room.deadline !== null &&
          now >= room.deadline
        ) {
          event(
            room,
            `${room.players[room.turnIndex].name} ran out of time. No penalty card.`,
          );
          advanceTurn(room, now);
          changed = true;
        }
        if (
          room.players.every((p) => p.left) ||
          (!room.players.some((p) => p.connected) &&
            now - room.updatedAt > 86400000)
        ) {
          rooms.delete(room.code);
          store.delete(room.code);
        } else if (changed) publish(room);
      }
      limiter.clean();
      store.clean();
    }),
  1000,
);
if (production || process.env.SERVE_BUILD === "1") {
  app.use(express.static(resolve("dist/web")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve("dist/web/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configLoader: "native",
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
http.listen(port, process.env.HOST || "0.0.0.0", () =>
  console.log(`NO NAME listening on ${origin}`),
);
function shutdown() {
  clearInterval(tick);
  void queue.then(() => {
    for (const r of rooms.values()) store.save(r);
    io.close();
    http.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
