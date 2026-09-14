import { useEffect, useState } from "react";
import {
  ranks,
  suits,
  type Command,
  type Suit,
  type View,
} from "../../../packages/shared/types.js";
import { Avatar, symbols } from "./components.js";
import { questionAnnouncement } from "../../../packages/shared/announcements.js";

export function AskPanel({
  view,
  send,
  busy,
  target,
  setTarget,
}: {
  view: View;
  send: (c: Command) => Promise<boolean>;
  busy: boolean;
  target: string;
  setTarget: (id: string) => void;
}) {
  const [chosen, setChosen] = useState<Suit[]>([]);
  const mine = view.currentPlayerId === view.myId;
  const pending = view.pendingQuestion;
  const opponent = view.players.find(
    (p) => p.id === (pending?.targetId || target),
  );
  const others = view.players.filter((p) => p.id !== view.myId && !p.left);
  const rank = pending?.rank;
  const amount = pending?.amount ?? 0;
  useEffect(() => setChosen([]), [view.turnId, amount]);
  const step =
    view.stage === "WAITING_FOR_SUITS"
      ? 3
      : view.stage === "WAITING_FOR_AMOUNT"
        ? 2
        : target
          ? 1
          : 0;
  const stamp = () => ({ actionId: crypto.randomUUID(), turnId: view.turnId });
  return (
    <section className={`panel ask-panel ${mine ? "available" : ""}`}>
      <span className="eyebrow">MAKE YOUR MOVE</span>
      <div className="steps" aria-label="Guess progress">
        {["Player", "Rank", "Amount", "Suits"].map((s, i) => (
          <span key={s} className={i <= step ? "done" : ""}>
            <b>{i + 1}</b>
            {s}
          </span>
        ))}
      </div>
      {!mine ? (
        <div className="waiting-message">
          <span>♧</span>
          <h2>
            Watch. Remember.
            <br />
            Make your next move.
          </h2>
          <p>
            {pending
              ? `${view.players.find((p) => p.id === pending.askerId)?.name} is asking ${opponent?.name} about ${rank}s.`
              : "Each correct answer unlocks the next question."}
          </p>
        </div>
      ) : !opponent ? (
        <>
          <h2>Who has your cards?</h2>
          <p>Choose a player around the table to start your question.</p>
          <div className="target-list">
            {others.map((p) => (
              <button
                className="secondary"
                disabled={busy}
                key={p.id}
                onClick={() => setTarget(p.id)}
              >
                <Avatar player={p} />
                <span>{p.name}</span>
                <span>→</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="ask-heading">
            <h2>Ask {opponent.name}</h2>
            {!pending && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setTarget("")}
              >
                ← Back
              </button>
            )}
          </div>
          {view.stage === "WAITING_FOR_TURN" ? (
            <>
              <p>Do they have this rank? Tap a rank to ask.</p>
              <div className="rank-options">
                {ranks
                  .filter((r) => view.legal[r])
                  .map((r) => (
                    <button
                      key={r}
                      className="rank-choice"
                      disabled={busy}
                      aria-label={`Ask about ${r}`}
                      onClick={() =>
                        void send({
                          type: "askRank",
                          ...stamp(),
                          targetId: opponent.id,
                          rank: r,
                        })
                      }
                    >
                      {r}
                    </button>
                  ))}
              </div>
              <small>A wrong answer draws a card and ends your turn.</small>
            </>
          ) : view.stage === "WAITING_FOR_AMOUNT" && rank ? (
            <>
              <div className="stage-confirmation" role="status">
                ✓ Correct — {opponent.name} has {rank}s.
              </div>
              <p>
                How many <strong>{rank}s</strong> do they have? Tap an amount to
                ask.
              </p>
              <div className="amount-options">
                {view.legal[rank]?.amounts.map((n) => (
                  <button
                    key={n}
                    disabled={busy}
                    aria-label={`Ask for ${n} ${n === 1 ? "card" : "cards"}`}
                    onClick={() =>
                      void send({ type: "askAmount", ...stamp(), amount: n })
                    }
                  >
                    <strong>{n}</strong>
                    <span>{n === 1 ? "card" : "cards"}</span>
                  </button>
                ))}
              </div>
              <small>A wrong quantity draws a card and ends your turn.</small>
            </>
          ) : view.stage === "WAITING_FOR_SUITS" && rank ? (
            <>
              <div className="stage-confirmation" role="status">
                ✓ Correct — {opponent.name} has {amount} {rank}
                {amount === 1 ? "" : "s"}.
              </div>
              <p>
                Choose exactly{" "}
                <strong>
                  {amount} {amount === 1 ? "suit" : "suits"}
                </strong>
                .
              </p>
              <div className="suit-options">
                {suits.map((s) => {
                  const unavailable = !view.legal[rank]?.suits.includes(s);
                  return (
                    <button
                      key={s}
                      aria-label={s}
                      aria-pressed={chosen.includes(s)}
                      className={`${chosen.includes(s) ? "chosen" : ""} ${s === "hearts" || s === "diamonds" ? "red-suit" : ""}`}
                      disabled={
                        busy ||
                        unavailable ||
                        (chosen.length === amount && !chosen.includes(s))
                      }
                      onClick={() =>
                        setChosen(
                          chosen.includes(s)
                            ? chosen.filter((c) => c !== s)
                            : [...chosen, s],
                        )
                      }
                    >
                      <strong>{symbols[s]}</strong>
                      <span>{s}</span>
                      {unavailable && <small>In your hand</small>}
                    </button>
                  );
                })}
              </div>
              <p className="selection-count" aria-live="polite">
                {chosen.length} of {amount} suits selected
              </p>
              <div className="guess-summary">
                <span>Your question to {opponent.name}</span>
                <strong>
                  {amount} × {rank} {chosen.map((s) => symbols[s]).join(" ")}
                </strong>
                <small>
                  {chosen.length
                    ? chosen.join(" + ")
                    : "Select your suits above"}
                </small>
              </div>
              <button
                className="primary full"
                disabled={busy || chosen.length !== amount}
                onClick={() =>
                  void send({ type: "askSuits", ...stamp(), suits: chosen })
                }
              >
                {busy ? "Checking your answer…" : "Ask about suits →"}
              </button>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

export function LatestQuestion({ view }: { view: View }) {
  const q = view.latestQuestion;
  return (
    <section className="panel activity">
      <div className="section-heading">
        <h2>Last question</h2>
        <span>LIVE</span>
      </div>
      <div
        role="log"
        aria-label="Latest question"
        aria-live="polite"
        aria-atomic="true"
      >
        {q ? (
          <div className="latest-question" key={q.id}>
            <p>
              <strong>{q.asker}</strong> asked <strong>{q.target}</strong>
            </p>
            <h3>
              {q.step === "rank"
                ? `Do you have any ${q.rank}s?`
                : q.step === "amount"
                  ? `Do you have ${q.amount} ${q.rank}${q.amount === 1 ? "" : "s"}?`
                  : `Are your ${q.rank}s ${q.suits?.map((s) => `${symbols[s]} ${s}`).join(" + ")}?`}
            </h3>
            <span
              className={`question-result ${q.correct ? "correct" : "incorrect"}`}
            >
              {q.correct
                ? `✓ ${questionAnnouncement(q)}`
                : "Incorrect — turn ended"}
            </span>
          </div>
        ) : (
          <p className="muted">The latest question will appear here.</p>
        )}
      </div>
    </section>
  );
}
