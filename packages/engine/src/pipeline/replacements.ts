// Replacement effects (CR 614): they watch for an event about to happen and change it before it does. `happen.ts`'s
// `replace` calls `applyReplacements` for each event, against the state before its batch (each watches for an event
// about to happen, CR 614.1). The candidates come from the event: the moving card's own text about where it goes
// (`CardDef.replacements`: "enters tapped unless ...", "if it would be put into a graveyard from anywhere, ...
// instead"), and a regeneration shield on a permanent about to be destroyed (`GameState.replacements`, CR 701.19a).
//
// They're applied one at a time, each once: a replacement doesn't apply again to its own result (CR 614.5, the
// `applied` list; a Clone choosing again the Clone whose text it copied isn't asked a third time), and after each the
// others are checked against the changed event
// (CR 616.1f). When two different ones apply, the affected player or the affected object's controller chooses which
// first (CR 616.1): `choices` holds the choices made so far, and without one for this event the answer is to ask. A
// replacement with a choice of its own as a permanent enters, "choose a card name" (CR 614.12a, D-119), is asked the
// same way, its answer kept in `choices` too.

import { copiableValues } from "../cards/card-data.ts";
import type { CardDatabase, ReplacementDef } from "../cards/types.ts";
import { apnapOrder } from "../game/turn-order.ts";
import { copiedReplacements, replacementsOf } from "../rules/abilities.ts";
import { controllerOf } from "../rules/controller.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import { ownerOf } from "../rules/owner.ts";
import type { ChooseWhat } from "../state/decisions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { isBasicLandType } from "../state/objects.ts";
import {
  type ChoiceFor,
  hasRegenerationShield,
  type ReplacementChoice,
  type ReplacementRef,
  sameReplacement,
} from "../state/replacements.ts";
import type { Destination } from "../zones/move-card.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { playLandDestination, type SingleEvent } from "./proposed.ts";

/**
 * A choice needed before the event can happen: who must choose between which replacements first (CR 616.1), or a
 * replacement's own choice as a permanent enters, a card name (CR 614.12a), and what each is for.
 */
export type Ask =
  | { kind: "choose"; player: PlayerId; for: ChoiceFor; options: ReplacementRef[] }
  | { kind: "chooseName"; what: ChooseWhat; player: PlayerId; for: EnteringObject; ref: ReplacementRef }
  /** The permanent to enter as a copy of (CR 707.5), or none ("you may", Clone), among `options`. */
  | { kind: "chooseCopy"; player: PlayerId; for: EnteringObject; ref: ReplacementRef; options: ObjectId[] };

/** The permanent a choice as it enters is made for (CR 614.12a). */
type EnteringObject = { kind: "object"; object: ObjectId };

/** The events in place of the event, or the choice needed first. */
export type Replaced = { kind: "replaced"; events: SingleEvent[] } | Ask;

/** The first of these choices to ask, in APNAP order of the players asked (CR 616.1, 101.4), or null if none. */
export function firstInApnapOrder(state: GameState, asks: readonly Ask[]): Ask | null {
  if (asks.length === 0) return null;
  const order = apnapOrder(state);
  return [...asks].sort((x, y) => order.indexOf(x.player) - order.indexOf(y.player))[0] ?? null;
}

/**
 * The event as the replacements that apply change it: none, one, or several events in its place. `choices` are the
 * affected players' choices so far, in order; an event with two candidates and no choice among them asks.
 */
