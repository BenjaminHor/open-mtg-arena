// "Attach this permanent to target creature you control" (equip, CR 702.6a): the `attachSelf` op.

import type { CardDatabase, EffectSubject } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { isProtectedFrom } from "../rules/protection.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import { objectsNamed } from "./subjects.ts";

/**
 * The ability's source moves onto the creature, if both are still on the battlefield (CR 400.7). An Equipment can't be
 * attached to a creature with protection from it, and then doesn't move (CR 702.16d, 701.3b); already attached there,
 * the attach does nothing (CR 701.3b). The target's legality, a creature its controller controls, was checked as the
 * ability began to resolve (CR 608.2b, 301.5b).
 */
export function attachSelf(state: GameState, to: EffectSubject, context: EffectContext, cards: CardDatabase): Progress {
  const [host] = objectsNamed(state, to, context, cards);
  const self = context.self;
  if (host === undefined || !state.zones.battlefield.includes(self) || !state.zones.battlefield.includes(host))
    return { state, events: [] };
  if (!cardTypesOf(state, host, cards).includes("creature") || isProtectedFrom(state, host, self, cards))
    return { state, events: [] };
  return happen(state, { kind: "attach", object: self, to: host }, cards);
}
