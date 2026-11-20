// "Each opponent sacrifices a land of their choice" (Yawning Fissure, M2-05c2): the sacrificing player chooses among
// the permanents they control that fit (CR 701.21a, 608.2d), then sacrifices it.

import type { CardDatabase, Effect } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { queueWork } from "../game/work.ts";
import { happen } from "../pipeline/happen.ts";
import { characteristics } from "../rules/characteristics.ts";
import { controllerOf } from "../rules/controller.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { askToChoose, fittingCards, nothing } from "./choose-cards.ts";

type Sacrifice = Extract<Effect, { op: "sacrifice" }>;

/**
 * `player` sacrifices one permanent they control fitting the filter, read relative to them ("of their choice": a player
 * can sacrifice only what they control, CR 701.21a). They choose it (CR 608.2d); the battlefield is public, so with
 * only one to choose from nothing is asked. Several players would choose in APNAP order and then sacrifice at
 * once (later: CR 101.4).
 */
export function sacrificeChosen(
  state: GameState,
  player: PlayerId,
  effect: Sacrifice,
  context: EffectContext,
  chosen: readonly ObjectId[] | null,
  cards: CardDatabase,
): Progress {
  // "Other than this creature": the ability's source can't be chosen (Xathrid Demon).
  const theirs = state.zones.battlefield.filter(
    (id) => controllerOf(state, id) === player && !(effect.otherThanSelf === true && id === context.self),
  );
  if (chosen !== null)
    return sacrificeEach(
      state,
      chosen.filter((id) => theirs.includes(id)),
      cards,
    );
  const options = fittingCards(state, theirs, effect.filter, player, cards);
  // None or one fits: nothing to choose (the battlefield is public); none sacrifices nothing (CR 609.3).
  if (options.length <= 1) return sacrificeEach(state, options, cards);
  return nothing(
    askToChoose(state, { chooser: player, purpose: "sacrifice", options, min: 1, max: 1, effect, context }),
  );
}

/**
 * Sacrifices these at once, keeping each with its power as it is now, the last moment it's on the battlefield
 * (CR 608.2h), as sacrificed this way (CR 608.2c).
 */
function sacrificeEach(state: GameState, ids: readonly ObjectId[], cards: CardDatabase): Progress {
  if (ids.length === 0) return nothing(state);
  const records = ids.map((object) => ({ object, power: characteristics(state, object, cards).power }));
  const done = happen(
    state,
    { kind: "simultaneous", events: ids.map((object) => ({ kind: "sacrifice", object }) as const) },
    cards,
  );
  const resolution = done.state.resolution;
  if (resolution === null) return done;
  return {
    ...done,
    state: { ...done.state, resolution: { ...resolution, sacrificed: [...resolution.sacrificed, ...records] } },
  };
}

/**
 * "If you can't sacrifice [one], [effects]": queues the effects, ahead of the rest of the resolution, only if nothing
 * was sacrificed this way (CR 608.2c).
 */
export function ifNothingSacrificed(state: GameState, effects: readonly Effect[], context: EffectContext): Progress {
  if ((state.resolution?.sacrificed.length ?? 0) > 0) return nothing(state);
  const items = effects.map((effect) => ({ kind: "runEffect", effect, context, chosen: null }) as const);
  return nothing(queueWork(state, ...items));
}