export function applyReplacements(
  state: GameState,
  event: SingleEvent,
  cards: CardDatabase,
  allChoices: readonly ReplacementChoice[] = [],
): Replaced {
  // Choices are for the object the event affects (`ReplacementChoice.for`).
  const object = affectedObject(event);
  const forObject = allChoices.filter((c) => c.for.kind === "object" && c.for.object === object);
  const choices = forObject.flatMap((c) => (c.kind === "first" ? [c.ref] : []));
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
    // Any of them may be chosen (CR 616.1e). No self-replacement, control or face-up replacement exists yet, and the one
    // copy replacement (Clone's) never meets another, though a copy one must come first (later: CR 616.1a–d).
    if (chosen === undefined) {
      if (object === null) throw new Error(`no replacement offers a choice on ${event.kind} yet`);
      return {
        kind: "choose",
        player: affectedPlayer(state, replaced.event, cards),
        for: { kind: "object", object },
        options: candidates.map((c) => c.ref),
      };
    }
    // A replacement that makes a choice as the permanent enters asks it before it enters (CR 614.12a), of the player it
    // enters under (its controller, CR 614.12's example, 616.1); the answer is kept with the others, so replacing
    // again finds it.
    const answer = forObject.find((c) => c.kind !== "first" && sameReplacement(c.ref, chosen.ref));
    const ask = answer === undefined && chosen.kind === "ownText" ? askAsEnters(state, chosen, object, cards) : null;
    if (ask !== null) return ask;
    applied.push(chosen.ref);
    replaced = replaceWith(state, chosen, replaced, answer);
  }
}

/**
 * The choice this replacement has the player the permanent enters under make as it enters (CR 614.12a; its controller,
 * CR 614.12's example), or null if it has none: a name, or a permanent to copy (CR 707.5) among those already on the
 * battlefield (one entering with it isn't, Clone's ruling; `state` is from before the event).
 */
function askAsEnters(state: GameState, candidate: OwnText, object: ObjectId | null, cards: CardDatabase): Ask | null {
  const def = candidate.def;
  const to = candidate.move.to;
  const asked = () => {
    if (object === null || to.zone !== "battlefield") throw new Error("only a permanent entering chooses as it enters");
    return { player: to.controller, for: { kind: "object", object }, ref: candidate.ref } as const;
  };
  if (def.kind === "entersAsCopy") {
    const options = state.zones.battlefield.filter((id) => matchesFilter(state, id, def.of, asked().player, cards));
    return { kind: "chooseCopy", ...asked(), options };
  }
  const what = nameAsEnters(def);
  return what === null ? null : { kind: "chooseName", what, ...asked() };
}

/** The name this replacement has its player choose as the permanent enters, if any (CR 614.12a). */
function nameAsEnters(def: ReplacementDef): ChooseWhat | null {
  switch (def.kind) {
    case "asEntersChooseName":
      return "cardName";
    case "asEntersChooseBasicLandType":
      return "basicLandType";
    case "entersAsCopy":
    case "entersTapped":
    case "graveyardToLibrary":
    case "entersWithCounters":
    case "entersWithLoyalty":
    case "preventDamageToYou":
    case "preventDamageToSelfRemovingCounters":
    case "preventNoncombatDamageToAttached":
      return null;
  }
}

/** The event so far: what earlier replacements put before and after it, and the event itself as changed. */
type Replacing = { before: SingleEvent[]; event: SingleEvent; after: SingleEvent[] };

/** A replacement effect that would apply to an event, with the reference that names it. */
type Candidate = OwnText | { kind: "regeneration"; ref: ReplacementRef; object: ObjectId };
type OwnText = { kind: "ownText"; ref: ReplacementRef; def: ReplacementDef; move: Move };

function candidatesFor(state: GameState, event: SingleEvent, cards: CardDatabase): Candidate[] {
  const move = moveOf(state, event);
  return [...(move === null ? [] : ownTextFor(state, move, cards)), ...regeneration(state, event)];
}

/**
 * The moving card's own replacements that apply. Once it's entering as a copy, they're the copied text's, as the
 * permanent would exist on the battlefield (CR 614.12, 707.5), named apart from its own (`text`): a Clone copying a
 * Clone that copied nothing gets that Clone's replacement and chooses again (CR 707.9e's example).
 */
