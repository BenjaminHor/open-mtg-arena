// Replacement effects (CR 614): they watch for an event about to happen and change it before it does. `happen.ts`'s
// `replace` calls `applyReplacements` for each event, against the state before its batch (CR 614.4). So far the only
// replacements are an object's own text about where it goes (`CardDef.replacements`, read through `replacementsOf`):
// "enters tapped unless ..." and "if it would be put into a graveyard from anywhere, ... instead".
//
// So far each card has at most one, so one replacement applies to an event at most. Several on one event, chosen in turn
// by the affected player, each applying once, come in M2-08c (later: CR 616.1, 614.5); until then this refuses rather
// than choose for them.

import type { CardDatabase, ReplacementDef } from "../cards/types.ts";
import { keywordsOf, replacementsOf } from "../rules/abilities.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { Destination } from "../zones/move-card.ts";
import { zoneOf } from "../zones/zone-list.ts";
import type { SingleEvent } from "./proposed.ts";

/** The event as the replacements that apply change it: none, one, or several events in its place. */
export function applyReplacements(state: GameState, event: SingleEvent, cards: CardDatabase): SingleEvent[] {
  // An indestructible permanent can't be destroyed (CR 702.12b): the event can't happen, so there's nothing to perform.
  if (event.kind === "destroy" && keywordsOf(state, event.object, cards).includes("indestructible")) return [];
  const move = moveOf(state, event);
  if (move === null) return [event];
  const applicable = replacementsOf(state, move.object, cards).filter((def) => applies(state, def, move, cards));
  const [only, another] = applicable;
  if (only === undefined) return [event];
  // No card in the pool has two that could apply to one move. With two, its controller would choose one, and the
  // other would be checked against the changed event (later: CR 616.1, 616.1f, 614.5).
  if (another !== undefined)
    throw new Error("two replacement effects apply to one event; choosing between them isn't built yet");
  const replaced = replaceWith(state, only, event, move);
  return [...replaced.before, replaced.event, ...replaced.after];
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
      return {
        object: event.object,
        to: { zone: "battlefield", controller: event.player, ...(event.tapped === true ? { tapped: true } : {}) },
      };
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
      return null;
  }
}

/** Whether this replacement applies to the move. */
function applies(state: GameState, def: ReplacementDef, move: Move, cards: CardDatabase): boolean {
  switch (def.kind) {
    case "entersTapped": {
      if (move.to.zone !== "battlefield" || "tapped" in move.to) return false;
      if (def.unless === undefined) return true;
      // Checked against the permanents already there, read as the player it enters under, "you" (CR 614.12).
      const you = move.to.controller;
      const unless = def.unless;
      return !state.zones.battlefield.some((id) => matchesFilter(state, id, unless, you, cards));
    }
    case "graveyardToLibrary":
      return move.to.zone === "graveyard";
  }
}

/** The events that happen instead: before it, the changed event, and after it. */
function replaceWith(
  state: GameState,
  def: ReplacementDef,
  event: SingleEvent,
  move: Move,
): { before: SingleEvent[]; event: SingleEvent; after: SingleEvent[] } {
  switch (def.kind) {
    case "entersTapped":
      if (move.to.zone !== "battlefield") throw new Error("only a permanent entering enters tapped");
      return { before: [], event: rerouted(event, { ...move.to, tapped: true }), after: [] };
    case "graveyardToLibrary": {
      // "Reveal it and shuffle it into its owner's library": revealed where it is, put into the library, then the
      // library is shuffled (CR 701.24c).
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
    case "counterObject":
      if (to.zone === "graveyard") return event;
      return { ...event, to };
    case "playLand":
      if (to.zone !== "battlefield") throw new Error("a land played can only be sent elsewhere on the battlefield");
      return "tapped" in to ? { ...event, tapped: true } : event;
    default:
      throw new Error(`${event.kind} moves no card`);
  }
}

function ownerOf(state: GameState, id: ObjectId) {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a card`);
  return obj.owner;
}
