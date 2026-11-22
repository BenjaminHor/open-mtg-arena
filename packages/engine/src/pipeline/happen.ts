// The event pipeline (docs/architecture.md, "Effects, events, replacements, triggers"; D-056): everything that happens
// is proposed, replaced, performed, then checked for triggers. M2-03 builds the path; replacement and prevention
// effects (M2-08) and triggered abilities (M2-07) plug into `replace` and `checkTriggers`.

import type { CardDatabase } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import type { Progress } from "../game/progress.ts";
import { keywordsOf, staticAbilitiesOf } from "../rules/abilities.ts";
import type { DecisionKind } from "../state/decisions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ReplacementChoice } from "../state/replacements.ts";
import { detectTriggers } from "../triggers/detect.ts";
import { isHiddenZone } from "../zones/move-card.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { replaceDamage } from "./damage-replacements.ts";
import { perform } from "./perform.ts";
import type { ProposedEvent, SingleEvent } from "./proposed.ts";
import { type Ask, applyReplacements, firstInApnapOrder, type Replaced } from "./replacements.ts";

/**
 * Carries out an event. All of the replacing comes first, against the state before the event, and then all of the
 * performing. An event on which a player must choose between replacement effects (CR 616.1), or make a replacement's
 * choice as a permanent enters (CR 614.12a), can't happen here: only `happenOrAsk` can wait for that choice.
 */
export function happen(state: GameState, proposed: ProposedEvent, cards: CardDatabase): Progress {
  const replaced = replace(state, proposed, cards, []);
  if (replaced.kind !== "replaced")
    throw new Error("a choice for replacement effects can only be asked where happenOrAsk is used");
  return checkTriggers(state, perform(state, replaced.event, cards), cards);
}

/**
 * Carries out an event, or, when the affected player must choose which replacement effect applies first (CR 616.1) or
 * a permanent entering must make its choice (a card name, CR 614.12a), performs nothing and asks: the answer queues a
 * `resumeEvent` work item with the choices so far, and the event is replaced again from the start, as nothing has
 * happened yet. Only callers that do nothing after the event may use it (a resolving effect, the combat damage step,
 * a permanent spell's resolving, Open the Vaults): whatever they'd do next must already be queued behind it.
 * `only-the-pipeline-performs.test.ts` lists them.
 */
export function happenOrAsk(
  state: GameState,
  proposed: ProposedEvent,
  cards: CardDatabase,
  choices: readonly ReplacementChoice[] = [],
): Progress {
  const replaced = replace(state, proposed, cards, choices);
  const resume = { proposed, choices: [...choices] };
  switch (replaced.kind) {
    case "choose": {
      const decision = { kind: "chooseReplacement", for: replaced.for, options: replaced.options, resume } as const;
      return { state: waitFor(state, replaced.player, decision), events: [] };
    }
    case "chooseName": {
      const answering = { kind: "asEnters", for: replaced.for, ref: replaced.ref, resume } as const;
      const decision = { kind: "chooseName", what: replaced.what, answering } as const;
      return { state: waitFor(state, replaced.player, decision), events: [] };
    }
    case "chooseCopy": {
      // Asked as `chooseCards`, of the permanents to copy (CR 707.5) or none ("you may"), resumed like a name.
      if (replaced.for.kind !== "object") throw new Error("a copy is chosen for an object");
      // The card entering is shown with the choice only from a public zone: one put onto the battlefield from a library
      // (Sphinx Ambassador's search) keeps its id there, which records its history (D-062).
      const entering = replaced.for.object;
      const answering = { kind: "asEnters", for: replaced.for, ref: replaced.ref, event: resume } as const;
      const decision: DecisionKind = {
        kind: "chooseCards",
        purpose: "copy",
        for: isHiddenZone(zoneOf(state, entering)) ? null : entering,
        options: replaced.options,
        min: 0,
        max: 1,
        chosen: [],
        endsOnlyOnFinish: false,
        seen: null,
        resume: answering,
      };
      return { state: waitFor(state, replaced.player, decision), events: [] };
    }
    case "replaced":
      break;
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
  choices: readonly ReplacementChoice[],
): { kind: "replaced"; event: ProposedEvent } | Ask {
  const members = proposed.kind === "simultaneous" ? proposed.events : [proposed];
  const results = members.map((e) => replaceOne(state, e, cards, choices));
  const ask = firstInApnapOrder(
    state,
    results.flatMap((r) => (r.kind === "replaced" ? [] : [r])),
  );
  if (ask !== null) return ask;
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

/** Replacement and prevention effects modify the event (CR 614, 615). */
function replaceOne(
  state: GameState,
  proposed: SingleEvent,
  cards: CardDatabase,
  choices: readonly ReplacementChoice[],
): Replaced {
  const done = (events: SingleEvent[]): Replaced => ({ kind: "replaced", events });
  switch (proposed.kind) {
    case "dealDamage":
      // Prevention applies to each source's damage to each recipient (`damage-replacements.ts`).
      return replaceDamage(state, proposed.damage, cards, choices);
    case "gainLife":
      // Gaining 0 life isn't an event: nothing triggers on it (CR 119.9) and nothing replaces it (CR 119.10).
      return done(proposed.amount > 0 ? [proposed] : []);
    case "destroy":
      // An indestructible permanent can't be destroyed (CR 702.12b): the event can't happen, so no replacement or
      // prevention effect may replace it, and a regeneration shield isn't used up (CR 614.17c). Only a
      // self-replacement could (later: CR 614.15).
      if (keywordsOf(state, proposed.object, cards).includes("indestructible")) return done([]);
      return applyReplacements(state, proposed, cards, choices);
    case "counterObject":
      // "This spell can't be countered" works on the stack (CR 113.6g), and a counter effect does nothing to it
      // (CR 101.2; Great Sable Stag's ruling): the event can't happen, so nothing replaces it.
      if (staticAbilitiesOf(state, proposed.object, cards).some((a) => a.kind === "cantBeCountered")) return done([]);
      return applyReplacements(state, proposed, cards, choices);
    case "moveCard":
    case "sacrifice":
    case "tap":
    case "loseLife":
    case "reveal":
    case "reorderLibrary":
    case "untap":
    case "putCounters":
    case "removeCounters":
    case "createToken":
    case "copySpell":
    case "ceaseToExist":
    case "attach":
    case "unattach":
    case "addMana":
    case "draw":
    case "discard":
    case "shuffle":
    case "playLand":
    case "regenerate":
    case "damagePrevented":
      return applyReplacements(state, proposed, cards, choices);
  }
}

/**
 * Triggered abilities that the events trigger wait to be put on the stack the next time a player would receive
 * priority (CR 603.2, 603.3). `before` is the state before the events, for abilities that look back in time
 * (CR 603.10a).
 */
function checkTriggers(before: GameState, after: Progress, cards: CardDatabase): Progress {
  return { state: detectTriggers(before, after.state, after.events, cards), events: after.events };
}
