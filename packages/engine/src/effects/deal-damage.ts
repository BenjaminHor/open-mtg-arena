// Dealing damage (CR 120). Every source of damage goes through `dealDamage`, so prevention and replacement effects
// (CR 614–615) and source abilities like lifelink, infect and wither (CR 120.3) have one place to plug in.

import type { CardDatabase } from "../cards/types.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { markDamage } from "../permanents/damage.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import { loseLife } from "./life.ts";

/** `source` deals `amount` damage to `to`. */
export type Damage = { source: ObjectId; to: Target; amount: number };

/**
 * Deals damage as one damage event (CR 120.4): spells deal it to one recipient, combat damage to many at once
 * (CR 510.2). All of it is dealt first (CR 120.4b, when "whenever ... is dealt damage" triggers), then all of it turns
 * into its results (CR 120.4c): life loss for a player (CR 120.3a), damage marked on a creature (CR 120.3e). There are
 * no planeswalkers or battles yet (CR 120.3c, 120.3h).
 */
export function dealDamage(state: GameState, damage: readonly Damage[], cards: CardDatabase): Progress {
  // A source that would deal 0 damage deals no damage at all (CR 120.8).
  const dealt = damage.filter((d) => d.amount > 0 && canBeDealtDamage(state, d.to, cards));
  const events: GameEvent[] = dealt.map((d) => ({
    type: "DAMAGE_DEALT",
    source: d.source,
    to: d.to,
    amount: d.amount,
  }));
  return dealt.reduce<Progress>((progress, d) => andThen(progress, (s) => damageResult(s, d)), { state, events });
}

/** What dealt damage does (CR 120.3, 120.4c). */
function damageResult(state: GameState, d: Damage): Progress {
  switch (d.to.kind) {
    case "player":
      return loseLife(state, d.to.player, d.amount);
    case "object":
      return markDamage(state, d.to.object, d.amount);
  }
}

/**
 * Whether the recipient can be dealt damage: a player, or a creature on the battlefield (CR 120.1a; no planeswalkers or
 * battles yet). A recipient that left between the start of resolution and this effect is a new object (CR 400.7), so
 * dealing it damage is impossible and is ignored (CR 101.3).
 */
function canBeDealtDamage(state: GameState, to: Target, cards: CardDatabase): boolean {
  switch (to.kind) {
    case "player":
      return state.players[to.player] !== undefined;
    case "object":
      return state.zones.battlefield.includes(to.object) && cardTypesOf(state, to.object, cards).includes("creature");
  }
}
