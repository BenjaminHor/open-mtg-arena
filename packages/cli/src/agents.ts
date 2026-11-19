// Simple agents for `ai` and `auto` (and the fuzzer, M1-18) until the real AI arrives in M2. Each is pure: the state,
// the legal actions and a random state in, an action and the next random state out. They choose only from
// `legalActions`, so they never concede (D-042).

import type { Action, GameState } from "@mtg/engine";

export type AgentName = "first-legal" | "random";

export const AGENTS: readonly AgentName[] = ["first-legal", "random"];

/** A tiny seeded PRNG (mulberry32): one 32-bit number of state, enough for picking actions reproducibly. */
export function nextRandom(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
}

/**
 * The action this agent takes. `first-legal` takes the first legal action (pass, keep, no attackers...), so its games
 * are dull but always end. `random` picks uniformly among the legal actions.
 */
export function chooseAction(
  agent: AgentName,
  _state: GameState,
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
  }
}

export function agentNamed(name: string | undefined): AgentName {
  const agent = (name ?? "random") as AgentName;
  if (!AGENTS.includes(agent)) throw new Error(`no agent "${name}"; agents: ${AGENTS.join(", ")}`);
  return agent;
}
