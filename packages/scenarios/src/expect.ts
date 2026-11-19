// Checking a scenario's `expect:` block against the game (docs/testing.md, "Expectations").

import {
  type CardDatabase,
  characteristics,
  type GameEvent,
  type GameState,
  type ObjectId,
  type PlayerId,
} from "@mtg/engine";
import { deepEqual, partialMatch } from "./compare.ts";
import { isRecord } from "./format.ts";
import { battlefieldOf, nameOf, parseRef, resolveRef, STEP_NAMES, scenarioStep } from "./names.ts";
import { PLAYERS } from "./setup.ts";

/** Expectation keys the runner supports. `pX.` and `pX:<card>.` forms are listed with a placeholder. */
export const EXPECTATIONS = [
  "pX.life",
  "pX.manaPool",
  "pX.library",
  "pX.hand",
  "pX.graveyard",
  "pX.battlefield",
  "contains",
  "count",
  "stack",
  "exile",
  "step",
  "turn",
  "active",
  "pending",
  "tapped",
  "damage",
  "sick",
  "power",
  "toughness",
  "abilities contains",
  "events contains",
];

/** Expectation keys the format defines that later tasks add, with the task. */
export const COMING_EXPECTATIONS: Record<string, string> = {
  counters: "M1-13",
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
    const actual = check(state, key, expected, recentEvents, cards);
    if (actual.error !== undefined) problems.push(`${key}: ${actual.error}`);
    else if (!actual.matches)
      problems.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual.value)}`);
  }
  return problems;
}

type Result = { value?: unknown; matches?: boolean; error?: string };

function check(
  state: GameState,
  key: string,
  expected: unknown,
  events: readonly GameEvent[],
  cards: CardDatabase,
): Result {
  const same = (value: unknown): Result => ({ value, matches: deepEqual(value, expected) });
  const names = (ids: readonly ObjectId[]) => ids.map((id) => nameOf(state, id, cards));
  const player = (p: string): PlayerId | null => (PLAYERS.includes(p as PlayerId) ? (p as PlayerId) : null);

  const zone = /^(p\d+)\.(library|hand|graveyard|battlefield)( contains| count)?$/.exec(key);
  if (zone !== null) {
    const [, who = "", zoneName = "", mode] = zone;
    const p = player(who);
    if (p === null) return { error: `no player ${who}` };
    const ids =
      zoneName === "battlefield" ? battlefieldOf(state, p) : (state.zones.players[p]?.[zoneName as "hand"] ?? []);
    if (mode === " count") return same(ids.length);
    if (mode === " contains") {
      if (!Array.isArray(expected) || expected.length === 0) return { error: "contains takes a non-empty list" };
      return { value: names(ids), matches: containsAll(names(ids), expected, deepEqual) };
    }
    return same(names(ids));
  }
  const life = /^(p\d+)\.(life|manaPool)$/.exec(key);
  if (life !== null) {
    const p = player(life[1] ?? "");
    if (p === null) return { error: `no player ${life[1]}` };
    const ps = state.players[p];
    if (life[2] === "life") return same(ps?.life);
    return same(Object.fromEntries(Object.entries(ps?.manaPool ?? {}).filter(([, n]) => n !== 0)));
  }
  const property = /^(p\d+:.+?)\.(\w+(?: contains)?)$/.exec(key);
  if (property !== null) {
    const [, refText = "", prop = ""] = property;
    const coming = COMING_EXPECTATIONS[prop];
    if (coming !== undefined) return { error: `arrives in ${coming}` };
    const ref = parseRef(refText);
    if (ref === null || player(ref.player) === null)
      return { error: `"${refText}" isn't a reference like p2:Grizzly Bears` };
    const id = resolveRef(state, ref, cards);
    const obj = id === null ? undefined : state.objects[id];
    if (obj?.kind !== "card")
      return { error: `${ref.player} controls no ${ref.card}${ref.nth === 1 ? "" : ` #${ref.nth}`}` };
    switch (prop) {
      case "tapped":
        return same(obj.tapped);
      case "damage":
        return same(obj.damage);
      case "sick":
        return same(!obj.controlledSinceTurnStart);
      case "power":
        return same(characteristics(state, obj.id, cards).power);
      case "toughness":
        return same(characteristics(state, obj.id, cards).toughness);
      case "abilities contains": {
        if (!Array.isArray(expected) || expected.length === 0) return { error: "contains takes a non-empty list" };
        const keywords = characteristics(state, obj.id, cards).keywords;
        return { value: keywords, matches: containsAll(keywords, expected, deepEqual) };
      }
      default:
        return { error: `unknown property "${prop}"` };
    }
  }
  switch (key) {
    case "stack":
      return same(names(state.zones.stack));
    case "exile":
      return same(names(state.zones.exile));
    case "step":
      if (typeof expected !== "string" || !(expected in STEP_NAMES))
        return { error: `unknown step "${String(expected)}"` };
      return same(state.turn === null ? null : scenarioStep(state.turn.step));
    case "turn":
      return same(state.turn?.number ?? null);
    case "active":
      return same(state.turn?.activePlayer ?? null);
    case "pending": {
      if (expected === null) return same(state.pending);
      if (!isRecord(expected) || Object.keys(expected).length === 0) {
        return { error: "pending takes a map like { player: p1, kind: priority }, or null" };
      }
      const pending = state.pending as Record<string, unknown> | null;
      return { value: pending, matches: pending !== null && partialMatch(pending, expected) };
    }
    case "events contains": {
      if (!Array.isArray(expected) || expected.length === 0 || !expected.every(isRecord)) {
        return { error: "events contains takes a non-empty list of events like { type: CARD_DRAWN }" };
      }
      const wanted = expected.map((want) => withEngineStep(want));
      const matches = containsAll(events as unknown[], wanted, (e, w) =>
        partialMatch(e as Record<string, unknown>, w as Record<string, unknown>),
      );
      return { value: events.map((e) => e.type), matches };
    }
    default: {
      const coming = COMING_EXPECTATIONS[key];
      return { error: coming === undefined ? "unknown expectation" : `arrives in ${coming}` };
    }
  }
}

/** Each wanted item matches a different item of `have` (a match is used only once). */
function containsAll(
  have: readonly unknown[],
  wanted: readonly unknown[],
  matches: (h: unknown, w: unknown) => boolean,
): boolean {
  const left = [...have];
  return wanted.every((w) => {
    const at = left.findIndex((h) => matches(h, w));
    if (at < 0) return false;
    left.splice(at, 1);
    return true;
  });
}

/** Events carry the engine's step names; a scenario may use its own (`main1`). */
function withEngineStep(want: Record<string, unknown>): Record<string, unknown> {
  const step = want.step;
  return typeof step === "string" && step in STEP_NAMES ? { ...want, step: STEP_NAMES[step] } : want;
}
