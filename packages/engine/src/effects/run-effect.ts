// The effects interpreter: what each effect op does (effects/README.md). Card definitions are data; this is the one
// place that turns them into changes to the game.

import type { CardDatabase, Effect, EffectSubject } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import type { Damage, SingleEvent } from "../pipeline/proposed.ts";
import { amountOf } from "../rules/amount.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import { createContinuousEffect } from "./continuous-effect.ts";
import { apnapOrder, discardAtRandom, drawEach, halfTheirLibrary, mill } from "./player-effects.ts";

/** Carries out one effect of a resolving spell or ability (CR 608.2c). */
export function runEffect(state: GameState, effect: Effect, context: EffectContext, cards: CardDatabase): Progress {
  switch (effect.op) {
    case "dealDamage": {
      // The damage's source is one object (CR 120.2b). If it was an illegal target, that part of the effect can't
      // happen (CR 608.2b: it "fails to determine any such information").
      const [from, ...more] = objectsOf(subject(state, effect.from, context));
      if (more.length > 0) throw new Error("dealDamage's `from` must name exactly one object");
      if (from === undefined) return { state, events: [] };
      return happen(state, { kind: "dealDamage", damage: damageOf(state, effect, from, context) }, cards);
    }
    case "addMana": {
      // "Add {G}": mana goes into the pool of the player the text calls "you" (CR 106.4, 109.5).
      const { mana, amount } = effect;
      return happen(state, { kind: "addMana", player: context.controller, mana, amount, source: context.self }, cards);
    }
    case "modifyPT": {
      // The affected objects are fixed now (CR 611.2c). An illegal target isn't among them (CR 608.2b), and neither is
      // one that left the battlefield since resolution began: affecting it is impossible (CR 101.3, 400.7).
      const affected = onBattlefield(state, objectsOf(subject(state, effect.of, context)));
      if (affected.length === 0) return { state, events: [] };
      const change = { kind: "modifyPT", power: effect.power, toughness: effect.toughness } as const;
      return createContinuousEffect(state, {
        source: context.self,
        controller: context.controller,
        duration: effect.duration,
        affected,
        change,
      });
    }
    case "destroy":
      return toEach(state, onBattlefield(state, objectsOf(subject(state, effect.of, context))), cards, (object) => ({
        kind: "destroy",
        object,
      }));
    case "destroyAll": {
      // Every permanent that fits, decided once now (CR 608.2h), destroyed at the same time (CR 608.2f). Cards going to
      // one graveyard together go in battlefield order (D-039; later: CR 404.3 lets their owner choose).
      const all = state.zones.battlefield.filter((id) =>
        matchesFilter(state, id, effect.filter, context.controller, cards),
      );
      return toEach(state, all, cards, (object) => ({ kind: "destroy", object }));
    }
    case "exile":
      return toEach(state, stillThere(state, objectsOf(subject(state, effect.of, context))), cards, (object) => ({
        kind: "moveCard",
        object,
        to: { zone: "exile" },
      }));
    case "returnToHand":
      // Its owner's hand (CR 400.3): `moveCard` takes it there.
      return toEach(state, stillThere(state, objectsOf(subject(state, effect.of, context))), cards, (object) => ({
        kind: "moveCard",
        object,
        to: { zone: "hand" },
      }));
    case "putOnTopOfLibrary":
      return toEach(state, stillThere(state, objectsOf(subject(state, effect.of, context))), cards, (object) => ({
        kind: "moveCard",
        object,
        to: { zone: "library", position: "top" },
      }));
    case "tap":
      return toEach(state, onBattlefield(state, objectsOf(subject(state, effect.of, context))), cards, (object) => ({
        kind: "tap",
        object,
      }));
    case "counter": {
      // "Can't be countered" will make this do nothing for that spell, without stopping the rest (later: CR 101.2).
      const onStack = objectsOf(subject(state, effect.of, context)).filter((id) => state.zones.stack.includes(id));
      return toEach(state, onStack, cards, (object) => ({ kind: "counterObject", object }));
    }
    case "loseLife": {
      // Losing 0 life does nothing, so it isn't proposed.
      const amount = amountOf(effect.amount, context.x);
      if (amount <= 0) return { state, events: [] };
      return toEach(state, playersOf(subject(state, effect.who, context)), cards, (player) => ({
        kind: "loseLife",
        player,
        amount,
      }));
    }
    case "draw":
      return drawEach(state, playersOf(subject(state, effect.who, context)), amountOf(effect.amount, context.x), cards);
    case "discardAtRandom":
      return discardAtRandom(
        state,
        playersOf(subject(state, effect.who, context)),
        amountOf(effect.amount, context.x),
        cards,
      );
    case "mill": {
      const players = playersOf(subject(state, effect.who, context));
      const amount = effect.amount;
      return mill(
        state,
        players,
        (p) => (amount === "halfTheirLibrary" ? halfTheirLibrary(state, p) : amountOf(amount, context.x)),
        cards,
      );
    }
    case "gainLife": {
      const amount = amountOf(effect.amount, context.x);
      return toEach(state, playersOf(subject(state, effect.who, context)), cards, (player) => ({
        kind: "gainLife",
        player,
        amount,
      }));
    }
  }
}

