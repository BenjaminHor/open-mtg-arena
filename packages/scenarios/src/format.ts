// The scenario file format (docs/testing.md, section 1), checked as it's read so a typo fails loudly instead of
// quietly testing nothing.

import { parse } from "yaml";

export type Scenario = {
  name: string;
  rules: string[];
  setup: Record<string, unknown>;
  /** Present when the setup itself must be rejected: a piece of the expected message. */
  expectSetupError: string | null;
  steps: ScenarioStep[];
};

export type ScenarioStep =
  | { kind: "pass"; player: string; count: number }
  | { kind: "allPass"; until: string | null }
  | { kind: "choose"; player: string; value: unknown }
  | { kind: "expect"; expectations: Record<string, unknown> }
  | { kind: "expectError"; code: string }
  /** A step word the format has but the runner doesn't support yet, with the task that adds it. */
  | { kind: "unsupported"; word: string; arrives: string };

/** Step words the format defines that later tasks add to the runner. */
export const COMING_STEP_WORDS: Record<string, string> = {
  play: "M1-09",
  cast: "M1-09",
  activate: "M1-08",
  attack: "M1-13",
  block: "M1-13",
};

const TOP_KEYS = ["name", "rules", "setup", "steps", "expect setup error"];

export function parseScenario(text: string): Scenario {
  const raw: unknown = parse(text);
  if (!isRecord(raw)) throw new Error("A scenario is a YAML map");
  for (const key of Object.keys(raw)) if (!TOP_KEYS.includes(key)) throw new Error(`Unknown top-level key "${key}"`);
  const name = raw.name;
  if (typeof name !== "string") throw new Error("A scenario needs a name");
  const rules = raw.rules;
  if (!Array.isArray(rules) || rules.length === 0 || !rules.every((r) => typeof r === "string" && /^CR \d/.test(r))) {
    throw new Error(`${name}: rules must list the CR rules tested, like [CR 103.5]`);
  }
  const setup = raw.setup;
  if (!isRecord(setup)) throw new Error(`${name}: setup must be a map`);
  const expectSetupError = raw["expect setup error"];
  const steps = raw.steps ?? [];
  if (!Array.isArray(steps)) throw new Error(`${name}: steps must be a list`);
  if (expectSetupError !== undefined && steps.length > 0) throw new Error(`${name}: a rejected setup has no steps`);
  return {
    name,
    rules: rules as string[],
    setup,
    expectSetupError: expectSetupError === undefined ? null : String(expectSetupError),
    steps: steps.map((s, i) => parseStep(s, `${name}, step ${i + 1}`)),
  };
}

function parseStep(raw: unknown, where: string): ScenarioStep {
  if (!isRecord(raw)) throw new Error(`${where}: a step is a map like "p1 pass: once"`);
  const keys = Object.keys(raw);
  const [key] = keys;
  if (key === undefined || keys.length !== 1)
    throw new Error(`${where}: a step has exactly one key, got ${keys.join(", ")}`);
  const value = raw[key];
  if (key === "expect") {
    if (!isRecord(value)) throw new Error(`${where}: expect takes a map`);
    return { kind: "expect", expectations: value };
  }
  if (key === "expect error") return { kind: "expectError", code: String(value) };
  if (key === "all pass") {
    if (value === "once") return { kind: "allPass", until: null };
    const until = /^until (\S+)$/.exec(String(value));
    if (until?.[1] !== undefined) return { kind: "allPass", until: until[1] };
    throw new Error(`${where}: "all pass" takes "once" or "until <step>"`);
  }
  const playerStep = /^(p\d+) (\w+)$/.exec(key);
  if (playerStep === null) throw new Error(`${where}: unknown step "${key}"`);
  const [, player = "", word = ""] = playerStep;
  if (word === "pass") {
    if (value !== "once") throw new Error(`${where}: "${player} pass" takes "once"`);
    return { kind: "pass", player, count: 1 };
  }
  if (word === "choose") return { kind: "choose", player, value };
  const arrives = COMING_STEP_WORDS[word];
  if (arrives !== undefined) return { kind: "unsupported", word, arrives };
  throw new Error(`${where}: unknown step word "${word}"`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
