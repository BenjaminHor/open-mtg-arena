// What a prompt says (M3-04b slice 2; ui.md "Clarity": always say what the game is waiting for): its title, and each
// choice's label, from the decision waiting and what it's for: "Choose X for Fireball", "How much of 3 to Elite
// Vanguard?", "Keep 7". Pure, so a test can check every decision kind.

import type { Action, ObjectId, SeatView, Target } from "@mtg/engine";
import { optionLabel } from "../app/option-label.ts";
import { nameOf } from "../board-model/card-info.ts";
import { mainButton, mustDeclare } from "../hud/main-button.ts";

type Answer = Extract<Action, { type: "ANSWER" }>["answer"];
type Decision = NonNullable<SeatView["view"]["decision"]>;

/** How a prompt's choices are laid out: buttons, a row of numbers, or a list with a filter box (naming a card). */
export type PromptLayout = "buttons" | "numbers" | "filtered";

/** What the prompt asks, by the decision waiting and what it's for. */
export function promptTitle(shown: SeatView, selection: ObjectId | null = null): string {
  const decision = shown.view.decision;
  const kind = decision?.kind;
  const name = (id: ObjectId) => objectName(shown, id);
  const picked = selection === null ? undefined : shown.seen[selection];
  if (kind === "declareBlockers" && picked?.kind === "card") {
    return `Choose what ${picked.characteristics.name} blocks`;
  }
  // A declaration that can't finish yet names who must still be picked (CR 508.1d, 509.1c); the button only counts.
  const must = mustDeclare(shown);
  if ((kind === "declareAttackers" || kind === "declareBlockers") && mainButton(shown).action === null && must.length) {
    return `${must.join(", ")} must ${kind === "declareAttackers" ? "attack" : "block"}`;
  }
  if (decision === null || decision === undefined) return "Choose";
  return decisionTitle(shown, decision, name);
}

function decisionTitle(shown: SeatView, d: Decision, name: (id: ObjectId) => string): string {
  const hand = shown.view.zones.players[shown.player]?.hand?.length ?? 0;
  switch (d.kind) {
    case "chooseStartingPlayer":
      return "Who goes first?";
    case "mulligan":
      // A mulligan's cards go to the bottom as it's taken (CR 103.5), so the hand asked about is the hand kept.
      return hand === 1 ? "Keep this card?" : `Keep these ${hand} cards?`;
    case "mulliganBottom":
      return `Put ${d.remaining} card${d.remaining === 1 ? "" : "s"} on the bottom of your library`;
    case "discardToHandSize":
      return `Discard ${d.remaining} card${d.remaining === 1 ? "" : "s"} down to your hand size`;
    case "chooseTarget":
      return `Choose a target for ${name(d.object)}`;
    case "announceX":
      return `Choose X for ${name(d.object)}`;
    case "chooseTargetCount":
      return `How many targets for ${name(d.object)}?`;
    case "divide": {
      // One target at a time, in the order chosen; the last gets the rest (CR 601.2d).
      const next = d.targets[d.shares.length];
      const left = d.amount - d.shares.reduce((a, b) => a + b, 0);
      return next === undefined ? `Divide ${d.amount}` : `How much of ${left} to ${targetName(shown, next)}?`;
    }
    case "assignDamage": {
      const next = d.recipients[d.assigned.length];
      const left = d.amount - d.assigned.reduce((a, b) => a + b, 0);
      const who = next === undefined ? "" : ` to ${targetName(shown, next)}`;
      return `${name(d.source)} deals ${left} damage: how much${who}?`;
    }
    case "payMana":
      return `Pay for ${name(d.object)}`;
    case "chooseSacrifice":
      return `Choose what to sacrifice for ${name(d.object)}`;
    case "chooseCards":
      return chooseCardsTitle(
        d.purpose,
        d.min,
        d.max,
        d.endsOnlyOnFinish,
        d.for === null ? null : nameOf(d.for.oracleId),
      );
    case "orderTriggers":
      // The one put on the stack first resolves last (CR 603.3b, 405.5).
      return "Which goes on the stack first? It resolves last";
    case "chooseYesNo":
      return d.purpose === "shuffle" ? "Shuffle your library?" : `${resolving(shown)}: do you want to?`;
    case "keepLegend":
      return "Choose the legend to keep";
    case "chooseReplacement":
      return "Which effect applies first?";
    case "chooseName":
      return d.what === "cardName" ? "Name a card" : "Choose a basic land type";
    case "chooseNewTarget":
      return `Choose a new target for ${name(d.object)}`;
    case "declareAttackers":
      return "Choose attackers";
    case "declareBlockers":
      return "Choose blockers";
    case "priority":
      return "Choose";
  }
}

type ChoosePurpose = Extract<Decision, { kind: "chooseCards" }>["purpose"];

function chooseCardsTitle(
  purpose: ChoosePurpose,
  min: number,
  max: number,
  anyNumber: boolean,
  forName: string | null,
): string {
  // "Any number" hides the most there could be (D-062); otherwise the most is the text's own ("up to one").
  const cards = `card${max === 1 ? "" : "s"}`;
  const count = anyNumber ? "any number of cards" : min === max ? `${max} ${cards}` : `up to ${max} ${cards}`;
  switch (purpose) {
    case "discard":
      return `Discard ${count}`;
    case "search":
      return `Search for ${count}`;
    case "putOntoBattlefield":
      return `Choose ${count} to put onto the battlefield`;
    case "putOnTop":
      return `Choose ${count} to put on top`;
    case "putOnBottom":
      return `Choose ${count} to put on the bottom`;
    case "sacrifice":
      return `Choose ${count} to sacrifice`;
    case "enchant":
      return `Choose what ${forName ?? "it"} enchants`;
    case "copy":
      return `Choose what ${forName ?? "it"} copies`;
    case "choose":
      return `Choose ${count}`;
  }
}

