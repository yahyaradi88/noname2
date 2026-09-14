import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDeck,
  shuffleDeck,
  startGame,
  resolveGuess,
  sanitizeGameState,
  detectCompletedSets,
  advanceTurn,
  checkGameEnd,
  forfeit,
  legalChoices,
  validateAsk,
} from "../packages/game-engine/index.js";
import { player } from "../apps/server/rooms.js";
import type { Room, Guess, Rank, Suit } from "../packages/shared/types.js";
function fixture(): Room {
  const players = [
    player("Alex", "session-a"),
    player("Sam", "session-b"),
    player("Lina", "session-c"),
  ];
  return {
    code: "ABC234",
    hostId: players[0].id,
    passwordHash: null,
    settings: { name: "Test", maxPlayers: 4, timer: 45, privacy: "private" },
    players,
    deck: createDeck(),
    stage: "LOBBY",
    turnIndex: 0,
    turnId: randomUUID(),
    deadline: null,
    events: [],
    processed: [],
    createdAt: 0,
    updatedAt: 0,
    winners: [],
  };
}
const card = (rank: Rank, suit: Suit) => ({
  id: `${rank}-${suit}`,
  rank,
  suit,
});
function scenario() {
  const r = fixture();
  r.stage = "WAITING_FOR_TURN";
  r.players[0].hand = [card("5", "spades"), card("5", "hearts")];
  r.players[1].hand = [card("5", "clubs"), card("5", "diamonds")];
  r.players[2].hand = [card("K", "hearts")];
  r.deck = createDeck().filter(
    (c) => !r.players.some((p) => p.hand.some((h) => h.id === c.id)),
  );
  return r;
}
function guess(r: Room, extra: Partial<Guess> = {}): Guess {
  return {
    actionId: randomUUID(),
    turnId: r.turnId,
    targetId: r.players[1].id,
    rank: "5",
    amount: 2,
    suits: ["clubs", "diamonds"],
    ...extra,
  };
}
test("deck contains all 52 unique cards", () => {
  const d = createDeck();
  assert.equal(d.length, 52);
  assert.equal(new Set(d.map((c) => c.id)).size, 52);
});
test("secure shuffle preserves input and all cards", () => {
  const d = createDeck(),
    copy = structuredClone(d),
    s = shuffleDeck(d);
  assert.deepEqual(d, copy);
  assert.deepEqual(s.map((c) => c.id).sort(), d.map((c) => c.id).sort());
  assert.notDeepEqual(s, d);
});
for (const n of [2, 3, 4, 5, 6, 7, 8])
  test(`deal gives 4 cards to each of ${n} players`, () => {
    const r = fixture();
    r.players = Array.from({ length: n }, (_, i) =>
      player(`Player ${i}`, `session-${i}`),
    );
    startGame(r);
    assert.equal(r.deck.length, 52 - n * 4);
    assert.ok(
      r.players.every((p) => p.hand.length + p.completed.length * 4 === 4),
    );
    assert.equal(
      new Set([...r.deck, ...r.players.flatMap((p) => p.hand)].map((c) => c.id))
        .size,
      52 - r.players.reduce((n, p) => n + 4 * p.completed.length, 0),
    );
  });
