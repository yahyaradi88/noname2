import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
const origin = process.env.TEST_ORIGIN || "http://localhost:3000";
const sockets = [];
async function client(cookie) {
  if (!cookie) {
    const r = await fetch(`${origin}/api/session`, {
      method: "POST",
      headers: { Origin: origin },
    });
    assert.equal(r.status, 200);
    cookie = r.headers.get("set-cookie").split(";")[0];
  }
  const socket = io(origin, {
    transports: ["websocket"],
    extraHeaders: { Origin: origin, Cookie: cookie },
    reconnection: false,
    autoConnect: false,
  });
  const c = { socket, cookie, view: null };
  socket.on("state", (v) => {
    c.view = v;
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
    socket.connect();
  });
  return c;
}
async function wait(fn) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("Timed out waiting for synchronized state");
}
const command = (c, payload) =>
  new Promise((resolve, reject) =>
    c.socket
      .timeout(5000)
      .emit("command", payload, (e, result) =>
        e ? reject(e) : resolve(result),
      ),
  );
try {
  const forbidden = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { Origin: "https://attacker.invalid" },
  });
  assert.equal(forbidden.status, 403);
  const a = await client(),
    b = await client();
  assert.deepEqual(
    await command(a, {
      type: "create",
      name: "Network A",
      roomName: "Network integration",
      maxPlayers: 2,
      timer: 0,
      privacy: "private",
      password: "integration-only",
    }),
    { ok: true },
  );
  await wait(() => a.view);
  const code = a.view.code;
  assert.equal(
    (
      await command(b, {
        type: "join",
        name: "Network B",
        code,
        password: "wrong",
      })
    ).error,
    "Incorrect room password.",
  );
  assert.deepEqual(
    await command(b, {
      type: "join",
      name: "Network B",
      code,
      password: "integration-only",
    }),
    { ok: true },
  );
  await wait(() => a.view.players.length === 2 && b.view);
  assert.deepEqual(await command(a, { type: "start" }), { ok: true });
  await wait(() => a.view.myHand.length === 4 && b.view.myHand.length === 4);
  assert.ok(
    a.view.myHand.every((c) => !b.view.myHand.some((d) => d.id === c.id)),
  );
  for (const c of [a, b]) {
    assert.ok(!("deck" in c.view));
    assert.ok(!("passwordHash" in c.view));
    assert.ok(c.view.players.every((p) => !("hand" in p) && !("session" in p)));
  }
  const active = a.view.currentPlayerId === a.view.myId ? a : b,
    other = active === a ? b : a;
  const rank =
    active.view.myHand.find((c) =>
      other.view.myHand.some((d) => d.rank === c.rank),
    )?.rank ?? active.view.myHand[0].rank;
  const payload = {
    type: "askRank",
    actionId: randomUUID(),
    turnId: active.view.turnId,
    targetId: other.view.myId,
    rank,
  };
  assert.equal((await command(other, payload)).ok, false);
  const oldTurn = active.view.turnId;
  assert.deepEqual(await command(active, payload), { ok: true });
  await wait(() => active.view.latestQuestion?.rank === rank);
  if (active.view.stage === "WAITING_FOR_AMOUNT") {
    await wait(() => other.view.latestQuestion?.correct === true);
    assert.equal(other.view.latestQuestion.step, "rank");
    const actual = other.view.myHand.filter((c) => c.rank === rank);
    assert.deepEqual(
      await command(active, {
        type: "askAmount",
        actionId: randomUUID(),
        turnId: oldTurn,
        amount: actual.length,
      }),
      { ok: true },
    );
    await wait(
      () =>
        active.view.stage === "WAITING_FOR_SUITS" &&
        other.view.latestQuestion?.step === "amount",
    );
    assert.deepEqual(
      await command(active, {
        type: "askSuits",
        actionId: randomUUID(),
        turnId: oldTurn,
        suits: actual.map((c) => c.suit),
      }),
      { ok: true },
    );
  }
  await wait(
    () => a.view.turnId !== oldTurn && b.view.turnId === a.view.turnId,
  );
  const after = JSON.stringify(active.view);
  assert.deepEqual(await command(active, payload), { ok: true });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(JSON.stringify(active.view), after);
  const saved = { id: b.view.myId, hand: b.view.myHand, turn: b.view.turnId };
  b.socket.disconnect();
  await wait(() =>
    a.view.players.some((p) => p.id === saved.id && !p.connected),
  );
  const reconnected = await client(b.cookie);
  await wait(() => reconnected.view);
  assert.equal(reconnected.view.myId, saved.id);
  assert.deepEqual(reconnected.view.myHand, saved.hand);
  assert.equal(reconnected.view.turnId, saved.turn);
  await command(reconnected, { type: "leave" });
  await wait(() => a.view.stage === "GAME_OVER");
  assert.deepEqual(a.view.winners, [a.view.myId]);
  await command(a, { type: "reset" });
  await wait(() => a.view.stage === "LOBBY");
  await command(a, { type: "leave" });
  console.log(
    "PASS: independent sessions, origin protection, passwords, synchronized private hands, guesses, duplicate replay, reconnect, forfeit, game end and reset.",
  );
} finally {
  for (const s of sockets) s.disconnect();
}
