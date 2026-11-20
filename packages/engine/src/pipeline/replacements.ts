// Replacement effects (CR 614): they watch for an event about to happen and change it before it does. `happen.ts`'s
// `replace` calls `applyReplacements` for each event, against the state before its batch (each watches for an event
// about to happen, CR 614.1). The candidates come from the event: the moving card's own text about where it goes
// (`CardDef.replacements`: "enters tapped unless ...", "if it would be put into a graveyard from anywhere, ...
// instead"), and a regeneration shield on a permanent about to be destroyed (`GameState.replacements`, CR 701.19a).
//
// They're applied one at a time, each once (none so far could apply again to its own result; later: CR 614.5, the
// `applied` list), and after each the others are checked against the changed event
// (CR 616.1f). When two different ones apply, the affected player or the affected object's controller chooses which
// first (CR 616.1): `choices` holds the choices made so far, and without one for this event the answer is to ask.

import type { CardDatabase, ReplacementDef } from "../cards/types.ts";
import { replacementsOf } from "../rules/abilities.ts";
import { controllerOf } from "../rules/controller.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { hasRegenerationShield, type ReplacementRef, sameReplacement } from "../state/replacements.ts";
import type { Destination } from "../zones/move-card.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { playLandDestination, type SingleEvent } from "./proposed.ts";

/** The events in place of the event, or who must choose between which replacements first (CR 616.1). */
export type Replaced =
  | { kind: "replaced"; events: SingleEvent[] }
  | { kind: "choose"; player: PlayerId; options: ReplacementRef[] };

/**
 * The event as the replacements that apply change it: none, one, or several events in its place. `choices` are the
 * affected players' choices so far, in order; an event with two candidates and no choice among them asks.
 */
export function applyReplacements(
  state: GameState,
  event: SingleEvent,
  cards: CardDatabase,
  choices: readonly ReplacementRef[] = [],
): Replaced {
  let replaced: Replacing = { before: [], event, after: [] };
  const applied: ReplacementRef[] = [];
  for (;;) {
    const candidates = candidatesFor(state, replaced.event, cards).filter(
      (c) => !applied.some((done) => sameReplacement(done, c.ref)),
    );
    const [first, second] = candidates;
    if (first === undefined)
      return { kind: "replaced", events: [...replaced.before, replaced.event, ...replaced.after] };
    // The earliest choice not yet applied that's among the candidates: choices are applied in the order made.
    const next = choices.find(
      (ch) => !applied.some((a) => sameReplacement(a, ch)) && candidates.some((c) => sameReplacement(c.ref, ch)),
    );
    const chosen =
      second === undefined ? first : candidates.find((c) => next !== undefined && sameReplacement(c.ref, next));
    if (chosen === undefined)
      return { kind: "choose", player: affectedPlayer(state, replaced.event), options: candidates.map((c) => c.ref) };
    applied.push(chosen.ref);
    replaced = replaceWith(state, chosen, replaced);
  }
}

/** The event so far: what earlier replacements put before and after it, and the event itself as changed. */
type Replacing = { before: SingleEvent[]; event: SingleEvent; after: SingleEvent[] };

/** A replacement effect that would apply to an event, with the reference that names it. */
type Candidate =
  | { kind: "ownText"; ref: ReplacementRef; def: ReplacementDef; move: Move }
  | { kind: "regeneration"; ref: ReplacementRef; object: ObjectId };

function candidatesFor(state: GameState, event: SingleEvent, cards: CardDatabase): Candidate[] {
  const move = moveOf(state, event);
  const ownText: Candidate[] =
    move === null
      ? []
      : replacementsOf(state, move.object, cards).flatMap((def, index) =>
          applies(state, def, move, cards)
            ? [{ kind: "ownText", ref: { kind: "ownText", object: move.object, index }, def, move }]
            : [],
        );
  return [...ownText, ...regeneration(state, event)];
}

/**
 * A permanent about to be destroyed with a regeneration shield (CR 701.19a): one candidate however many it has, since
 * they're interchangeable and one is used (like identical triggers, D-077). None if it "can't be regenerated"
 * (CR 701.19c).
 */
function regeneration(state: GameState, event: SingleEvent): Candidate[] {
  if (event.kind !== "destroy" || event.noRegeneration === true) return [];
  if (!hasRegenerationShield(state, event.object)) return [];
  return [{ kind: "regeneration", ref: { kind: "regenerationShield", object: event.object }, object: event.object }];
}

/** Who chooses among replacements for this event: the affected object's controller, or its owner (CR 616.1). */
function affectedPlayer(state: GameState, event: SingleEvent): PlayerId {
  switch (event.kind) {
    case "destroy":
    case "sacrifice":
    case "discard":
    case "counterObject":
    case "moveCard":
    case "regenerate":
      return controllerOf(state, event.object);
    case "playLand":
      return event.player;
    case "draw":
    case "dealDamage":
    case "gainLife":
    case "loseLife":
    case "reveal":
    case "reorderLibrary":
    case "tap":
    case "untap":
    case "addMana":
    case "shuffle":
      throw new Error(`no replacement offers a choice on ${event.kind} yet`);
  }
}

