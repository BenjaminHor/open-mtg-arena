// The continuous effects of permanents' static abilities (CR 604.1, 611.3), for the layer pass (`layers.ts`): they aren't
// locked in, but apply at any moment to whatever their text says (CR 611.3a), only while their permanent is on the
// battlefield (CR 113.6, 611.3b). Inside the pass, what fits a filter is read from the board as the earlier layers left
// it, never from the readers (which read the finished pass).

import type { CardDatabase, Keyword, ObjectFilter, StaticAbilityDef } from "../cards/types.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import type { Layered, LayerInputs } from "./layers.ts";

type CreaturesGet = Extract<StaticAbilityDef, { kind: "creaturesGet" }>;

/** One static ability's effect: its permanent, and which of its statics. */
export type StaticSource = { source: ObjectId; def: StaticAbilityDef };

/** The static abilities of the permanents on the battlefield, as the board has them (layer 6 removes none yet). */
export function staticSources(input: LayerInputs, board: Readonly<Record<ObjectId, Layered>>): StaticSource[] {
  return input.battlefield.flatMap((source) => (board[source]?.statics ?? []).map((def) => ({ source, def })));
}

/**
 * The permanents a "creatures get" effect applies to, found from the board as it is when the effect first applies
 * (CR 611.3a); it keeps them in its later layer (later: CR 613.6).
 */
export function creaturesGetSet(
  input: LayerInputs,
  board: Readonly<Record<ObjectId, Layered>>,
  source: ObjectId,
  def: CreaturesGet,
): ObjectId[] {
  const you = board[source]?.controller;
  if (you === undefined) return [];
  return input.battlefield.filter((id) => {
    if (def.others === true && id === source) return false;
    const obj = input.objects[id];
    const card = board[id];
    return obj?.kind === "card" && card !== undefined && fitsOnBoard(obj, card, def.filter, you);
  });
}

/** Layer 6 (CR 613.1f): keywords these static abilities grant, by object, with the sets they found. */
export function staticKeywordGrants(
  input: LayerInputs,
  board: Readonly<Record<ObjectId, Layered>>,
  sources: readonly StaticSource[],
): { grants: Record<ObjectId, Keyword[]>; sets: (ObjectId[] | undefined)[] } {
  const grants: Record<ObjectId, Keyword[]> = {};
  // By source's place in `sources`: the set each effect found here, if it started in this layer.
  const sets: (ObjectId[] | undefined)[] = sources.map(() => undefined);
  for (const [i, s] of sources.entries()) {
    if (s.def.kind !== "creaturesGet" || (s.def.keywords ?? []).length === 0) continue;
    const affected = creaturesGetSet(input, board, s.source, s.def);
    sets[i] = affected;
    for (const id of affected) grants[id] = [...(grants[id] ?? []), ...(s.def.keywords ?? [])];
  }
  return { grants, sets };
}

/** One static ability's change to a permanent's power and toughness in layer 7c (CR 613.4c). */
export type StaticPT = { source: ObjectId; power: number; toughness: number };

/**
 * Layer 7c (CR 613.4c): the static abilities' bonuses, by object. A "creatures get" effect that started in layer 6 keeps
 * the set it found there (later: CR 613.6, once something between those layers can change what fits); one that
 * starts here finds it now.
 */
export function staticPTChanges(
  input: LayerInputs,
  board: Readonly<Record<ObjectId, Layered>>,
  sources: readonly StaticSource[],
  setsFromLayer6: readonly (ObjectId[] | undefined)[],
  cards: CardDatabase,
): Record<ObjectId, StaticPT[]> {
  const changes: Record<ObjectId, StaticPT[]> = {};
  const add = (id: ObjectId, change: StaticPT) => {
    changes[id] = [...(changes[id] ?? []), change];
  };
  const creatures = input.battlefield.filter((id) => board[id]?.types.includes("creature") === true);
  for (const [i, s] of sources.entries()) {
    switch (s.def.kind) {
      case "creaturesGet": {
        const { power, toughness } = s.def;
        if (power === 0 && toughness === 0) break;
        const affected = setsFromLayer6[i] ?? creaturesGetSet(input, board, s.source, s.def);
        for (const id of affected) add(id, { source: s.source, power, toughness });
        break;
      }
      case "plusPerSharedCreatureType":
        // Each creature, whoever controls it (CR 109.2), counting the others that share a creature type with it. The
        // subtypes are one list today; once a creature can also have land types (an animated Forest), compare only
        // its creature types (CR 205.3m).
        for (const id of creatures) {
          const mine = board[id]?.subtypes ?? [];
          const sharing = creatures.filter(
            (other) => other !== id && (board[other]?.subtypes ?? []).some((t) => mine.includes(t)),
          );
          if (sharing.length > 0) add(id, { source: s.source, power: sharing.length, toughness: sharing.length });
        }
        break;
      case "plusPerOtherSameName": {
        const named = cardName(input, s.source, cards);
        const others = creatures.filter((other) => other !== s.source && cardName(input, other, cards) === named);
        if (others.length > 0 && creatures.includes(s.source))
          add(s.source, { source: s.source, power: others.length, toughness: others.length });
        break;
      }
      case "cantBeBlocked":
      case "canBlockAnyNumber":
      case "cantAttackOrBlockAlone":
      case "attacksEachCombat":
      case "mustBeBlockedByAllAble":
      case "cantBeCountered":
        break;
    }
  }
  return changes;
}

/** An object's name: printed, as nothing changes names yet (layer 1 copies and layer 3 text changes would). */
function cardName(input: LayerInputs, id: ObjectId, cards: CardDatabase): string | null {
  const obj = input.objects[id];
  return obj?.kind === "card" ? (cards[obj.oracleId]?.printed.name ?? null) : null;
}

/**
 * Whether a permanent fits a filter, read from the board as built so far (`matchesFilter` reads the finished pass, so
 * the pass can't call it). `you` is the static ability's controller. Combat isn't one of the pass's inputs (D-092), so a
 * static can't ask about attacking or blocking.
 */
function fitsOnBoard(obj: CardObject, card: Layered, filter: ObjectFilter, you: PlayerId): boolean {
  const any = <T>(have: readonly T[], wanted: readonly T[] | undefined) =>
    wanted === undefined || wanted.some((w) => have.includes(w));
  const none = <T>(have: readonly T[], unwanted: readonly T[] | undefined) =>
    unwanted === undefined || !unwanted.some((u) => have.includes(u));
  if (!any(card.types, filter.types) || !none(card.types, filter.notTypes)) return false;
  if (!any(card.colors, filter.colors) || !none(card.colors, filter.notColors)) return false;
  if (!any(card.subtypes, filter.subtypes)) return false;
  if (!any(card.keywords, filter.keywords) || !none(card.keywords, filter.notKeywords)) return false;
  if (filter.supertypes !== undefined && !filter.supertypes.every((s) => card.supertypes.includes(s))) return false;
  if (filter.not !== undefined && fitsOnBoard(obj, card, filter.not, you)) return false;
  if (filter.tapped === true && !obj.tapped) return false;
  if (filter.combat !== undefined)
    throw new Error("a static ability can't ask about combat inside the layer pass (D-092)");
  switch (filter.controller) {
    case undefined:
      return true;
    case "you":
      return card.controller === you;
    case "notYou":
    case "opponent":
      // An opponent (CR 102.2); teams would change "opponent" (later: CR 102.3).
      return card.controller !== you;
    case "triggeringPlayer":
      throw new Error("only a triggered ability's target can name the triggering player");
  }
  return true;
}