test("minimum players enforced", () => {
  const r = fixture();
  r.players = r.players.slice(0, 1);
  assert.throws(() => startGame(r), /2 players/);
});
test("sanitizer only includes viewer hand, no session, deck or password", () => {
  const r = scenario();
  r.passwordHash = "SECRET_HASH";
  const v = sanitizeGameState(r, r.players[0].id);
  assert.equal(v.myHand.length, 2);
  for (const p of v.players) assert.equal("hand" in p, false);
  const json = JSON.stringify(v);
  for (const secret of [
    "session-a",
    "session-b",
    "session-c",
    "SECRET_HASH",
    "K-hearts",
    "5-clubs",
    "5-diamonds",
  ])
    assert.ok(!json.includes(secret));
  assert.ok(!("deck" in v));
  v.myHand.pop();
  assert.equal(r.players[0].hand.length, 2);
});
test("unknown viewers rejected", () => {
  assert.throws(() => sanitizeGameState(scenario(), "intruder"));
});
test("rank not held is rejected without mutation", () => {
  const r = scenario(),
    before = structuredClone(r);
  assert.throws(
    () => resolveGuess(r, r.players[0].id, guess(r, { rank: "Q" })),
    /ranks in your hand/,
  );
  assert.deepEqual(r, before);
});
test("cannot ask yourself", () => {
  const r = scenario();
  assert.throws(
    () =>
      resolveGuess(r, r.players[0].id, guess(r, { targetId: r.players[0].id })),
    /another player/,
  );
});
for (const amount of [1, 2, 3])
  test(`${amount} cards require exactly ${amount} suits`, () => {
    const r = scenario();
    r.players[0].hand = [card("5", "spades")];
    assert.throws(
      () =>
        validateAsk(
          r,
          r.players[0].id,
          guess(r, {
            amount,
            suits: amount === 1 ? ["clubs", "hearts"] : ["clubs"],
          }),
        ),
      /required number/,
    );
  });
