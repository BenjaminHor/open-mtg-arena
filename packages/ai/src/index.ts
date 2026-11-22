// The computer players. The simple agents test the rules (they pick among legal actions); the heuristic AI (M3-02)
// plays to win, from what its seat is shown. See README.md.

export { AGENTS, type AgentName, agentNamed, chooseAction } from "./agents.ts";
export { heuristicAction } from "./heuristic/heuristic.ts";
export { pickAction } from "./pick-action.ts";
export { nextRandom } from "./seeded-random.ts";
