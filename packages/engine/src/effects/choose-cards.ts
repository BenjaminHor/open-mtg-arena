// Choosing cards while a spell or ability resolves (CR 608.2d; D-062): the effect waits with a `chooseCards` decision,
// takes one card per answer, and runs again with the cards chosen once all are in. Nothing happens before that. The same
// decision answers a choice as a permanent enters (CR 614.12a, "enter as a copy of", D-127): the event waiting is
// replaced again with the choice kept.

import type { CardDatabase, Effect, ObjectFilter } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import type { Progress } from "../game/progress.ts";
import { queueWork, resumeAsEnters } from "../game/work.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { Answer } from "../state/actions.ts";
import type { ChoosePurpose, PendingDecision, Seen } from "../state/decisions.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { ZoneRef } from "../state/zones.ts";
import { inShownOrder, oracleIdOf, publicIdOf } from "../zones/shown-order.ts";

type ChooseCards = Extract<PendingDecision, { kind: "chooseCards" }>;

/**
 * What `askToChoose` needs: who chooses, why, among which cards, how many, and the effect to run with them; whether
 * only `finishChoosing` ends it ("any number"), and the whole zone the chooser sees, if any.
 */
export type CardChoice = {
  chooser: PlayerId;
  purpose: ChoosePurpose;
  options: readonly ObjectId[];
  min: number;
  max: number;
  effect: Effect;
  context: EffectContext;
  endsOnlyOnFinish?: boolean;
  seen?: Seen;
  /** The object the choice is for (an Aura choosing what it enchants). */
  for?: ObjectId;
};

/** Waits for `chooser` to choose between `min` and `max` of the options, shown in a fixed order (D-062). */
export function askToChoose(state: GameState, choice: CardChoice): GameState {
  return waitFor(state, choice.chooser, {
    kind: "chooseCards",
    purpose: choice.purpose,
    for: choice.for ?? null,
    options: inShownOrder(state, choice.options),
    min: choice.min,
    max: choice.max,
    chosen: [],
    endsOnlyOnFinish: choice.endsOnlyOnFinish ?? false,
    seen: choice.seen ?? null,
    resume: { kind: "effect", effect: choice.effect, context: choice.context },
  });
}

/** Why an answer to a `chooseCards` decision isn't legal, or null if it is. */
export function chooseCardsProblem(decision: ChooseCards, answer: Answer): string | null {
  switch (answer.kind) {
    case "chooseCard":
      if (!Number.isInteger(answer.option) || answer.option < 0 || answer.option >= decision.options.length)
        return `There's no option ${answer.option}`;
      if (decision.chosen.includes(answer.option)) return `Option ${answer.option} is already chosen`;
      return null;
    case "finishChoosing":
      return decision.chosen.length < decision.min ? `Choose at least ${decision.min}` : null;
    default:
      return `That doesn't answer a chooseCards decision`;
  }
}

/** What's shown of a zone to a player who can't see it: identities only, in a fixed order (D-062). */
export function seenOf(state: GameState, from: ZoneRef, ids: readonly ObjectId[]): Seen {
  return { from, cards: inShownOrder(state, ids).map((id) => oracleIdOf(state, id)) };
}

/**
 * Takes a legal answer: one more card, waiting for the next, or, once `max` are chosen (unless only finishing ends it,
 * "any number") or the player finishes, the
 * effect queued to run again with the chosen cards, ahead of the rest of the resolution (D-032), or the event waiting
 * resumed with the choice. `answered` has the decision cleared. No events for an effect, as what was chosen shows in
 * what it then does; `OBJECTS_CHOSEN` for a choice as a permanent enters, told to everyone.
 */
export function answerChooseCards(answered: GameState, decision: ChooseCards, answer: Answer): Progress {
  const chosen = answer.kind === "chooseCard" ? [...decision.chosen, answer.option] : decision.chosen;
  if (answer.kind === "chooseCard" && (chosen.length < decision.max || decision.endsOnlyOnFinish)) {
    const { id: _id, player, ...kind } = decision;
    return { state: waitFor(answered, player, { ...kind, chosen }), events: [] };
  }
  const picked = chosen.map((i) => decision.options[i] as ObjectId);
  const resume = decision.resume;
  switch (resume.kind) {
    case "effect":
      return {
        state: queueWork(answered, {
          kind: "runEffect",
          effect: resume.effect,
          context: resume.context,
          chosen: picked,
        }),
        events: [],
      };
    case "asEnters": {
      // Made before it enters (CR 614.12a) and told to everyone, as the permanent will show it (a copy, CR 707.5).
      const choice = { kind: "asEntersCopy", for: resume.for, ref: resume.ref, chosen: picked[0] ?? null } as const;
      const event: GameEvent = {
        type: "OBJECTS_CHOSEN",
        player: decision.player,
        object: decision.for === null ? null : publicIdOf(answered, decision.for),
        card: decision.for === null ? null : oracleIdOf(answered, decision.for),
        purpose: decision.purpose,
        chosen: picked,
      };
      return {
        state: resumeAsEnters(answered, resume, choice),
        events: [event],
      };
    }
  }
}

/** No change, no events: an effect that does nothing, or that waits for a decision. */
export const nothing = (state: GameState): Progress => ({ state, events: [] });

/** The cards among `ids` fitting `filter` (all of them without one), read from their characteristics (CR 109.3). */
export function fittingCards(
  state: GameState,
  ids: readonly ObjectId[],
  filter: ObjectFilter | undefined,
  you: PlayerId,
  cards: CardDatabase,
): ObjectId[] {
  return filter === undefined ? [...ids] : ids.filter((id) => matchesFilter(state, id, filter, you, cards));
}
