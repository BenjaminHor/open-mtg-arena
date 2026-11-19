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
 * Deals damage, all of it in one event (CR 120.4): spells deal it to one recipient at a time, combat damage to many
 * at once (CR 510.2). Each damage is dealt (CR 120.4b), then turned into its result (CR 120.4c): life loss for a
 * player (CR 120.3a), damage marked on a creature (CR 120.3e). There are no planeswalkers or battles yet (CR 120.3c).
 */
export function dealDamage(state: GameState, damage: readonly Damage[], cards: CardDatabase): Progress {
  let progress: Progress = { state, events: [] };
  for (const d of damage) {
    // A source that would deal 0 damage deals no damage at all (CR 120.8).
    if (d.amount <= 0 || !canBeDealtDamage(progress.state, d.to, cards)) continue;
    const dealt: GameEvent = { type: "DAMAGE_DEALT", source: d.source, to: d.to, amount: d.amount };
    progress = andThen({ state: progress.state, events: [...progress.events, dealt] }, (s) => result(s, d));
  }
  return progress;
}

function result(state: GameState, d: Damage): Progress {
  switch (d.to.kind) {
    case "player":
      return loseLife(state, d.to.player, d.amount);
    case "object":
      return markDamage(state, d.to.object, d.amount);
  }
}

/**
 * Whether the recipient can be dealt damage: a player, or a creature on the battlefield (CR 120.1a; no planeswalkers or
 * battles yet). A recipient that left between the start of resolution and this effect is simply not dealt damage.
 */
function canBeDealtDamage(state: GameState, to: Target, cards: CardDatabase): boolean {
  switch (to.kind) {
    case "player":
      return state.players[to.player] !== undefined;
    case "object":
      return state.zones.battlefield.includes(to.object) && cardTypesOf(state, to.object, cards).includes("creature");
  }
}
