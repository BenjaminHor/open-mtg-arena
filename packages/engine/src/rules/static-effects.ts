// The continuous effects of permanents' static abilities (CR 604.1, 611.3), for the layer pass (`layers.ts`): they aren't
// locked in, but apply at any moment to whatever their text says (CR 611.3a), only while their permanent is on the
// battlefield (CR 113.6, 611.3b). Inside the pass, what fits a filter is read from the board as the earlier layers left
// it, never from the readers (which read the finished pass).

import type { CardDatabase, Keyword, ObjectFilter, StaticAbilityDef } from "../cards/types.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import { fits } from "./filter-fit.ts";
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
 * (CR 611.3a); it keeps them in its later layer (CR 613.6).
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
    // "Creatures": whatever else the filter says, only creatures (it can't grant a keyword to a land by omission).
    if (obj?.kind !== "card" || card === undefined || !card.types.includes("creature")) return false;
    return fitsOnBoard(obj, card, def.filter, you);
  });
}

/** Layer 6 (CR 613.1f): keywords these static abilities grant, by object, with the sets they found. */
export function staticKeywordGrants(
  input: LayerInputs,
  board: Readonly<Record<ObjectId, Layered>>,
  sources: readonly StaticSource[],
): { grants: Record<ObjectId, KeywordGrant[]>; sets: (ObjectId[] | undefined)[] } {
  const grants: Record<ObjectId, KeywordGrant[]> = {};
  // By source's place in `sources`: the set each effect found here, if it started in this layer.
  const sets: (ObjectId[] | undefined)[] = sources.map(() => undefined);
  for (const [i, s] of sources.entries()) {
    if (s.def.kind !== "creaturesGet" || (s.def.keywords ?? []).length === 0) continue;
    const affected = creaturesGetSet(input, board, s.source, s.def);
    sets[i] = affected;
    const keywords = s.def.keywords ?? [];
    for (const id of affected) grants[id] = [...(grants[id] ?? []), { source: s.source, keywords }];
  }
  return { grants, sets };
}

/** Keywords granted in layer 6, and by what: a static ability's permanent, or a resolved effect's source. */
export type KeywordGrant = { source: ObjectId; keywords: readonly Keyword[] };

/** One static ability's change to a permanent's power and toughness in layer 7c (CR 613.4c). */
export type StaticPT = { source: ObjectId; power: number; toughness: number };

/**
 * Layer 7c (CR 613.4c): the static abilities' bonuses, by object. A "creatures get" effect that started in layer 6 keeps
 * the set it found there (CR 613.6), even if what it grants there changes what fits; one that starts here finds it
 * now.
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
        // its creature types (later: CR 205.3m).
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
      case "powerToughnessEachEqual":
      case "cantAttackUnlessDefenderControls":
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

/** How many permanents fit a filter, read from the board as built so far, `you` being the ability's controller. */
export function countOnBoard(
  input: LayerInputs,
  board: Readonly<Record<ObjectId, Layered>>,
  filter: ObjectFilter,
  you: PlayerId,
): number {
  return input.battlefield.filter((id) => {
    const obj = input.objects[id];
    const card = board[id];
    return obj?.kind === "card" && card !== undefined && fitsOnBoard(obj, card, filter, you);
  }).length;
}

/**
 * Whether a permanent fits a filter, read from the board as built so far (`filter-fit.ts`; `matchesFilter` reads the
 * finished pass, so the pass can't call it). `you` is the static ability's controller. Combat isn't one of the pass's
 * inputs (D-092), so a static can't ask about attacking or blocking; definitions are checked for that.
 */
function fitsOnBoard(obj: CardObject, card: Layered, filter: ObjectFilter, you: PlayerId): boolean {
  const inCombat = () => {
    throw new Error("a static ability can't ask about combat inside the layer pass (D-092)");
  };
  return fits({ obj, card, controlled: true, inCombat }, filter, you, null);
}
