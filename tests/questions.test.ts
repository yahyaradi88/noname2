import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDeck,
  advanceTurn,
  forfeit,
  sanitizeGameState,
} from "../packages/game-engine/index.js";
import {
  submitQuestion,
  type QuestionCommand,
} from "../packages/game-engine/questions.js";
import { player } from "../apps/server/rooms.js";
import { commandSchema } from "../apps/server/validation.js";
import type { Room } from "../packages/shared/types.js";
function fixture(): Room {
  const players = [
    player("Alex", "a"),
    player("Sam", "b"),
    player("Lina", "c"),
  ];
  const cards = createDeck();
  players[0].hand = cards.filter((c) => c.id === "5-spades");
  players[1].hand = cards.filter(
    (c) => c.id === "5-diamonds" || c.id === "5-clubs",
  );
  players[2].hand = cards.filter((c) => c.id === "5-hearts");
  return {
    code: "ABC234",
    hostId: players[0].id,
    passwordHash: null,
    settings: { name: "Stages", maxPlayers: 4, timer: 45, privacy: "private" },
    players,
    deck: cards.filter((c) => c.rank !== "5"),
    stage: "WAITING_FOR_TURN",
    turnIndex: 0,
    turnId: randomUUID(),
    deadline: Date.now() + 45000,
    events: [],
    processed: [],
    createdAt: 0,
    updatedAt: 0,
    winners: [],
  };
}
const stamp = (r: Room) => ({ actionId: randomUUID(), turnId: r.turnId });
function rank(r: Room) {
  submitQuestion(r, r.players[0].id, {
    type: "askRank",
    ...stamp(r),
    targetId: r.players[1].id,
    rank: "5",
  });
}
function amount(r: Room, n = 2) {
  submitQuestion(r, r.players[0].id, {
    type: "askAmount",
    ...stamp(r),
    amount: n,
  });
}
test("rank correct announces to everyone and unlocks quantity without drawing or rotating", () => {
  const r = fixture(),
    deadline = r.deadline;
  rank(r);
  assert.equal(r.stage, "WAITING_FOR_AMOUNT");
  assert.equal(r.turnIndex, 0);
  assert.equal(r.deck.length, 48);
  assert.equal(r.deadline, deadline);
  assert.equal(r.latestQuestion?.correct, true);
  assert.equal(r.latestQuestion?.step, "rank");
  for (const p of r.players) {
    const v = sanitizeGameState(r, p.id);
    assert.equal(v.currentPlayerId, r.players[0].id);
    assert.deepEqual(v.latestQuestion, r.latestQuestion);
    assert.equal(v.pendingQuestion?.rank, "5");
    assert.equal(v.pendingQuestion?.amount, undefined);
    assert.equal(v.latestQuestion?.suits, undefined);
  }
});
test("wrong rank immediately draws one and ends turn", () => {
  const r = fixture();
  r.players[1].hand = [];
  const turn = r.turnId;
  rank(r);
  assert.equal(r.latestQuestion?.correct, false);
  assert.equal(r.latestQuestion?.step, "rank");
  assert.notEqual(r.turnId, turn);
  assert.equal(r.players[0].hand.length, 2);
  assert.equal(r.pendingQuestion, null);
});
test("rank failure with an empty pile ends without drawing", () => {
  const r = fixture();
  r.players[1].hand = [];
  r.deck = [];
  rank(r);
  assert.equal(r.players[0].hand.length, 1);
  assert.equal(r.turnIndex, 2);
});
test("correct amount is public and unlocks suits in same turn", () => {
  const r = fixture();
  rank(r);
  amount(r);
  assert.equal(r.stage, "WAITING_FOR_SUITS");
  assert.equal(r.pendingQuestion?.amount, 2);
  assert.equal(r.latestQuestion?.step, "amount");
  assert.equal(r.latestQuestion?.correct, true);
  assert.equal(r.turnIndex, 0);
  assert.equal(r.deck.length, 48);
});
test("wrong amount immediately draws one and never reveals actual suits or count", () => {
  const r = fixture();
  rank(r);
  amount(r, 1);
  assert.equal(r.stage, "WAITING_FOR_TURN");
  assert.equal(r.turnIndex, 1);
  assert.equal(r.players[0].hand.length, 2);
  assert.equal(r.deck.length, 47);
  assert.equal(r.latestQuestion?.amount, 1);
  assert.equal(r.latestQuestion?.correct, false);
  assert.equal(r.pendingQuestion, null);
  assert.ok(!JSON.stringify(r.latestQuestion).includes("clubs"));
});
test("wrong amount with empty pile ends without a card", () => {
  const r = fixture();
  rank(r);
  r.deck = [];
  amount(r, 1);
  assert.equal(r.players[0].hand.length, 1);
  assert.equal(r.turnIndex, 1);
});
test("correct suits transfer only after the first two stages pass", () => {
  const r = fixture();
  const originalTurn = r.turnId;
  rank(r);
  amount(r);
  submitQuestion(r, r.players[0].id, {
    type: "askSuits",
    ...stamp(r),
    suits: ["diamonds", "clubs"],
  });
  assert.equal(r.players[0].hand.length, 3);
  assert.equal(r.latestQuestion?.step, "suits");
  assert.equal(r.latestQuestion?.correct, true);
  assert.equal(r.turnIndex, 0);
  assert.notEqual(r.turnId, originalTurn);
  assert.equal(r.stage, "WAITING_FOR_TURN");
  assert.equal(r.deck.length, 48);
  assert.equal(r.pendingQuestion, null);
});
test("wrong suits draw exactly one and end turn", () => {
  const r = fixture();
  rank(r);
  amount(r);
  submitQuestion(r, r.players[0].id, {
    type: "askSuits",
    ...stamp(r),
    suits: ["hearts", "clubs"],
  });
  assert.equal(r.players[0].hand.length, 2);
  assert.equal(r.players[1].hand.length, 2);
  assert.equal(r.deck.length, 47);
  assert.equal(r.latestQuestion?.correct, false);
  assert.equal(r.turnIndex, 1);
});
test("cannot skip quantity, revise rank after success, or use old all-at-once protocol", () => {
  const r = fixture();
  assert.throws(() => amount(r), /stage/);
  rank(r);
  assert.throws(() => rank(r), /stage/);
  assert.throws(
    () =>
      submitQuestion(r, r.players[0].id, {
        type: "askSuits",
        ...stamp(r),
        suits: ["clubs", "diamonds"],
      }),
    /stage/,
  );
  assert.equal(
    commandSchema.safeParse({ type: "guess", guess: {} }).success,
    false,
  );
});
test("each stage is idempotent and rejects out-of-turn and stale commands", () => {
  const r = fixture();
  const c: QuestionCommand = {
    type: "askRank",
    ...stamp(r),
    targetId: r.players[1].id,
    rank: "5",
  };
  assert.throws(() => submitQuestion(r, r.players[1].id, c), /Not your turn/);
  submitQuestion(r, r.players[0].id, c);
  const saved = structuredClone(r);
  submitQuestion(r, r.players[0].id, c);
  assert.deepEqual(r, saved);
  assert.throws(
    () =>
      submitQuestion(r, r.players[0].id, {
        type: "askAmount",
        actionId: randomUUID(),
        turnId: randomUUID(),
        amount: 2,
      }),
    /ended/,
  );
});
test("reconnect view restores the confirmed stage without revealing unasked suits", () => {
  const r = fixture();
  rank(r);
  amount(r);
  const restored = JSON.parse(JSON.stringify(r)) as Room;
  const v = sanitizeGameState(restored, r.players[0].id);
  assert.equal(v.stage, "WAITING_FOR_SUITS");
  assert.deepEqual(v.pendingQuestion, {
    askerId: r.players[0].id,
    targetId: r.players[1].id,
    rank: "5",
    amount: 2,
  });
  assert.equal(v.latestQuestion?.suits, undefined);
});
test("timer remains one total-turn deadline and expiry cancels pending question", () => {
  const r = fixture();
  rank(r);
  r.deadline = 1;
  assert.throws(() => amount(r), /expired/);
  advanceTurn(r);
  assert.equal(r.turnIndex, 1);
  assert.equal(r.pendingQuestion, null);
  assert.equal(r.players[0].hand.length, 1);
});
test("latest question replaces previous question instead of appending UI history", () => {
  const r = fixture();
  rank(r);
  const id = r.latestQuestion?.id;
  amount(r);
  assert.notEqual(r.latestQuestion?.id, id);
  assert.equal(r.latestQuestion?.step, "amount");
  assert.equal(
    sanitizeGameState(r, r.players[2].id).latestQuestion?.asker,
    "Alex",
  );
});
test("target forfeit clears pending question and allows a new target without penalty", () => {
  const r = fixture();
  rank(r);
  const deadline = r.deadline;
  forfeit(r, r.players[1].id);
  assert.equal(r.stage, "WAITING_FOR_TURN");
  assert.equal(r.turnIndex, 0);
  assert.equal(r.pendingQuestion, null);
  assert.equal(r.deadline, deadline);
  assert.equal(r.players[0].hand.length, 1);
});
