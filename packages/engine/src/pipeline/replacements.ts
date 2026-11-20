// Replacement effects (CR 614): they watch for an event about to happen and change it before it does. `happen.ts`'s
// `replace` calls `applyReplacements` for each event, against the state before its batch (each watches for an event
// about to happen, CR 614.1). The candidates come from the event: the moving card's own text about where it goes
// (`CardDef.replacements`: "enters tapped unless ...", "if it would be put into a graveyard from anywhere, ...
// instead"), and a regeneration shield on a permanent about to be destroyed (`GameState.replacements`, CR 701.19a).
//
// One applies to an event at most so far. Several on one event, chosen in turn by the affected player, each applying
// once, come in M2-08c (later: CR 616.1, 614.5); until then this refuses rather than choose for them.

import type { CardDatabase, ReplacementDef } from "../cards/types.ts";
import { replacementsOf } from "../rules/abilities.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { Destination } from "../zones/move-card.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { playLandDestination, type SingleEvent } from "./proposed.ts";

/** The event as the replacements that apply change it: none, one, or several events in its place. */
export function applyReplacements(state: GameState, event: SingleEvent, cards: CardDatabase): SingleEvent[] {
  const [only, another] = candidatesFor(state, event, cards);
  if (only === undefined) return [event];
  // With two, the affected object's controller would choose one, and the other would be checked against the changed
  // event (later: CR 616.1, 616.1f, 614.5).
  if (another !== undefined)
    throw new Error("two replacement effects apply to one event; choosing between them isn't built yet");
  const replaced = replaceWith(state, only, event);
  return [...replaced.before, replaced.event, ...replaced.after];
}

/** A replacement effect that would apply to an event: the moving card's own, or a regeneration shield. */
type Candidate = { kind: "ownText"; def: ReplacementDef; move: Move } | { kind: "regeneration"; object: ObjectId };

function candidatesFor(state: GameState, event: SingleEvent, cards: CardDatabase): Candidate[] {
  const move = moveOf(state, event);
  const ownText =
    move === null ? [] : replacementsOf(state, move.object, cards).filter((def) => applies(state, def, move, cards));
  return [
    ...ownText.map((def): Candidate => ({ kind: "ownText", def, move: move as Move })),
    ...regeneration(state, event),
  ];
}

/**
 * A permanent about to be destroyed with a regeneration shield (CR 701.19a): one candidate however many it has, since
 * they're interchangeable and one is used (like identical triggers, D-077). None if it "can't be regenerated"
 * (CR 701.19c).
 */
function regeneration(state: GameState, event: SingleEvent): Candidate[] {
  if (event.kind !== "destroy" || event.noRegeneration === true) return [];
  const shielded = state.replacements.some((r) => r.kind === "regenerationShield" && r.object === event.object);
  return shielded ? [{ kind: "regeneration", object: event.object }] : [];
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

/** The events that happen instead: before it, the changed event, and after it. */
function replaceWith(
  state: GameState,
  candidate: Candidate,
  event: SingleEvent,
): { before: SingleEvent[]; event: SingleEvent; after: SingleEvent[] } {
  // "Instead remove all damage marked on it and its controller taps it ... remove it from combat" (CR 701.19a).
  if (candidate.kind === "regeneration")
    return { before: [], event: { kind: "regenerate", object: candidate.object }, after: [] };
  const { def, move } = candidate;
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
