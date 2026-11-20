// The layer system (CR 613): every card object's characteristics, computed in one pass over the whole game, layer by
// layer (CR 613.1), so an effect sees the board as the layers before it left it. Every characteristic reader
// (`controllerOf`, `cardTypesOf`, `colorsOf`, `keywordsOf`, `powerAndToughness`, ...) reads this pass; nothing stores
// a computed value in the state (architecture.md). The pass is computed at most once per state object (D-092).
//
// Each card object starts from its printed values (CR 613.1). The layers with effects in the pool so far: 7c
// (CR 613.4c), from resolved effects on the objects they locked in (CR 611.2c), counters and rule modifiers. Layers
// 1-6 and 7a, 7b, 7d have none yet; each comes in its place below as its first card does (M2-09).

import type {
  CardDatabase,
  CardType,
  Color,
  Keyword,
  ProtectionQuality,
  StaticAbilityDef,
  Supertype,
} from "../cards/types.ts";
import type { Duration } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";

/** One card object's characteristics after every layer (CR 613), and what layer 7c did, for explaining it. */
export type Layered = {
  /** On the battlefield or the stack, its controller (layer 2); a card elsewhere has none: its owner (CR 108.4a). */
  controller: PlayerId;
  supertypes: readonly Supertype[];
  types: readonly CardType[];
  subtypes: readonly string[];
  colors: readonly Color[];
  keywords: readonly Keyword[];
  protections: readonly ProtectionQuality[];
  statics: readonly StaticAbilityDef[];
  /** Null when it has none: a noncreature permanent, or a card without printed ones (CR 208.3). */
  power: number | null;
  toughness: number | null;
  /** Each layer 7c change, in the order applied (CR 613.4c). */
  sevenC: readonly LayerSevenCChange[];
};

/** What changes an object's power and toughness in layer 7c, and by how much (CR 613.4c). */
export type LayerSevenCChange =
  /** A continuous effect from a resolved spell or ability (CR 611.2), by its source and timestamp. */
  | { kind: "effect"; source: ObjectId; timestamp: number; duration: Duration; power: number; toughness: number }
  /** All the counters of one kind on it (CR 122.1a). */
  | { kind: "counters"; counter: string; count: number; power: number; toughness: number }
  /** A rule modifier of the game (`GameSetup.ruleModifiers`, by index). */
  | { kind: "ruleModifier"; index: number; power: number; toughness: number };

/**
 * What the pass reads, and all it may read: its result is kept for exactly these (D-092), so reading anything else
 * would make it stale. A new layer that reads more (combat, for "attacking creatures") adds it here and to the key.
 */
export type LayerInputs = {
  objects: GameState["objects"];
  effects: GameState["effects"];
  battlefield: GameState["zones"]["battlefield"];
  stack: GameState["zones"]["stack"];
  ruleModifiers: GameState["setup"]["ruleModifiers"];
};

function inputsOf(state: GameState): LayerInputs {
  const { objects, effects } = state;
  const { battlefield, stack } = state.zones;
  return { objects, effects, battlefield, stack, ruleModifiers: state.setup.ruleModifiers };
}

/**
 * One card object's characteristics now, or null if it isn't a card object. The battlefield and the stack, where
 * effects apply, are computed together in one pass; a card in any other zone is computed alone as it's asked for, as
 * nothing there changes it yet (later: effects on cards in hands or graveyards).
 */
export function layeredOf(state: GameState, id: ObjectId, cards: CardDatabase): Layered | null {
  const computed = memo(state, cards);
  const known = computed.board[id];
  if (known !== undefined) return known;
  const obj = computed.input.objects[id];
  if (obj?.kind !== "card") return null;
  return alone(computed.input, obj, cards);
}

// A card outside the battlefield and the stack depends on nothing but itself while no effect names it, so it's kept
// per card object, across states (D-092).
const aloneFor = new WeakMap<CardDatabase, WeakMap<CardObject, Layered>>();

