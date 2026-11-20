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
  /** Play a land from hand (CR 305.1). */
  | { kind: "play"; player: string; card: string }
  /**
   * Cast a spell from hand (CR 601.2): its targets in order, one entry per instance of "target" (a list when that
   * instance has several), then the shares of a divided effect (CR 601.2d), then the payment: `auto` (autoPay), a
   * payment from the pool like `{ R: 1 }`, or `cancel`. Without `pay`, the cast stops at the payment decision.
   */
  | { kind: "cast"; player: string; card: string; targets: unknown[]; divide: number[] | null; pay: unknown }
  /**
   * Activate an ability of a permanent: `p1 activate: Mountain`, or a reference like `p2:Mountain`. An ability that uses
   * the stack then takes `targets` and `pay`, as `cast` does.
   */
  | {
      kind: "activate";
      player: string;
      card: string;
      ability: number | null;
      targets: unknown[];
      divide: number[] | null;
      pay: unknown;
    }
  /** Declare attackers (CR 508.1): the player's creatures by name or reference (`Grizzly Bears#2`), maybe none. */
  | { kind: "attack"; player: string; attackers: string[] }
  /** Declare blockers (CR 509.1): pairs of the player's blocker and the attacker it blocks, maybe none. */
  | { kind: "block"; player: string; blocks: [string, string][] }
  /** Divide an attacker's combat damage among its blockers (CR 510.1c): pairs of blocker and amount. */
  | { kind: "assign"; player: string; division: [string, number][] }
  /** Concede the game (CR 104.3a): `p1 concede: now`. Allowed at any time, so it isn't in `legalActions()`. */
  | { kind: "concede"; player: string }
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
export const COMING_STEP_WORDS: Record<string, string> = {}; // none now; a task adding a step word lists it here first

/** Option keys that may sit next to a step word in the same step (docs/testing.md, "Steps"). */
export const STEP_OPTIONS: Record<string, string[]> = {
  cast: ["targets", "divide", "pay"],
  activate: ["ability", "targets", "divide", "pay"],
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
  if (word === "play") {
    noOptions();
    return { kind: "play", player, card: String(value) };
  }
  if (word === "cast") {
    for (const option of rest)
      if (!(STEP_OPTIONS.cast ?? []).includes(option)) throw new Error(`${where}: "cast" has no option "${option}"`);
    const targets = raw.targets ?? [];
    if (!Array.isArray(targets)) throw new Error(`${where}: targets is a list`);
    return { kind: "cast", player, card: String(value), targets, divide: shares(raw.divide, where), pay: raw.pay };
  }
  if (word === "concede") {
    noOptions();
    if (value !== "now") throw new Error(`${where}: "${player} concede" takes "now"`);
    return { kind: "concede", player };
  }
  if (word === "attack") {
    noOptions();
    if (!Array.isArray(value)) throw new Error(`${where}: attack takes a list of creatures, like [Grizzly Bears]`);
    return { kind: "attack", player, attackers: value.map(String) };
  }
  if (word === "block") {
    noOptions();
    if (!isRecord(value))
      throw new Error(`${where}: block takes a map of blocker to attacker, like { Giant Spider: Craw Wurm }`);
    return { kind: "block", player, blocks: Object.entries(value).map(([b, a]): [string, string] => [b, String(a)]) };
  }
  if (word === "assign") {
    noOptions();
    if (!isRecord(value))
      throw new Error(`${where}: assign takes a map of blocker to damage, like { Grizzly Bears: 2 }`);
    const division = Object.entries(value).map(([b, n]): [string, number] => {
      if (typeof n !== "number" || !Number.isInteger(n))
        throw new Error(`${where}: damage for ${b} must be a whole number`);
      return [b, n];
    });
    return { kind: "assign", player, division };
  }
  if (word === "activate") {
    for (const option of rest)
      if (!(STEP_OPTIONS.activate ?? []).includes(option))
        throw new Error(`${where}: "activate" has no option "${option}"`);
    const ability = raw.ability;
    if (ability !== undefined && (typeof ability !== "number" || !Number.isInteger(ability) || ability < 1)) {
      throw new Error(`${where}: ability is a number counting from 1`);
    }
    const targets = raw.targets ?? [];
    if (!Array.isArray(targets)) throw new Error(`${where}: targets is a list`);
    return {
      kind: "activate",
      player,
      card: String(value),
      ability: typeof ability === "number" ? ability : null,
      targets,
      divide: shares(raw.divide, where),
      pay: raw.pay,
    };
  }
  const arrives = COMING_STEP_WORDS[word];
  if (arrives === undefined) throw new Error(`${where}: unknown step word "${word}"`);
  const allowed = STEP_OPTIONS[word] ?? [];
  for (const option of rest)
    if (!allowed.includes(option)) throw new Error(`${where}: "${word}" has no option "${option}"`);
  const options = Object.fromEntries(rest.map((k) => [k, raw[k]]));
  return { kind: "unsupported", player, word, value, options, arrives };
}

/**
 * One step written on its own, as YAML: `p1 cast: Lightning Bolt, targets: [p2], pay: auto`, with or without braces.
 * The CLI's `do` uses it, so a step from a scenario can be pasted straight in. A step whose first key has no player
 * (`cast: Shock, ...`) is taken by `defaultPlayer`, if one is given.
 */
export function parseStepText(text: string, defaultPlayer: string | null = null): ScenarioStep {
  const trimmed = text.trim();
  const inner = trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1).trim() : trimmed;
  const hasPlayer = /^(p\d+ |all pass|expect)/.test(inner);
  const withPlayer = hasPlayer || defaultPlayer === null ? inner : `${defaultPlayer} ${inner}`;
  return parseStep(parse(`{ ${withPlayer} }`), "step");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `divide:` option: each target's share, in the order the targets were chosen (CR 601.2d). */
function shares(value: unknown, where: string): number[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.every((n) => typeof n === "number" && Number.isInteger(n)))
    throw new Error(`${where}: divide is a list of whole numbers, one per target, like [2, 1]`);
  return value;
}
