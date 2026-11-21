// Whether an Aura could legally enchant a permanent: what its enchant ability allows and protection don't stop
// (CR 303.4c, 702.5a, 702.16c). The state-based action for an Aura attached illegally (CR 704.5m) and an Aura entering the
// battlefield without being cast (CR 303.4f) both ask this, so the two can't disagree. Targeting isn't part of it: an
// Aura spell targets (CR 303.4a), but being attached doesn't, so shroud doesn't matter here.

import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { enchantFilterOf, isAura } from "./attachment.ts";
import { matchesFilter } from "./object-filter.ts";
import { isProtectedFrom } from "./protection.ts";

/**
 * Whether `aura` could enchant `host`, a permanent, with `you` the Aura's controller (or controller-to-be) for its
 * enchant filter ("enchant creature you control"). An Aura can't enchant itself (later: CR 303.4d; only an Aura that's
 * also a creature could try, and none in the pool is).
 */
export function canEnchant(
  state: GameState,
  aura: ObjectId,
  host: ObjectId,
  you: PlayerId,
  cards: CardDatabase,
): boolean {
  const enchant = enchantFilterOf(state, aura, cards);
  if (enchant === null || !isAura(state, aura, cards) || host === aura) return false;
  return matchesFilter(state, host, enchant, you, cards) && !isProtectedFrom(state, host, aura, cards);
}
