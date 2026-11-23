// The phase ladder [R]: five small icons for the turn's phases (CR 500.1), the current one lit. It sits over the main
// button on the person's turn and around the opponent's life crest on theirs, so where it is says whose turn it is.
// The lit phase also differs by size and an underline, not only by colour (ui.md, "Never color alone").

import { type Phase, phaseOf, type Step } from "@mtg/engine";

const PHASES: { phase: Phase; label: string; icon: "cap" | "card" | "swords" }[] = [
  { phase: "beginning", label: "Beginning", icon: "cap" },
  { phase: "precombatMain", label: "Main 1", icon: "card" },
  { phase: "combat", label: "Combat", icon: "swords" },
  { phase: "postcombatMain", label: "Main 2", icon: "card" },
  { phase: "ending", label: "End", icon: "cap" },
];

export function PhaseLadder({
  step,
  side,
  style,
}: {
  step: Step;
  side: "mine" | "opponent";
  style: React.CSSProperties;
}) {
  const current = phaseOf(step);
  return (
    <ol
      className={`ladder ladder-${side}`}
      style={style}
      aria-label={side === "mine" ? "Your turn" : "Opponent's turn"}
    >
      {PHASES.map((p, i) => (
        <li
          key={p.phase}
          className={p.phase === current ? "lit" : undefined}
          aria-current={p.phase === current ? "step" : undefined}
          aria-label={p.label}
          // On the opponent's turn the ladder parts around their life crest.
          data-gap={side === "opponent" && i === 2 ? "" : undefined}
        >
          <Icon kind={p.icon} />
        </li>
      ))}
    </ol>
  );
}

function Icon({ kind }: { kind: "cap" | "card" | "swords" }) {
  switch (kind) {
    case "cap":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M10 3 L16 10 L10 17 L4 10 Z" />
        </svg>
      );
    case "card":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect x="5" y="2.5" width="10" height="15" rx="1.5" />
        </svg>
      );
    case "swords":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className="stroke">
          <path d="M4 4 L15 15 M16 4 L5 15 M12.5 15.5 L15.5 12.5 M4.5 12.5 L7.5 15.5" />
        </svg>
      );
  }
}
