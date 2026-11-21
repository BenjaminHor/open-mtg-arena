// Checking a scenario's `expect:` block against the game (docs/testing.md, "Expectations").

import {
  attachedHost,
  type CardDatabase,
  characteristics,
  controllerOf,
  type GameEvent,
  type GameState,
  KEYWORDS,
  type ObjectId,
  type PlayerId,
} from "@mtg/engine";
import { deepEqual, partialMatch } from "./compare.ts";
import { isRecord } from "./format.ts";
import { battlefieldOf, nameOf, type PermanentRef, parseRef, resolveRef, STEP_NAMES, scenarioStep } from "./names.ts";
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
  "colors",
  "types",
  "subtypes",
  "counters",
  "attachedTo",
  "chosenName",
  "abilities contains",
  "abilities lacks",
  "events contains",
  "events lacks",
  "winner",
];

/** Expectation keys the format defines that later tasks add, with the task. */
export const COMING_EXPECTATIONS: Record<string, string> = {};

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
      zoneName === "battlefield"
        ? battlefieldOf(state, p, cards)
        : (state.zones.players[p]?.[zoneName as "hand"] ?? []);
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
  const property = /^((?:hand:|graveyard:|stack:)?p\d+:.+?)\.(\w+(?: contains| lacks)?)$/.exec(key);
  if (property !== null) {
    const [, refText = "", prop = ""] = property;
    const coming = COMING_EXPECTATIONS[prop];
    if (coming !== undefined) return { error: `arrives in ${coming}` };
    // `hand:p1:Nightmare`, `graveyard:p1:Nightmare` and `stack:p1:Nightmare` (a spell p1 controls) name a card in that
    // zone, for what works there (CR 604.3).
    const zoned = /^(hand|graveyard|stack):(.+)$/.exec(refText);
    const ref = parseRef(zoned?.[2] ?? refText);
    if (ref === null || player(ref.player) === null)
      return { error: `"${refText}" isn't a reference like p2:Grizzly Bears or hand:p1:Nightmare` };
    const inZone = zoned?.[1] as "hand" | "graveyard" | "stack" | undefined;
    const id = inZone === undefined ? resolveRef(state, ref, cards) : cardInZone(state, inZone, ref, cards);
    const obj = id === null ? undefined : state.objects[id];
    if (obj?.kind !== "card")
      return {
        error: `${inZone === undefined ? `${ref.player} controls` : `${ref.player}'s ${inZone} has`} no ${ref.card}${ref.nth === 1 ? "" : ` #${ref.nth}`}`,
      };
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
      case "colors":
        return same(characteristics(state, obj.id, cards).colors);
      case "types": {
        const c = characteristics(state, obj.id, cards);
        return same([...c.supertypes, ...c.types]);
      }
      case "subtypes":
        return same(characteristics(state, obj.id, cards).subtypes);
      case "counters":
        // The kinds it has any of (CR 122.1); `{}` for none.
        return same(Object.fromEntries(Object.entries(obj.counters).filter(([, n]) => n > 0)));
      case "attachedTo": {
        // What it's attached to, as a reference (`p2:Grizzly Bears`), or null for nothing (CR 303.4b, 301.5a).
        const host = attachedHost(state, obj.id);
        const shown = host === null ? null : `${controllerOf(state, host, cards)}:${nameOf(state, host, cards)}`;
        if (expected === null) return { value: shown, matches: host === null };
        const hostRef = typeof expected === "string" ? parseRef(expected) : null;
        if (hostRef === null) return { error: "attachedTo takes a reference like p2:Grizzly Bears, or null" };
        return { value: shown, matches: host !== null && host === resolveRef(state, hostRef, cards) };
      }
      case "chosenName":
        // The card name it chose as it entered (Pithing Needle, CR 614.12a), or null for none.
        return { value: obj.chosenName ?? null, matches: (obj.chosenName ?? null) === expected };
      case "abilities contains": {
        if (!Array.isArray(expected) || expected.length === 0) return { error: "contains takes a non-empty list" };
        const keywords = characteristics(state, obj.id, cards).keywords;
        return { value: keywords, matches: containsAll(keywords, expected, deepEqual) };
      }
      case "abilities lacks": {
        // "Loses flying" (CR 613.1f): none of these keyword abilities.
        if (!Array.isArray(expected) || expected.length === 0) return { error: "lacks takes a non-empty list" };
        // A misspelt keyword would always be lacked, so only known keywords are allowed.
        const unknown = expected.filter((k) => !(KEYWORDS as readonly unknown[]).includes(k));
        if (unknown.length > 0) return { error: `lacks: unknown keyword ${JSON.stringify(unknown[0])}` };
        const keywords: readonly unknown[] = characteristics(state, obj.id, cards).keywords;
        return { value: keywords, matches: expected.every((k) => !keywords.includes(k)) };
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
    case "winner":
      // A player, `draw` (CR 104.4a), or `(game not over)`.
      return same(state.result === null ? "(game not over)" : (state.result.winner ?? "draw"));
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
    case "events lacks": {
      if (!Array.isArray(expected) || expected.length === 0 || !expected.every(isRecord)) {
        return { error: "events lacks takes a non-empty list of events like { type: DAMAGE_DEALT }" };
      }
      const unwanted = expected.map((e) => withEngineStep(e));
      const matches = !events.some((e) =>
        unwanted.some((u) => partialMatch(e as unknown as Record<string, unknown>, u as Record<string, unknown>)),
      );
      return { value: events.map((e) => e.type), matches };
    }
    default: {
      const coming = COMING_EXPECTATIONS[key];
      return { error: coming === undefined ? "unknown expectation" : `arrives in ${coming}` };
    }
  }
}

/**
 * The card a reference names in a player's hand or graveyard, or a spell they control on the stack (`#2`: the second
 * with that name, in zone order, the stack's from the bottom).
 */
function cardInZone(
  state: GameState,
  zone: "hand" | "graveyard" | "stack",
  ref: PermanentRef,
  cards: CardDatabase,
): ObjectId | null {
  const ids =
    zone === "stack"
      ? state.zones.stack.filter((id) => controllerOf(state, id, cards) === ref.player)
      : (state.zones.players[ref.player]?.[zone] ?? []);
  return ids.filter((id) => nameOf(state, id, cards) === ref.card)[ref.nth - 1] ?? null;
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
