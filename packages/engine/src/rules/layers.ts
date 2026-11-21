// The layer system (CR 613): every card object's characteristics, computed in one pass over the whole game, layer by
// layer (CR 613.1), so an effect sees the board as the layers before it left it. Every characteristic reader
// (`controllerOf`, `cardTypesOf`, `colorsOf`, `keywordsOf`, `powerAndToughness`, ...) reads this pass; nothing stores
// a computed value in the state (architecture.md). The pass is computed at most once per state object (D-092).
//
// Each card object starts from its printed values (CR 613.1). The layers with effects in the pool so far: 6 (keywords
// granted) and 7c (CR 613.4c), from resolved effects on the objects they locked in (CR 611.2c), static abilities
// (`static-effects.ts`), counters and rule modifiers. Layers 1-5 and 7a, 7b, 7d have none yet; each comes in its place
// below as its first card does (M2-09).

import type {
  CardData,
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
import {
  type KeywordGrant,
  type StaticPT,
  staticKeywordGrants,
  staticPTChanges,
  staticSources,
} from "./static-effects.ts";

/**
 * One card object's characteristics after every layer (CR 613), and what layer 7c did, for explaining it. Read-only:
 * results are kept and shared (`start`), so a change is always a copy.
 */
export type Layered = Readonly<{
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
  /** Each layer 6 grant of keywords, and its source, for explaining them (the printed ones are in `keywords` too). */
  granted: readonly KeywordGrant[];
}>;

/** What changes an object's power and toughness in layer 7c, and by how much (CR 613.4c). */
export type LayerSevenCChange =
  /** A continuous effect from a resolved spell or ability (CR 611.2), by its source and timestamp. */
  | { kind: "effect"; source: ObjectId; timestamp: number; duration: Duration; power: number; toughness: number }
  /** All the counters of one kind on it (CR 122.1a). */
  | { kind: "counters"; counter: string; count: number; power: number; toughness: number }
  /** A static ability of a permanent on the battlefield (CR 611.3), by that permanent. */
  | { kind: "static"; source: ObjectId; power: number; toughness: number }
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
 * effects apply, are computed together in one pass; a card in any other zone is computed alone as it's first asked for,
 * and kept with the pass, under the same inputs.
 */
export function layeredOf(state: GameState, id: ObjectId, cards: CardDatabase): Layered | null {
  const computed = memo(state, cards);
  const known = computed.board[id] ?? computed.elsewhere[id];
  if (known !== undefined) return known;
  const obj = computed.input.objects[id];
  if (obj?.kind !== "card") return null;
  const card = alone(computed.input, obj, cards);
  computed.elsewhere[id] = card;
  return card;
}

/** A card in another zone: no controller, so "controller" is its owner (CR 108.4a); its printed values otherwise. */
function alone(input: LayerInputs, obj: CardObject, cards: CardDatabase): Layered {
  return layerSeven(input, obj, start(obj, obj.owner, cards), cards);
}

/**
 * The pass computed afresh, without the kept passes, for one card object or for the board: the fuzzer checks after
 * every action that they equal what the readers see (`layersMatchFreshPass`), which catches a state changed in place
 * after its pass was kept. Both share the printed starts (`start`), which are frozen instead.
 */
export function layeredFresh(state: GameState, cards: CardDatabase): Readonly<Record<ObjectId, Layered>> {
  return pass(inputsOf(state), cards);
}

export function layeredOfFresh(state: GameState, id: ObjectId, cards: CardDatabase): Layered | null {
  const input = inputsOf(state);
  const onBoard = pass(input, cards)[id];
  if (onBoard !== undefined) return onBoard;
  const obj = input.objects[id];
  return obj?.kind === "card" ? alone(input, obj, cards) : null;
}

/** The characteristics of everything on the battlefield and the stack, the objects effects apply to. */
export function layered(state: GameState, cards: CardDatabase): Readonly<Record<ObjectId, Layered>> {
  return memo(state, cards).board;
}

/** A kept pass: its inputs and card database, the board, and the cards elsewhere asked for so far. */
type Computed = {
  input: LayerInputs;
  cards: CardDatabase;
  board: Readonly<Record<ObjectId, Layered>>;
  elsewhere: Record<ObjectId, Layered>;
};

// The pass is pure, so its result for the same inputs never changes. It's kept, never stored in the state
// (architecture.md: "memoize per state object ... never by caching values inside the state"; D-092): per objects record
// (by identity: the state is never changed in place, and an action that changes no object, like passing priority, keeps
// it), as a short list matched on all the other inputs by `hasInputs`, the one place the key is spelled out; and the
// last one used, as most reads in a row are of one state.
const computedFor = new WeakMap<LayerInputs["objects"], Computed[]>();
let last: Computed | null = null;

function memo(state: GameState, cards: CardDatabase): Computed {
  if (last !== null && last.cards === cards && hasInputs(state, last.input)) return last;
  const kept = computedFor.get(state.objects) ?? [];
  const found = kept.find((c) => c.cards === cards && hasInputs(state, c.input));
  const computed = found ?? { input: inputsOf(state), cards, board: {}, elsewhere: {} };
  if (found === undefined) {
    computed.board = pass(computed.input, cards);
    computedFor.set(state.objects, [...kept, computed]);
  }
  last = computed;
  return computed;
}

/** Whether the state has exactly these inputs: every part of `LayerInputs`, by identity. */
function hasInputs(state: GameState, input: LayerInputs): boolean {
  return (
    state.objects === input.objects &&
    state.effects === input.effects &&
    state.zones.battlefield === input.battlefield &&
    state.zones.stack === input.stack &&
    state.setup.ruleModifiers === input.ruleModifiers
  );
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
  // Layer 6 (CR 613.1f): keywords granted by resolved effects, on the objects they locked in (CR 611.2c), and by static
  // abilities, on what fits now (CR 611.3a). Only adding so far, so the order within the layer can't matter.
  const sources = staticSources(input, board);
  const { grants, sets } = staticKeywordGrants(input, board, sources);
  for (const effect of input.effects) {
    if (effect.change.kind !== "addKeywords") continue;
    const grant = { source: effect.source, keywords: effect.change.keywords };
    for (const id of effect.affected) grants[id] = [...(grants[id] ?? []), grant];
  }
  for (const [id, granted] of Object.entries(grants) as [ObjectId, KeywordGrant[]][]) {
    const card = board[id];
    const keywords = granted.flatMap((g) => g.keywords);
    if (card !== undefined) board[id] = { ...card, keywords: withoutRepeats([...card.keywords, ...keywords]), granted };
  }
  // Layer 7 (CR 613.4): a creature's printed power and toughness, then 7c.
  const statics = staticPTChanges(input, board, sources, sets, cards);
  for (const obj of objects) {
    const card = board[obj.id];
    if (card !== undefined) board[obj.id] = layerSeven(input, obj, card, cards, statics[obj.id] ?? []);
  }
  return board;
}

/**
 * The printed values with a controller. Made once per card and controller and shared, as most permanents (lands) keep
 * them unchanged: the pass only ever copies a `Layered` to change it (measured, D-092).
 */
function start(obj: CardObject, controller: PlayerId, cards: CardDatabase): Layered {
  const data = cards[obj.oracleId];
  if (data === undefined) throw new Error(`No card data for ${obj.oracleId}`);
  const kept = startsKept.get(data) ?? {};
  const known = kept[controller];
  if (known !== undefined) return known;
  // Frozen, so changing a shared start in place throws rather than quietly changing every card that shares it: the
  // fresh pass shares these too, so the fuzzer's comparison couldn't catch it.
  const made = Object.freeze(printedWith(data, controller));
  startsKept.set(data, { ...kept, [controller]: made });
  return made;
}

const startsKept = new WeakMap<CardData, Partial<Record<PlayerId, Layered>>>();

function printedWith(data: CardData, controller: PlayerId): Layered {
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
    sevenC: Object.freeze([]),
    granted: Object.freeze([]),
  };
}