/** A card in another zone: no controller, so "controller" is its owner (CR 108.4a); its printed values otherwise. */
function alone(input: LayerInputs, obj: CardObject, cards: CardDatabase): Layered {
  const named = input.effects.some((e) => e.affected.includes(obj.id));
  const forCards = getOrAdd(aloneFor, cards, () => new WeakMap<CardObject, Layered>());
  const known = named ? undefined : forCards.get(obj);
  if (known !== undefined) return known;
  const card = layerSeven(input, obj, start(obj, obj.owner, cards), cards);
  if (!named) forCards.set(obj, card);
  return card;
}

/**
 * The pass computed afresh, without the kept results: the fuzzer checks after every action that it equals what the
 * readers see (`layersMatchFreshPass`), so a pass reading something outside `LayerInputs` is caught.
 */
export function layeredFresh(state: GameState, cards: CardDatabase): Readonly<Record<ObjectId, Layered>> {
  return pass(inputsOf(state), cards);
}

/** The characteristics of everything on the battlefield and the stack, the objects effects apply to. */
export function layered(state: GameState, cards: CardDatabase): Readonly<Record<ObjectId, Layered>> {
  return memo(state, cards).board;
}

type Computed = { input: LayerInputs; board: Readonly<Record<ObjectId, Layered>> };

// Pure, so its result for the same inputs never changes: kept per inputs (by identity: the state is never changed in
// place, and an action that changes none of them, like passing priority, keeps their identity) and card database, and
// dropped with them (architecture.md: "memoize per state object ... never by caching values inside the state"; D-092).
type Level<K extends object, V> = WeakMap<K, V>;
const computedFor: Level<
  LayerInputs["objects"],
  Level<
    LayerInputs["effects"],
    Level<LayerInputs["battlefield"], Level<LayerInputs["stack"], Level<CardDatabase, Computed>>>
  >
> = new WeakMap();

// The last result: most reads in a row are of one state, or of states that share its inputs, so they skip the
// lookups below.
let last: { cards: CardDatabase; computed: Computed } | null = null;

function memo(state: GameState, cards: CardDatabase): Computed {
  if (last !== null && last.cards === cards && hasInputs(state, last.computed.input)) return last.computed;
  const computed = memoized(inputsOf(state), cards);
  last = { cards, computed };
  return computed;
}

function hasInputs(state: GameState, input: LayerInputs): boolean {
  return (
    state.objects === input.objects &&
    state.effects === input.effects &&
    state.zones.battlefield === input.battlefield &&
    state.zones.stack === input.stack &&
    state.setup.ruleModifiers === input.ruleModifiers
  );
}

function memoized(input: LayerInputs, cards: CardDatabase): Computed {
  const byEffects = getOrAdd(computedFor, input.objects, () => new WeakMap());
  const byBattlefield = getOrAdd(byEffects, input.effects, () => new WeakMap());
  const byStack = getOrAdd(byBattlefield, input.battlefield, () => new WeakMap());
  const byCards = getOrAdd(byStack, input.stack, () => new WeakMap());
  // The rule modifiers are the game's setup, the same for the whole game.
  return getOrAdd(byCards, cards, () => ({
    input,
    board: pass(input, cards),
  }));
}

function getOrAdd<K extends object, V>(map: WeakMap<K, V>, key: K, make: () => V): V {
  const known = map.get(key);
  if (known !== undefined) return known;
  const made = make();
  map.set(key, made);
  return made;
}

function pass(input: LayerInputs, cards: CardDatabase): Record<ObjectId, Layered> {
  const board: Record<ObjectId, Layered> = {};
  const objects: CardObject[] = [];
  for (const id of [...input.battlefield, ...input.stack]) {
    const obj = input.objects[id];
    if (obj?.kind === "card") objects.push(obj);
  }
  // The printed values (CR 613.1), and the controller as stored (CR 110.2); no control-changing effects yet (layer 2).
  for (const obj of objects) board[obj.id] = start(obj, obj.baseController, cards);
  // Layer 7 (CR 613.4): a creature's printed power and toughness, then 7c.
  for (const obj of objects) {
    const card = board[obj.id];
    if (card !== undefined) board[obj.id] = layerSeven(input, obj, card, cards);
  }
  return board;
}