/** A prompt choice's label, with the decision's context where the plain label would be vague. */
export function promptLabel(shown: SeatView, action: Action): string {
  const d = shown.view.decision;
  if (action.type !== "ANSWER" || d === null || d === undefined) return optionLabel(shown, action);
  const a: Answer = action.answer;
  switch (a.kind) {
    case "mulligan":
      // Arena's buttons [R]: "Keep 7", "Mulligan"; after a mulligan, the smaller hand (CR 103.5).
      return a.choice === "keep" ? `Keep ${shown.view.zones.players[shown.player]?.hand?.length ?? 0}` : "Mulligan";
    case "announceX":
      return String(a.value);
    case "chooseTargetCount":
      return String(a.count);
    case "divide":
      return String(a.amount);
    case "assignDamage": {
      // Lethal damage marked, as Arena does: with trample, the rest can go on only once each blocker has it.
      const lethal = d.kind === "assignDamage" ? d.lethal?.[d.assigned.length] : undefined;
      return lethal !== undefined && a.amount === lethal ? `${a.amount} (lethal)` : String(a.amount);
    }
    case "orderTrigger": {
      const trigger = d.kind === "orderTriggers" ? d.batch[a.index] : undefined;
      if (trigger === undefined) return optionLabel(shown, action);
      // A dies trigger's source has a new id in the graveyard (CR 400.7): named by its card when it's out of sight.
      const source = shown.seen[trigger.source] === undefined ? nameOf(trigger.sourceOracleId) : null;
      return `${source ?? objectName(shown, trigger.source)} trigger`;
    }
    case "chooseCard": {
      if (d.kind === "keepLegend") {
        const id = d.options[a.option];
        return id === undefined ? optionLabel(shown, action) : `Keep ${objectName(shown, id)}`;
      }
      if (d.kind !== "chooseCards") return optionLabel(shown, action);
      const option = d.options[a.option];
      if (option === undefined) return optionLabel(shown, action);
      // A card in sight by its name as it is now (a token has no oracle name); one by identity only, by its oracle name.
      return option.object !== null ? objectName(shown, option.object) : (nameOf(option.oracleId) ?? "a card");
    }
    case "chooseReplacement": {
      if (d.kind !== "chooseReplacement") return optionLabel(shown, action);
      const ref = d.options[a.option];
      return ref === undefined ? optionLabel(shown, action) : `${replacementSource(shown, ref)} first`;
    }
    case "chooseName":
      return a.name;
    default:
      return optionLabel(shown, action);
  }
}

/** How a prompt lays out its choices: a long list of names gets a filter box, small numbers a compact row. */
export function promptLayout(shown: SeatView): PromptLayout {
  const d = shown.view.decision;
  switch (d?.kind) {
    case "chooseName":
      // Every card name is a long list; the five basic land types are buttons.
      return d.what === "cardName" ? "filtered" : "buttons";
    case "announceX":
    case "chooseTargetCount":
    case "divide":
    case "assignDamage":
      return "numbers";
    default:
      return "buttons";
  }
}

export function objectName(shown: SeatView, id: ObjectId): string {
  const seen = shown.seen[id];
  if (seen?.kind === "card") return seen.characteristics.name;
  // An ability whose source has left (sacrificed for its cost, CR 400.7) is named by the card it came from.
  if (seen?.kind === "ability") {
    const source = shown.seen[seen.source] === undefined ? nameOf(seen.sourceOracleId) : null;
    return `${source ?? objectName(shown, seen.source)} ability`;
  }
  return "it";
}

function targetName(shown: SeatView, t: Target): string {
  if (t.kind === "object") return objectName(shown, t.object);
  return t.player === shown.player ? "you" : "your opponent";
}

/** What's resolving: the object on top of the stack, named as the stack names it. */
function resolving(shown: SeatView): string {
  const top = shown.view.zones.stack.at(-1);
  return top === undefined ? "This effect" : objectName(shown, top);
}

type ReplacementRef = Extract<Decision, { kind: "chooseReplacement" }>["options"][number];

/** A replacement effect by where it comes from: the permanent with the text, its shield or protection, a spell's. */
function replacementSource(shown: SeatView, ref: ReplacementRef): string {
  switch (ref.kind) {
    case "ownText":
      return objectName(shown, ref.object);
    case "regenerationShield":
      return `${objectName(shown, ref.object)}'s regeneration`;
    case "protection":
      return `${objectName(shown, ref.object)}'s protection`;
    case "resolvedEffect":
      // A resolved spell's effect (Fog's prevention) has an id of its own, not shown with its source: say what it is.
      return "A prevention effect";
  }
}

/**
 * The choices whose label matches what's typed, best first: the exact name, then names that start with it, then the
 * rest that contain it, each group in its own order. So "Shatter" puts Shatter before Mind Shatter, and a short name
 * is never hidden behind longer ones that merely contain it.
 */
export function rankByLabel<T extends { label: string }>(choices: readonly T[], typed: string): T[] {
  const wanted = typed.trim().toLowerCase();
  const rank = (label: string) => (label === wanted ? 0 : label.startsWith(wanted) ? 1 : 2);
  return choices
    .map((choice) => ({ choice, label: choice.label.toLowerCase() }))
    .filter(({ label }) => label.includes(wanted))
    .sort((a, b) => rank(a.label) - rank(b.label))
    .map(({ choice }) => choice);
}
