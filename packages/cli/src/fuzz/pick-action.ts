// How the fuzzer picks among the legal actions (D-061). Picking uniformly among actions spends most of a game on casts
// that end in a cancel: every card in hand is listed whether it can be paid for or not (D-035), so with a hand of
// uncastable cards, passing is one choice among many. Picking a kind of action first, then one of that kind, keeps
// every listed action possible while letting games move on. It reads only the listed actions, never whether a cost can
// be paid, so the fuzzer doesn't trust the code it tests.

import type { Action } from "@mtg/engine";
import { nextRandom } from "../agents.ts";

/** Cancelling a cast or an activation is still tried, a tenth as often as any other kind of action. */
const CANCEL_WEIGHT = 0.1;

/** What kind of choice an action is: its type, and for an answer to a decision, the answer's kind. */
export function actionKind(action: Action): string {
  return action.type === "ANSWER" ? `ANSWER ${action.answer.kind}` : action.type;
}

/** A kind's weight, read from one of its actions so the compiler checks the answer kind's name. */
function weightOf(action: Action): number {
  return action.type === "ANSWER" && action.answer.kind === "cancelCast" ? CANCEL_WEIGHT : 1;
}

/** A kind of action, by weight, then one action of that kind, uniformly. Seeded, so one seed is one game. */
export function pickAction(actions: readonly Action[], seed: number): { action: Action; seed: number } {
  // Kinds in the order they're first listed, so the same list always gives the same pick.
  const kinds = [...Map.groupBy(actions, actionKind).values()];
  if (kinds.length === 0) throw new Error("no legal actions to choose from");
  const weights = kinds.map((ofKind) => weightOf(ofKind[0] as Action));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const first = nextRandom(seed);
  let roll = first.value * total;
  // The last kind is the fallback only if rounding leaves the roll at the very end of the range.
  let chosen = kinds.length - 1;
  for (const [i, weight] of weights.entries()) {
    if (roll < weight) {
      chosen = i;
      break;
    }
    roll -= weight;
  }
  const ofKind = kinds[chosen] as Action[];
  const second = nextRandom(first.seed);
  return { action: ofKind[Math.floor(second.value * ofKind.length)] as Action, seed: second.seed };
}
