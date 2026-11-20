// How the fuzzer picks among the legal actions (D-061). Picking uniformly among actions spends most of a game on casts
// that end in a cancel: every card in hand is listed whether it can be paid for or not (D-035), so a hand of five
// uncastable cards leaves passing one choice in seven. Picking a kind of action first, then one of that kind, keeps
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

function weightOf(kind: string): number {
  return kind === "ANSWER cancelCast" ? CANCEL_WEIGHT : 1;
}

/** A kind of action, by weight, then one action of that kind, uniformly. Seeded, so one seed is one game. */
export function pickAction(actions: readonly Action[], seed: number): { action: Action; seed: number } {
  const byKind = new Map<string, Action[]>();
  for (const action of actions) {
    const kind = actionKind(action);
    byKind.set(kind, [...(byKind.get(kind) ?? []), action]);
  }
  const kinds = [...byKind.entries()];
  if (kinds.length === 0) throw new Error("no legal actions to choose from");
  const total = kinds.reduce((sum, [kind]) => sum + weightOf(kind), 0);
  const first = nextRandom(seed);
  let left = first.value * total;
  let chosen = kinds[kinds.length - 1] as [string, Action[]];
  for (const entry of kinds) {
    left -= weightOf(entry[0]);
    if (left < 0) {
      chosen = entry;
      break;
    }
  }
  const second = nextRandom(first.seed);
  const ofKind = chosen[1];
  return { action: ofKind[Math.floor(second.value * ofKind.length)] as Action, seed: second.seed };
}
