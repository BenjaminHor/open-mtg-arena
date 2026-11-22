// What the golden games cover, and `pnpm golden:cover`, which adds games until they cover every mechanic in the pool
// (D-082; D-069 covered every card). Between them the golden games must run every mechanic the pool's cards have
// (`mechanics.ts`) and answer every kind of decision, and the export tests need a few kinds of choice in them. Rather
// than play long games between hand-made decks, the command plays the fuzzer's decks for each seed (prebuilt pairs and
// seeded random pool decks) with `by-kind` agents, and keeps, greedily, the game that adds the most uncovered units per
// action, cut off (`maxTurns`) at the turn its last new unit appears. The games already in the folder count, and none
// is changed: it only adds.

import { basename } from "node:path";
import { parseArgs } from "node:util";
import { cardDatabase } from "@mtg/cards";
import {
  type Action,
  applyAction,
  type CardDatabase,
  cardDataByOracleId,
  cardDataOf,
  createGame,
  type GameEvent,
  type GameSetup,
  type GameState,
  type ObjectId,
} from "@mtg/engine";
import { deckGameSetup } from "@mtg/match";
import { playAgents } from "./agent-play.ts";
import { fuzzDecks, TURN_CAP } from "./fuzz/run-game.ts";
import { addGolden, GOLDEN_DIR, goldenFiles, type NewGolden, playRecipe, readGolden } from "./golden.ts";
import {
  abilityUnits,
  DELAYED_TRIGGER,
  decisionUnit,
  eventUnit,
  permanentUnits,
  replacementUnits,
  spellUnits,
  triggerUnits,
  wantedMechanics,
} from "./mechanics.ts";
import { wholeNumber } from "./numbers.ts";

/**
 * Choices the export tests need in a golden game (`export.test.ts`): naming a spell on the stack as a target, a card in
 * a graveyard as a target, and cards chosen while a spell resolves. The cover counts them like cards.
 */
export const FEATURES = {
  stackTarget: "a spell on the stack targeted",
  graveyardTarget: "a card in a graveyard targeted",
  cardsChosen: "cards chosen as a spell or ability resolves",
} as const;

/**
 * What a game covers: each mechanic it runs, each kind of decision answered, and each feature, with the first turn it
 * appears (`mechanicsUsed`). `lengthThrough[t]` is how many actions the game takes up to the end of turn
 * `t`, so a game cut off at turn `t` is that long.
 */
export type Coverage = { firstTurn: Record<string, number>; lengthThrough: number[] };

export function coverageOf(setup: GameSetup, actions: readonly Action[], cards: CardDatabase): Coverage {
  const created = createGame(setup, cards);
  if (!created.ok) throw new Error(`the setup is rejected: ${created.error.message}`);
  const firstTurn: Record<string, number> = {};
  const lengthThrough: number[] = [];
  let state = created.state;
  for (const [i, action] of actions.entries()) {
    const turnBefore = state.turn?.number ?? 0;
    // Every action so far was taken in this turn or before it.
    for (let t = lengthThrough.length; t < turnBefore; t++) lengthThrough[t] = i;
    for (const unit of featuresOf(state, action)) firstTurn[unit] ??= turnBefore;
    if (state.pending !== null && answers(action)) firstTurn[decisionUnit(state.pending.kind)] ??= turnBefore;
    const result = applyAction(state, action, cards);
    if (!result.ok) throw new Error(`action ${i + 1} is rejected: ${result.error.message}`);
    let turn = turnBefore;
    for (const event of result.events) {
      if (event.type === "TURN_BEGAN") turn = event.turn;
      firstTurn[eventUnit(event.type)] ??= turn;
      for (const unit of mechanicsUsed(event, state, result.state, cards)) firstTurn[unit] ??= turn;
    }
    state = result.state;
  }
  const lastTurn = state.turn?.number ?? 0;
  for (let t = lengthThrough.length; t <= lastTurn; t++) lengthThrough[t] = actions.length;
  return { firstTurn, lengthThrough };
}

/**
 * The mechanics an event shows a card's script running (D-082): a spell resolving (its fields, and the keywords and
 * statics credited as it resolves), an ability resolving (its costs or trigger condition, targets and effects), a
 * mana ability making mana, a card moving where its own replacement effect applies, or creatures attacking and blocking
 * (their combat keywords, protection and statics, where those do something). A cast that's cancelled or countered
 * never runs the script. Objects that left are only in the state before.
 */
