// Effects that change what an object is, in several layers at once (CR 613.6): Awakener Druid's "becomes a 4/5 green
// Treefolk creature", and Rise from the Grave's creature that "is a black Zombie" as it enters (CR 611.2e).

import type { CardDatabase, Effect } from "../cards/types.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import { zoneChangeOf } from "../pipeline/moved.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import { createContinuousEffect } from "./continuous-effect.ts";
import { objectsNamed } from "./subjects.ts";

type BecomesEffect = Extract<Effect, { op: "becomes" }>;
type PutTarget = Extract<Effect, { op: "putTargetOntoBattlefield" }>;

/**
 * "[It] becomes ...": one effect on the permanents named now (CR 611.2c). "For as long as this creature remains on the
 * battlefield" never starts if the source has already left, so no effect is made (CR 611.2b).
 */
export function becomes(
  state: GameState,
  effect: BecomesEffect,
  context: EffectContext,
  cards: CardDatabase,
): Progress {
  const nothing = { state, events: [] };
  if (effect.duration === "whileSourceOnBattlefield" && !state.zones.battlefield.includes(context.self)) return nothing;
  const affected = objectsNamed(state, effect.of, context, cards).filter((id) => state.zones.battlefield.includes(id));
  if (affected.length === 0) return nothing;
  const { addTypes, addSubtypes, colors, setPT } = effect;
  return createContinuousEffect(state, {
    source: context.self,
    controller: context.controller,
    duration: effect.duration,
    affected,
    change: { kind: "becomes", addTypes, addSubtypes, ...(colors && { colors }), ...(setPT && { setPT }) },
  });
}

/**
 * "Put target creature card from a graveyard onto the battlefield under your control": the card enters under the
 * controller's control (CR 110.2a), a new object (CR 400.7). What it "is" applies as it enters (CR 611.2e): the effect
 * is made with the move, on the new object, for the rest of the game (CR 611.2a), its timestamp after the object's
 * (CR 613.7n). A target that's gone or was replaced elsewhere gets nothing.
 */
export function putTargetOntoBattlefield(
  state: GameState,
  effect: PutTarget,
  context: EffectContext,
  cards: CardDatabase,
): Progress {
  const target = context.targets[effect.target]?.[0];
  if (target?.kind !== "object") return { state, events: [] };
  const moved = happen(
    state,
    { kind: "moveCard", object: target.object, to: { zone: "battlefield", controller: context.controller } },
    cards,
  );
  const change = zoneChangeOf(moved.events, target.object);
  const is = effect.is;
  if (is === undefined || change === null || change.to.zone !== "battlefield") return moved;
  return andThen(moved, (s) =>
    createContinuousEffect(s, {
      source: context.self,
      controller: context.controller,
      duration: "endOfGame",
      affected: [change.newId],
      change: { kind: "becomes", ...is },
    }),
  );
}
