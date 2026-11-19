// Turns a scenario's `setup:` into the engine's GameSetup (docs/testing.md, "Format").

import type { CardDatabase, GameSetup, ManaPool, PermanentSetup, PlayerId, PlayerSetup } from "@mtg/engine";
import { isRecord } from "./format.ts";
import { engineStep, oracleIdOf } from "./names.ts";

/**
 * Unlisted libraries get 20 basic lands so drawing doesn't lose the game: Forest for p1, Mountain for p2.
 * A fixed opening without a turn number is turn 3: turn 1 has special rules (the starting player skips their draw step,
 * CR 103.8a), so a scenario that wants them says `number: 1`.
 */
const DEFAULT_LIBRARY: Record<string, string> = { p1: "Forest", p2: "Mountain" };
const DEFAULT_TURN_NUMBER = 3;
const SETUP_KEYS = ["seed", "opening", "first", "turn", "p1", "p2", "rules"];
const PLAYER_KEYS = ["life", "library", "hand", "battlefield", "graveyard", "exile", "manaPool"];
const PERMANENT_KEYS = ["card", "tapped", "sick", "damage", "counters"];

export function buildSetup(setup: Record<string, unknown>, cards: CardDatabase): GameSetup {
  for (const key of Object.keys(setup)) if (!SETUP_KEYS.includes(key)) throw new Error(`Unknown setup key "${key}"`);
  if (setup.rules !== undefined) throw new Error("Rule modifiers in scenarios arrive with layer 7c effects in M1-11");
  const ids: PlayerId[] = ["p1", "p2"];
  const players = ids.map((id) => playerSetup(id, setup[id], cards, setup.opening === "standard"));
  const seed = setup.seed ?? 1;
  if (typeof seed !== "number") throw new Error("seed must be a number");
  if (setup.opening === "standard") {
    if (setup.turn !== undefined) throw new Error("A standard opening starts before turn 1, so it takes no turn");
    const first = setup.first ?? null;
    if (first !== null && !ids.includes(first as PlayerId)) throw new Error(`first must be p1 or p2, got ${first}`);
    return { seed, players, opening: { kind: "standard", firstPlayer: first as PlayerId | null }, ruleModifiers: [] };
  }
  if (setup.opening !== undefined && setup.opening !== "fixed") throw new Error(`opening is "standard" or "fixed"`);
  if (setup.first !== undefined) throw new Error("first is only for a standard opening");
  const turn = setup.turn;
  if (!isRecord(turn)) throw new Error("A fixed opening needs turn: { active, step, number }");
  const number = turn.number ?? DEFAULT_TURN_NUMBER;
  if (typeof number !== "number") throw new Error("turn number must be a number");
  return {
    seed,
    players,
    opening: {
      kind: "fixed",
      turn: { number, activePlayer: String(turn.active) as PlayerId, step: engineStep(String(turn.step)) },
    },
    ruleModifiers: [],
  };
}

function playerSetup(id: PlayerId, raw: unknown, cards: CardDatabase, standard: boolean): PlayerSetup {
  const p = raw ?? {};
  if (!isRecord(p)) throw new Error(`${id} must be a map`);
  for (const key of Object.keys(p)) if (!PLAYER_KEYS.includes(key)) throw new Error(`Unknown key "${key}" for ${id}`);
  const names = (key: string) => {
    const list = p[key] ?? [];
    if (!Array.isArray(list)) throw new Error(`${id}.${key} must be a list`);
    return list.map((n) => oracleIdOf(cards, String(n)));
  };
  const defaultLibrary = Array.from({ length: standard ? 40 : 20 }, () =>
    oracleIdOf(cards, DEFAULT_LIBRARY[id] ?? "Forest"),
  );
  const battlefield = p.battlefield ?? [];
  if (!Array.isArray(battlefield)) throw new Error(`${id}.battlefield must be a list`);
  return {
    id,
    life: typeof p.life === "number" ? p.life : 20,
    library: p.library === undefined ? defaultLibrary : names("library"),
    hand: names("hand"),
    battlefield: battlefield.map((entry) => permanent(entry, cards)),
    graveyard: names("graveyard"),
    exile: names("exile"),
    manaPool: manaPool(p.manaPool),
  };
}

function permanent(entry: unknown, cards: CardDatabase): PermanentSetup {
  if (typeof entry === "string") {
    return { oracleId: oracleIdOf(cards, entry), tapped: false, summoningSick: false, damage: 0, counters: {} };
  }
  if (!isRecord(entry)) throw new Error("A battlefield entry is a card name or a map");
  for (const key of Object.keys(entry))
    if (!PERMANENT_KEYS.includes(key)) throw new Error(`Unknown permanent key "${key}"`);
  return {
    oracleId: oracleIdOf(cards, String(entry.card)),
    tapped: entry.tapped === true,
    summoningSick: entry.sick === true,
    damage: typeof entry.damage === "number" ? entry.damage : 0,
    counters: isRecord(entry.counters) ? (entry.counters as Record<string, number>) : {},
  };
}

function manaPool(raw: unknown): ManaPool {
  const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  if (raw === undefined) return pool;
  if (!isRecord(raw)) throw new Error("manaPool is a map like { R: 1 }");
  for (const [type, amount] of Object.entries(raw)) {
    if (!(type in pool) || typeof amount !== "number") throw new Error(`Bad mana pool entry ${type}: ${amount}`);
    pool[type as keyof ManaPool] = amount;
  }
  return pool;
}
