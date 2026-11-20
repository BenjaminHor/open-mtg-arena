// "Destroy one of them at random" (Capricious Efreet): one permanent picked with the game's seeded RNG among the ones
// named that are still on the battlefield, as the effect resolves. No one can respond between the pick and the
// destruction (its ruling): both happen in this one step.

import type { CardDatabase, EffectSubject } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import { randomInt } from "../rng/xoshiro128.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import { objectsNamed } from "./subjects.ts";

/**
 * Destroys one of the permanents these subjects name, at random. Targets that became illegal aren't among them
 * (CR 608.2b): `objectsNamed` gives only the still-legal ones, so the pick is among the rest (its ruling).
 */
export function destroyOneAtRandom(
  state: GameState,
  among: readonly EffectSubject[],
  context: EffectContext,
  cards: CardDatabase,
): Progress {
  const named = among.flatMap((s) => objectsNamed(state, s, context, cards));
  const ids = named.filter((id, i) => named.indexOf(id) === i && state.zones.battlefield.includes(id));
  if (ids.length === 0) return { state, events: [] };
  const pick = randomInt(state.rng, ids.length);
  const object = ids[pick.value];
  if (object === undefined) throw new Error("a random pick outside the list");
  return happen({ ...state, rng: pick.rng }, { kind: "destroy", object }, cards);
}
