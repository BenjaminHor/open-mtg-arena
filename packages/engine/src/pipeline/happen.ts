// The event pipeline (docs/architecture.md, "Effects, events, replacements, triggers"; D-056): everything that happens
// is proposed, replaced, performed, then checked for triggers. M2-03 builds the path; replacement and prevention
// effects (M2-08) and triggered abilities (M2-07) plug into `replace` and `checkTriggers`.

import type { CardDatabase } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import type { Progress } from "../game/progress.ts";
import { apnapOrder } from "../game/turn-order.ts";
import { keywordsOf } from "../rules/abilities.ts";
import type { GameState } from "../state/game-state.ts";
import type { ReplacementRef } from "../state/replacements.ts";
import { detectTriggers } from "../triggers/detect.ts";
import { perform } from "./perform.ts";
import type { ProposedEvent, SingleEvent } from "./proposed.ts";
import { applyReplacements, type Replaced } from "./replacements.ts";

/**
 * Carries out an event. All of the replacing comes first, against the state before the event, and then all of the
 * performing. An event on which a player must choose between replacement effects (CR 616.1) can't happen here: only
 * `happenOrAsk` can wait for that choice.
 */
export function happen(state: GameState, proposed: ProposedEvent, cards: CardDatabase): Progress {
  const replaced = replace(state, proposed, cards, []);
  if (replaced.kind === "choose")
    throw new Error("a choice between replacement effects can only be asked where happenOrAsk is used");
  return checkTriggers(state, perform(state, replaced.event, cards), cards);
}

/**
 * Carries out an event, or, when the affected player must choose which replacement effect applies first (CR 616.1),
 * performs nothing and asks: the answer queues a `happen` work item with the choices so far, and the event is replaced
 * again from the start, as nothing has happened yet. Only callers that do nothing after the event may use it (a
 * resolving effect, the combat damage step): whatever they'd do next must already be queued behind it. `only-the-
 * pipeline-performs.test.ts` lists them.
 */
export function happenOrAsk(
  state: GameState,
  proposed: ProposedEvent,
  cards: CardDatabase,
  choices: readonly ReplacementRef[] = [],
): Progress {
  const replaced = replace(state, proposed, cards, choices);
  if (replaced.kind === "choose") {
    const resume = { proposed, choices: [...choices] };
    const asked = waitFor(state, replaced.player, { kind: "chooseReplacement", options: replaced.options, resume });
    return { state: asked, events: [] };
  }
  return checkTriggers(state, perform(state, replaced.event, cards), cards);
}

/**
 * The members of a batch are each replaced against the same state, the one before the batch: each watches for an event
 * about to happen (CR 614.1), and none of the batch has happened yet. A replacement may turn one event into several
 * (Darksteel Colossus's reveal, move and shuffle) or none (a destroy an indestructible permanent ignores, CR 702.12b), so
 * the result is a batch, unless it's exactly one event. If several players must choose, the first in APNAP order does
 * first (CR 616.1, 101.4).
 */
function replace(
  state: GameState,
  proposed: ProposedEvent,
  cards: CardDatabase,
  choices: readonly ReplacementRef[],
): { kind: "replaced"; event: ProposedEvent } | Extract<Replaced, { kind: "choose" }> {
  const members = proposed.kind === "simultaneous" ? proposed.events : [proposed];
  const results = members.map((e) => replaceOne(state, e, cards, choices));
  const asks = results.flatMap((r) => (r.kind === "choose" ? [r] : []));
  if (asks.length > 0) {
    const order = apnapOrder(state);
    const [firstAsk] = [...asks].sort((x, y) => order.indexOf(x.player) - order.indexOf(y.player));
    if (firstAsk !== undefined) return firstAsk;
  }
  const replaced = results.flatMap((r) => (r.kind === "replaced" ? r.events : []));
  const [only] = replaced;
  return {
    kind: "replaced",
    event:
      replaced.length === 1 && only !== undefined && proposed.kind !== "simultaneous"
        ? only
        : { kind: "simultaneous", events: replaced },
  };
}

/** Replacement and prevention effects modify the event (CR 614; prevention, later: CR 615). */
function replaceOne(
  state: GameState,
  proposed: SingleEvent,
  cards: CardDatabase,
  choices: readonly ReplacementRef[],
): Replaced {
  const done = (events: SingleEvent[]): Replaced => ({ kind: "replaced", events });
  switch (proposed.kind) {
    case "dealDamage":
      // A source that would deal 0 damage deals no damage at all, so there's nothing for a replacement or prevention
      // effect to modify, not even one that would increase it (CR 120.8).
      return done([{ kind: "dealDamage", damage: proposed.damage.filter((d) => d.amount > 0) }]);
    case "gainLife":
      // Gaining 0 life isn't an event: nothing triggers on it (CR 119.9) and nothing replaces it (CR 119.10).
      return done(proposed.amount > 0 ? [proposed] : []);
    case "destroy":
      // An indestructible permanent can't be destroyed (CR 702.12b): the event can't happen, so no replacement or
      // prevention effect may replace it, and a regeneration shield isn't used up (CR 614.17c). Only a
      // self-replacement could (later: CR 614.15).
      if (keywordsOf(state, proposed.object, cards).includes("indestructible")) return done([]);
      return applyReplacements(state, proposed, cards, choices);
    case "moveCard":
    case "sacrifice":
    case "tap":
    case "counterObject":
    case "loseLife":
    case "reveal":
    case "reorderLibrary":
    case "untap":
    case "addMana":
    case "draw":
    case "discard":
    case "shuffle":
    case "playLand":
    case "regenerate":
      return applyReplacements(state, proposed, cards, choices);
  }
}

/**
 * Triggered abilities that the events trigger wait to be put on the stack the next time a player would receive
 * priority (CR 603.2, 603.3). `before` is the state before the events, for abilities that look back in time
 * (later: CR 603.10).
 */
function checkTriggers(before: GameState, after: Progress, cards: CardDatabase): Progress {
  return { state: detectTriggers(before, after.state, after.events, cards), events: after.events };
}
