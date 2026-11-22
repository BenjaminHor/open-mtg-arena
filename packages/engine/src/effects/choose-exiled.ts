// "Choose up to N [filter] exiled cards" (Mirror of Fate): a choice made as the spell or ability resolves (CR 608.2d),
// kept as the cards `found` for the effects after it (CR 608.2c), as a search's are.

import type { CardDatabase, Effect } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { askToChoose, fittingCards, nothing } from "./choose-cards.ts";
import { remember } from "./library-effects.ts";

type Choose = Extract<Effect, { op: "choose" }>;

/**
 * The controller chooses up to `upTo` exiled cards fitting the filter, however they got there (Mirror of Fate's
 * ruling); every exiled card is face up (CR 406.3; exiled face down, later: CR 406.3a). Not asked with none to choose: exile is public (CR 406.3), so
 * skipping tells nothing. With `chosen`, the answer: the cards still in exile are `found`.
 */
export function chooseExiled(
  state: GameState,
  effect: Choose,
  context: EffectContext,
  chosen: readonly ObjectId[] | null,
  cards: CardDatabase,
): Progress {
  const exile = state.zones.exile;
  if (chosen !== null) return nothing(remember(state, { found: chosen.filter((id) => exile.includes(id)) }));
  const options = fittingCards(state, exile, effect.filter, context.controller, cards);
  const max = Math.min(effect.upTo, options.length);
  if (max <= 0) return nothing(remember(state, { found: [] }));
  const chooser = context.controller;
  return nothing(askToChoose(state, { chooser, purpose: effect.purpose, options, min: 0, max, effect, context }));
}