export function mechanicsUsed(event: GameEvent, before: GameState, after: GameState, cards: CardDatabase): string[] {
  const object = (id: ObjectId) => before.objects[id] ?? after.objects[id];
  const cardDef = (id: ObjectId) => {
    const obj = object(id);
    return obj?.kind === "card" ? cardDataOf(obj, cards)?.def : undefined;
  };
  const inCombat = (ids: readonly ObjectId[]) =>
    ids.flatMap((id) => {
      const def = cardDef(id);
      return def === undefined ? [] : permanentUnits(def, "combat");
    });
  switch (event.type) {
    case "SPELL_RESOLVED": {
      const obj = object(event.object);
      const def = cardDef(event.object);
      if (def === undefined || obj === undefined) return [];
      const manyTargets = (obj.choices?.targets.flat().length ?? 0) > 1;
      return [...permanentUnits(def, "enters"), ...(def.spell === undefined ? [] : spellUnits(def.spell, manyTargets))];
    }
    case "ABILITY_RESOLVED": {
      const obj = object(event.object);
      if (obj?.kind !== "ability") return [];
      const def = cardDataByOracleId(obj.sourceOracleId, cards)?.def;
      const ref = obj.ability;
      switch (ref.kind) {
        case "printed": {
          const ability = def?.abilities?.[ref.index];
          return ability === undefined ? [] : abilityUnits(ability);
        }
        case "triggered": {
          const trigger = def?.triggers?.[ref.index];
          return trigger === undefined ? [] : triggerUnits(trigger);
        }
        case "delayed":
          // Credited as the delayed ability itself resolves, not as the effect that made it does.
          return [DELAYED_TRIGGER, ...triggerUnits(ref.ability)];
        case "basicLandType":
          // A basic land's mana ability never goes on the stack (CR 605.3b).
          return [];
      }
      return [];
    }
    case "MANA_ADDED": {
      // A printed mana ability (Birds of Paradise); a basic land's is intrinsic and shows nothing a card defines. Coarse:
      // every mana ability of the source counts, as no pool card has two.
      const abilities = cardDef(event.source)?.abilities ?? [];
      return abilities.filter((a) => a.effects.some((e) => e.op === "addMana")).flatMap(abilityUnits);
    }
    case "ZONE_CHANGED": {
      // A mulligan puts the hand back into the library: no replacement does that (CR 103.5).
      const def = cardDataOf(event.object, cards)?.def;
      return def === undefined || before.pregame !== null ? [] : replacementUnits(def, event.to.zone);
    }
    case "DAMAGE_PREVENTED": {
      // A permanent's own prevention text, credited only when it prevented something.
      const def = cardDataByOracleId(event.by, cards)?.def;
      return def === undefined ? [] : replacementUnits(def, "prevented");
    }
    case "ATTACKERS_DECLARED":
      return inCombat(event.attacks.map((a) => a.attacker));
    case "BLOCKERS_DECLARED":
      return inCombat(event.blocks.flatMap((b) => [b.blocker, b.attacker]));
    default:
      return [];
  }
}

/** Whether the action answers the pending decision: a concession, a cancel or a take-back only backs out of it. */
function answers(action: Action): boolean {
  if (action.type === "CONCEDE") return false;
  return action.type !== "ANSWER" || (action.answer.kind !== "cancelCast" && action.answer.kind !== "takeBack");
}

/** The export tests' features this action shows. */
export function featuresOf(state: GameState, action: Action): string[] {
  if (action.type !== "ANSWER") return [];
  const answer = action.answer;
  if (answer.kind === "chooseCard") return [FEATURES.cardsChosen];
  if (answer.kind !== "chooseTarget" || answer.target.kind !== "object") return [];
  const target = answer.target.object;
  if (state.zones.stack.includes(target)) return [FEATURES.stackTarget];
  const inGraveyard = Object.values(state.zones.players).some((zones) => zones.graveyard.includes(target));
  return inGraveyard ? [FEATURES.graveyardTarget] : [];
}

/** A game that could join the golden games: its setup seed (also the agent's seed) and what it covers. */
export type Candidate = { seed: number; coverage: Coverage };

/** A game chosen for the cover: cut off at `maxTurns`, it adds `adds`, in `length` actions. */
export type Chosen = { seed: number; maxTurns: number; length: number; adds: string[] };

/**
 * Greedy set cover: again and again, the candidate adding the most uncovered units per action, each cut off at the turn
 * its last new unit appears (ties: the lower seed). Stops when no candidate adds anything. Not the smallest cover, but
 * close enough, and the same candidates always give the same choice.
 */
export function chooseCover(candidates: readonly Candidate[], alreadyCovered: readonly string[]): Chosen[] {
  const covered = new Set(alreadyCovered);
  const chosen: Chosen[] = [];
  for (;;) {
    let best: (Chosen & { score: number }) | null = null;
    for (const { seed, coverage } of candidates) {
      const adds = Object.keys(coverage.firstTurn)
        .filter((unit) => !covered.has(unit))
        .sort();
      if (adds.length === 0) continue;
      const maxTurns = Math.max(...adds.map((unit) => coverage.firstTurn[unit] as number));
      const length = coverage.lengthThrough[maxTurns] as number;
      const score = adds.length / Math.max(length, 1);
      if (best === null || score > best.score || (score === best.score && seed < best.seed))
        best = { seed, maxTurns, length, adds, score };
    }
    if (best === null) return chosen;
    const { score: _, ...game } = best;
    chosen.push(game);
    for (const unit of game.adds) covered.add(unit);
  }
}

