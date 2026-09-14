import { useCallback, useEffect, useRef, useState } from "react";
import type { Command, View } from "../../../packages/shared/types.js";
import { socket, connect } from "./network.js";
import { Entry } from "./Entry.js";
import { Lobby } from "./Lobby.js";
import { Table } from "./Table.js";
import { Modal, Rules } from "./components.js";
import { questionAnnouncement } from "../../../packages/shared/announcements.js";
export default function App() {
  const [view, setView] = useState<View | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<"rules" | "settings" | "leave" | null>(
    null,
  );
  const [sound, setSound] = useState(
    localStorage.getItem("nn_sound") === "true",
  );
  const [reduced, setReduced] = useState(
    localStorage.getItem("nn_reduced") === "true" ||
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const pending = useRef(false);
  const audio = useRef<AudioContext | null>(null);
  const lastEvent = useRef("");
  const lastTurn = useRef("");
  const lastQuestion = useRef("");
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const play = useCallback((frequency: number) => {
    if (
      !soundRef.current ||
      !audio.current ||
      audio.current.state !== "running"
    )
      return;
    const ctx = audio.current;
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = frequency;
    g.gain.setValueAtTime(0.025, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
  }, []);
  useEffect(() => {
    const unlock = () => {
      audio.current ??= new AudioContext();
      void audio.current.resume();
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    const onState = (v: View | null) => {
      setView(v);
      if (v) {
        if (v.latestQuestion && lastQuestion.current !== v.latestQuestion.id) {
          const q = v.latestQuestion;
          lastQuestion.current = q.id;
          setNotice(
            questionAnnouncement(q) +
              (q.correct &&
              q.step === "suits" &&
              v.currentPlayerId ===
                v.players.find((p) => p.name === q.asker)?.id
                ? " Another turn!"
                : ""),
          );
        }
        history.replaceState(null, "", `/room/${v.code}`);
        const e = v.events.at(-1);
        if (e && lastEvent.current !== e.id) {
          lastEvent.current = e.id;
          play(
            e.kind === "win"
              ? 880
              : e.kind === "set"
                ? 740
                : e.kind === "success"
                  ? 620
                  : 340,
          );
        }
        if (v.currentPlayerId === v.myId && lastTurn.current !== v.turnId)
          play(520);
        lastTurn.current = v.turnId;
      } else if (!location.pathname.startsWith("/room/"))
        history.replaceState(null, "", "/");
    };
    const onConnect = () => {
      setConnected(true);
    };
    const onDisconnect = () => {
      setConnected(false);
      pending.current = false;
      setBusy(false);
    };
    const onError = (e: Error) => {
      setNotice(e.message);
      setConnected(false);
    };
    socket.on("state", onState);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onError);
    socket.on("notice", setNotice);
    void connect().catch((e) => setNotice(String(e)));
    return () => {
      socket.off("state", onState);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onError);
      socket.off("notice", setNotice);
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [play]);
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(timeout);
  }, [notice]);
  async function send(cmd: Command): Promise<boolean> {
    if (pending.current || !socket.connected) return false;
    pending.current = true;
    setBusy(true);
    return new Promise((resolve) => {
      socket.timeout(10000).emit("command", cmd, (err, result) => {
        pending.current = false;
        setBusy(false);
        if (err) {
          setNotice(
            "No confirmation received. Reconnecting to restore the latest state.",
          );
          socket.disconnect();
          void connect().catch((e) => setNotice(String(e)));
          resolve(false);
          return;
        }
        if (!result.ok) {
          setNotice(result.error);
          resolve(false);
        } else {
          if (cmd.type === "leave") history.replaceState(null, "", "/");
          resolve(true);
        }
      });
    });
  }
  async function copy(link = false) {
    try {
      await navigator.clipboard.writeText(
        link ? `${location.origin}/room/${view!.code}` : view!.code,
      );
      setNotice(link ? "Invite link copied" : "Room code copied");
    } catch {
      setNotice(`Room code: ${view!.code}`);
    }
  }
  return (
    <div className={reduced ? "app reduced" : "app"}>
      <header>
        <a
          href="/"
          className="brand"
          onClick={(e) => {
            if (view) e.preventDefault();
          }}
        >
          <span>♠</span>NO NAME<small>THE CARD GAME</small>
        </a>
        <nav>
          {view && (
            <button className="code-pill" onClick={() => void copy()}>
              ROOM <strong>{view.code}</strong> ⧉
            </button>
          )}
          <span className={`connection ${connected ? "connected" : ""}`}>
            {connected ? "Connected" : "Reconnecting"}
          </span>
          <button className="text-button" onClick={() => setModal("rules")}>
            How to play
          </button>
          <button
            className="icon-button"
            onClick={() => setModal("settings")}
            aria-label="Open settings"
          >
            ☷
          </button>
        </nav>
      </header>
      {!connected && (
        <div className="connection-banner" role="status">
          Connecting to the table. Your seat is reserved for 5 minutes.
          {
            <button
              onClick={() => {
                socket.disconnect();
                void connect().catch((e) => setNotice(String(e)));
              }}
            >
              Retry
            </button>
          }
        </div>
      )}
      {view ? (
        view.stage === "LOBBY" ? (
          <Lobby
            view={view}
            send={send}
            busy={busy || !connected}
            copy={() => void copy()}
          />
        ) : (
          <Table
            view={view}
            send={send}
            busy={busy || !connected}
            reduced={reduced}
          />
        )
      ) : (
        <Entry send={send} connected={connected} busy={busy} />
      )}
      <footer>
        <span>NO NAME</span>
        <span>A good guess goes a long way.</span>
        <button className="text-button" onClick={() => setModal("rules")}>
          The rules ↗
        </button>
      </footer>
      {notice && (
        <div className="toast" role="alert">
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
      {modal === "rules" && (
        <Modal
          title="A good guess goes a long way."
          onClose={() => setModal(null)}
        >
          <Rules />
        </Modal>
      )}
      {modal === "settings" && (
        <Modal title="Make yourself comfortable" onClose={() => setModal(null)}>
          <div className="preferences">
            <label className="check">
              <input
                type="checkbox"
                checked={sound}
                onChange={(e) => {
                  setSound(e.target.checked);
                  localStorage.setItem("nn_sound", String(e.target.checked));
                }}
              />
              Sound effects
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={reduced}
                onChange={(e) => {
                  setReduced(e.target.checked);
                  localStorage.setItem("nn_reduced", String(e.target.checked));
                }}
              />
              Reduce animations
            </label>
            <p>Connection: {connected ? "Connected" : "Reconnecting"}</p>
            {view && (
              <>
                <button className="secondary full" onClick={() => void copy()}>
                  Copy room code
                </button>
                <button
                  className="secondary full"
                  onClick={() => void copy(true)}
                >
                  Copy invite link
                </button>
                <button
                  className="danger full"
                  onClick={() => setModal("leave")}
                >
                  Leave {view.stage === "LOBBY" ? "room" : "game"}
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
      {modal === "leave" && (
        <Modal title="Leave the table?" onClose={() => setModal(null)}>
          <p>
            {view?.stage === "LOBBY"
              ? "Your seat will become available for someone else."
              : "You will forfeit your place. Your active cards return to the draw pile."}
          </p>
          <button
            className="danger full"
            disabled={busy}
            onClick={async () => {
              if (await send({ type: "leave" })) setModal(null);
            }}
          >
            Leave table
          </button>
          <button className="secondary full" onClick={() => setModal(null)}>
            Keep playing
          </button>
        </Modal>
      )}
    </div>
  );
}
