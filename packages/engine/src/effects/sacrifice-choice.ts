// "Each opponent sacrifices a land of their choice" (Yawning Fissure, M2-05c2): the sacrificing player chooses among
// the permanents they control that fit (CR 701.21a, 608.2d), then sacrifices it.

import type { CardDatabase, Effect } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
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
  const theirs = state.zones.battlefield.filter((id) => controllerOf(state, id) === player);
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

function sacrificeEach(state: GameState, ids: readonly ObjectId[], cards: CardDatabase): Progress {
  if (ids.length === 0) return nothing(state);
  return happen(
    state,
    { kind: "simultaneous", events: ids.map((object) => ({ kind: "sacrifice", object }) as const) },
    cards,
  );
}
