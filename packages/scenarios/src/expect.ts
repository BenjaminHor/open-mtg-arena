// Checking a scenario's `expect:` block against the game (docs/testing.md, "Expectations").

import type { CardDatabase, GameEvent, GameState, ObjectId, PlayerId } from "@mtg/engine";
import { isRecord } from "./format.ts";
import { nameOf, STEP_NAMES, scenarioStep } from "./names.ts";

/** Expectation keys the format defines that later tasks add, with the task. */
export const COMING_EXPECTATIONS: Record<string, string> = {
  power: "M1-11",
  toughness: "M1-11",
  counters: "M1-13",
  "abilities contains": "M1-11",
  winner: "M1-15",
};

export function expectationProblems(
  state: GameState,
  expectations: Record<string, unknown>,
  recentEvents: readonly GameEvent[],
  cards: CardDatabase,
): string[] {
  const problems: string[] = [];
  for (const [key, expected] of Object.entries(expectations)) {
    const actual = actualValue(state, key, recentEvents, cards, expected);
    if (actual.error !== undefined) problems.push(`${key}: ${actual.error}`);
    else if (!actual.matches) problems.push(`${key}: expected ${show(expected)}, got ${show(actual.value)}`);
  }
  return problems;
}

type Actual = { value?: unknown; matches?: boolean; error?: string };

function actualValue(
  state: GameState,
  key: string,
  events: readonly GameEvent[],
  cards: CardDatabase,
  expected: unknown,
): Actual {
  const same = (value: unknown): Actual => ({ value, matches: JSON.stringify(value) === JSON.stringify(expected) });
  const names = (ids: readonly ObjectId[]) => ids.map((id) => nameOf(state, id, cards));

  const zone = /^(p\d+)\.(library|hand|graveyard|battlefield)( contains| count)?$/.exec(key);
  if (zone !== null) {
    const [, player = "", zoneName = "", mode] = zone;
    const ids = zoneName === "battlefield" ? battlefieldOf(state, player as PlayerId) : zoneOf(state, player, zoneName);
    if (ids === null) return { error: `no player ${player}` };
    if (mode === " count") return same(ids.length);
    if (mode === " contains") {
      if (!Array.isArray(expected)) return { error: "contains takes a list" };
      const have = [...names(ids)];
      const missing = expected.filter((n) => {
        const at = have.indexOf(String(n));
        if (at < 0) return true;
        have.splice(at, 1);
        return false;
      });
      return { value: names(ids), matches: missing.length === 0 };
    }
    return same(names(ids));
  }
  const life = /^(p\d+)\.life$/.exec(key);
  if (life !== null) return same(state.players[life[1] as PlayerId]?.life);
  const mana = /^(p\d+)\.manaPool$/.exec(key);
  if (mana !== null) {
    const pool = state.players[mana[1] as PlayerId]?.manaPool ?? {};
    return same(Object.fromEntries(Object.entries(pool).filter(([, n]) => n !== 0)));
  }
  const permanent = /^(p\d+):(.+?)(?:#(\d+))?\.(\w+)$/.exec(key);
  if (permanent !== null) {
    const [, player = "", cardName = "", nth = "1", property = ""] = permanent;
    const coming = COMING_EXPECTATIONS[property];
    if (coming !== undefined) return { error: `arrives in ${coming}` };
    const id = battlefieldOf(state, player as PlayerId).filter((x) => nameOf(state, x, cards) === cardName)[
      Number(nth) - 1
    ];
    const obj = id === undefined ? undefined : state.objects[id];
    if (obj?.kind !== "card") return { error: `${player} controls no ${cardName}${nth === "1" ? "" : ` #${nth}`}` };
    switch (property) {
      case "tapped":
        return same(obj.tapped);
      case "damage":
        return same(obj.damage);
      case "sick":
        return same(!obj.controlledSinceTurnStart);
      default:
        return { error: `unknown property "${property}"` };
    }
  }
  switch (key) {
    case "stack":
      return same(names(state.zones.stack));
    case "exile":
      return same(names(state.zones.exile));
    case "step":
      if (typeof expected === "string" && !(expected in STEP_NAMES)) return { error: `unknown step "${expected}"` };
      return same(state.turn === null ? null : scenarioStep(state.turn.step));
    case "turn":
      return same(state.turn?.number ?? null);
    case "active":
      return same(state.turn?.activePlayer ?? null);
    case "pending": {
      if (expected === null) return same(state.pending);
      if (!isRecord(expected)) return { error: "pending takes a map like { player: p1, kind: priority }" };
      const pending = state.pending as Record<string, unknown> | null;
      const matches =
        pending !== null &&
        Object.entries(expected).every(([k, v]) => JSON.stringify(pending[k]) === JSON.stringify(v));
      return { value: pending, matches };
    }
    case "events contains": {
      if (!Array.isArray(expected)) return { error: "events contains takes a list" };
      const matches = expected.every((want) => isRecord(want) && events.some((e) => eventMatches(e, want)));
      return { value: events.map((e) => e.type), matches };
    }
    default: {
      const coming = COMING_EXPECTATIONS[key];
      return { error: coming === undefined ? "unknown expectation" : `arrives in ${coming}` };
    }
  }
}

/** Every key given in the expected event matches; step names may use the scenario's words. */
function eventMatches(event: GameEvent, want: Record<string, unknown>): boolean {
  const e = event as Record<string, unknown>;
  return Object.entries(want).every(([k, v]) => {
    const value = k === "step" && typeof v === "string" ? (STEP_NAMES[v] ?? v) : v;
    return JSON.stringify(e[k]) === JSON.stringify(value);
  });
}

function zoneOf(state: GameState, player: string, zone: string): ObjectId[] | null {
  const zones = state.zones.players[player as PlayerId] as Record<string, ObjectId[]> | undefined;
  return zones?.[zone] ?? null;
}

/**
 * The permanents a player controls, in battlefield order. Until `characteristics()` (M1-11) computes control, the
 * default controller is the controller; the runner switches to it then.
 */
function battlefieldOf(state: GameState, player: PlayerId): ObjectId[] {
  return state.zones.battlefield.filter((id) => state.objects[id]?.baseController === player);
}

function show(value: unknown): string {
  return JSON.stringify(value);
}
