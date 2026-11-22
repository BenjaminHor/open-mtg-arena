// Simple agents: the CLI's `ai` and `auto`, the fuzzer (`first-legal` and the `by-kind` picker, D-061), the golden
// games (`by-kind`, D-069) and the match host's test seats. Each is pure: the legal actions and a random state in, an
// action and the next random state out. They never see the game, so they can't cheat (D-062), and they choose only from
// `legalActions`, so they never concede (D-042).

import type { Action } from "@mtg/engine";
import { pickAction } from "./pick-action.ts";
import { nextRandom } from "./seeded-random.ts";

export type AgentName = "first-legal" | "random" | "by-kind";

export const AGENTS: readonly AgentName[] = ["first-legal", "random", "by-kind"];

/**
 * The action this agent takes. `first-legal` takes the first legal action (pass, keep, no attackers...), so its games
 * are dull but always end. `random` picks uniformly among the legal actions. `by-kind` picks a kind of action, then one
 * of that kind (the fuzzer's picker, D-061), so its games cast more and cancel less.
 */
export function chooseAction(
  agent: AgentName,
  actions: readonly Action[],
  seed: number,
): { action: Action; seed: number } {
  if (actions.length === 0) throw new Error("no legal actions to choose from");
  switch (agent) {
    case "first-legal":
      return { action: actions[0] as Action, seed };
    case "random": {
      const r = nextRandom(seed);
      return { action: actions[Math.floor(r.value * actions.length)] as Action, seed: r.seed };
    }
    case "by-kind":
      return pickAction(actions, seed);
  }
}

export function agentNamed(name: string | undefined): AgentName {
  const agent = (name ?? "random") as AgentName;
  if (!AGENTS.includes(agent)) throw new Error(`no agent "${name}"; agents: ${AGENTS.join(", ")}`);
  return agent;
}
