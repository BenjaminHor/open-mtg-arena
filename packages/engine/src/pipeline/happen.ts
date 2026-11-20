// The event pipeline (docs/architecture.md, "Effects, events, replacements, triggers"; D-056): everything that happens
// is proposed, replaced, performed, then checked for triggers. M2-03 builds the path; replacement and prevention
// effects (M2-08) and triggered abilities (M2-07) plug into `replace` and `checkTriggers`.

import type { CardDatabase } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import { perform } from "./perform.ts";
import type { ProposedEvent, SingleEvent } from "./proposed.ts";

/**
 * Carries out an event. All of the replacing comes first, against the state before the event, and then all of the
 * performing: a replacement that needs a player's choice (later: CR 616.1) can then stop before anything has changed.
 */
export function happen(state: GameState, proposed: ProposedEvent, cards: CardDatabase): Progress {
  return checkTriggers(state, perform(state, replace(state, proposed, cards), cards), cards);
}

/**
 * The members of a batch are each replaced against the same state, the one before the batch (later: CR 614.4). A
 * replacement may turn one event into several (regeneration, later: CR 701.19a) or none (a skip, later: CR 614.1b), so
 * the result is a batch, unless it's exactly one event.
 */
function replace(state: GameState, proposed: ProposedEvent, cards: CardDatabase): ProposedEvent {
  const members = proposed.kind === "simultaneous" ? proposed.events : [proposed];
  const replaced = members.flatMap((e) => replaceOne(state, e, cards));
  const [only] = replaced;
  return replaced.length === 1 && only !== undefined && proposed.kind !== "simultaneous"
    ? only
    : { kind: "simultaneous", events: replaced };
}

/** Replacement and prevention effects modify the event (later: CR 614–616). None exist yet. */
function replaceOne(_state: GameState, proposed: SingleEvent, _cards: CardDatabase): SingleEvent[] {
  switch (proposed.kind) {
    case "dealDamage":
      // A source that would deal 0 damage deals no damage at all, so there's nothing for a replacement or prevention
      // effect to modify, not even one that would increase it (CR 120.8).
      return [{ kind: "dealDamage", damage: proposed.damage.filter((d) => d.amount > 0) }];
    case "gainLife":
      // Gaining 0 life isn't an event: nothing triggers on it (CR 119.9) and nothing replaces it (CR 119.10).
      return proposed.amount > 0 ? [proposed] : [];
    case "moveCard":
    case "destroy":
    case "sacrifice":
    case "tap":
    case "counterObject":
    case "loseLife":
    case "reveal":
    case "untap":
    case "addMana":
    case "draw":
    case "discard":
    case "shuffle":
    case "playLand":
      return [proposed];
  }
}

/**
 * Triggered abilities that the events trigger wait to be put on the stack the next time a player would receive
 * priority (later: CR 603.2, 603.3). `before` is the state before the events, for abilities that look back in time
 * (later: CR 603.10). None exist yet.
 */
function checkTriggers(_before: GameState, after: Progress, _cards: CardDatabase): Progress {
  return after;
}
