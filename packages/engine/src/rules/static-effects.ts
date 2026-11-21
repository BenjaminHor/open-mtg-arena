// The continuous effects of permanents' static abilities (CR 604.1, 611.3), for the layer pass (`layers.ts`): they aren't
// locked in, but apply at any moment to whatever their text says (CR 611.3a), only while their permanent is on the
// battlefield (CR 113.6, 611.3b). Inside the pass, what fits a filter is read from the board as the earlier layers left
// it, never from the readers (which read the finished pass).

import { cardDataOf } from "../cards/card-data.ts";
import type { CardDatabase, Keyword, ObjectFilter, StaticAbilityDef } from "../cards/types.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import { attachedHostIn } from "./attachment.ts";
import { fits } from "./filter-fit.ts";
import type { Layered, LayerInputs } from "./layers.ts";
import { libraryTopOf } from "./library-top-input.ts";
import { printedStart } from "./printed-start.ts";

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
  cards: CardDatabase,
): ObjectId[] {
  const you = board[source]?.controller;
  if (you === undefined) return [];
  // "As long as ...": "your library" is its controller's (CR 109.5).
  if (def.asLongAs !== undefined && !topOfLibraryFits(input, you, def.asLongAs.topOfLibrary, cards)) return [];
  return input.battlefield.filter((id) => {
    if (def.others === true && id === source) return false;
    const obj = input.objects[id];
    const card = board[id];
    // "Creatures": whatever else the filter says, only creatures (it can't grant a keyword to a land by omission).
    if (obj?.kind !== "card" || card === undefined || !card.types.includes("creature")) return false;
    // "This creature and other Vampire creatures": this one even if it isn't a Vampire (Vampire Nocturnus's ruling).
    if (def.self === true && id === source) return true;
    return fitsOnBoard(obj, card, def.filter, you);
  });
}

/** Layer 6 (CR 613.1f): keywords these static abilities grant, by object, with the sets they found. */
export function staticKeywordGrants(
  input: LayerInputs,
  board: Readonly<Record<ObjectId, Layered>>,
  sources: readonly StaticSource[],
  cards: CardDatabase,
): { grants: Record<ObjectId, KeywordGrant[]>; sets: (ObjectId[] | undefined)[] } {
  const grants: Record<ObjectId, KeywordGrant[]> = {};
  const timestampOf = (id: ObjectId) => staticTimestamp(input, id);
  // By source's place in `sources`: the set each effect found here, if it started in this layer.
  const sets: (ObjectId[] | undefined)[] = sources.map(() => undefined);
  for (const [i, s] of sources.entries()) {
    switch (s.def.kind) {
      case "attachedGets": {
        // "Enchanted creature has flying", "equipped creature loses flying" (CR 303.4m, 301.5f): the permanent it's
        // attached to, whatever that is now.
        const host = attachedHostIn(input.objects, input.battlefield, s.source);
        const keywords = s.def.keywords ?? [];
        const lose = s.def.loseKeywords ?? [];
        if (host !== null && (keywords.length > 0 || lose.length > 0))
          grants[host] = [
            ...(grants[host] ?? []),
            { source: s.source, timestamp: timestampOf(s.source), keywords, lose },
          ];
        break;
      }
      case "creaturesGet": {
        const keywords = s.def.keywords ?? [];
        if (keywords.length === 0) break;
        const affected = creaturesGetSet(input, board, s.source, s.def, cards);
        sets[i] = affected;
        const grant = { source: s.source, timestamp: timestampOf(s.source), keywords, lose: [] };
        for (const id of affected) grants[id] = [...(grants[id] ?? []), grant];
        break;
      }
      case "attachedCantAttackOrBlock":
      case "attachedCantBeBlocked":
      case "attachedCantActivate":
      case "attachedDoesntUntap":
      case "attachedSetsLandType":
      case "cantLoseOpponentsCantWin":
      case "chosenNameCantActivate":
      case "attachedControl":
      case "plusPerSharedCreatureType":
      case "plusPerOtherSameName":
      case "cantBeBlocked":
      case "canBlockAnyNumber":
      case "cantAttackOrBlockAlone":
      case "attacksEachCombat":
      case "mustBeBlockedByAllAble":
      case "cantBeCountered":
      case "powerToughnessEachEqual":
      case "cantAttackUnlessDefenderControls":
      case "noMaximumHandSize":
      case "opponentsPlayWithHandsRevealed":
      case "playWithTopOfLibraryRevealed":
        break;
    }
  }
  return { grants, sets };
}

