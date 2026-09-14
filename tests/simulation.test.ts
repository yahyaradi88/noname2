import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execute } from "../apps/server/rooms.js";
import { submitQuestion } from "../packages/game-engine/questions.js";
import type { Room, Rank } from "../packages/shared/types.js";
for (const count of [2, 4, 8])
  test(`complete ${count}-player game conserves every card and ends with 13 sets`, async () => {
    const rooms = new Map<string, Room>();
    const r = (await execute(rooms, "0", {
      type: "create",
      name: "P0",
      roomName: "Test",
      maxPlayers: count,
      timer: 0,
      privacy: "private",
      password: "",
    }))!;
    for (let i = 1; i < count; i++)
      await execute(rooms, String(i), {
        type: "join",
        code: r.code,
        name: `P${i}`,
        password: "",
      });
    await execute(rooms, "0", { type: "start" });
    let steps = 0;
    while (r.stage !== "GAME_OVER" && steps++ < 3000) {
      const actor = r.players[r.turnIndex];
      const target =
        r.players.find(
          (p) =>
            p.id !== actor.id &&
            p.hand.some((c) => actor.hand.some((a) => a.rank === c.rank)),
        ) ?? r.players.find((p) => p.id !== actor.id)!;
      const rank = (target.hand.find((c) =>
        actor.hand.some((a) => a.rank === c.rank),
      )?.rank ?? actor.hand[0].rank) as Rank;
      const actual = target.hand.filter((c) => c.rank === rank);
      submitQuestion(r, actor.id, {
        type: "askRank",
        actionId: randomUUID(),
        turnId: r.turnId,
        targetId: target.id,
        rank,
      });
      if (actual.length) {
        submitQuestion(r, actor.id, {
          type: "askAmount",
          actionId: randomUUID(),
          turnId: r.turnId,
          amount: actual.length,
        });
        submitQuestion(r, actor.id, {
          type: "askSuits",
          actionId: randomUUID(),
          turnId: r.turnId,
          suits: actual.map((c) => c.suit),
        });
      }
      const cards = [...r.deck, ...r.players.flatMap((p) => p.hand)];
      const completed = r.players.flatMap((p) => p.completed);
      assert.equal(cards.length + 4 * completed.length, 52);
      assert.equal(new Set(cards.map((c) => c.id)).size, cards.length);
      assert.equal(new Set(completed).size, completed.length);
      for (const rank of completed)
        assert.equal(
          cards.some((c) => c.rank === rank),
          false,
        );
    }
    assert.ok(steps < 3000);
    assert.equal(r.stage, "GAME_OVER");
    assert.equal(
      r.players.reduce((n, p) => n + p.completed.length, 0),
      13,
    );
    assert.ok(r.winners.length >= 1);
  });
