// The layer system (CR 613): every card object's characteristics, computed in one pass over the whole game, layer by
// layer (CR 613.1), so an effect sees the board as the layers before it left it. Every characteristic reader
// (`controllerOf`, `cardTypesOf`, `colorsOf`, `keywordsOf`, `powerAndToughness`, ...) reads this pass; nothing stores
// a computed value in the state (architecture.md). The pass is computed at most once per state object (D-092).
//
// Each card object starts from its printed values (CR 613.1). The layers with effects in the pool so far: 6 (keywords
// granted or removed, `layer-six.ts`), 7a (characteristic-defining abilities, CR 613.4a, in every zone) and 7c (CR 613.4c), from resolved effects
// on the objects they locked in (CR 611.2c), static abilities (`static-effects.ts`), counters and rule modifiers.
// Layers 4 and 5 (types, colors) and 7b (P/T set) have resolved effects too (D-095), and so has layer 2 (D-098,
// `control-effects.ts`; `controllerOf` reads the pass, D-104). Layers 1, 3 and 7d have none yet; each comes in its place
// below as its first card does.

import { cardDataOf } from "../cards/card-data.ts";
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
import type { Becomes, Duration } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { COLORS } from "../state/mana.ts";
import type { CardObject } from "../state/objects.ts";
import { controlFromEffects } from "./control-effects.ts";
import { layerSeven } from "./layer-seven.ts";
import { layerSix } from "./layer-six.ts";
import { type KeywordGrant, staticPTChanges, staticSources } from "./static-effects.ts";

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
  /** What 7c started from: 7a's characteristic-defining ability, or the printed values; null with no P/T. */
  base: BasePT | null;
  /** Each layer 7c change, in the order applied (CR 613.4c). */
  sevenC: readonly LayerSevenCChange[];
  /**
   * Each layer 6 change to keywords, granted or removed, in the timestamp order applied, with its source, for explaining
   * them (the printed ones are in `keywords` too).
   */
  granted: readonly KeywordGrant[];
  /**
   * Not a characteristic: "enchanted creature can't attack or block" (Pacifism, CR 508.1c, 509.1b) from a permanent
   * attached to it. Found here because the pass already finds what each static applies to, so combat asks once per
   * creature instead of searching the battlefield for every pair of attacker and blocker (measured).
   */
  cantAttackOrBlock: boolean;
  /** Likewise, "equipped creature can't be blocked" (Whispersilk Cloak, CR 509.1b). */
  cantBeBlocked: boolean;
}>;

/** The power and toughness 7c started from, and where they came from (effects that check them, later: CR 208.4b). */
export type BasePT = Readonly<
  | { from: "printed" | "ability"; power: number; toughness: number }
  /** A creature with none: 0 (CR 208.5). */
  | { from: "none"; power: 0; toughness: 0 }
  /** Set by a resolved effect (layer 7b), from this source. */
  | { from: "effect"; source: ObjectId; power: number; toughness: number }
>;

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
  const card = offBoard(computed.input, computed.board, obj, cards);
  computed.elsewhere[id] = card;
  return card;
}

/**
 * A card in another zone: no controller, so "controller", and the "you" of its abilities, is its owner (CR 108.4a,
 * 109.5). Its printed values, but for 7a, whose counts read the finished board (CR 604.3).
 */
function offBoard(
  input: LayerInputs,
  board: Readonly<Record<ObjectId, Layered>>,
  obj: CardObject,
  cards: CardDatabase,
): Layered {
  return layerSeven(input, board, obj, start(obj, obj.owner, cards), false, cards);
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
  const board = pass(input, cards);
  const onBoard = board[id];
  if (onBoard !== undefined) return onBoard;
  const obj = input.objects[id];
  return obj?.kind === "card" ? offBoard(input, board, obj, cards) : null;
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
  // The printed values (CR 613.1), and the controller: as stored (CR 110.2), unless a layer 2 effect changed it
  // (CR 613.1b; a permanent's only, as effects lock in permanents).
  for (const obj of objects) {
    const changed = zoneOfIn(input, obj.id) === "battlefield" ? controlFromEffects(input.effects, obj.id) : null;
    board[obj.id] = start(obj, changed ?? obj.baseController, cards);
  }
  // Layers 4 and 5 (CR 613.1d, 613.1e): resolved effects that change types and colors, on the objects they locked in
  // (CR 611.2c), each layer in timestamp order (CR 613.7), which is `input.effects`' order (each new one is later).
  for (const effect of input.effects) {
    if (effect.change.kind !== "becomes") continue;
    for (const id of effect.affected) {
      const card = board[id];
      if (card !== undefined) board[id] = withTypesAdded(card, effect.change);
    }
  }
  for (const effect of input.effects) {
    if (effect.change.kind !== "becomes" || effect.change.colors === undefined) continue;
    for (const id of effect.affected) {
      const card = board[id];
      if (card !== undefined) board[id] = withColors(card, effect.change.colors);
    }
  }
  // Layer 6 (CR 613.1f): abilities, in `layer-six.ts`; it keeps the sets the static abilities found for 7c (CR 613.6).
  const sources = staticSources(input, board);
  const sets = layerSix(input, board, sources);
  // Layer 7 (CR 613.4): a creature's base power and toughness (7b's, else 7a's, else printed), then 7c.
  const statics = staticPTChanges(input, board, sources, sets, cards);
  for (const obj of objects) {
    const card = board[obj.id];
    const onBattlefield = zoneOfIn(input, obj.id) === "battlefield";
    if (card !== undefined)
      board[obj.id] = layerSeven(input, board, obj, card, onBattlefield, cards, statics[obj.id] ?? []);
  }
  return board;
}

/**
 * The printed values with a controller. Made once per card and controller and shared, as most permanents (lands) keep
 * them unchanged: the pass only ever copies a `Layered` to change it (measured, D-092).
 */
function start(obj: CardObject, controller: PlayerId, cards: CardDatabase): Layered {
  const data = cardDataOf(obj, cards);
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
    base: null,
    sevenC: Object.freeze([]),
    granted: Object.freeze([]),
    cantAttackOrBlock: false,
    cantBeBlocked: false,
  };
}

/**
 * Layer 4: card types and subtypes added, the others kept ("it's still a land", "in addition to its other types",
 * CR 205.1b). Setting types without keeping them waits for a card that does it.
 */
function withTypesAdded(card: Layered, change: Becomes): Layered {
  if (change.addTypes.length === 0 && change.addSubtypes.length === 0) return card;
  return {
    ...card,
    types: withoutRepeats([...card.types, ...change.addTypes]),
    subtypes: withoutRepeats([...card.subtypes, ...change.addSubtypes]),
  };
}

/**
 * Layer 5: colors set ("becomes ... green") or added ("black in addition to its other colors"). Listed in WUBRG order,
 * like printed colors; colorless is no color at all (CR 105.2c), so adding black to it makes it only black.
 */
function withColors(card: Layered, colors: NonNullable<Becomes["colors"]>): Layered {
  const now = "set" in colors ? colors.set : [...card.colors, ...colors.add];
  return { ...card, colors: COLORS.filter((c) => now.includes(c)) };
}

/** A keyword granted twice is listed once: each keyword's own rules say several instances are redundant. */
export function withoutRepeats<T>(items: readonly T[]): T[] {
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
