// A phase ladder [R], drawn where the board model put it: each icon and the pills behind them (board-model/ladder.ts
// decides which rungs there are and which is lit). The lit rung differs by size and an underline, not only by colour
// (ui.md, "Never color alone").

import type { Ladder, LadderIconKind } from "../board-model/ladder.ts";
import { place } from "./place.ts";

export function PhaseLadder({ ladder, label }: { ladder: Ladder; label: string | null }) {
  return (
    <>
      {ladder.pills.map((pill) => (
        <div key={`${pill.x},${pill.y}`} className="ladder-pill" style={place(pill)} aria-hidden="true" />
      ))}
      {/* A second ladder (the opponent's, at their crest) repeats what the first says: hidden from screen readers. */}
      <ol className="ladder" aria-label={label ?? undefined} aria-hidden={label === null ? true : undefined}>
        {ladder.icons.map((icon) => (
          <li
            key={icon.key}
            className={icon.lit ? "lit" : undefined}
            style={place(icon.rect)}
            aria-current={icon.lit ? "step" : undefined}
            aria-label={icon.label}
          >
            <Icon kind={icon.icon} />
          </li>
        ))}
      </ol>
    </>
  );
}

function Icon({ kind }: { kind: LadderIconKind }) {
  switch (kind) {
    case "cap":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 4 L15 10 L10 16 L5 10 Z" />
        </svg>
      );
    case "card":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect x="5.5" y="2.5" width="9" height="15" rx="1.5" />
        </svg>
      );
    case "swords":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="stroke">
          <path d="M4 4 L15 15 M16 4 L5 15 M12.5 15.5 L15.5 12.5 M4.5 12.5 L7.5 15.5" />
        </svg>
      );
    case "sword":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="stroke">
          <path d="M15.5 3.5 L6 13 M4 11.5 L8.5 16 M5 15 L3 17" />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 2.5 L16 5 C16 11 13.5 15 10 17.5 C6.5 15 4 11 4 5 Z" />
        </svg>
      );
    case "burst":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 2 L11.8 7.4 L17.5 6 L13.4 10 L17.5 14 L11.8 12.6 L10 18 L8.2 12.6 L2.5 14 L6.6 10 L2.5 6 L8.2 7.4 Z" />
        </svg>
      );
  }
}
