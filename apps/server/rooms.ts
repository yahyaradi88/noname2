import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Room, Player, Command } from "../../packages/shared/types.js";
import {
  requireRule,
  startGame,
  forfeit,
  event,
} from "../../packages/game-engine/index.js";
import { submitQuestion } from "../../packages/game-engine/questions.js";
export const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function roomCode(existing: Map<string, Room>) {
  let code: string;
  do {
    code = Array.from(
      { length: 6 },
      () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)],
    ).join("");
  } while (existing.has(code));
  return code;
}
export function player(name: string, session: string): Player {
  return {
    id: randomUUID(),
    session,
    name,
    hand: [],
    completed: [],
    connected: true,
    ready: false,
    left: false,
    disconnectedAt: null,
  };
}
export function findSeat(rooms: Map<string, Room>, session: string) {
  for (const room of rooms.values()) {
    const p = room.players.find((p) => p.session === session && !p.left);
    if (p) return { room, player: p };
  }
  return null;
}
export async function execute(
  rooms: Map<string, Room>,
  session: string,
  cmd: Command,
): Promise<Room | null> {
  let seat = findSeat(rooms, session);
  if (cmd.type === "create") {
    requireRule(!seat, "Leave your current room first.");
    requireRule(rooms.size < 1000, "All tables are busy. Try again later.");
    const hash = cmd.password ? await bcrypt.hash(cmd.password, 12) : null;
    const p = player(cmd.name, session);
    const room: Room = {
      code: roomCode(rooms),
      hostId: p.id,
      passwordHash: hash,
      settings: {
        name: cmd.roomName || "The evening table",
        maxPlayers: cmd.maxPlayers,
        timer: cmd.timer,
        privacy: cmd.privacy,
      },
      players: [p],
      deck: [],
      stage: "LOBBY",
      turnIndex: 0,
      turnId: "",
      deadline: null,
      events: [],
      processed: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      winners: [],
    };
    rooms.set(room.code, room);
    return room;
  }
  if (cmd.type === "join") {
    requireRule(!seat, "Leave your current room first.");
    const room = rooms.get(cmd.code);
    requireRule(room, "Room not found.");
    if (room.passwordHash)
      requireRule(
        await bcrypt.compare(cmd.password, room.passwordHash),
        "Incorrect room password.",
      );
    requireRule(room.stage === "LOBBY", "This game has already started.");
    requireRule(
      room.players.length < room.settings.maxPlayers,
      "This room is full.",
    );
    requireRule(
      !room.players.some(
        (p) => p.name.toLocaleLowerCase() === cmd.name.toLocaleLowerCase(),
      ),
      "That name is already taken in this room.",
    );
    room.players.push(player(cmd.name, session));
    return room;
  }
  seat = findSeat(rooms, session);
  requireRule(seat, "Join a room first.");
  const { room, player: p } = seat;
  if (
    cmd.type === "askRank" ||
    cmd.type === "askAmount" ||
    cmd.type === "askSuits"
  ) {
    submitQuestion(room, p.id, cmd);
    return room;
  }
  if (cmd.type === "leave") {
    forfeit(room, p.id);
    return room;
  }
  if (cmd.type === "ready") {
    requireRule(room.stage === "LOBBY", "The game has already started.");
    p.ready = !p.ready;
    return room;
  }
  requireRule(room.hostId === p.id, "Only the host can do that.");
  if (cmd.type === "reset") {
    requireRule(room.stage === "GAME_OVER", "Finish the current game first.");
    room.stage = "LOBBY";
    room.players = room.players.filter((p) => !p.left);
    for (const p of room.players) {
      p.hand = [];
      p.completed = [];
      p.ready = false;
    }
    room.deck = [];
    room.events = [];
    room.processed = [];
    room.winners = [];
    room.turnId = "";
    room.pendingQuestion = null;
    room.latestQuestion = null;
    room.deadline = null;
    return room;
  }
  requireRule(
    room.stage === "LOBBY",
    "Room settings are locked during a game.",
  );
  if (cmd.type === "start") startGame(room);
  if (cmd.type === "kick") {
    requireRule(cmd.playerId !== p.id, "You cannot remove yourself.");
    requireRule(
      room.players.some((p) => p.id === cmd.playerId),
      "Player not found.",
    );
    forfeit(room, cmd.playerId);
  }
  if (cmd.type === "settings") {
    requireRule(
      cmd.maxPlayers >= room.players.length,
      "The room already has more players than that.",
    );
    room.settings.maxPlayers = cmd.maxPlayers;
    room.settings.timer = cmd.timer;
    if (cmd.password !== undefined)
      room.passwordHash = cmd.password
        ? await bcrypt.hash(cmd.password, 12)
        : null;
    event(room, "The host updated the room settings.");
  }
  return room;
}