/** Everything the golden games in `dir` cover between them. */
export function coveredByGoldens(dir: string, cards: CardDatabase): string[] {
  const units = goldenFiles(dir).flatMap((file) => {
    const game = readGolden(file, cards);
    return Object.keys(coverageOf(game.setup, game.actions, cards).firstTurn);
  });
  return [...new Set(units)].sort();
}

/** A candidate: the fuzzer's decks for this seed, played by `by-kind` agents to the end or the fuzzer's turn cap. */
export function playCandidate(seed: number, cards: CardDatabase): Candidate {
  const setup = deckGameSetup(fuzzDecks(seed), seed, null);
  const created = createGame(setup, cards);
  if (!created.ok) throw new Error(`seed ${seed}: the setup is rejected: ${created.error.message}`);
  const limits = { maxActions: 100_000, maxTurns: TURN_CAP };
  const played = playAgents(created.state, () => true, "by-kind", seed, limits, cards);
  return { seed, coverage: coverageOf(setup, played.actions, cards) };
}

/** The golden game for this seed's decks, cut off at `maxTurns`; its name says the decks and the seed. */
function goldenFor(seed: number, maxTurns: number, adds: readonly string[]): NewGolden {
  const decks = fuzzDecks(seed);
  const random = decks.some((deck) => deck.name.startsWith("random-"));
  return {
    decks,
    seed,
    agent: "by-kind",
    agentSeed: seed,
    maxTurns,
    name: random ? `pool-${seed}` : `${decks.map((d) => d.name).join("-vs-")}-${seed}`,
    description:
      `${random ? "Random pool decks" : decks.map((d) => d.name).join(" against ")}, setup seed ${seed}, by-kind ` +
      `agents, to turn ${maxTurns}. Covered, when chosen: ${adds.join(", ")}.`,
  };
}

/**
 * Adds the cover's games to `dir`. Seeds whose game is already in `dir` aren't candidates: a pool or deck change can
 * make the same name a different game, which `pnpm golden:update` handles. Each game is checked, before it's written,
 * to cover what it was chosen for (the turn cut-off is where an off-by-one would hide). Returns one line per game, for
 * the commit message, and what's still not covered.
 */
export function addCover(
  dir: string,
  seeds: readonly number[],
  cards: CardDatabase,
): { added: string[]; missing: string[] } {
  const taken = new Set(goldenFiles(dir).map((file) => basename(file, ".json")));
  const free = seeds.filter((seed) => !taken.has(goldenFor(seed, 0, []).name));
  const candidates = free.map((seed) => playCandidate(seed, cards));
  const covered = coveredByGoldens(dir, cards);
  const added: string[] = [];
  for (const game of chooseCover(candidates, covered)) {
    const golden = goldenFor(game.seed, game.maxTurns, game.adds);
    const setup = deckGameSetup(golden.decks, golden.seed, null);
    const actions = playRecipe({ ...golden, setup }, cards);
    const covers = coverageOf(setup, actions, cards).firstTurn;
    const lost = game.adds.filter((unit) => covers[unit] === undefined);
    if (lost.length > 0) throw new Error(`${golden.name} doesn't cover ${lost.join(", ")} (a turn cut-off bug)`);
    const path = addGolden(golden, dir, cards);
    added.push(`${path}: ${actions.length} actions, adds ${game.adds.join(", ")}`);
    covered.push(...game.adds);
  }
  const wanted = [...wantedMechanics(cards), ...Object.values(FEATURES)];
  return { added, missing: wanted.filter((unit) => !covered.includes(unit)) };
}

/** `pnpm golden:cover [--from 1] [--to 800]`: the candidates' setup seeds. */
if (import.meta.main) {
  try {
    const text = { type: "string" } as const;
    const { values } = parseArgs({ options: { from: text, to: text }, strict: true });
    const from = wholeNumber(values.from, 1, "from");
    const to = wholeNumber(values.to, 800, "to");
    const seeds = Array.from({ length: Math.max(to - from + 1, 0) }, (_, i) => from + i);
    const { added, missing } = addCover(GOLDEN_DIR, seeds, cardDatabase());
    console.log(added.length === 0 ? "these seeds add nothing the golden games don't already cover" : added.join("\n"));
    if (missing.length > 0) {
      // The golden test fails until these are covered: try more seeds, or a prebuilt deck with the card.
      console.error(`still not covered: ${missing.join(", ")}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
