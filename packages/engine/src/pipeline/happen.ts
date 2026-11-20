// The event pipeline (docs/architecture.md, "Effects, events, replacements, triggers"; D-056): everything that happens
// is proposed, replaced, performed, then checked for triggers. M2-03 builds the path; replacement and prevention
// effects (M2-08) and triggered abilities (M2-07) plug into `replace` and `checkTriggers`.

import type { CardDatabase } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import { perform } from "./perform.ts";
import type { ProposedEvent } from "./proposed.ts";

/**
 * Carries out an event and checks for triggered abilities once, after everything it caused: an event that leads to
 * others (destroying a permanent moves it) is one happening, and triggers see all of it together.
 */
export function happen(state: GameState, proposed: ProposedEvent, cards: CardDatabase): Progress {
  return checkTriggers(state, carryOut(state, proposed, cards), cards);
}

/**
 * Replaces, then performs. An event that leads to others proposes each of them back through here, so each gets its own
 * replacement pass: regeneration replaces a destruction, and something else may replace the zone change it causes.
 */
function carryOut(state: GameState, proposed: ProposedEvent, cards: CardDatabase): Progress {
  return perform(state, replace(state, proposed, cards), cards, (s, next) => carryOut(s, next, cards));
}

/** Replacement and prevention effects modify the event (later: CR 614–616). None exist yet. */
function replace(_state: GameState, proposed: ProposedEvent, _cards: CardDatabase): ProposedEvent {
  return proposed;
}

/**
 * Triggered abilities that the events trigger wait to be put on the stack the next time a player would receive
 * priority (later: CR 603.2, 603.3). `before` is the state before the events, for abilities that look back in time
 * (later: CR 603.10). None exist yet.
 */
function checkTriggers(_before: GameState, after: Progress, _cards: CardDatabase): Progress {
  return after;
}