function ownTextFor(state: GameState, move: Move, cards: CardDatabase): OwnText[] {
  const copied = move.to.zone === "battlefield" ? move.to.copied : undefined;
  const defs = copied === undefined ? replacementsOf(state, move.object, cards) : copiedReplacements(copied, cards);
  const text = copied === undefined ? {} : { text: copied.oracleId };
  return defs.flatMap((def, index) =>
    applies(state, def, move, cards)
      ? [{ kind: "ownText", ref: { kind: "ownText", object: move.object, index, ...text }, def, move }]
      : [],
  );
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

/** The object this event affects, which a choice for it is for, or null for an event no choice is made on yet. */
function affectedObject(event: SingleEvent): ObjectId | null {
  switch (event.kind) {
    case "moveCard":
    case "destroy":
    case "sacrifice":
    case "discard":
    case "counterObject":
    case "regenerate":
    case "playLand":
    case "tap":
    case "untap":
    case "putCounters":
    case "removeCounters":
      return event.object;
    // Nothing replaces creating a token or one ceasing to exist yet (later: CR 614.1, "if you would create").
    case "createToken":
    case "copySpell":
    case "ceaseToExist":
    case "attach":
    case "unattach":
    // Damage is replaced per entry, with its own choices (`damage-replacements.ts`).
    case "dealDamage":
    case "damagePrevented":
    case "gainLife":
    case "loseLife":
    case "reveal":
    case "reorderLibrary":
    case "addMana":
    case "draw":
    case "shuffle":
      return null;
  }
}

/** Who chooses among replacements for this event: the affected object's controller, or its owner (CR 616.1). */
function affectedPlayer(state: GameState, event: SingleEvent, cards: CardDatabase): PlayerId {
  switch (event.kind) {
    case "destroy":
    case "sacrifice":
    case "discard":
    case "counterObject":
    case "moveCard":
    case "regenerate":
      return controllerOf(state, event.object, cards);
    case "playLand":
      return event.player;
    case "damagePrevented":
    case "draw":
    case "dealDamage":
    case "gainLife":
    case "loseLife":
    case "reveal":
    case "reorderLibrary":
    case "tap":
    case "untap":
    case "putCounters":
    case "removeCounters":
    case "createToken":
    case "copySpell":
    case "ceaseToExist":
    case "attach":
    case "unattach":
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
    case "putCounters":
    case "removeCounters":
    case "createToken":
    case "copySpell":
    case "ceaseToExist":
    case "attach":
    case "unattach":
    case "addMana":
    case "shuffle":
    case "regenerate":
    case "damagePrevented":
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
    case "entersWithCounters":
    case "entersWithLoyalty":
    case "asEntersChooseName":
    case "asEntersChooseBasicLandType":
    case "entersAsCopy":
      // Once per event like every replacement: the `applied` list sees to that.
      return move.to.zone === "battlefield";
    // Prevention, read for damage (`damage-replacements.ts`), never for a move.
    case "preventDamageToYou":
    case "preventDamageToSelfRemovingCounters":
    case "preventNoncombatDamageToAttached":
      return false;
  }
}

/**
 * The event with this replacement applied. One that swaps the event for another (regeneration for a destroy) replaces
 * the whole modified event, so what earlier replacements put around it goes too (CR 614.6: a replaced event never
 * happens). Considered and not followed: CR 701.24c shuffles a library even when the card to be shuffled in stays
 * where it is, but that's for an instruction carried out, not an event replaced (D-087; an open question for the
 * owner, unreachable with the pool).
 */
function replaceWith(
  state: GameState,
  candidate: Candidate,
  replaced: Replacing,
  answer: ReplacementChoice | undefined,
): Replacing {
  switch (candidate.kind) {
    case "regeneration":
      // "Instead remove all damage marked on it and its controller taps it ... remove it from combat" (CR 701.19a).
      return { before: [], event: { kind: "regenerate", object: candidate.object }, after: [] };
    case "ownText": {
      const own = replaceByOwnText(state, candidate.def, replaced.event, candidate.move, answer);
      return {
        before: [...replaced.before, ...own.before],
        event: own.event,
        after: [...own.after, ...replaced.after],
      };
    }
  }
}

/** The events a card's own replacement puts in place of the event. */
function replaceByOwnText(
  state: GameState,
  def: ReplacementDef,
  event: SingleEvent,
  move: Move,
  answer: ReplacementChoice | undefined,
): Replacing {
  // What its player chose as it entered (CR 614.12a), which `applyReplacements` asked for first.
  const name = answer?.kind === "asEnters" ? answer.chosen : null;
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
    case "entersWithCounters": {
      if (move.to.zone !== "battlefield") throw new Error("only a permanent entering enters with counters");
      // X as the spell that becomes it was cast (CR 107.3m); 0 if it wasn't cast (put onto the battlefield).
      const obj = state.objects[move.object];
      const x = obj?.kind === "card" ? (obj.choices?.x ?? 0) : 0;
      const amount = def.amount === "X" ? x : def.amount;
      // Zero counters is no counters (CR 122.6 counts only an object given some); others it enters with add up.
      if (amount <= 0) return { before: [], event, after: [] };
      const counters = { ...move.to.counters, [def.counter]: (move.to.counters?.[def.counter] ?? 0) + amount };
      return { before: [], event: rerouted(event, { ...move.to, counters }), after: [] };
    }
    case "entersWithLoyalty": {
      if (move.to.zone !== "battlefield") throw new Error("only a permanent entering enters with loyalty");
      // As many loyalty counters as its printed loyalty (CR 306.5b), added to any it enters with.
      if (def.loyalty <= 0) return { before: [], event, after: [] };
      const counters = { ...move.to.counters, loyalty: (move.to.counters?.loyalty ?? 0) + def.loyalty };
      return { before: [], event: rerouted(event, { ...move.to, counters }), after: [] };
    }
    case "asEntersChooseName": {
      if (move.to.zone !== "battlefield" || name === null) throw new Error("only a permanent entering with a name");
      return { before: [], event: rerouted(event, { ...move.to, chosenName: name }), after: [] };
    }
    case "asEntersChooseBasicLandType": {
      // Likewise, a basic land type (CR 205.3i), checked as it was answered.
      if (move.to.zone !== "battlefield" || name === null || !isBasicLandType(name))
        throw new Error("only a permanent entering with a basic land type");
      return { before: [], event: rerouted(event, { ...move.to, chosenLandType: name }), after: [] };
    }
    case "entersAsCopy": {
      // With the chosen permanent's copiable values (CR 707.2) as they are now; none chosen, as itself.
      if (move.to.zone !== "battlefield" || answer?.kind !== "asEntersCopy")
        throw new Error("only a permanent entering enters as a copy, of the permanent chosen");
      if (answer.chosen === null) return { before: [], event, after: [] };
      const original = state.objects[answer.chosen];
      if (original?.kind !== "card") throw new Error(`${answer.chosen} isn't a permanent to copy`);
      return { before: [], event: rerouted(event, { ...move.to, copied: copiableValues(original) }), after: [] };
    }
    case "preventDamageToYou":
    case "preventDamageToSelfRemovingCounters":
    case "preventNoncombatDamageToAttached":
      throw new Error("a prevention effect never replaces a move");
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
      // A played land carries only "tapped": a name chosen as it enters would be lost (no land in the pool names one).
      if (to.chosenName !== undefined) throw new Error("a land played can't carry a chosen name yet");
      return "tapped" in to ? { ...event, tapped: true } : event;
    case "draw":
    case "dealDamage":
    case "gainLife":
    case "loseLife":
    case "reveal":
    case "reorderLibrary":
    case "tap":
    case "untap":
    case "putCounters":
    case "removeCounters":
    case "createToken":
    case "copySpell":
    case "ceaseToExist":
    case "attach":
    case "unattach":
    case "addMana":
    case "shuffle":
    case "regenerate":
    case "damagePrevented":
      throw new Error(`${event.kind} moves no card`);
  }
}
