// What the one obvious button (ui.md, "Clarity") says and does, from the seat view: "Next" with where it goes on the
// person's turn, "Resolve" with the spell's name while the stack holds something, "Pass" on the opponent's turn, and
// a dark "Opponent's Turn" while there's nothing to pass [R]. M3-04b refines the labels as the auto-pass stops grow.

import type { Action, ObjectId, SeatView, Step } from "@mtg/engine";

export type MainButton = {
  label: string;
  /** The smaller line under the label: where "Next" goes, what "Resolve" resolves. */
  detail: string | null;
  /** What a press sends; null when the button only shows the state. */
  action: Action | null;
};

export function mainButton(shown: SeatView): MainButton {
  const view = shown.view;
  if (view.result !== null) return { label: "Game over", detail: null, action: null };
  const myTurn = view.turn?.activePlayer === shown.player;
  const pass = shown.options.find((o) => o.action.type === "PASS_PRIORITY")?.action ?? null;
  if (pass === null) {
    // A decision other than priority (a target, a block) is answered from its prompt, not this button.
    const choosing = shown.options.length > 0;
    return { label: choosing ? "Choose" : myTurn ? "Waiting" : "Opponent's Turn", detail: null, action: null };
  }
  const top = view.zones.stack[view.zones.stack.length - 1];
  if (top !== undefined) {
    const seen = shown.seen[top];
    const name =
      seen === undefined ? null : seen.kind === "card" ? seen.characteristics.name : abilitySource(shown, seen.source);
    return { label: "Resolve", detail: name, action: pass };
  }
  if (!myTurn) return { label: "Pass", detail: null, action: pass };
  return { label: "Next", detail: view.turn === null ? null : nextStop(view.turn.step), action: pass };
}

/** An ability on the stack is named by where it came from: "Ajani Goldmane's ability". */
function abilitySource(shown: SeatView, source: ObjectId): string {
  const seen = shown.seen[source];
  return seen?.kind === "card" ? `${seen.characteristics.name}'s ability` : "An ability";
}

/** Where passing on an empty stack heads in the person's own turn, named as the phase ladder names it. */
function nextStop(step: Step): string {
  switch (step) {
    case "untap":
    case "upkeep":
    case "draw":
      return "To Main";
    case "precombatMain":
      return "To Combat";
    case "beginningOfCombat":
    case "declareAttackers":
    case "declareBlockers":
    case "combatDamage":
    case "endOfCombat":
      return "To Main 2";
    case "postcombatMain":
    case "end":
    case "cleanup":
      return "End Turn";
  }
}
