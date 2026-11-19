// Turns a scenario's `setup:` into the engine's GameSetup (docs/testing.md, "Format"). Every key and value is
// checked: an unknown key or a value of the wrong type fails instead of falling back to a default.

import type {
  CardDatabase,
  GameSetup,
  ManaPool,
  PermanentSetup,
  PlayerId,
  PlayerSetup,
  RuleModifier,
} from "@mtg/engine";
import { isRecord } from "./format.ts";
import { engineStep, oracleIdOf } from "./names.ts";

/**
 * Unlisted libraries get 20 basic lands so drawing doesn't lose the game (40 in a standard opening): Forest for p1,
 * Mountain for p2. A fixed opening without a turn number is turn 3: turn 1 has special rules (the starting player skips
 * their draw step, CR 103.8a), so a scenario that wants them says `number: 1`. Scenarios are two-player for now.
 */
const DEFAULT_LIBRARY: Record<string, string> = { p1: "Forest", p2: "Mountain" };
const DEFAULT_TURN_NUMBER = 3;
export const PLAYERS: readonly PlayerId[] = ["p1", "p2"];
export const SETUP_KEYS = ["seed", "opening", "first", "turn", "p1", "p2", "rules"];
export const TURN_KEYS = ["active", "step", "number"];
export const PLAYER_KEYS = ["life", "library", "hand", "battlefield", "graveyard", "exile", "manaPool"];
export const PERMANENT_KEYS = ["card", "tapped", "sick", "damage", "counters"];

export function buildSetup(setup: Record<string, unknown>, cards: CardDatabase): GameSetup {
  keysIn(setup, SETUP_KEYS, "setup");
  const ruleModifiers = ruleModifiersFrom(setup.rules);
  const standard = setup.opening === "standard";
  const players = PLAYERS.map((id) => playerSetup(id, setup[id], cards, standard));
  const seed = setup.seed === undefined ? 1 : integer(setup.seed, "seed");
  if (standard) {
    if (setup.turn !== undefined) throw new Error("A standard opening starts before turn 1, so it takes no turn");
    const first = setup.first ?? null;
    if (first !== null && !PLAYERS.includes(first as PlayerId))
      throw new Error(`first must be p1 or p2, got ${String(first)}`);
    return { seed, players, opening: { kind: "standard", firstPlayer: first as PlayerId | null }, ruleModifiers };
  }
  if (setup.opening !== undefined && setup.opening !== "fixed") throw new Error(`opening is "standard" or "fixed"`);
  if (setup.first !== undefined) throw new Error("first is only for a standard opening");
  const turn = setup.turn;
  if (!isRecord(turn)) throw new Error("A fixed opening needs turn: { active, step, number }");
  keysIn(turn, TURN_KEYS, "turn");
  const active = turn.active;
  if (!PLAYERS.includes(active as PlayerId)) throw new Error(`turn active must be p1 or p2, got ${String(active)}`);
  const number = turn.number === undefined ? DEFAULT_TURN_NUMBER : integer(turn.number, "turn number");
  return {
    seed,
    players,
    opening: { kind: "fixed", turn: { number, activePlayer: active as PlayerId, step: engineStep(String(turn.step)) } },
    ruleModifiers,
  };
}

/** `rules:` in a setup: rule modifiers, written like the engine's `RuleModifier` (one kind so far). */
function ruleModifiersFrom(raw: unknown): RuleModifier[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw))
    throw new Error("rules is a list like [{ kind: creaturesGetPT, controller: p2, power: 1, toughness: 1 }]");
  return raw.map((r) => {
    if (!isRecord(r) || r.kind !== "creaturesGetPT") throw new Error(`unknown rule modifier ${JSON.stringify(r)}`);
    keysIn(r, ["kind", "controller", "power", "toughness"], "rule modifier");
    if (!PLAYERS.includes(r.controller as PlayerId)) throw new Error(`rule modifier controller must be p1 or p2`);
    return {
      kind: "creaturesGetPT",
      controller: r.controller as PlayerId,
      power: integer(r.power, "rule modifier power"),
      toughness: integer(r.toughness, "rule modifier toughness"),
    };
  });
}

function playerSetup(id: PlayerId, raw: unknown, cards: CardDatabase, standard: boolean): PlayerSetup {
  const p = raw ?? {};
  if (!isRecord(p)) throw new Error(`${id} must be a map`);
  keysIn(p, PLAYER_KEYS, id);
  const names = (key: string) => {
    const list = p[key] ?? [];
    if (!Array.isArray(list)) throw new Error(`${id}.${key} must be a list`);
    return list.map((n) => oracleIdOf(cards, String(n)));
  };
  const basic = DEFAULT_LIBRARY[id] ?? "Forest";
  const battlefield = p.battlefield ?? [];
  if (!Array.isArray(battlefield)) throw new Error(`${id}.battlefield must be a list`);
  return {
    id,
    life: p.life === undefined ? 20 : integer(p.life, `${id}.life`),
    library:
      p.library === undefined
        ? Array.from({ length: standard ? 40 : 20 }, () => oracleIdOf(cards, basic))
        : names("library"),
    hand: names("hand"),
    battlefield: battlefield.map((entry) => permanent(entry, cards, id)),
    graveyard: names("graveyard"),
    exile: names("exile"),
    manaPool: manaPool(p.manaPool, id),
  };
}

function permanent(entry: unknown, cards: CardDatabase, id: PlayerId): PermanentSetup {
  if (typeof entry === "string") {
    return { oracleId: oracleIdOf(cards, entry), tapped: false, summoningSick: false, damage: 0, counters: {} };
  }
  if (!isRecord(entry)) throw new Error(`${id}: a battlefield entry is a card name or a map`);
  keysIn(entry, PERMANENT_KEYS, `${id} permanent`);
  const counters = entry.counters ?? {};
  if (!isRecord(counters)) throw new Error(`${id}: counters is a map like { +1/+1: 2 }`);
  return {
    oracleId: oracleIdOf(cards, String(entry.card)),
    tapped: boolean(entry.tapped, "tapped"),
    summoningSick: boolean(entry.sick, "sick"),
    damage: entry.damage === undefined ? 0 : integer(entry.damage, "damage"),
    counters: Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, count(v, `counters ${k}`)])),
  };
}

function manaPool(raw: unknown, id: PlayerId): ManaPool {
  const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  if (raw === undefined) return pool;
  if (!isRecord(raw)) throw new Error(`${id}.manaPool is a map like { R: 1 }`);
  for (const [type, amount] of Object.entries(raw)) {
    if (!(type in pool)) throw new Error(`${id}.manaPool: unknown mana type ${type}`);
    pool[type as keyof ManaPool] = integer(amount, `${id}.manaPool ${type}`);
  }
  return pool;
}

function keysIn(map: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(map)) if (!allowed.includes(key)) throw new Error(`Unknown key "${key}" in ${where}`);
}

/** A number of counters: a whole number, not negative (CR 122.1). */
function count(value: unknown, what: string): number {
  const n = integer(value, what);
  if (n < 0) throw new Error(`${what} can't be negative`);
  return n;
}

function integer(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Error(`${what} must be a whole number, got ${String(value)}`);
  return value;
}

function boolean(value: unknown, what: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new Error(`${what} must be true or false, got ${String(value)}`);
  return value;
}