/**
 * The same event for each object or player, at the same time (CR 608.2f). Objects that left their zone since the
 * targets were checked are already gone from the list: acting on them is impossible (CR 101.3, 400.7).
 */
function toEach<T>(
  state: GameState,
  items: readonly T[],
  cards: CardDatabase,
  event: (item: T) => SingleEvent,
): Progress {
  if (items.length === 0) return { state, events: [] };
  return happen(state, { kind: "simultaneous", events: items.map(event) }, cards);
}

/**
 * The objects still in the zone they were in under these ids: one that changed zones is a new object with a new id
 * (CR 400.7), so its old id is gone. For the moves, whose subject may be a permanent now and a spell or a card in a
 * graveyard later (M2-05b).
 */
function stillThere(state: GameState, ids: readonly ObjectId[]): ObjectId[] {
  return ids.filter((id) => state.objects[id] !== undefined);
}

/** The objects still on the battlefield: what destroying, tapping and changing power can act on. */
function onBattlefield(state: GameState, ids: readonly ObjectId[]): ObjectId[] {
  return ids.filter((id) => state.zones.battlefield.includes(id));
}

/** Who a damage effect deals how much to, as it resolves. */
function damageOf(
  state: GameState,
  effect: Extract<Effect, { op: "dealDamage" }>,
  from: ObjectId,
  context: EffectContext,
): Damage[] {
  const amount = amountOf(effect.amount, context.x);
  const to = subject(state, effect.to, context);
  if (effect.divided === undefined) return to.map((t) => ({ source: from, to: t, amount, combat: false }));
  switch (effect.divided) {
    case "asYouChoose":
      // Each target still legal is dealt its announced share (CR 601.2d, 608.2b).
      return context.division.map((share) => ({ source: from, to: share.target, amount: share.amount, combat: false }));
    case "evenly": {
      // Divided evenly, rounded down as the text says (CR 107.1a), among the targets still legal as it resolves
      // (Fireball's rulings). With more targets than damage each share is 0, which isn't dealt at all (CR 120.8); with
      // no targets nothing is.
      const share = to.length === 0 ? 0 : Math.floor(amount / to.length);
      return to.map((t) => ({ source: from, to: t, amount: share, combat: false }));
    }
  }
}

/** The players and objects a subject refers to. A target group holds only the targets still legal (CR 608.2b). */
function subject(state: GameState, s: EffectSubject, context: EffectContext): Target[] {
  if (s === "self") return [{ kind: "object", object: context.self }];
  if (s === "you") return [{ kind: "player", player: context.controller }];
  if (s === "eachPlayer") return apnapOrder(state).map((player) => ({ kind: "player", player }));
  return context.targets[s.target] ?? [];
}

function playersOf(targets: readonly Target[]): PlayerId[] {
  return targets.flatMap((t) => (t.kind === "player" ? [t.player] : []));
}

function objectsOf(targets: readonly Target[]): ObjectId[] {
  return targets.flatMap((t) => (t.kind === "object" ? [t.object] : []));
}