/**
 * The timestamp of a static ability's effects: its permanent's (CR 613.7a), which an Aura or Equipment renews each time
 * it's attached (CR 613.7e). Shared by the layers that order statics against resolved effects (2 and 6).
 */
export function staticTimestamp(input: LayerInputs, source: ObjectId): number {
  const obj = input.objects[source];
  return obj?.kind === "card" ? obj.timestamp : 0;
}

/**
 * Keywords granted or removed in layer 6, and by what: a static ability's permanent, or a resolved effect's source. Applied
 * in timestamp order (CR 613.7), so "loses flying" and "gains flying" end with the later one.
 */
export type KeywordGrant = {
  source: ObjectId;
  timestamp: number;
  keywords: readonly Keyword[];
  lose: readonly Keyword[];
};

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
        const affected = setsFromLayer6[i] ?? creaturesGetSet(input, board, s.source, s.def, cards);
        for (const id of affected) add(id, { source: s.source, power, toughness });
        break;
      }
      case "attachedGets": {
        // "Enchanted creature gets +1/+2" (CR 303.4m), and "+1/+1 for each Plains you control" counted now (CR 611.3a).
        const host = attachedHostIn(input.objects, input.battlefield, s.source);
        const you = board[s.source]?.controller;
        if (host === null || you === undefined || !creatures.includes(host)) break;
        const times = s.def.perCount === undefined ? 1 : countOnBoard(input, board, s.def.perCount, you);
        const { power, toughness } = s.def;
        if (times * power !== 0 || times * toughness !== 0)
          add(host, { source: s.source, power: times * power, toughness: times * toughness });
        break;
      }
      case "plusPerSharedCreatureType":
        // Each creature, whoever controls it (CR 109.2), counting the others that share a creature type with it. The
        // subtypes are one list today, land types included: an animated Forest is a creature with one (Awakener Druid's
        // are all Treefolk, so a shared land type adds nobody yet). Compare only creature types (later: CR 205.3m).
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
      case "noMaximumHandSize":
      case "opponentsPlayWithHandsRevealed":
      case "playWithTopOfLibraryRevealed":
      case "attachedCantAttackOrBlock":
      case "attachedCantBeBlocked":
      case "attachedCantActivate":
      case "attachedDoesntUntap":
      case "attachedSetsLandType":
      case "cantLoseOpponentsCantWin":
      case "chosenNameCantActivate":
      case "attachedControl":
        break;
    }
  }
  return changes;
}

/** An object's name: printed, as nothing changes names yet (layer 1 copies and layer 3 text changes would). */
function cardName(input: LayerInputs, id: ObjectId, cards: CardDatabase): string | null {
  const obj = input.objects[id];
  return obj?.kind === "card" ? (cardDataOf(obj, cards)?.printed.name ?? null) : null;
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
function fitsOnBoard(obj: CardObject, card: Layered, filter: ObjectFilter, you: PlayerId, controlled = true): boolean {
  const inCombat = () => {
    throw new Error("a static ability can't ask about combat inside the layer pass (D-092)");
  };
  const namedThisWay = () => {
    throw new Error("a static ability can't ask about a name chosen while something resolves");
  };
  return fits({ obj, card, controlled, inCombat, namedThisWay }, filter, you, null);
}

/**
 * "As long as the top card of your library is [filter]" (Vampire Nocturnus): read with its printed values, as no
 * effect in the pool applies to a card in a library. An empty library has no top card, so it fits nothing.
 */
function topOfLibraryFits(input: LayerInputs, you: PlayerId, filter: ObjectFilter, cards: CardDatabase): boolean {
  const top = libraryTopOf(input, you);
  const obj = top === null ? undefined : input.objects[top];
  if (obj?.kind !== "card") return false;
  return fitsOnBoard(obj, printedStart(obj, obj.owner, cards), filter, you, false);
}
