// Effects that change what an object is, in several layers at once (CR 613.6): Awakener Druid's "becomes a 4/5 green
// Treefolk creature". What a card "is" as it enters (Rise from the Grave, CR 611.2e) is made by the move itself
// (`put`'s `is`, `moveCard`).

import type { CardDatabase, Effect } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import { createContinuousEffect } from "./continuous-effect.ts";
import { objectsNamed } from "./subjects.ts";

type BecomesEffect = Extract<Effect, { op: "becomes" }>;

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
