import { useEffect, useRef, type ReactNode } from "react";
import type {
  Card as CardType,
  Rank,
  Suit,
  PublicPlayer,
} from "../../../packages/shared/types.js";
export const symbols: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};
export function Card({
  card,
  back = false,
  small = false,
}: {
  card?: CardType;
  back?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={`card ${back ? "card-back" : ""} ${small ? "small" : ""} ${card && (card.suit === "hearts" || card.suit === "diamonds") ? "red" : ""}`}
      aria-label={card ? `${card.rank} of ${card.suit}` : "Face-down card"}
    >
      {back ? (
        <span>✦</span>
      ) : (
        card && (
          <>
            <span className="corner">
              {card.rank}
              <b>{symbols[card.suit]}</b>
            </span>
            <span className="pip">{symbols[card.suit]}</span>
            <span className="corner bottom">
              {card.rank}
              <b>{symbols[card.suit]}</b>
            </span>
          </>
        )
      )}
    </div>
  );
}
export function Sets({ ranks }: { ranks: Rank[] }) {
  return (
    <div className="sets">
      {ranks.map((rank) => (
        <div
          className="set-tile"
          key={rank}
          aria-label={`Completed ${rank}s, all four suits`}
        >
          <strong>{rank}</strong>
          <span>
            ♠ <i>♥ ♦</i> ♣
          </span>
        </div>
      ))}
    </div>
  );
}
export function Avatar({
  player,
}: {
  player: Pick<PublicPlayer, "name" | "id" | "connected">;
}) {
  return (
    <span className={`avatar avatar-${player.id.charCodeAt(0) % 4}`}>
      <span>{player.name.slice(0, 2).toUpperCase()}</span>
      <i
        className={player.connected ? "online" : "offline"}
        title={player.connected ? "Connected" : "Reconnecting"}
      />
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Rules() {
  return (
    <div className="rules">
      <p>Collect all four suits of a rank to earn a set. Most sets wins.</p>
      <ol>
        <li>Choose another player.</li>
        <li>Pick a rank already in your active hand.</li>
        <li>
          Ask about the rank. A correct answer is announced to everyone and
          unlocks the quantity question.
        </li>
        <li>
          Guess <strong>exactly how many</strong>. A correct quantity is
          announced to everyone and unlocks the suits question.
        </li>
        <li>
          Choose the <strong>exact suits</strong> to take the cards. A wrong
          answer at any stage draws one card if available and ends your turn. A
          complete rank is laid down automatically. Taking the cards
          successfully gives you another turn, with a fresh timer.
        </li>
      </ol>
      <p>
        Have an empty hand? Draw one card at the start of your turn. No cards
        left to draw? Empty hands are skipped.
      </p>
      <p>
        Timer expires? Your turn ends without a penalty card. All 13 sets
        complete? Highest score wins, with ties shared.
      </p>
      <p>
        Disconnected seats are reserved for 5 minutes. Leaving or timing out
        forfeits your place: your hand is shuffled back into the pile, your sets
        stay on display, and you cannot win. Fewer than two remaining players
        ends the game.
      </p>
    </div>
  );
}
