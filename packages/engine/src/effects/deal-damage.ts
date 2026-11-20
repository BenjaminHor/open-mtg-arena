// Dealing damage (CR 120): performs the pipeline's `dealDamage` event (pipeline/, D-056). Prevention and replacement
// effects modify the event before it gets here (later: CR 614–615); source abilities like lifelink, infect and wither
// (CR 120.3) change its results here.

import type { CardDatabase } from "../cards/types.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { markDamage } from "../permanents/damage.ts";
import type { Damage } from "../pipeline/proposed.ts";
import { keywordsOf } from "../rules/abilities.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { controllerOf } from "../rules/controller.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import { gainLife, loseLife } from "./life.ts";

/**
 * Deals damage as one damage event (CR 120.4): to one recipient, or to many at once, as combat damage (CR 510.2) and
 * a spell or ability dealing damage to several recipients in one action do (Earthquake, CR 608.2f). All of it is dealt first (CR 120.4b, when "whenever ... is dealt damage" triggers), then all of it turns
 * into its results (CR 120.4c): life loss for a player (CR 120.3a), damage marked on a creature (CR 120.3e), and life
 * gained from lifelink (CR 120.3f), all before state-based actions look. There are no planeswalkers or battles yet
 * (later: CR 120.3c, 120.3h).
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
  const results = dealt.reduce<Progress>((progress, d) => andThen(progress, (s) => damageResult(s, d)), {
    state,
    events,
  });
  const gained = lifelinkGains(state, dealt, cards).reduce<Progress>(
    (progress, gain) => andThen(progress, (s) => gainLife(s, gain.player, gain.amount)),
    results,
  );
  return andThen(gained, (s) => ({ state: recordDeathtouch(s, state, dealt, cards), events: [] }));
}

/**
 * Creatures dealt damage by a source with deathtouch are recorded for the next state-based action check, which destroys
 * them (CR 702.2b, 704.5h). The source is read as it deals the damage, from any zone (later: CR 702.2d, no source deals damage off the battlefield yet; a gone source's last
 * known information, later: CR 702.2e).
 */
function recordDeathtouch(state: GameState, before: GameState, dealt: readonly Damage[], cards: CardDatabase) {
  const touched = dealt.flatMap((d) =>
    d.to.kind === "object" && keywordsOf(before, d.source, cards).includes("deathtouch") ? [d.to.object] : [],
  );
  const added = touched.filter((id, i) => touched.indexOf(id) === i && !state.dealtDeathtouchDamage.includes(id));
  return added.length === 0 ? state : { ...state, dealtDeathtouchDamage: [...state.dealtDeathtouchDamage, ...added] };
}

/**
 * The life each source with lifelink makes its controller gain: the total damage it dealt in this event (CR 120.3f,
 * 702.15b), one gain per source, since several sources with lifelink cause separate life gain events (CR 702.15e). The
 * source's abilities are read as the damage is dealt, from any zone (later: CR 702.15d). A source that's gone would need its
 * last known information (later: CR 702.15c), and one with no controller its owner's.
 */
function lifelinkGains(state: GameState, dealt: readonly Damage[], cards: CardDatabase) {
  const gains: { source: ObjectId; player: PlayerId; amount: number }[] = [];
  for (const d of dealt) {
    if (state.objects[d.source] === undefined || !keywordsOf(state, d.source, cards).includes("lifelink")) continue;
    const gain = gains.find((g) => g.source === d.source);
    if (gain !== undefined) gain.amount += d.amount;
    else gains.push({ source: d.source, player: controllerOf(state, d.source), amount: d.amount });
  }
  return gains;
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
