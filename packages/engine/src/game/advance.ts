// advance: runs queued work until the game needs a decision or is over (docs/architecture.md, "Running the game").
// Every engine entry point ends here.

import type { CardDatabase } from "../cards/types.ts";
import { runEffect } from "../effects/run-effect.ts";
import type { GameState } from "../state/game-state.ts";
import type { WorkItem } from "../state/work.ts";
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
  }
}

function runWorkItem(state: GameState, item: WorkItem, cards: CardDatabase): Progress {
  switch (item.kind) {
    case "givePriority":
      return givePriority(state, item.player, cards);
    case "endStep":
      return endStep(state);
    case "resolveTopOfStack":
      return resolveTopOfStack(state, cards);
    case "runEffect":
      return runEffect(state, item.effect, item.context, cards);
    case "finishResolving":
      return finishResolving(state, item.object, cards);
    case "doesNotResolve":
      return doesNotResolve(state, item.object);
    case "cleanupCheck":
      return cleanupCheck(state, cards);
    case "anotherCleanupStep":
      return anotherCleanupStep(state);
    case "finishCleanup":
      return finishCleanup(state, item.chosen);
  }
}
