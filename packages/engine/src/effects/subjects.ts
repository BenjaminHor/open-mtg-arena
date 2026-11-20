// What an effect's words refer to as it resolves: its subjects ("target creature", "you", "each player", "each creature
// without flying", "the cards found") and its amounts (a number, X, a count). Read once, as the effect applies
// (CR 608.2h).

import type { Amount, CardDatabase, EffectSubject, ObjectFilter } from "../cards/types.ts";
import { apnapOrder } from "../game/turn-order.ts";
import { amountOf } from "../rules/amount.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";

/** The players and objects a subject refers to. A target group holds only the targets still legal (CR 608.2b). */
export function subject(state: GameState, s: EffectSubject, context: EffectContext, cards: CardDatabase): Target[] {
  if (s === "self") return [{ kind: "object", object: context.self }];
  if (s === "you") return [{ kind: "player", player: context.controller }];
  if (s === "eachPlayer") return apnapOrder(state).map((player) => ({ kind: "player", player }));
  // Every opponent of "you" (CR 102.2; teams later: CR 102.3), in APNAP order.
  if (s === "eachOpponent")
    return apnapOrder(state).flatMap((player) => (player === context.controller ? [] : [{ kind: "player", player }]));
  // What an earlier search of this resolution found (CR 608.2c).
  if (s === "found") return (state.resolution?.found ?? []).map((object) => ({ kind: "object", object }));
  // Every permanent fitting the filter now, as the effect applies (CR 608.2h).
  if ("each" in s)
    return permanentsFitting(state, s.each, context, cards).map((object) => ({ kind: "object", object }));
  return context.targets[s.target] ?? [];
}

/**
 * The one player an op that waits for a choice, or keeps a "this way" result, acts on; null if none is left.
 * `definition-problems.ts` refuses "each player" for these: several would choose in APNAP order (later: CR 608.2e).
 */
export function onePlayer(
  state: GameState,
  s: EffectSubject,
  context: EffectContext,
  cards: CardDatabase,
): PlayerId | null {
  const [player, ...more] = playersOf(subject(state, s, context, cards));
  if (more.length > 0) throw new Error("this effect acts on one player");
  return player ?? null;
}

export function playersOf(targets: readonly Target[]): PlayerId[] {
  return targets.flatMap((t) => (t.kind === "player" ? [t.player] : []));
}

export function objectsOf(targets: readonly Target[]): ObjectId[] {
  return targets.flatMap((t) => (t.kind === "object" ? [t.object] : []));
}

/** What an `Amount` is now: a number, X, or a count of permanents (CR 107.3a, 107.3c, 608.2h). */
export function amountNow(state: GameState, amount: Amount, context: EffectContext, cards: CardDatabase): number {
  if (typeof amount === "object") return permanentsFitting(state, amount.count, context, cards).length;
  return amountOf(amount, context.x);
}

/** The permanents fitting a filter right now, its `controller` relative to "you" (CR 109.5). */
export function permanentsFitting(
  state: GameState,
  filter: ObjectFilter,
  context: EffectContext,
  cards: CardDatabase,
): ObjectId[] {
  return state.zones.battlefield.filter((id) => matchesFilter(state, id, filter, context.controller, cards));
}

/** The objects a subject names (its players left out). */
export function objectsNamed(
  state: GameState,
  s: EffectSubject,
  context: EffectContext,
  cards: CardDatabase,
): ObjectId[] {
  return objectsOf(subject(state, s, context, cards));
}

/** The players a subject names (its objects left out). */
export function playersNamed(
  state: GameState,
  s: EffectSubject,
  context: EffectContext,
  cards: CardDatabase,
): PlayerId[] {
  return playersOf(subject(state, s, context, cards));
}
