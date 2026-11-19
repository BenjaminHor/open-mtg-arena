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
  | { kind: "pass"; player: string }
  | { kind: "allPass"; until: string | null }
  | { kind: "choose"; player: string; value: unknown }
  /** Activate an ability of a permanent: `p1 activate: Mountain`, or a reference like `p2:Mountain`. */
  | { kind: "activate"; player: string; card: string; ability: number | null }
  | { kind: "expect"; expectations: Record<string, unknown> }
  | { kind: "expectError"; code: string }
  /** A step word the format has but the runner doesn't support yet, kept whole for the task that adds it. */
  | {
      kind: "unsupported";
      player: string;
      word: string;
      value: unknown;
      options: Record<string, unknown>;
      arrives: string;
    };

/** Top-level keys of a scenario file. */
export const TOP_KEYS = ["name", "rules", "setup", "steps", "expect setup error"];

/** Step words the format defines that later tasks add to the runner, with the task. */
export const COMING_STEP_WORDS: Record<string, string> = {
  play: "M1-09",
  cast: "M1-09",
  attack: "M1-13",
  block: "M1-13",
};

/** Option keys that may sit next to a step word in the same step (docs/testing.md, "Steps"). */
export const STEP_OPTIONS: Record<string, string[]> = {
  cast: ["targets", "modes", "x", "pay"],
  activate: ["ability", "targets", "modes", "x", "pay"],
};

export function parseScenario(text: string): Scenario {
  const raw: unknown = parse(text);
  if (!isRecord(raw)) throw new Error("A scenario is a YAML map");
  for (const key of Object.keys(raw)) if (!TOP_KEYS.includes(key)) throw new Error(`Unknown top-level key "${key}"`);
  const name = raw.name;
  if (typeof name !== "string" || name === "") throw new Error("A scenario needs a name");
  const rules = raw.rules;
  if (
    !Array.isArray(rules) ||
    rules.length === 0 ||
    !rules.every((r) => typeof r === "string" && /^CR \d{3}(\.\d+[a-z]?)?$/.test(r))
  ) {
    throw new Error(`${name}: rules must list the CR rules tested, like [CR 103.5]`);
  }
  const setup = raw.setup;
  if (!isRecord(setup)) throw new Error(`${name}: setup must be a map`);
  const setupError = raw["expect setup error"];
  const steps = raw.steps;
  if ((setupError === undefined) === (steps === undefined)) {
    throw new Error(`${name}: a scenario has either steps or "expect setup error", not both or neither`);
  }
  if (setupError !== undefined && (typeof setupError !== "string" || setupError === "")) {
    throw new Error(`${name}: "expect setup error" takes a piece of the expected message`);
  }
  if (steps !== undefined && (!Array.isArray(steps) || steps.length === 0))
    throw new Error(`${name}: steps must be a non-empty list`);
  return {
    name,
    rules: rules as string[],
    setup,
    expectSetupError: typeof setupError === "string" ? setupError : null,
    steps: (steps ?? []).map((s: unknown, i: number) => parseStep(s, `${name}, step ${i + 1}`)),
  };
}

function parseStep(raw: unknown, where: string): ScenarioStep {
  if (!isRecord(raw)) throw new Error(`${where}: a step is a map like "p1 pass: once"`);
  const [key, ...rest] = Object.keys(raw);
  if (key === undefined) throw new Error(`${where}: an empty step`);
  const value = raw[key];
  const noOptions = () => {
    if (rest.length > 0) throw new Error(`${where}: "${key}" takes no other keys, got ${rest.join(", ")}`);
  };
  if (key === "expect") {
    noOptions();
    if (!isRecord(value) || Object.keys(value).length === 0) throw new Error(`${where}: expect takes a non-empty map`);
    return { kind: "expect", expectations: value };
  }
  if (key === "expect error") {
    noOptions();
    return { kind: "expectError", code: String(value) };
  }
  if (key === "all pass") {
    noOptions();
    if (value === "once") return { kind: "allPass", until: null };
    const until = /^until (\S+)$/.exec(String(value));
    if (until?.[1] !== undefined) return { kind: "allPass", until: until[1] };
    throw new Error(`${where}: "all pass" takes "once" or "until <step>"`);
  }
  const playerStep = /^(p\d+) (\w+)$/.exec(key);
  if (playerStep === null) throw new Error(`${where}: unknown step "${key}"`);
  const [, player = "", word = ""] = playerStep;
  if (word === "pass") {
    noOptions();
    if (value !== "once") throw new Error(`${where}: "${player} pass" takes "once"`);
    return { kind: "pass", player };
  }
  if (word === "choose") {
    noOptions();
    return { kind: "choose", player, value };
  }
  if (word === "activate") {
    const allowed = ["ability"];
    for (const option of rest)
      if (!allowed.includes(option)) throw new Error(`${where}: "activate" has no option "${option}" yet`);
    const ability = raw.ability;
    if (ability !== undefined && (typeof ability !== "number" || !Number.isInteger(ability) || ability < 1)) {
      throw new Error(`${where}: ability is a number counting from 1`);
    }
    return { kind: "activate", player, card: String(value), ability: typeof ability === "number" ? ability : null };
  }
  const arrives = COMING_STEP_WORDS[word];
  if (arrives === undefined) throw new Error(`${where}: unknown step word "${word}"`);
  const allowed = STEP_OPTIONS[word] ?? [];
  for (const option of rest)
    if (!allowed.includes(option)) throw new Error(`${where}: "${word}" has no option "${option}"`);
  const options = Object.fromEntries(rest.map((k) => [k, raw[k]]));
  return { kind: "unsupported", player, word, value, options, arrives };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