/** The card an event would move, and where to: what replacements about where a card goes look at. */
type Move = { object: ObjectId; to: Destination };

const GRAVEYARD: Destination = { zone: "graveyard" };

/** The card this event moves and where it goes, or null if it moves none. */
function moveOf(state: GameState, event: SingleEvent): Move | null {
  switch (event.kind) {
    case "moveCard":
      return { object: event.object, to: event.to };
    case "destroy":
    case "sacrifice":
    case "discard":
      return { object: event.object, to: event.to ?? GRAVEYARD };
    case "counterObject":
      // A countered ability ceases to exist; only a spell goes anywhere (CR 701.6a).
      return state.objects[event.object]?.kind === "card" ? { object: event.object, to: event.to ?? GRAVEYARD } : null;
    case "playLand":
      return { object: event.object, to: playLandDestination(event) };
    // Which card a draw moves is known only as it's performed; nothing replaces a draw yet (later: "if you would draw").
    case "draw":
    case "dealDamage":
    case "gainLife":
    case "loseLife":
    case "reveal":
    case "reorderLibrary":
    case "tap":
    case "untap":
    case "addMana":
    case "shuffle":
    case "regenerate":
      return null;
  }
}

/** Whether this replacement applies to the move. */
function applies(state: GameState, def: ReplacementDef, move: Move, cards: CardDatabase): boolean {
  switch (def.kind) {
    case "entersTapped": {
      if (move.to.zone !== "battlefield" || "tapped" in move.to) return false;
      // Checked against the permanents already there, not those entering with it (its ruling), read as the player it
      // enters under, "you".
      const you = move.to.controller;
      return !state.zones.battlefield.some((id) => matchesFilter(state, id, def.unless, you, cards));
    }
    case "graveyardToLibrary":
      return move.to.zone === "graveyard";
  }
}

/**
 * The event with this replacement applied. One that swaps the event for another (regeneration for a destroy) replaces
 * the whole modified event, so what earlier replacements put around it goes too (CR 614.6: a replaced event never
 * happens).
 */
function replaceWith(state: GameState, candidate: Candidate, replaced: Replacing): Replacing {
  switch (candidate.kind) {
    case "regeneration":
      // "Instead remove all damage marked on it and its controller taps it ... remove it from combat" (CR 701.19a).
      return { before: [], event: { kind: "regenerate", object: candidate.object }, after: [] };
    case "ownText": {
      const own = replaceByOwnText(state, candidate.def, replaced.event, candidate.move);
      return {
        before: [...replaced.before, ...own.before],
        event: own.event,
        after: [...own.after, ...replaced.after],
      };
    }
  }
}

/** The events a card's own replacement puts in place of the event. */
function replaceByOwnText(state: GameState, def: ReplacementDef, event: SingleEvent, move: Move): Replacing {
  switch (def.kind) {
    case "entersTapped":
      if (move.to.zone !== "battlefield") throw new Error("only a permanent entering enters tapped");
      return { before: [], event: rerouted(event, { ...move.to, tapped: true }), after: [] };
    case "graveyardToLibrary": {
      // "Reveal it and shuffle it into its owner's library", in the card's order: revealed where it is, put into the
      // library, then the library is shuffled. In a batch, the shuffle comes right after its own move, before the
      // batch's later members: a card another member puts on top at the same time would be shuffled too, where it should
      // stay on top (later: CR 701.24g; no pool card can).
      const owner = ownerOf(state, move.object);
      return {
        before: [{ kind: "reveal", from: zoneOf(state, move.object), objects: [move.object] }],
        event: rerouted(event, { zone: "library", position: "top" }),
        after: [{ kind: "shuffle", player: owner }],
      };
    }
  }
}

/** The event with the card going to `to` instead; what the event does to it (destroys, discards ...) stays. */
function rerouted(event: SingleEvent, to: Destination): SingleEvent {
  switch (event.kind) {
    case "moveCard":
      return { ...event, to };
    case "destroy":
    case "sacrifice":
    case "discard":
    case "counterObject": {
      // Back to the graveyard is where it goes anyway: no `to` (and none left from an earlier replacement).
      const { to: _earlier, ...action } = event;
      return to.zone === "graveyard" ? action : { ...action, to };
    }
    case "playLand":
      if (to.zone !== "battlefield") throw new Error("a land played can only be sent elsewhere on the battlefield");
      return "tapped" in to ? { ...event, tapped: true } : event;
    case "draw":
    case "dealDamage":
    case "gainLife":
    case "loseLife":
    case "reveal":
    case "reorderLibrary":
    case "tap":
    case "untap":
    case "addMana":
    case "shuffle":
    case "regenerate":
      throw new Error(`${event.kind} moves no card`);
  }
}

function ownerOf(state: GameState, id: ObjectId) {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a card`);
  return obj.owner;
}