test("three-suit legal guess accepted when holding one", () => {
  const r = scenario();
  r.players[0].hand = [card("5", "spades")];
  assert.doesNotThrow(() =>
    validateAsk(
      r,
      r.players[0].id,
      guess(r, { amount: 3, suits: ["clubs", "hearts", "diamonds"] }),
    ),
  );
});
test("duplicate suits rejected", () => {
  const r = scenario();
  assert.throws(
    () =>
      resolveGuess(r, r.players[0].id, guess(r, { suits: ["clubs", "clubs"] })),
    /different suits/,
  );
});
test("own suits cannot be guessed", () => {
  const r = scenario();
  assert.throws(
    () =>
      resolveGuess(
        r,
        r.players[0].id,
        guess(r, { suits: ["hearts", "clubs"] }),
      ),
    /already hold/,
  );
});
test("amount options use only own cards and cannot leak target cards", () => {
  const r = scenario();
  assert.deepEqual(legalChoices(r.players[0])["5"], {
    amounts: [1, 2],
    suits: ["diamonds", "clubs"],
  });
  assert.throws(
    () =>
      resolveGuess(
        r,
        r.players[0].id,
        guess(r, { amount: 3, suits: ["clubs", "diamonds", "hearts"] }),
      ),
    /impossible/,
  );
});
test("exact guess transfers, completes set, scores once, rotates", () => {
  const r = scenario();
  resolveGuess(r, r.players[0].id, guess(r));
  assert.deepEqual(r.players[0].completed, ["5"]);
  assert.equal(r.players[0].hand.length, 0);
  assert.equal(r.players[1].hand.length, 1);
  assert.equal(r.turnIndex, 1);
  detectCompletedSets(r, r.players[0]);
  assert.equal(r.players[0].completed.length, 1);
  assert.ok(
    r.events.some((e) => e.kind === "success" && e.cards?.length === 2),
  );
});
test("failed guess draws exactly one, no target contents in events", () => {
  const r = scenario(),
    deckSize = r.deck.length;
  resolveGuess(r, r.players[0].id, guess(r, { amount: 1, suits: ["clubs"] }));
  assert.equal(r.deck.length, deckSize - 1);
  assert.equal(r.players[0].hand.length, 3);
  assert.equal(r.players[1].hand.length, 2);
  const json = JSON.stringify(r.events);
  assert.ok(!json.includes("diamonds"));
  assert.ok(!json.includes("clubs"));
  assert.ok(!json.includes("cards"));
  assert.equal(r.turnIndex, 1);
});
test("failure with empty deck advances without drawing", () => {
  const r = scenario();
  r.deck = [];
  resolveGuess(r, r.players[0].id, guess(r, { amount: 1, suits: ["clubs"] }));
  assert.equal(r.players[0].hand.length, 2);
  assert.equal(r.turnIndex, 1);
});
test("duplicate action id has no second effect", () => {
  const r = scenario(),
    g = guess(r);
  resolveGuess(r, r.players[0].id, g);
  const after = structuredClone(r);
  resolveGuess(r, r.players[0].id, g);
  assert.deepEqual(r, after);
});
test("old turn ID rejected even with new action ID", () => {
  const r = scenario();
  assert.throws(
    () => resolveGuess(r, r.players[0].id, guess(r, { turnId: randomUUID() })),
    /ended/,
  );
});
test("out of turn and disconnected players rejected", () => {
  const r = scenario();
  assert.throws(
    () => resolveGuess(r, r.players[1].id, guess(r)),
    /Not your turn/,
  );
  r.players[0].connected = false;
  assert.throws(
    () => resolveGuess(r, r.players[0].id, guess(r)),
    /Not your turn/,
  );
});
test("expired deadline rejects guess", () => {
  const r = scenario();
  r.deadline = 1;
  assert.throws(() => resolveGuess(r, r.players[0].id, guess(r)), /expired/);
});
test("draw detects a set immediately", () => {
  const r = scenario();
  r.players[0].hand = [
    card("K", "spades"),
    card("K", "clubs"),
    card("K", "diamonds"),
    card("5", "spades"),
  ];
  r.deck = [card("K", "hearts")];
  resolveGuess(r, r.players[0].id, guess(r, { amount: 1, suits: ["clubs"] }));
  assert.deepEqual(r.players[0].completed, ["K"]);
  assert.equal(r.players[0].hand.length, 1);
});
test("empty hand with empty pile skipped clockwise", () => {
  const r = scenario();
  r.deck = [];
  r.players[1].hand = [];
  r.players[2].hand.push(card("5", "clubs"));
  advanceTurn(r);
  assert.equal(r.turnIndex, 2);
});
test("timeout advances without penalty draw", () => {
  const r = scenario(),
    n = r.deck.length;
  advanceTurn(r);
  assert.equal(r.players[0].hand.length, 2);
  assert.equal(r.deck.length, n);
});
test("all ranks completed ends game and chooses winner", () => {
  const r = fixture();
  r.stage = "WAITING_FOR_TURN";
  r.deck = [];
  const all = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ] as Rank[];
  r.players[0].completed = all.slice(0, 7);
  r.players[1].completed = all.slice(7);
  assert.ok(checkGameEnd(r));
  assert.equal(r.stage, "GAME_OVER");
  assert.deepEqual(r.winners, [r.players[0].id]);
});
test("ties shared, no arbitrary tiebreaker", () => {
  const r = fixture();
  r.deck = [];
  r.players[0].completed = ["A", "2"];
  r.players[1].completed = ["3", "4"];
  r.players[2].completed = ["5"];
  checkGameEnd(r);
  assert.deepEqual(r.winners, [r.players[0].id, r.players[1].id]);
});
test("forfeit returns hand, preserves sets, migrates host", () => {
  const r = scenario(),
    n = r.deck.length;
  r.players[0].completed = ["A"];
  forfeit(r, r.players[0].id);
  assert.equal(r.players[0].left, true);
  assert.equal(r.players[0].hand.length, 0);
  assert.equal(r.deck.length, n + 2);
  assert.deepEqual(r.players[0].completed, ["A"]);
  assert.equal(r.hostId, r.players[1].id);
});
test("fewer than two non-forfeited players ends game", () => {
  const r = scenario();
  forfeit(r, r.players[0].id);
  forfeit(r, r.players[1].id);
  assert.equal(r.stage, "GAME_OVER");
  assert.deepEqual(r.winners, [r.players[2].id]);
});
