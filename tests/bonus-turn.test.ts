import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDeck } from "../packages/game-engine/index.js";
import { submitQuestion } from "../packages/game-engine/questions.js";
import { player } from "../apps/server/rooms.js";
import { questionAnnouncement } from "../packages/shared/announcements.js";
import type { Room } from "../packages/shared/types.js";
test("successful set earns fresh turn and timer; duplicate does not grant a second bonus", () => {
  const cards = createDeck(),
    a = player("Alex", "a"),
    b = player("Sam", "b");
  a.hand = cards.filter((c) => c.rank === "J" && c.suit !== "clubs");
  b.hand = cards.filter((c) => c.rank === "J" && c.suit === "clubs");
  const r: Room = {
    code: "ABC234",
    hostId: a.id,
    passwordHash: null,
    settings: { name: "Test", maxPlayers: 2, timer: 45, privacy: "private" },
    players: [a, b],
    deck: cards.filter((c) => c.rank !== "J"),
    stage: "WAITING_FOR_TURN",
    turnIndex: 0,
    turnId: randomUUID(),
    deadline: 45000,
    events: [],
    processed: [],
    createdAt: 0,
    updatedAt: 0,
    winners: [],
  };
  const stamp = () => ({ actionId: randomUUID(), turnId: r.turnId });
  submitQuestion(
    r,
    a.id,
    { type: "askRank", ...stamp(), targetId: b.id, rank: "J" },
    1000,
  );
  assert.match(r.events.at(-1)!.text, /Alex guessed J correctly.*Sam/);
  submitQuestion(r, a.id, { type: "askAmount", ...stamp(), amount: 1 }, 2000);
  assert.match(r.events.at(-1)!.text, /Alex guessed one correctly.*one J/);
  const final = {
    type: "askSuits" as const,
    ...stamp(),
    suits: ["clubs" as const],
  };
  submitQuestion(r, a.id, final, 3000);
  assert.equal(r.turnIndex, 0);
  assert.equal(r.deadline, 48000);
  assert.deepEqual(a.completed, ["J"]);
  assert.equal(a.hand.length, 1); // Empty-hand refill at beginning of earned turn.
  const saved = structuredClone(r);
  submitQuestion(r, a.id, final, 4000);
  assert.deepEqual(r, saved);
  submitQuestion(
    r,
    a.id,
    { type: "askRank", ...stamp(), targetId: b.id, rank: a.hand[0].rank },
    5000,
  );
  assert.equal(r.turnIndex, 1); // A subsequent failure gives up the turn.
});
test("quantity announcement specifies the guessed number and rank", () => {
  assert.equal(
    questionAnnouncement({
      id: "test",
      asker: "Alex",
      target: "Sam",
      rank: "J",
      step: "amount",
      amount: 2,
      correct: true,
    }),
    "Alex guessed two correctly — Sam has two Js.",
  );
});
