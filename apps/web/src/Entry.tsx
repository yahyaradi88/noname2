import { useState } from "react";
import type { Command } from "../../../packages/shared/types.js";
import { Card } from "./components.js";
export function Entry({
  send,
  connected,
  busy,
}: {
  send: (c: Command) => Promise<boolean>;
  connected: boolean;
  busy: boolean;
}) {
  const codeFromLink =
    location.pathname.match(/^\/room\/([A-Z2-9]{6})$/)?.[1] ?? "";
  const [mode, setMode] = useState<"create" | "join">(
    codeFromLink ? "join" : "create",
  );
  return (
    <main className="entry">
      <section className="entry-intro">
        <span className="eyebrow">A TABLE FOR YOUR PEOPLE</span>
        <h1>
          Good company.
          <br />
          Better guesses.
        </h1>
        <p>
          A little memory. A little intuition.
          <br />
          All four suits, or nothing.
        </p>
        <div className="hero-cards" aria-hidden="true">
          <Card card={{ id: "q-s", rank: "Q", suit: "spades" }} />
          <Card card={{ id: "q-h", rank: "Q", suit: "hearts" }} />
          <Card card={{ id: "q-c", rank: "Q", suit: "clubs" }} />
          <Card card={{ id: "q-d", rank: "Q", suit: "diamonds" }} />
        </div>
        <div className="entry-facts">
          <span>2–8 friends</span>
          <span>52 cards</span>
          <span>13 sets to collect</span>
        </div>
      </section>
      <section className="entry-panel">
        <div className="tabs" aria-label="Room action">
          <button
            aria-pressed={mode === "create"}
            onClick={() => setMode("create")}
          >
            Create a room
          </button>
          <button
            aria-pressed={mode === "join"}
            onClick={() => setMode("join")}
          >
            Join a room
          </button>
        </div>
        <h2>
          {mode === "create"
            ? "Make yourself at home."
            : "Your seat is waiting."}
        </h2>
        <p>
          {mode === "create"
            ? "Set the table. Invite your friends."
            : "Enter your friend’s room code to join them."}
        </p>
        <form
          key={mode}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const name = String(f.get("name")).trim();
            localStorage.setItem("nn_name", name);
            await send(
              mode === "create"
                ? {
                    type: "create",
                    name,
                    roomName: String(f.get("roomName")),
                    maxPlayers: Number(f.get("maxPlayers")),
                    timer: Number(f.get("timer")),
                    privacy: f.get("privacy") as "private" | "public",
                    password: String(f.get("password")),
                  }
                : {
                    type: "join",
                    name,
                    code: String(f.get("code")).trim().toUpperCase(),
                    password: String(f.get("password")),
                  },
            );
          }}
        >
          <label>
            Your name
            <input
              name="name"
              defaultValue={localStorage.getItem("nn_name") ?? ""}
              autoComplete="nickname"
              placeholder="What should we call you?"
              maxLength={24}
              required
            />
          </label>
          {mode === "create" ? (
            <>
              <label>
                Room name <span>optional</span>
                <input
                  name="roomName"
                  placeholder="The evening table"
                  maxLength={40}
                />
              </label>
              <div className="form-row">
                <label>
                  Seats
                  <select name="maxPlayers" defaultValue="4">
                    {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {n} players
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Turn timer
                  <select name="timer" defaultValue="45">
                    {[0, 15, 30, 45, 60].map((n) => (
                      <option key={n} value={n}>
                        {n ? `${n} seconds` : "Off"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Privacy
                <select name="privacy" defaultValue="private">
                  <option value="private">Private · invite with a code</option>
                  <option value="public">Public · share with anyone</option>
                </select>
              </label>
            </>
          ) : (
            <label>
              Room code
              <input
                name="code"
                className="code-input"
                defaultValue={codeFromLink}
                placeholder="K7PX4Q"
                minLength={6}
                maxLength={6}
                required
                autoCapitalize="characters"
                autoComplete="off"
              />
            </label>
          )}
          <label>
            Room password{" "}
            <span>{mode === "create" ? "optional" : "if required"}</span>
            <input
              name="password"
              type="password"
              autoComplete={
                mode === "create" ? "new-password" : "current-password"
              }
              maxLength={64}
              placeholder={
                mode === "create"
                  ? "Leave empty for a password-free room"
                  : "Enter the room password"
              }
            />
          </label>
          <button className="primary full" disabled={!connected || busy}>
            {busy
              ? "One moment…"
              : !connected
                ? "Connecting…"
                : mode === "create"
                  ? "Create room →"
                  : "Join the table →"}
          </button>
        </form>
        <div className="panel-note">
          No account needed. Just bring your best guess.
        </div>
      </section>
    </main>
  );
}
