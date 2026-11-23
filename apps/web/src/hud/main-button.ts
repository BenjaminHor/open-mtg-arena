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
  const declaring = declarationButton(shown);
  if (declaring !== null) return declaring;
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

/**
 * While attackers or blockers are being declared, the button finishes the declaration and says what it holds [R]:
 * "No Attacks" or "2 Attackers" (on to blockers), "No Blocks" or "1 Blocker" (on to damage). Picking the creatures is
 * M3-04b's touch; until then the actions drawer picks them.
 */
function declarationButton(shown: SeatView): MainButton | null {
  const decision = shown.view.decision;
  if (decision?.kind !== "declareAttackers" && decision?.kind !== "declareBlockers") return null;
  const finish = shown.options.find((o) => o.action.type === "ANSWER" && o.action.answer.kind === "finishDeclaring");
  const action = finish?.action ?? null;
  // The picks so far are the declaration under way, before it's finished.
  if (decision.kind === "declareAttackers") {
    const n = decision.chosen.length;
    return { label: n === 0 ? "No Attacks" : `${n} Attacker${n === 1 ? "" : "s"}`, detail: "To Blockers", action };
  }
  // A creature that blocks two attackers is still one blocker.
  const n = new Set(decision.chosen.map((b) => b.blocker)).size;
  return { label: n === 0 ? "No Blocks" : `${n} Blocker${n === 1 ? "" : "s"}`, detail: "To Damage", action };
}

/** An ability on the stack is named by where it came from: "Ajani Goldmane ability". */
function abilitySource(shown: SeatView, source: ObjectId): string {
  const seen = shown.seen[source];
  return seen?.kind === "card" ? `${seen.characteristics.name} ability` : "An ability";
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
