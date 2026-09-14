export const ranks = [
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
] as const;
export const suits = ["spades", "hearts", "diamonds", "clubs"] as const;
export type Rank = (typeof ranks)[number];
export type Suit = (typeof suits)[number];
export type Card = { id: string; rank: Rank; suit: Suit };
export type Settings = {
  name: string;
  maxPlayers: number;
  timer: number;
  privacy: "public" | "private";
};
export type Player = {
  id: string;
  session: string;
  name: string;
  hand: Card[];
  completed: Rank[];
  connected: boolean;
  ready: boolean;
  left: boolean;
  disconnectedAt: number | null;
};
export type Stage =
  | "LOBBY"
  | "DEALING"
  | "WAITING_FOR_TURN"
  | "WAITING_FOR_AMOUNT"
  | "WAITING_FOR_SUITS"
  | "RESOLVING_GUESS"
  | "CHECKING_SETS"
  | "TURN_END"
  | "GAME_OVER";
export type GameEvent = {
  id: string;
  text: string;
  kind: "info" | "draw" | "success" | "set" | "turn" | "win";
  actor?: string;
  target?: string;
  cards?: Card[];
};
export type PendingQuestion = {
  askerId: string;
  targetId: string;
  rank: Rank;
  amount?: number;
};
export type PublicQuestion = {
  id: string;
  asker: string;
  target: string;
  rank: Rank;
  step: "rank" | "amount" | "suits";
  amount?: number;
  suits?: Suit[];
  correct: boolean;
};
export type Room = {
  code: string;
  hostId: string;
  passwordHash: string | null;
  settings: Settings;
  players: Player[];
  deck: Card[];
  stage: Stage;
  turnIndex: number;
  turnId: string;
  deadline: number | null;
  events: GameEvent[];
  processed: string[];
  createdAt: number;
  updatedAt: number;
  winners: string[];
  pendingQuestion?: PendingQuestion | null;
  latestQuestion?: PublicQuestion | null;
};
export type PublicPlayer = Pick<
  Player,
  "id" | "name" | "completed" | "connected" | "ready" | "left"
> & { cardCount: number };
export type View = {
  code: string;
  hostId: string;
  settings: Settings;
  passwordProtected: boolean;
  stage: Stage;
  players: PublicPlayer[];
  myId: string;
  myHand: Card[];
  drawCount: number;
  turnId: string;
  currentPlayerId: string | null;
  deadline: number | null;
  events: GameEvent[];
  winners: string[];
  legal: Record<string, { amounts: number[]; suits: Suit[] }>;
  pendingQuestion: PendingQuestion | null;
  latestQuestion: PublicQuestion | null;
};
export type Guess = {
  actionId: string;
  turnId: string;
  targetId: string;
  rank: Rank;
  amount: number;
  suits: Suit[];
};
export type Reply = { ok: true } | { ok: false; error: string };
export type Command =
  | {
      type: "create";
      name: string;
      roomName: string;
      maxPlayers: number;
      timer: number;
      privacy: "public" | "private";
      password: string;
    }
  | { type: "join"; name: string; code: string; password: string }
  | { type: "ready" }
  | { type: "start" }
  | {
      type: "askRank";
      actionId: string;
      turnId: string;
      targetId: string;
      rank: Rank;
    }
  | { type: "askAmount"; actionId: string; turnId: string; amount: number }
  | { type: "askSuits"; actionId: string; turnId: string; suits: Suit[] }
  | { type: "leave" }
  | { type: "reset" }
  | { type: "kick"; playerId: string }
  | { type: "settings"; maxPlayers: number; timer: number; password?: string };
export interface ServerEvents {
  state: (view: View | null) => void;
  notice: (message: string) => void;
}
export interface ClientEvents {
  command: (command: Command, reply: (result: Reply) => void) => void;
}
