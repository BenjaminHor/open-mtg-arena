// Dealing damage (CR 120): performs the pipeline's `dealDamage` event (pipeline/, D-056). Prevention and replacement
// effects modify the event before it gets here (later: CR 614–615); source abilities like lifelink, infect and wither
// (CR 120.3) change its results here.

import type { CardDatabase } from "../cards/types.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { markDamage } from "../permanents/damage.ts";
import type { Damage } from "../pipeline/proposed.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { Target } from "../state/objects.ts";
import { loseLife } from "./life.ts";

/**
 * Deals damage as one damage event (CR 120.4): to one recipient, or to many at once, as combat damage (CR 510.2) and
 * a spell or ability dealing damage to several recipients in one action do (Earthquake, CR 608.2f). All of it is dealt first (CR 120.4b, when "whenever ... is dealt damage" triggers), then all of it turns
 * into its results (CR 120.4c): life loss for a player (CR 120.3a), damage marked on a creature (CR 120.3e). There are
 * no planeswalkers or battles yet (later: CR 120.3c, 120.3h).
 */
export function dealDamage(state: GameState, damage: readonly Damage[], cards: CardDatabase): Progress {
  // Damage of 0 is already gone: the pipeline drops it before replacement (CR 120.8, happen.ts).
  const dealt = damage.filter((d) => canBeDealtDamage(state, d.to, cards));
  const events: GameEvent[] = dealt.map((d) => ({
    type: "DAMAGE_DEALT",
    source: d.source,
    to: d.to,
    amount: d.amount,
    combat: d.combat,
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
