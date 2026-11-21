// Scenario tests (docs/testing.md, section 1): parse a scenario, run it against the engine, report problems.

export type { AfterEach, Game } from "./apply.ts";
export { COMING_EXPECTATIONS } from "./expect.ts";
export { scenarioFromGame } from "./export.ts";
export { COMING_STEP_WORDS, parseScenario, parseStepText, type Scenario, type ScenarioStep } from "./format.ts";
export { invariantProblems, plainJsonProblems } from "./invariants.ts";
export { graveyardRef, nameOf, parseRef, refOf, resolveRef, STEP_NAMES, scenarioStep } from "./names.ts";
export { runScenario, type ScenarioResult } from "./run.ts";
export { buildSetup } from "./setup.ts";
export { type ActionStep, takeStep } from "./steps.ts";
