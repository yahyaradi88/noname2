import { z } from "zod";
import { ranks, suits } from "../../packages/shared/types.js";
const name = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(
    /^[\p{L}\p{N} ._'’-]+$/u,
    "Use letters, numbers, spaces or simple punctuation.",
  );
const capacity = z.number().int().min(2).max(8);
const timer = z.union([
  z.literal(0),
  z.literal(15),
  z.literal(30),
  z.literal(45),
  z.literal(60),
]);
const password = z
  .string()
  .max(64)
  .refine(
    (s) => Buffer.byteLength(s, "utf8") <= 72,
    "Password must be at most 72 UTF-8 bytes.",
  );
export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("create"),
      name,
      roomName: z.string().trim().max(40),
      maxPlayers: capacity,
      timer,
      privacy: z.enum(["public", "private"]),
      password,
    })
    .strict(),
  z
    .object({
      type: z.literal("join"),
      name,
      code: z.string().regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/),
      password,
    })
    .strict(),
  z
    .object({
      type: z.literal("askRank"),
      actionId: z.uuid(),
      turnId: z.uuid(),
      targetId: z.uuid(),
      rank: z.enum(ranks),
    })
    .strict(),
  z
    .object({
      type: z.literal("askAmount"),
      actionId: z.uuid(),
      turnId: z.uuid(),
      amount: z.number().int().min(1).max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("askSuits"),
      actionId: z.uuid(),
      turnId: z.uuid(),
      suits: z.array(z.enum(suits)).min(1).max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("settings"),
      maxPlayers: capacity,
      timer,
      password: password.optional(),
    })
    .strict(),
  z.object({ type: z.literal("kick"), playerId: z.uuid() }).strict(),
  ...(["ready", "start", "leave", "reset"] as const).map((type) =>
    z.object({ type: z.literal(type) }).strict(),
  ),
]);
export class RateLimiter {
  private buckets = new Map<string, { count: number; until: number }>();
  allow(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.until <= now) {
      b = { count: 0, until: now + windowMs };
      this.buckets.set(key, b);
    }
    return ++b.count <= limit;
  }
  clean() {
    const now = Date.now();
    for (const [key, b] of this.buckets)
      if (b.until <= now) this.buckets.delete(key);
  }
}
