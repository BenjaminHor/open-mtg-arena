// advance: runs queued work until the game needs a decision or is over (docs/architecture.md, "Running the game").
// Every engine entry point ends here.

import type { CardDatabase } from "../cards/types.ts";
import { combatDamage } from "../combat/combat-damage.ts";
import { declareAttackers } from "../combat/declare-attackers.ts";
import { declareBlockers } from "../combat/declare-blockers.ts";
import { removeTypeChangesFromCombat } from "../combat/removed-from-combat.ts";
import { runEffect } from "../effects/run-effect.ts";
import { happenOrAsk } from "../pipeline/happen.ts";
import type { GameState } from "../state/game-state.ts";
import type { WorkItem } from "../state/work.ts";
import { putTriggers } from "../triggers/put-on-stack.ts";
import { recordControlChanges } from "./control-changes.ts";
import { waitFor } from "./decide.ts";
import { playWithoutPaying } from "./play-during-resolution.ts";
import { givePriority } from "./priority.ts";
import { andThen, type Progress } from "./progress.ts";
import { doesNotResolve, finishResolving, resolveTopOfStack } from "./resolve.ts";
import { anotherCleanupStep, cleanupCheck, endStep, finishCleanup } from "./steps.ts";

export function advance(progress: Progress, cards: CardDatabase): Progress {
  let current = progress;
  for (;;) {
    const state = current.state;
    if (state.result !== null || state.pending !== null) return current;
    const [item, ...rest] = state.work;
    // Nothing to wait for and nothing to do would leave the game stuck: always an engine bug.
    if (item === undefined) throw new Error("The game has nothing pending and no work queued");
    current = andThen(current, (s) => runWorkItem({ ...s, work: rest }, item, cards));
    // What changed as the work was done, with no event of its own: control (CR 302.6, 506.4), and a creature ceasing to
    // be one (CR 506.4).
    const controlled = recordControlChanges(state, current.state, cards);
    current = { ...current, state: removeTypeChangesFromCombat(controlled, cards) };
  }
}

function runWorkItem(state: GameState, item: WorkItem, cards: CardDatabase): Progress {
  switch (item.kind) {
    case "givePriority":
      return givePriority(state, item.player, cards);
    case "endStep":
      return endStep(state, cards);
    case "resolveTopOfStack":
      return resolveTopOfStack(state, cards);
    case "runEffect":
      return runEffect(state, item.effect, item.context, cards, item.chosen);
    case "finishResolving":
      return finishResolving(state, item.object, cards);
    case "doesNotResolve":
      return doesNotResolve(state, item.object, item.reason, cards);
    case "cleanupCheck":
      return cleanupCheck(state, cards);
    case "anotherCleanupStep":
      return anotherCleanupStep(state, cards);
    case "declareAttackers":
      return declareAttackers(state, item.chosen, cards);
    case "declareBlockers":
      return declareBlockers(state, item.chosen, cards);
    case "combatDamage":
      return combatDamage(state, item.divisions, cards);
    case "finishCleanup":
      return finishCleanup(state, item.chosen, cards);
    case "playWithoutPaying":
      return playWithoutPaying(state, item.player, item.card, cards);
    case "askOptional":
      return {
        state: waitFor(state, item.player, {
          kind: "chooseYesNo",
          purpose: "optional",
          canSayYes: true,
          resume: item.resume,
        }),
        events: [],
      };
    case "putTriggers":
      return putTriggers(state, item.batch, item.player, cards);
    case "resumeEvent":
      return happenOrAsk(state, item.proposed, cards, item.choices);
  }
}
