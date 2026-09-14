import { randomUUID } from "node:crypto";
import type {
  Command,
  Room,
  Player,
  PublicQuestion,
  Stage,
} from "../shared/types.js";
import {
  advanceTurn,
  beginTurn,
  detectCompletedSets,
  drawCard,
  event,
  legalChoices,
  requireRule,
} from "./index.js";
import { questionAnnouncement } from "../shared/announcements.js";

export type QuestionCommand = Extract<
  Command,
  { type: "askRank" | "askAmount" | "askSuits" }
>;
export const activeStages: Stage[] = [
  "WAITING_FOR_TURN",
  "WAITING_FOR_AMOUNT",
  "WAITING_FOR_SUITS",
];

function record(
  room: Room,
  player: Player,
  target: Player,
  question: Omit<PublicQuestion, "id" | "asker" | "target">,
) {
  room.latestQuestion = {
    id: randomUUID(),
    asker: player.name,
    target: target.name,
    ...question,
  };
  const label =
    question.step === "rank"
      ? `Rank ${question.rank}`
      : question.step === "amount"
        ? `Quantity ${question.amount} of ${question.rank}`
        : `Suits for ${question.rank}`;
  event(
    room,
    question.correct
      ? questionAnnouncement(room.latestQuestion)
      : `${player.name} asked ${target.name}: ${label}. Incorrect.`,
    question.correct ? "success" : "info",
    { actor: player.id, target: target.id },
  );
}

function failed(room: Room, player: Player, now: number) {
  if (!room.deck.length) event(room, "The draw pile is empty. The turn ends.");
  drawCard(room, player);
  advanceTurn(room, now);
}

/** Every stage is committed before the next question becomes available. */
export function submitQuestion(
  room: Room,
  playerId: string,
  command: QuestionCommand,
  now = Date.now(),
) {
  const key = `${playerId}:${command.actionId}`;
  if (room.processed.includes(key)) return;
  const expected: Record<QuestionCommand["type"], Stage> = {
    askRank: "WAITING_FOR_TURN",
    askAmount: "WAITING_FOR_AMOUNT",
    askSuits: "WAITING_FOR_SUITS",
  };
  requireRule(
    room.stage === expected[command.type],
    "This question is not available at this stage.",
  );
  const player = room.players[room.turnIndex];
  requireRule(
    player?.id === playerId && player.connected && !player.left,
    "Not your turn.",
  );
  requireRule(command.turnId === room.turnId, "This turn has already ended.");
  requireRule(
    room.deadline === null || now < room.deadline,
    "Your turn has expired.",
  );
  const pending = room.pendingQuestion;
  const targetId =
    command.type === "askRank" ? command.targetId : pending?.targetId;
  const target = room.players.find((p) => p.id === targetId && !p.left);
  requireRule(target && target.id !== player.id, "Choose another player.");
  const rank = command.type === "askRank" ? command.rank : pending?.rank;
  requireRule(rank, "Choose a rank first.");
  const legal = legalChoices(player)[rank];
  requireRule(legal, "You can only ask about ranks in your hand.");
  if (command.type !== "askRank")
    requireRule(
      pending?.askerId === playerId,
      "This question belongs to another player.",
    );
  const actual = target.hand.filter((c) => c.rank === rank);
  if (command.type === "askAmount")
    requireRule(
      legal.amounts.includes(command.amount),
      "That amount is impossible.",
    );
  if (command.type === "askSuits") {
    requireRule(pending?.amount, "Confirm the quantity first.");
    requireRule(
      command.suits.length === pending.amount &&
        new Set(command.suits).size === pending.amount,
      "Choose exactly the required number of different suits.",
    );
    requireRule(
      command.suits.every((s) => legal.suits.includes(s)),
      "You already hold one of those suits.",
    );
  }
  // Remember only validated commands. An invalid payload cannot consume a stage.
  room.processed.push(key);
  room.processed = room.processed.slice(-512);
  if (command.type === "askRank") {
    const correct = actual.length > 0;
    record(room, player, target, { step: "rank", rank, correct });
    if (correct) {
      room.pendingQuestion = { askerId: playerId, targetId: target.id, rank };
      room.stage = "WAITING_FOR_AMOUNT";
    } else failed(room, player, now);
    return;
  }
  if (command.type === "askAmount") {
    const correct = actual.length === command.amount;
    record(room, player, target, {
      step: "amount",
      rank,
      amount: command.amount,
      correct,
    });
    if (correct) {
      room.pendingQuestion = {
        askerId: playerId,
        targetId: target.id,
        rank,
        amount: command.amount,
      };
      room.stage = "WAITING_FOR_SUITS";
    } else failed(room, player, now);
    return;
  }
  room.stage = "RESOLVING_GUESS";
  const correct =
    actual.length === pending!.amount &&
    actual.every((c) => command.suits.includes(c.suit));
  record(room, player, target, {
    step: "suits",
    rank,
    amount: pending!.amount,
    suits: [...command.suits],
    correct,
  });
  if (!correct) {
    failed(room, player, now);
    return;
  }
  target.hand = target.hand.filter((c) => c.rank !== rank);
  player.hand.push(...actual);
  event(
    room,
    `${player.name} took ${actual.length} ${rank}${actual.length === 1 ? "" : "s"} from ${target.name}.`,
    "success",
    { actor: player.id, target: target.id, cards: actual },
  );
  room.stage = "CHECKING_SETS";
  detectCompletedSets(room, player);
  beginTurn(room, now);
  if (
    activeStages.includes(room.stage) &&
    room.players[room.turnIndex].id === player.id
  ) {
    event(room, `${player.name} takes another turn.`, "turn", {
      actor: player.id,
    });
  }
}
