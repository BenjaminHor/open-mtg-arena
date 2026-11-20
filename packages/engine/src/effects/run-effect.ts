// The effects interpreter: what each effect op does (effects/README.md). Card definitions are data; this is the one
// place that turns them into changes to the game.

import type { CardDatabase, Effect } from "../cards/types.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import type { Damage, SingleEvent } from "../pipeline/proposed.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Destination } from "../zones/move-card.ts";
import { createContinuousEffect } from "./continuous-effect.ts";
import { discardChosen, putOntoBattlefieldFromHand, revealHand } from "./hand-effects.ts";
import { exileGraveyard, lookAtTop, mayShuffle, revealObjects, search, shuffleEach } from "./library-effects.ts";
import { discardAtRandom, drawEach, mill } from "./player-effects.ts";
import { sacrificeChosen } from "./sacrifice-choice.ts";
import { amountNow, objectsNamed, onePlayer, permanentsFitting, playersNamed, subject } from "./subjects.ts";

/**
 * Carries out one effect of a resolving spell or ability (CR 608.2c). An effect that needs cards chosen waits for
 * them and runs again with `chosen` (CR 608.2d, `choose-cards.ts`); for the others it's null.
 */
export function runEffect(
  state: GameState,
  effect: Effect,
  context: EffectContext,
  cards: CardDatabase,
  chosen: readonly ObjectId[] | null = null,
): Progress {
  switch (effect.op) {
    case "dealDamage": {
      // The damage's source is one object (CR 120.2b). If it was an illegal target, that part of the effect can't
      // happen (CR 608.2b: it "fails to determine any such information").
      const [from, ...more] = objectsNamed(state, effect.from, context, cards);
      if (more.length > 0) throw new Error("dealDamage's `from` must name exactly one object");
      if (from === undefined) return { state, events: [] };
      return happen(state, { kind: "dealDamage", damage: damageOf(state, effect, from, context, cards) }, cards);
    }
    case "addMana": {
      // "Add {G}": mana goes into the pool of the player the text calls "you" (CR 106.4, 109.5). "Any color" was replaced
      // by the color chosen as the mana ability resolved (`resolveManaAbility`, D-068).
      const { mana, amount } = effect;
      if (mana === "anyColor") throw new Error("mana of any color needs the color chosen as its ability resolves");
      return happen(state, { kind: "addMana", player: context.controller, mana, amount, source: context.self }, cards);
    }
    case "modifyPT": {
      // The affected objects are fixed now (CR 611.2c). An illegal target isn't among them (CR 608.2b), and neither is
      // one that left the battlefield since resolution began: affecting it is impossible (CR 101.3, 400.7).
      const affected = onBattlefield(state, objectsNamed(state, effect.of, context, cards));
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
    case "cantBlock": {
      // Fixed as it resolves, like any effect from a resolved spell (CR 611.2c).
      const affected = onBattlefield(state, objectsNamed(state, effect.of, context, cards));
      if (affected.length === 0) return { state, events: [] };
      return createContinuousEffect(state, {
        source: context.self,
        controller: context.controller,
        duration: effect.duration,
        affected,
        change: { kind: "cantBlock" },
      });
    }
    case "destroy":
      return toEach(state, onBattlefield(state, objectsNamed(state, effect.of, context, cards)), cards, (object) => ({
        kind: "destroy",
        object,
      }));
    case "destroyAll": {
      // Every permanent that fits, decided once now (CR 608.2h), destroyed at the same time (CR 608.2f). Cards going to
      // one graveyard together go in battlefield order (D-039; later: CR 404.3 lets their owner choose).
      // (The same as `destroy` of `{ each: filter }`; card definitions use this name for "destroy all".)
      const all = permanentsFitting(state, effect.filter, context, cards);
      return toEach(state, all, cards, (object) => ({ kind: "destroy", object }));
    }
    case "exile":
      return toEach(state, stillThere(state, objectsNamed(state, effect.of, context, cards)), cards, (object) => ({
        kind: "moveCard",
        object,
        to: { zone: "exile" },
      }));
    case "returnToHand":
      // Its owner's hand (CR 400.3): `moveCard` takes it there.
      return toEach(state, stillThere(state, objectsNamed(state, effect.of, context, cards)), cards, (object) => ({
        kind: "moveCard",
        object,
        to: { zone: "hand" },
      }));
    case "putOnTopOfLibrary":
      return toEach(state, stillThere(state, objectsNamed(state, effect.of, context, cards)), cards, (object) => ({
        kind: "moveCard",
        object,
        to: { zone: "library", position: "top" },
      }));
    case "tap":
      return toEach(state, onBattlefield(state, objectsNamed(state, effect.of, context, cards)), cards, (object) => ({
        kind: "tap",
        object,
      }));
    case "counter": {
      // "Can't be countered" will make this do nothing for that spell, without stopping the rest (later: CR 101.2).
      const onStack = objectsNamed(state, effect.of, context, cards).filter((id) => state.zones.stack.includes(id));
      return toEach(state, onStack, cards, (object) => ({ kind: "counterObject", object }));
    }
    case "loseLife": {
      // Losing 0 life is still an event (D-065, the owner's ruling; the CR settles only gaining 0, CR 119.9).
      const amount = amountNow(state, effect.amount, context, cards);
      return toEach(state, playersNamed(state, effect.who, context, cards), cards, (player) => ({
        kind: "loseLife",
        player,
        amount,
      }));
    }
    case "draw":
      return drawEach(
        state,
        playersNamed(state, effect.who, context, cards),
        amountNow(state, effect.amount, context, cards),
        cards,
      );
    case "discardAtRandom":
      return discardAtRandom(
        state,
        playersNamed(state, effect.who, context, cards),
        amountNow(state, effect.amount, context, cards),
        cards,
      );
    case "mill": {
      const amount =
        effect.amount === "halfTheirLibrary" ? effect.amount : amountNow(state, effect.amount, context, cards);
      return mill(state, playersNamed(state, effect.who, context, cards), amount, cards);
    }
    case "discard": {
      // One player's choice (`definition-problems.ts` refuses "each player"); several players discarding at once would
      // choose in APNAP order first (later: CR 608.2e).
      const [player, ...more] = playersNamed(state, effect.who, context, cards);
      if (more.length > 0) throw new Error("a chosen discard names one player");
      if (player === undefined) return { state, events: [] };
      return discardChosen(
        state,
        player,
        amountNow(state, effect.amount, context, cards),
        effect,
        context,
        chosen,
        cards,
      );
    }
    case "revealHand":
      return playersNamed(state, effect.who, context, cards).reduce<Progress>(
        (p, player) => andThen(p, (s) => revealHand(s, player, cards)),
        { state, events: [] },
      );
    case "putOntoBattlefield":
      return putOntoBattlefieldFromHand(state, effect, context, chosen, cards);
    case "search": {
      const owner = onePlayer(state, effect.library, context, cards);
      return owner === null ? { state, events: [] } : search(state, owner, effect, context, chosen, cards);
    }
    case "reveal":
      return revealObjects(state, stillThere(state, objectsNamed(state, effect.of, context, cards)), cards);
    case "put": {
      // "Put it into your hand" (its owner's, CR 400.3); "onto the battlefield", under the controller (CR 110.2a).
      const to = destinationOf(effect, context.controller);
      const ids = stillThere(state, objectsNamed(state, effect.of, context, cards));
      return toEach(state, ids, cards, (object) => ({ kind: "moveCard", object, to }));
    }
    case "shuffle":
      return shuffleEach(state, playersNamed(state, effect.who, context, cards), cards);
    case "mayShuffle": {
      const player = onePlayer(state, effect.who, context, cards);
      return player === null ? { state, events: [] } : mayShuffle(state, player, effect, context);
    }
    case "lookAtTop":
      return lookAtTop(state, context.controller, effect, context, chosen, cards);
    case "sacrifice": {
      const player = onePlayer(state, effect.who, context, cards);
      return player === null ? { state, events: [] } : sacrificeChosen(state, player, effect, context, chosen, cards);
    }
    case "exileGraveyard": {
      const player = onePlayer(state, effect.of, context, cards);
      if (player === null) return { state, events: [] };
      return exileGraveyard(state, player, effect.filter, context.controller, cards);
    }
    case "gainLife": {
      const amount = amountNow(state, effect.amount, context, cards);
      return toEach(state, playersNamed(state, effect.who, context, cards), cards, (player) => ({
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
  cards: CardDatabase,
): Damage[] {
  // "...and 3 damage to you": the other recipients of the same action, in the same damage event (CR 608.2f, 120.4).
  const more = (effect.and ?? []).flatMap(({ to, amount }) => {
    const each = amountNow(state, amount, context, cards);
    return subject(state, to, context, cards).map((t) => ({ source: from, to: t, amount: each, combat: false }));
  });
  return [...mainDamage(state, effect, from, context, cards), ...more];
}

/** The damage the effect's own `amount` and `to` describe, divided if the text says so. */
function mainDamage(
  state: GameState,
  effect: Extract<Effect, { op: "dealDamage" }>,
  from: ObjectId,
  context: EffectContext,
  cards: CardDatabase,
): Damage[] {
  const amount = amountNow(state, effect.amount, context, cards);
  const to = subject(state, effect.to, context, cards);
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

/** Where `put` moves a card: its owner's hand (CR 400.3), or the battlefield under the controller (CR 110.2a). */
function destinationOf(effect: Extract<Effect, { op: "put" }>, controller: PlayerId): Destination {
  if (effect.into === "hand") return { zone: "hand" };
  return effect.tapped === true
    ? { zone: "battlefield", controller, tapped: true }
    : { zone: "battlefield", controller };
}
