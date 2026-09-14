import type { PublicQuestion } from "./types.js";
export function questionAnnouncement(q: PublicQuestion): string {
  if (!q.correct)
    return `${q.asker} asked ${q.target} — incorrect. Turn ended.`;
  if (q.step === "rank")
    return `${q.asker} guessed ${q.rank} correctly — ${q.target} has ${q.rank}s.`;
  const amount = ["zero", "one", "two", "three"][q.amount ?? 0];
  if (q.step === "amount")
    return `${q.asker} guessed ${amount} correctly — ${q.target} has ${amount} ${q.rank}${q.amount === 1 ? "" : "s"}.`;
  return `${q.asker} guessed the ${q.rank} suits correctly and took ${q.target}’s cards.`;
}
