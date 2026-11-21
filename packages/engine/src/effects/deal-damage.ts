// Dealing damage (CR 120): performs the pipeline's `dealDamage` event (pipeline/, D-056). Prevention effects modify
// the event before it gets here (`pipeline/damage-replacements.ts`, CR 615); source abilities like lifelink, infect and
// wither (CR 120.3) change its results here.

import type { CardDatabase, Keyword } from "../cards/types.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { markDamage } from "../permanents/damage.ts";
import type { Damage } from "../pipeline/proposed.ts";
import { keywordsOf } from "../rules/abilities.ts";
import { controllerNowOrLastKnown } from "../rules/controller.ts";
import { canBeDealtDamage } from "../rules/damage-recipients.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { gainLife, loseLife } from "./life.ts";

/**
 * Deals damage as one damage event (CR 120.4): to one recipient, or to many at once, as combat damage (CR 510.2) and
 * a spell or ability dealing damage to several recipients in one action do (Earthquake, CR 608.2f). All of it is dealt first (CR 120.4b, when "whenever ... is dealt damage" triggers), then all of it turns
 * into its results (CR 120.4c): life loss for a player (CR 120.3a), damage marked on a creature (CR 120.3e), and life
 * gained from lifelink (CR 120.3f), all before state-based actions look. There are no planeswalkers or battles yet
 * (later: CR 120.3c, 120.3h).
 */
export function dealDamage(state: GameState, damage: readonly Damage[], cards: CardDatabase): Progress {
  // Damage of 0, and damage to a recipient that can't be dealt it, are already gone: the pipeline drops them before
  // prevention (CR 120.8, damage-replacements.ts). A recipient can still leave between that and this, when an earlier
  // event of the same batch is performed first, so it's checked again.
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
 * them (CR 702.2b, 704.5h). The source's abilities are read with `keywordsOf`, which works in any zone; no source deals
 * damage off the battlefield yet (later: CR 702.2d).
 */
function recordDeathtouch(state: GameState, before: GameState, dealt: readonly Damage[], cards: CardDatabase) {
  const touched = dealt.flatMap((d) =>
    d.to.kind === "object" && sourceKeywords(before, d.source, cards).includes("deathtouch") ? [d.to.object] : [],
  );
  const added = touched.filter((id, i) => touched.indexOf(id) === i && !state.dealtDeathtouchDamage.includes(id));
  return added.length === 0 ? state : { ...state, dealtDeathtouchDamage: [...state.dealtDeathtouchDamage, ...added] };
}

/**
 * The life each source with lifelink makes its controller gain: the total damage it dealt in this event (CR 120.3f,
 * 702.15b), one gain per source, since several sources with lifelink cause separate life gain events (CR 702.15e). The
 * source's abilities are read with `keywordsOf`, which works in any zone; no source deals damage off the battlefield yet
 * (later: CR 702.15d). A source that has left the battlefield is read as it last existed there (CR 702.15c): Siege-Gang
 * Commander sacrificed for its own ability, with Lifelink on it.
 */
function lifelinkGains(state: GameState, dealt: readonly Damage[], cards: CardDatabase) {
  const gains: { source: ObjectId; player: PlayerId; amount: number }[] = [];
  for (const d of dealt) {
    if (!hasLifelink(state, d.source, cards)) continue;
    const gain = gains.find((g) => g.source === d.source);
    if (gain !== undefined) gain.amount += d.amount;
    else {
      // The source's controller (CR 702.15b), as it last was if it's gone (CR 702.15c).
      const player = controllerNowOrLastKnown(state, d.source);
      if (player !== null) gains.push({ source: d.source, player, amount: d.amount });
    }
  }
  return gains;
}

/** Whether a damage source has lifelink: now, or as it last existed on the battlefield if it's gone (CR 702.15c). */
function hasLifelink(state: GameState, source: ObjectId, cards: CardDatabase): boolean {
  return sourceKeywords(state, source, cards).includes("lifelink");
}

/**
 * A damage source's keywords: now, or from its last known information if it has left the battlefield, for lifelink and
 * deathtouch alike (CR 702.15c, 702.2e). None if neither.
 */
function sourceKeywords(state: GameState, source: ObjectId, cards: CardDatabase): readonly Keyword[] {
  if (state.objects[source] !== undefined) return keywordsOf(state, source, cards);
  return state.lastKnownCharacteristics[source]?.keywords ?? [];
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