function start(obj: CardObject, controller: PlayerId, cards: CardDatabase): Layered {
  const data = cards[obj.oracleId];
  if (data === undefined) throw new Error(`No card data for ${obj.oracleId}`);
  return {
    controller,
    supertypes: data.printed.supertypes,
    types: data.printed.types,
    subtypes: data.printed.subtypes,
    colors: data.printed.colors,
    keywords: data.def.keywords ?? [],
    protections: data.def.protections ?? [],
    statics: data.def.statics ?? [],
    power: null,
    toughness: null,
    sevenC: [],
  };
}

/**
 * Power and toughness (CR 613.4): a noncreature permanent has none, even if printed; a noncreature card elsewhere has
 * its printed ones (CR 208.3). Then 7c adds (7a, 7b, 7d have no effects yet; when they do, they apply in timestamp
 * order, CR 613.7). 7c only adds and subtracts, so its order never changes the result.
 */
function layerSeven(input: LayerInputs, obj: CardObject, card: Layered, cards: CardDatabase): Layered {
  const printed = cards[obj.oracleId]?.printed;
  const onBattlefield = input.battlefield.includes(obj.id);
  const isCreature = card.types.includes("creature");
  if (printed === undefined || printed.power === null || printed.toughness === null || (onBattlefield && !isCreature))
    return card;
  const sevenC = layer7c(input, obj, card, isCreature, onBattlefield);
  const bonus = sevenC.reduce((sum, c) => ({ power: sum.power + c.power, toughness: sum.toughness + c.toughness }), {
    power: 0,
    toughness: 0,
  });
  return { ...card, power: printed.power + bonus.power, toughness: printed.toughness + bonus.toughness, sevenC };
}

/** Layer 7c (CR 613.4c): effects and counters that modify power and toughness, each with what it is. */
function layer7c(
  input: LayerInputs,
  obj: CardObject,
  card: Layered,
  isCreature: boolean,
  onBattlefield: boolean,
): LayerSevenCChange[] {
  const changes: LayerSevenCChange[] = [];
  // Continuous effects from resolved spells and abilities, on the objects they locked in (CR 611.2c).
  for (const effect of input.effects) {
    if (!effect.affected.includes(obj.id)) continue;
    switch (effect.change.kind) {
      case "modifyPT": {
        const { power, toughness } = effect.change;
        const { source, timestamp, duration } = effect;
        changes.push({ kind: "effect", source, timestamp, duration, power, toughness });
        break;
      }
      case "cantBlock":
      case "mustAttack":
        break;
    }
  }
  // +X/+Y and -X/-Y counters count on a creature or a creature card in another zone, not on a noncreature card
  // (CR 122.1a). In the engine today only permanents get counters (they don't move with a card, CR 122.2), but the CR
  // allows them elsewhere.
  for (const [name, count] of isCreature ? Object.entries(obj.counters) : []) {
    const pt = ptCounter(name);
    if (pt !== null)
      changes.push({
        kind: "counters",
        counter: name,
        count,
        power: pt.power * count,
        toughness: pt.toughness * count,
      });
  }
  // Rule modifiers: "creatures [player] controls get +N/+N" means creature permanents on the battlefield (CR 109.2).
  if (onBattlefield) {
    input.ruleModifiers.forEach((modifier, index) => {
      switch (modifier.kind) {
        case "creaturesGetPT":
          if (modifier.controller === card.controller)
            changes.push({ kind: "ruleModifier", index, power: modifier.power, toughness: modifier.toughness });
          break;
      }
    });
  }
  return changes;
}

/** A counter named like `+1/+1` or `-1/-1` (CR 122.1a), as numbers; null for any other counter. */
function ptCounter(name: string): { power: number; toughness: number } | null {
  const match = /^([+-]\d+)\/([+-]\d+)$/.exec(name);
  if (match === null) return null;
  return { power: Number(match[1]), toughness: Number(match[2]) };
}
