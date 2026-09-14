import { useState } from "react";
import type { View, Command } from "../../../packages/shared/types.js";
import { Avatar, Modal } from "./components.js";
export function Lobby({
  view,
  send,
  busy,
  copy,
}: {
  view: View;
  send: (c: Command) => Promise<boolean>;
  busy: boolean;
  copy: () => void;
}) {
  const [settings, setSettings] = useState(false);
  const host = view.hostId === view.myId;
  const me = view.players.find((p) => p.id === view.myId)!;
  return (
    <main className="lobby">
      <section className="lobby-heading">
        <span className="eyebrow">THE TABLE IS OPEN</span>
        <h1>{view.settings.name}</h1>
        <p>Good games start with good company.</p>
      </section>
      <div className="lobby-grid">
        <section className="panel seats">
          <div className="section-heading">
            <h2>At the table</h2>
            <span>
              {view.players.length} / {view.settings.maxPlayers} players
            </span>
          </div>
          {view.players.map((p) => (
            <div className="lobby-player" key={p.id}>
              <Avatar player={p} />
              <div>
                <strong>
                  {p.name}
                  {p.id === view.myId ? " (you)" : ""}
                </strong>
                <span>
                  {p.id === view.hostId
                    ? "Host"
                    : p.connected
                      ? "Connected"
                      : "Reconnecting · seat reserved"}
                </span>
              </div>
              <span className={`ready-tag ${p.ready ? "is-ready" : ""}`}>
                {p.ready ? "✓ Ready" : "Settling in"}
              </span>
              {host && p.id !== view.myId && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void send({ type: "kick", playerId: p.id })}
                  aria-label={`Remove ${p.name}`}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {Array.from(
            { length: view.settings.maxPlayers - view.players.length },
            (_, i) => (
              <div className="empty-seat" key={i}>
                <span>＋</span>
                <div>
                  Room for one more
                  <small>Share the code to invite a friend</small>
                </div>
              </div>
            ),
          )}
        </section>
        <aside className="panel lobby-aside">
          <span className="eyebrow">YOUR ROOM CODE</span>
          <button className="room-code" onClick={copy} title="Copy room code">
            {view.code}
            <span>Copy code ↗</span>
          </button>
          <div className="settings-summary">
            <div>
              <span>Turn timer</span>
              <strong>
                {view.settings.timer ? `${view.settings.timer} seconds` : "Off"}
              </strong>
            </div>
            <div>
              <span>Privacy</span>
              <strong>{view.settings.privacy}</strong>
            </div>
            <div>
              <span>Password</span>
              <strong>
                {view.passwordProtected ? "Protected" : "Not required"}
              </strong>
            </div>
          </div>
          {host && (
            <button
              className="secondary full"
              onClick={() => setSettings(true)}
            >
              Edit room settings
            </button>
          )}
          <button
            className="secondary full"
            disabled={busy}
            onClick={() => void send({ type: "ready" })}
          >
            {me.ready ? "✓ You’re ready · undo" : "I’m ready"}
          </button>
          {host ? (
            <button
              className="primary full"
              disabled={
                busy ||
                view.players.length < 2 ||
                view.players.some((p) => !p.connected)
              }
              onClick={() => void send({ type: "start" })}
            >
              Deal the cards →
            </button>
          ) : (
            <p className="muted">
              Waiting for {view.players.find((p) => p.id === view.hostId)?.name}{" "}
              to deal.
            </p>
          )}
          <small>
            At least 2 connected players to start. Ready status is a courtesy.
          </small>
        </aside>
      </div>
      {settings && (
        <Modal title="Room settings" onClose={() => setSettings(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const password = String(f.get("password"));
              if (
                await send({
                  type: "settings",
                  maxPlayers: Number(f.get("maxPlayers")),
                  timer: Number(f.get("timer")),
                  ...(f.get("changePassword") ? { password } : {}),
                })
              )
                setSettings(false);
            }}
          >
            <label>
              Maximum players
              <select name="maxPlayers" defaultValue={view.settings.maxPlayers}>
                {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <option key={n} value={n} disabled={n < view.players.length}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Turn timer
              <select name="timer" defaultValue={view.settings.timer}>
                {[0, 15, 30, 45, 60].map((n) => (
                  <option key={n} value={n}>
                    {n ? `${n} seconds` : "Off"}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" name="changePassword" />
              Change or remove password
            </label>
            <label>
              New password <span>empty removes it when checked</span>
              <input
                type="password"
                name="password"
                maxLength={64}
                autoComplete="new-password"
              />
            </label>
            <button className="primary full" disabled={busy}>
              Save settings
            </button>
          </form>
        </Modal>
      )}
    </main>
  );
}
