import { useEffect, useState, type CSSProperties } from "react";
import {
  ranks,
  suits,
  type View,
  type Command,
} from "../../../packages/shared/types.js";
import { Avatar, Card, Sets } from "./components.js";
import { AskPanel, LatestQuestion } from "./AskPanel.js";
export function Table({
  view,
  send,
  busy,
  reduced,
}: {
  view: View;
  send: (c: Command) => Promise<boolean>;
  busy: boolean;
  reduced: boolean;
}) {
  const [target, setTarget] = useState("");
  const [sort, setSort] = useState("rank");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setTarget("");
  }, [view.turnId]);
  useEffect(() => {
    if (
      target &&
      !view.players.some(
        (p) => p.id === (view.pendingQuestion?.targetId || target) && !p.left,
      )
    ) {
      setTarget("");
    }
  }, [target, view.players]);
  const me = view.players.find((p) => p.id === view.myId)!;
  const mine = view.currentPlayerId === me.id;
  const others = view.players.filter((p) => p.id !== me.id && !p.left);
  const hand = [...view.myHand].sort((a, b) =>
    sort === "rank"
      ? ranks.indexOf(a.rank) - ranks.indexOf(b.rank) ||
        suits.indexOf(a.suit) - suits.indexOf(b.suit)
      : suits.indexOf(a.suit) - suits.indexOf(b.suit) ||
        ranks.indexOf(a.rank) - ranks.indexOf(b.rank),
  );
  const latest = view.events.at(-1);
  const motion = [...view.events]
    .reverse()
    .find((e) => (e.kind === "success" && e.cards) || e.kind === "draw");
  const sorted = [...view.players].sort(
    (a, b) =>
      Number(a.left) - Number(b.left) ||
      b.completed.length - a.completed.length,
  );
  return (
    <main className="game-layout">
      <section className="game-main">
        <div className="table-topline">
          <span>{view.settings.name}</span>
          <span>
            {view.players.reduce((n, p) => n + p.completed.length, 0)} / 13 sets
            collected
          </span>
        </div>
        <div className={`felt count-${others.length}`}>
          <div className="table-stitch" />
          <div className="opponents">
            {others.map((p, i) => {
              const angle =
                others.length === 1
                  ? -Math.PI / 2
                  : others.length === 3
                    ? Math.PI + (i * Math.PI) / 2
                    : Math.PI + ((i + 1) / (others.length + 1)) * Math.PI;
              const style = {
                "--seat-x": `${50 + 43 * Math.cos(angle)}%`,
                "--seat-y": `${49 + 36 * Math.sin(angle)}%`,
              } as CSSProperties;
              return (
                <button
                  style={style}
                  key={p.id}
                  className={`opponent ${p.id === view.currentPlayerId ? "active" : ""} ${p.id === (view.pendingQuestion?.targetId || target) ? "selected" : ""}`}
                  disabled={!mine || busy || view.stage !== "WAITING_FOR_TURN"}
                  onClick={() => {
                    setTarget(p.id);
                  }}
                  aria-label={`Ask ${p.name}, ${p.cardCount} cards, ${p.completed.length} sets`}
                  aria-pressed={
                    p.id === (view.pendingQuestion?.targetId || target)
                  }
                >
                  <Avatar player={p} />
                  <strong>{p.name}</strong>
                  <span className="opponent-meta">
                    {p.cardCount} cards · {p.completed.length} sets
                  </span>
                  {!p.connected && <small>Reconnecting</small>}
                  <div className="mini-fan" aria-hidden="true">
                    {Array.from(
                      { length: Math.min(p.cardCount, 5) },
                      (_, n) => (
                        <Card key={n} back small />
                      ),
                    )}
                  </div>
                  <Sets ranks={p.completed} />
                </button>
              );
            })}
          </div>
          <div className="draw-area">
            <div className="deck-stack">
              <Card back />
              <Card back />
              <Card back />
            </div>
            <span className="eyebrow">DRAW PILE</span>
            <strong>
              {view.drawCount ? `${view.drawCount} cards` : "Empty"}
            </strong>
          </div>
          <div
            className={`turn-banner ${mine ? "your-turn" : ""}`}
            role="status"
          >
            <span>
              {view.stage === "GAME_OVER"
                ? "THE TABLE IS COMPLETE"
                : mine
                  ? "YOUR TURN"
                  : `Waiting for ${view.players.find((p) => p.id === view.currentPlayerId)?.name ?? "the table"}…`}
            </span>
            {view.deadline && (
              <b aria-label="Seconds remaining">
                {Math.max(0, Math.ceil((view.deadline - now) / 1000))}s
              </b>
            )}
          </div>
          {motion && !reduced && (
            <div
              key={motion.id}
              className={`moving-card ${motion.kind}`}
              aria-hidden="true"
            >
              <Card back />
            </div>
          )}
        </div>
        <section className="hand-section">
          <div className="hand-title">
            <Avatar player={me} />
            <div>
              <h2>
                Your hand <span>{hand.length} cards</span>
              </h2>
              <p>
                {mine
                  ? "Choose a player, then make your guess."
                  : "Keep an eye on what changes."}
              </p>
            </div>
            <label className="sort-label">
              <span className="sr-only">Sort hand</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="rank">Sort by rank</option>
                <option value="suit">Sort by suit</option>
              </select>
            </label>
          </div>
          <div
            className="hand"
            tabIndex={0}
            aria-label="Your cards, scroll horizontally"
          >
            {hand.map((c) => (
              <Card key={c.id} card={c} />
            ))}
            {!hand.length && (
              <p className="empty-hand">
                {view.drawCount
                  ? "You’ll draw a card when your turn begins."
                  : "No active cards. Your completed sets still count."}
              </p>
            )}
          </div>
          <div className="your-sets">
            <span className="eyebrow">YOUR SETS · {me.completed.length}</span>
            {me.completed.length ? (
              <Sets ranks={me.completed} />
            ) : (
              <span className="muted">Four of a rank makes one set.</span>
            )}
          </div>
        </section>
      </section>
      <aside className="game-sidebar">
        {view.stage === "GAME_OVER" ? (
          <section className="panel winner">
            <span className="trophy">♛</span>
            <span className="eyebrow">GAME OVER</span>
            <h2>
              {view.winners.length > 1
                ? "A shared victory."
                : `${view.players.find((p) => p.id === view.winners[0])?.name ?? "Nobody"} wins!`}
            </h2>
            <p>
              {view.winners.length > 1
                ? view.players
                    .filter((p) => view.winners.includes(p.id))
                    .map((p) => p.name)
                    .join(" & ")
                : "A very good set of guesses."}
            </p>
            <ol className="standings">
              {sorted.map((p) => (
                <li key={p.id}>
                  <span>
                    {p.name}
                    {p.left ? " · forfeited" : ""}
                  </span>
                  <b>{p.completed.length} sets</b>
                </li>
              ))}
            </ol>
            {view.hostId === view.myId ? (
              <button
                className="primary full"
                disabled={busy}
                onClick={() => void send({ type: "reset" })}
              >
                Play again · return to lobby
              </button>
            ) : (
              <p>Waiting for the host to return to the lobby.</p>
            )}
          </section>
        ) : (
          <AskPanel
            view={view}
            send={send}
            busy={busy}
            target={target}
            setTarget={setTarget}
          />
        )}
        <LatestQuestion view={view} />
        <div className="sr-only" role="status">
          {latest?.text}
        </div>
      </aside>
    </main>
  );
}
