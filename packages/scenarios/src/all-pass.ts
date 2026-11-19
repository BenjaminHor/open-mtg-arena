// `all pass: once` and `all pass: until <step>` (docs/testing.md, "Steps").

import type { CardDatabase } from "@mtg/engine";
import { apply, type Game, legal } from "./apply.ts";
import { engineStep } from "./names.ts";

/** The most passes `all pass: until` makes before giving up, so a step that never comes fails instead of hanging. */
const MAX_PASSES = 500;

/**
 * Each player passes once (`until` null), or players keep passing until `until` begins and someone has priority in it.
 * Passing stops early if the game ends; for `until`, that's a success only if the game ended in that step.
 */
export function allPass(
  game: Game,
  until: string | null,
  cards: CardDatabase,
  afterEach: (g: Game) => void,
  maxPasses = MAX_PASSES,
): Game {
  if (until === null) {
    let next = game;
    for (const _ of game.state.turnOrder) {
      next = passByWhoeverHasPriority(next, cards, afterEach);
      if (next.state.result !== null) break; // the game ended part way round
    }
    return next;
  }
  const target = engineStep(until);
  let next = game;
  let begun = false;
  for (let passes = 0; passes < maxPasses; passes++) {
    const before = next.events.length;
    next = passByWhoeverHasPriority(next, cards, afterEach);
    begun ||= next.events.slice(before).some((e) => e.type === "STEP_BEGAN" && e.step === target);
    if (next.state.result !== null) {
      // The game ended in that step before anyone got priority (a lost draw, say): that step did come.
      if (begun && next.state.turn?.step === target) return next;
      throw new Error(`"all pass: until ${until}": the game ended before that step began`);
    }
    if (begun && next.state.turn?.step === target && stopsHere(next)) return next;
  }
  throw new Error(`"all pass: until ${until}" didn't reach that step with priority in ${maxPasses} passes`);
}

/** Where `until` stops: someone has priority, or the step's own decision is pending (declaring, dividing damage). */
function stopsHere(game: Game): boolean {
  const kind = game.state.pending?.kind;
  return kind === "priority" || kind === "declareAttackers" || kind === "declareBlockers" || kind === "assignDamage";
}

/**
 * Whoever has priority passes. Passing through combat, a pending declaration is answered first with no attackers or no
 * blockers, the natural "do nothing" (a division of damage has no such answer, so it stops the passing).
 */
function passByWhoeverHasPriority(game: Game, cards: CardDatabase, afterEach: (g: Game) => void): Game {
  let next = game;
  for (;;) {
    const pending = next.state.pending;
    if (next.state.result !== null) throw new Error("the game is over, so no one can pass");
    if (pending?.kind === "declareAttackers" || pending?.kind === "declareBlockers") {
      if (pending.chosen.length > 0) throw new Error(`${pending.kind} is part way through: finish it first`);
      const finish = legal(
        next,
        pending.player,
        cards,
        (a) => a.type === "ANSWER" && a.answer.kind === "finishDeclaring",
        "declare nothing",
      );
      next = apply(next, finish, cards, afterEach);
      continue;
    }
    if (pending?.kind !== "priority")
      throw new Error(`expected someone to have priority, but the game waits for ${pending?.kind ?? "nothing"}`);
    return apply(
      next,
      legal(next, pending.player, cards, (a) => a.type === "PASS_PRIORITY", "pass"),
      cards,
      afterEach,
    );
  }
}
