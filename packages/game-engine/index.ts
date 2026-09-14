import { randomInt, randomUUID } from "node:crypto";
import {
  ranks,
  suits,
  type Card,
  type Room,
  type Player,
  type Guess,
  type View,
  type GameEvent,
} from "../shared/types.js";
export class RuleError extends Error {}
export function requireRule(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new RuleError(message);
}
export function createDeck(): Card[] {
  return ranks.flatMap((rank) =>
    suits.map((suit) => ({ id: `${rank}-${suit}`, rank, suit })),
  );
}
export function shuffleDeck(cards: Card[]): Card[] {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function event(
  room: Room,
  text: string,
  kind: GameEvent["kind"] = "info",
  extra: Partial<GameEvent> = {},
) {
  room.events.push({ id: randomUUID(), text, kind, ...extra });
  room.events = room.events.slice(-80);
}
export function detectCompletedSets(room: Room, player: Player) {
  for (const rank of ranks)
    if (player.hand.filter((c) => c.rank === rank).length === 4) {
      player.hand = player.hand.filter((c) => c.rank !== rank);
      player.completed.push(rank);
      event(room, `${player.name} completed the ${rank}s!`, "set", {
        actor: player.id,
      });
    }
}
export function drawCard(room: Room, player: Player) {
  const card = room.deck.pop();
  if (card) {
    player.hand.push(card);
    event(room, `${player.name} drew a card.`, "draw", { actor: player.id });
    detectCompletedSets(room, player);
  }
}
export function checkGameEnd(room: Room): boolean {
  const active = room.players.filter((p) => !p.left);
  const complete =
    room.players.reduce((n, p) => n + p.completed.length, 0) === 13;
  const interactions = active.some((p) =>
    p.hand.some((c) =>
      active.some(
        (q) => q.id !== p.id && q.hand.some((d) => d.rank === c.rank),
      ),
    ),
  );
  if (complete || active.length < 2 || (!room.deck.length && !interactions)) {
    room.stage = "GAME_OVER";
    room.deadline = null;
    const high = Math.max(...active.map((p) => p.completed.length));
    room.winners = active
      .filter((p) => p.completed.length === high)
      .map((p) => p.id);
    event(
      room,
      room.winners.length > 1
        ? "The game ends in a tie."
        : `${active.find((p) => p.id === room.winners[0])?.name ?? "Nobody"} wins!`,
      "win",
    );
    return true;
  }
  return false;
}
export function beginTurn(room: Room, now = Date.now()) {
  room.pendingQuestion = null;
  if (checkGameEnd(room)) return;
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[room.turnIndex];
    if (!p.left && (p.hand.length || room.deck.length)) {
      if (!p.hand.length) drawCard(room, p);
      room.stage = "WAITING_FOR_TURN";
      room.turnId = randomUUID();
      room.deadline = room.settings.timer
        ? now + room.settings.timer * 1000
        : null;
      return;
    }
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
  }
  checkGameEnd(room);
}
export function advanceTurn(room: Room, now = Date.now()) {
  room.stage = "TURN_END";
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  beginTurn(room, now);
}
export function startGame(room: Room, now = Date.now()) {
  requireRule(room.stage === "LOBBY", "The game has already started.");
  const active = room.players.filter((p) => !p.left);
  requireRule(active.length >= 2, "At least 2 players are needed.");
  requireRule(
    active.every((p) => p.connected),
    "Wait for all players to reconnect or remove them.",
  );
  room.players = active;
  room.stage = "DEALING";
  room.deck = shuffleDeck(createDeck());
  room.events = [];
  room.winners = [];
  room.processed = [];
  room.pendingQuestion = null;
  room.latestQuestion = null;
  for (const p of active) {
    p.hand = [];
    p.completed = [];
    for (let i = 0; i < 4; i++) p.hand.push(room.deck.pop()!);
    detectCompletedSets(room, p);
  }
  room.turnIndex = randomInt(active.length);
  event(room, "The cards are dealt. Let the guessing begin.");
  beginTurn(room, now);
}
export function legalChoices(player: Player) {
  return Object.fromEntries(
    [...new Set(player.hand.map((c) => c.rank))].map((rank) => {
      const available = suits.filter(
        (s) => !player.hand.some((c) => c.rank === rank && c.suit === s),
      );
      return [
        rank,
        {
          amounts: Array.from(
            { length: Math.min(3, available.length) },
            (_, i) => i + 1,
          ),
          suits: available,
        },
      ];
    }),
  );
}
export function validateAsk(
  room: Room,
  playerId: string,
  guess: Guess,
  now = Date.now(),
) {
  requireRule(
    room.stage === "WAITING_FOR_TURN",
    "The game is not accepting guesses.",
  );
  const player = room.players[room.turnIndex];
  requireRule(
    player.id === playerId && !player.left && player.connected,
    "Not your turn.",
  );
  requireRule(guess.turnId === room.turnId, "This turn has already ended.");
  requireRule(
    room.deadline === null || now < room.deadline,
    "Your turn has expired.",
  );
  const target = room.players.find((p) => p.id === guess.targetId && !p.left);
  requireRule(target && target.id !== player.id, "Choose another player.");
  const legal = legalChoices(player)[guess.rank];
  requireRule(legal, "You can only ask about ranks in your hand.");
  requireRule(
    legal.amounts.includes(guess.amount),
    "That amount is impossible.",
  );
  requireRule(
    guess.suits.length === guess.amount &&
      new Set(guess.suits).size === guess.amount,
    "Choose exactly the required number of different suits.",
  );
  requireRule(
    guess.suits.every((s) => legal.suits.includes(s)),
    "You already hold one of those suits.",
  );
  return { player, target };
}
export function resolveGuess(
  room: Room,
  playerId: string,
  guess: Guess,
  now = Date.now(),
) {
  const key = `${playerId}:${guess.actionId}`;
  if (room.processed.includes(key)) return;
  const { player, target } = validateAsk(room, playerId, guess, now);
  room.stage = "RESOLVING_GUESS";
  const cards = target.hand.filter((c) => c.rank === guess.rank);
  event(room, `${player.name} asked ${target.name} about ${guess.rank}s.`);
  const success =
    cards.length === guess.amount &&
    cards.every((c) => guess.suits.includes(c.suit));
  if (success) {
    target.hand = target.hand.filter((c) => c.rank !== guess.rank);
    player.hand.push(...cards);
    event(
      room,
      `${player.name} correctly took ${cards.length} ${guess.rank}${cards.length === 1 ? "" : "s"} from ${target.name}.`,
      "success",
      { actor: player.id, target: target.id, cards },
    );
  } else {
    event(
      room,
      `Incorrect guess.${room.deck.length ? "" : " The draw pile is empty."}`,
    );
    drawCard(room, player);
  }
  room.stage = "CHECKING_SETS";
  detectCompletedSets(room, player);
  room.processed.push(key);
  room.processed = room.processed.slice(-512);
  advanceTurn(room, now);
}
export function forfeit(room: Room, playerId: string, now = Date.now()) {
  const p = room.players.find((p) => p.id === playerId);
  if (!p || p.left) return;
  p.left = true;
  p.connected = false;
  room.deck = shuffleDeck([...room.deck, ...p.hand]);
  p.hand = [];
  event(room, `${p.name} left the game.`);
  if (room.stage === "LOBBY") {
    room.players = room.players.filter((q) => q.id !== p.id);
  } else if (room.stage !== "GAME_OVER") {
    if (!checkGameEnd(room)) {
      if (room.players[room.turnIndex].id === p.id) advanceTurn(room, now);
      else if (room.pendingQuestion?.targetId === p.id) {
        // A departed target cannot finish the ongoing question. Allow the same
        // player to choose again, preserving the original turn deadline.
        room.pendingQuestion = null;
        room.stage = "WAITING_FOR_TURN";
        room.turnId = randomUUID();
        event(room, "The selected player left. Choose another player.");
      }
    }
  }
  migrateHost(room);
}
export function migrateHost(room: Room) {
  if (!room.players.some((p) => p.id === room.hostId && !p.left)) {
    const next = room.players.find((p) => p.connected && !p.left);
    if (next) {
      room.hostId = next.id;
      event(room, `${next.name} is now the room host.`);
    }
  }
}
export function sanitizeGameState(room: Room, viewerId: string): View {
  const viewer = room.players.find((p) => p.id === viewerId && !p.left);
  requireRule(viewer, "You are no longer in this room.");
  return {
    code: room.code,
    hostId: room.hostId,
    settings: { ...room.settings },
    passwordProtected: !!room.passwordHash,
    stage: room.stage,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      completed: [...p.completed],
      connected: p.connected,
      ready: p.ready,
      left: p.left,
      cardCount: p.hand.length,
    })),
    myId: viewerId,
    myHand: viewer.hand.map((c) => ({ ...c })),
    drawCount: room.deck.length,
    turnId: room.turnId,
    currentPlayerId: [
      "WAITING_FOR_TURN",
      "WAITING_FOR_AMOUNT",
      "WAITING_FOR_SUITS",
    ].includes(room.stage)
      ? room.players[room.turnIndex].id
      : null,
    deadline: room.deadline,
    events: room.events.map((e) => ({
      ...e,
      cards: e.cards?.map((c) => ({ ...c })),
    })),
    winners: [...room.winners],
    legal: legalChoices(viewer),
    pendingQuestion: room.pendingQuestion ? { ...room.pendingQuestion } : null,
    latestQuestion: room.latestQuestion
      ? {
          ...room.latestQuestion,
          ...(room.latestQuestion.suits
            ? { suits: [...room.latestQuestion.suits] }
            : {}),
        }
      : null,
  };
}
