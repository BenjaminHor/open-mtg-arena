// What an effect's words refer to as it resolves: its subjects ("target creature", "you", "each player", "each creature
// without flying", "the cards found") and its amounts (a number, X, a count). Read once, as the effect applies
// (CR 608.2h).

import type { Amount, CardDatabase, EffectSubject, ObjectFilter } from "../cards/types.ts";
import { apnapOrder } from "../game/turn-order.ts";
import { amountOf } from "../rules/amount.ts";
import { attachedHost, attachedHostIn } from "../rules/attachment.ts";
import { controllerNowOrLastKnown } from "../rules/controller.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";

/** The objects the resolving delayed triggered ability remembers (CR 603.7c); none for any other spell or ability. */
function rememberedObjects(state: GameState): readonly ObjectId[] {
  const resolving = state.resolution === null ? undefined : state.objects[state.resolution.object];
  if (resolving?.kind !== "ability" || resolving.ability.kind !== "delayed") return [];
  return resolving.ability.objects ?? [];
}

/** The players and objects a subject refers to. A target group holds only the targets still legal (CR 608.2b). */
export function subject(state: GameState, s: EffectSubject, context: EffectContext, cards: CardDatabase): Target[] {
  if (s === "self") return [{ kind: "object", object: context.self }];
  if (s === "you") return [{ kind: "player", player: context.controller }];
  if (s === "triggeringPlayer") {
    const player = context.trigger?.player ?? null;
    return player === null ? [] : [{ kind: "player", player }];
  }
  if (s === "triggeringObject") {
    const object = context.trigger?.object ?? null;
    return object === null ? [] : [{ kind: "object", object }];
  }
  if (s === "eachPlayer") return apnapOrder(state).map((player) => ({ kind: "player", player }));
  // Every opponent of "you" (CR 102.2; teams later: CR 102.3), in APNAP order.
  if (s === "eachOpponent")
    return apnapOrder(state).flatMap((player) => (player === context.controller ? [] : [{ kind: "player", player }]));
  // "That creature" in a delayed ability: what the effect that made it named (CR 603.7c).
  if (s === "remembered") return rememberedObjects(state).map((object) => ({ kind: "object", object }));
  // What an earlier search of this resolution found (CR 608.2c).
  if (s === "found") return (state.resolution?.found ?? []).map((object) => ({ kind: "object", object }));
  // "Enchanted creature" in its Aura's ability: what the source is attached to now (CR 303.4m), or, if the source has
  // left the battlefield, what it was attached to as it last existed, if that's still there (CR 608.2h, 113.7a).
  if (s === "attached") {
    const host =
      attachedHost(state, context.self) ?? attachedHostIn(state.lastKnown, state.zones.battlefield, context.self);
    return host === null ? [] : [{ kind: "object", object: host }];
  }
  // Every permanent fitting the filter now, as the effect applies (CR 608.2h).
  if ("each" in s)
    return permanentsFitting(state, s.each, context, cards).map((object) => ({ kind: "object", object }));
  if ("controllerOf" in s) {
    const player = controllerOfTarget(state, context.targets[s.controllerOf.target] ?? [], cards);
    return player === null ? [] : [{ kind: "player", player }];
  }
  if ("eachControlledBy" in s) {
    // The target player, or the targeted permanent's controller; none if the target is no longer legal (CR 608.2b).
    const [target] = context.targets[s.eachControlledBy.target] ?? [];
    const player =
      target === undefined
        ? null
        : target.kind === "player"
          ? target.player
          : controllerOfTarget(state, [target], cards);
    if (player === null) return [];
    const theirs = permanentsFittingFor(state, { ...s.filter, controller: "you" }, player, cards);
    return theirs.map((object) => ({ kind: "object", object }));
  }
  return context.targets[s.target] ?? [];
}

/**
 * "Its controller": the controller of the targeted object now, or as it last was on the battlefield if it's gone
 * (CR 608.2h). The targets here are those still legal as the spell began to resolve (CR 608.2b).
 */
function controllerOfTarget(state: GameState, targets: readonly Target[], cards: CardDatabase): PlayerId | null {
  const [object] = objectsOf(targets);
  return object === undefined ? null : controllerNowOrLastKnown(state, object, cards);
}

/**
 * The one player an op that waits for a choice, or keeps a "this way" result, acts on; null if none is left.
 * `definition-problems.ts` refuses "each player" for these: several would choose in APNAP order (later: CR 608.2e).
 * "Each opponent" is one player only while games have two (`setup-validation.ts`); multiplayer needs APNAP choosing.
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
  if (amount === "sacrificedPower") {
    // Nothing sacrificed: a number that can't be determined is 0 (CR 107.2). Never below 0: a creature with negative
    // power makes no one lose life (CR 107.1b).
    const powers = (state.resolution?.sacrificed ?? []).map((s) => s.power ?? 0);
    return Math.max(
      0,
      powers.reduce((sum, p) => sum + p, 0),
    );
  }
  if (amount === "thatMuch") {
    const known = context.trigger?.amount ?? null;
    if (known === null) throw new Error('"that much" outside a triggered ability whose event has an amount');
    return known;
  }
  return amountOf(amount, context.x);
}

/** The permanents fitting a filter right now, its `controller` relative to "you" (CR 109.5). */
export function permanentsFitting(
  state: GameState,
  filter: ObjectFilter,
  context: EffectContext,
  cards: CardDatabase,
): ObjectId[] {
  return permanentsFittingFor(state, filter, context.controller, cards);
}

/**
 * The same, for a given "you": also what `manaAvailable` counts before a mana ability is activated, so the X offered
 * and the mana made are counted one way.
 */
export function permanentsFittingFor(
  state: GameState,
  filter: ObjectFilter,
  you: PlayerId,
  cards: CardDatabase,
): ObjectId[] {
  return state.zones.battlefield.filter((id) => matchesFilter(state, id, filter, you, cards));
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