/**
 * Power and toughness (CR 613.4): a noncreature permanent has none, even if printed; a noncreature card elsewhere has
 * its printed ones (CR 208.3). Then 7c adds (7a, 7b, 7d have no effects yet; when they do, they apply in timestamp
 * order, later: CR 613.7). 7c only adds and subtracts, so its order never changes the result.
 */
function layerSeven(
  input: LayerInputs,
  obj: CardObject,
  card: Layered,
  cards: CardDatabase,
  statics: readonly StaticPT[] = [],
): Layered {
  const printed = cards[obj.oracleId]?.printed;
  const onBattlefield = zoneOfIn(input, obj.id) === "battlefield";
  const isCreature = card.types.includes("creature");
  if (printed === undefined || printed.power === null || printed.toughness === null || (onBattlefield && !isCreature))
    return card;
  const sevenC = [
    ...layer7c(input, obj, card, isCreature, onBattlefield),
    ...statics.map((s): LayerSevenCChange => ({ kind: "static", ...s })),
  ];
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
      case "addKeywords":
      case "cantBeBlocked":
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

/** A keyword granted twice is listed once: each keyword's own rules say several instances are redundant. */
function withoutRepeats<T>(items: readonly T[]): T[] {
  return items.filter((item, i) => items.indexOf(item) === i);
}

/**
 * Where a card object is, of the zones the pass knows: found once per inputs (a lookup per object, rather than a search
 * of the battlefield for each one).
 */
function zoneOfIn(input: LayerInputs, id: ObjectId): "battlefield" | "stack" | "elsewhere" {
  const zones = zonesFor(input);
  return zones[id] ?? "elsewhere";
}

const zonesKept = new WeakMap<LayerInputs, Record<ObjectId, "battlefield" | "stack">>();

function zonesFor(input: LayerInputs): Record<ObjectId, "battlefield" | "stack"> {
  const known = zonesKept.get(input);
  if (known !== undefined) return known;
  const zones: Record<ObjectId, "battlefield" | "stack"> = {};
  for (const id of input.battlefield) zones[id] = "battlefield";
  for (const id of input.stack) zones[id] = "stack";
  zonesKept.set(input, zones);
  return zones;
}
