// The phase ladders [R] (arena-research.md, both sets of the owner's screenshots). Over the main button, the current
// turn's ladder: in short form a diamond, a card, crossed swords, a card, a diamond (the turn's five phases, CR 500.1);
// during combat it opens into its steps (CR 506.1): a sword for attackers, a shield for blockers, a burst for damage.
// On the opponent's turn their ladder is at the top centre, the same rungs.

import type { Step } from "@mtg/engine";
import type { BoardLayout } from "../layout/board-layout.ts";
import type { Rect } from "./board-model.ts";

export type LadderIconKind = "cap" | "card" | "swords" | "sword" | "shield" | "burst";
export type LadderIcon = { key: string; icon: LadderIconKind; label: string; lit: boolean; rect: Rect };
export type Ladder = { icons: LadderIcon[]; pills: Rect[] };

type Rung = { key: string; icon: LadderIconKind; label: string; steps: readonly Step[] };

const BEGINNING: Rung = { key: "beginning", icon: "cap", label: "Beginning", steps: ["untap", "upkeep", "draw"] };
const MAIN1: Rung = { key: "main1", icon: "card", label: "Main 1", steps: ["precombatMain"] };
const MAIN2: Rung = { key: "main2", icon: "card", label: "Main 2", steps: ["postcombatMain"] };
const END: Rung = { key: "end", icon: "cap", label: "End", steps: ["end", "cleanup"] };
const COMBAT: Rung = {
  key: "combat",
  icon: "swords",
  label: "Combat",
  steps: ["beginningOfCombat", "declareAttackers", "declareBlockers", "combatDamage", "endOfCombat"],
};
const COMBAT_STEPS: Rung[] = [
  { key: "attackers", icon: "sword", label: "Attackers", steps: ["beginningOfCombat", "declareAttackers"] },
  { key: "blockers", icon: "shield", label: "Blockers", steps: ["declareBlockers"] },
  { key: "damage", icon: "burst", label: "Damage", steps: ["combatDamage"] },
  { key: "endOfCombat", icon: "cap", label: "End of combat", steps: ["endOfCombat"] },
];

export function inCombat(step: Step): boolean {
  return COMBAT.steps.includes(step);
}

function rungsFor(step: Step | null): Rung[] {
  return step !== null && inCombat(step)
    ? [BEGINNING, MAIN1, ...COMBAT_STEPS, MAIN2, END]
    : [BEGINNING, MAIN1, COMBAT, MAIN2, END];
}

/** The ladder's one pill with its top left at (x, y), for these rungs. */
function inPill(rungs: readonly Rung[], step: Step | null, x: number, y: number, layout: BoardLayout): Ladder {
  const { icon, padding } = layout.ladder;
  const pill = { x, y, width: rungs.length * icon + 2 * padding, height: icon + 2 * padding };
  const icons = rungs.map((r, i) =>
    entry(r, step, { x: pill.x + padding + i * icon, y: pill.y + padding, width: icon, height: icon }),
  );
  return { icons, pills: [pill] };
}

/** The current turn's ladder in one pill, centred over the main button. */
export function ladderOver(button: Rect, step: Step | null, layout: BoardLayout): Ladder {
  const rungs = rungsFor(step);
  const { icon, padding, gap } = layout.ladder;
  const width = rungs.length * icon + 2 * padding;
  const x = Math.min(button.x + button.width / 2 - width / 2, button.x + button.width - width);
  return inPill(rungs, step, x, button.y - gap - icon - 2 * padding, layout);
}

/** The opponent's ladder on their turn: one pill at the top centre, `gap` below the top edge. */
export function ladderAtTop(area: Rect, step: Step | null, layout: BoardLayout): Ladder {
  const rungs = rungsFor(step);
  const { icon, padding, gap } = layout.ladder;
  const width = rungs.length * icon + 2 * padding;
  return inPill(rungs, step, area.x + area.width / 2 - width / 2, area.y + gap, layout);
}

function entry(rung: Rung, step: Step | null, rect: Rect): LadderIcon {
  return { key: rung.key, icon: rung.icon, label: rung.label, lit: step !== null && rung.steps.includes(step), rect };
}
