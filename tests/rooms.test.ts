import { test } from "node:test";
import assert from "node:assert/strict";
import { execute, findSeat, roomCode } from "../apps/server/rooms.js";
import { Store } from "../apps/server/store.js";
import { commandSchema, RateLimiter } from "../apps/server/validation.js";
import type { Room, Command } from "../packages/shared/types.js";
const create: Command = {
  type: "create",
  name: "Alex",
  roomName: "Friends",
  maxPlayers: 2,
  timer: 45,
  privacy: "private",
  password: "test-password",
};
test("password hashing, bad passwords, room capacity, locked joining and host permissions", async () => {
  const rooms = new Map<string, Room>();
  const r = (await execute(rooms, "a", create))!;
  assert.ok(r.passwordHash?.startsWith("$2"));
  assert.notEqual(r.passwordHash, "test-password");
  await assert.rejects(
    () =>
      execute(rooms, "b", {
        type: "join",
        code: r.code,
        name: "Sam",
        password: "wrong",
      }),
    /Incorrect room password/,
  );
  await execute(rooms, "b", {
    type: "join",
    code: r.code,
    name: "Sam",
    password: "test-password",
  });
  await assert.rejects(
    () =>
      execute(rooms, "c", {
        type: "join",
        code: r.code,
        name: "Lina",
        password: "test-password",
      }),
    /full/,
  );
  await assert.rejects(() => execute(rooms, "b", { type: "start" }), /host/);
  await execute(rooms, "a", { type: "start" });
  await assert.rejects(
    () =>
      execute(rooms, "c", {
        type: "join",
        code: r.code,
        name: "Lina",
        password: "test-password",
      }),
    /already started/,
  );
  await assert.rejects(
    () => execute(rooms, "a", { type: "settings", maxPlayers: 4, timer: 0 }),
    /locked/,
  );
});
test("session restores same identity and hand from durable state", async () => {
  const rooms = new Map<string, Room>();
  const r = (await execute(rooms, "a", { ...create, password: "" }))!;
  await execute(rooms, "b", {
    type: "join",
    code: r.code,
    name: "Sam",
    password: "",
  });
  await execute(rooms, "a", { type: "start" });
  const original = findSeat(rooms, "a")!;
  const store = new Store(":memory:");
  store.save(r);
  const restored = new Map(store.load().map((r) => [r.code, r]));
  const seat = findSeat(restored, "a")!;
  assert.equal(seat.player.id, original.player.id);
  assert.deepEqual(seat.player.hand, original.player.hand);
  assert.equal(findSeat(restored, "intruder"), null);
  store.close();
});
test("room IDs use safe six-character alphabet and are unique", () => {
  const rooms = new Map<string, Room>();
  for (let i = 0; i < 3000; i++) {
    const c = roomCode(rooms);
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    assert.ok(!rooms.has(c));
    rooms.set(c, {} as Room);
  }
});
test("schema rejects XSS, forged fields, malformed actions and invalid settings", () => {
  for (const cmd of [
    { ...create, name: "<script>alert(1)</script>" },
    { ...create, maxPlayers: 9 },
    { ...create, timer: 22 },
    { ...create, deck: [] },
    { ...create, password: "🔒".repeat(30) },
    { type: "guess", guess: {} },
  ])
    assert.equal(commandSchema.safeParse(cmd).success, false);
});
test("rate limiter enforces bounded attempts", () => {
  const l = new RateLimiter();
  assert.ok(l.allow("ip", 2, 60000));
  assert.ok(l.allow("ip", 2, 60000));
  assert.equal(l.allow("ip", 2, 60000), false);
  assert.ok(l.allow("other", 2, 60000));
});
test("host can kick, update settings, remove password, and reset game", async () => {
  const rooms = new Map<string, Room>();
  const r = (await execute(rooms, "a", { ...create, password: "" }))!;
  await execute(rooms, "b", {
    type: "join",
    code: r.code,
    name: "Sam",
    password: "",
  });
  const p = findSeat(rooms, "b")!.player;
  await execute(rooms, "a", { type: "kick", playerId: p.id });
  assert.equal(findSeat(rooms, "b"), null);
  await execute(rooms, "a", {
    type: "settings",
    maxPlayers: 3,
    timer: 0,
    password: "new",
  });
  assert.equal(r.settings.timer, 0);
  assert.ok(r.passwordHash);
  await execute(rooms, "a", {
    type: "settings",
    maxPlayers: 3,
    timer: 0,
    password: "",
  });
  assert.equal(r.passwordHash, null);
  r.stage = "GAME_OVER";
  await execute(rooms, "a", { type: "reset" });
  assert.equal(r.stage, "LOBBY");
  assert.equal(r.deck.length, 0);
  assert.deepEqual(r.events, []);
});
