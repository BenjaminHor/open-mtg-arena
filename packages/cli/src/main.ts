// The headless game CLI. Stateless: each command reads a game file, does one thing, and writes it back. The full
// command list is in docs/testing.md, section 2.

import { type ParseArgsConfig, parseArgs } from "node:util";
import { cardDatabase } from "@mtg/cards";
import { ENGINE_VERSION } from "@mtg/engine";
import { actionsCommand } from "./commands/actions.ts";
import { aiCommand, autoCommand } from "./commands/ai.ts";
import { briefCommand } from "./commands/brief.ts";
import { doCommand } from "./commands/do.ts";
import { exportCommand } from "./commands/export.ts";
import { inspectCommand } from "./commands/inspect.ts";
import { logCommand } from "./commands/log.ts";
import { newCommand } from "./commands/new.ts";
import { replayCommand } from "./commands/replay.ts";
import { showCommand } from "./commands/show.ts";

const HELP = `Usage: pnpm cli <command> [options]

Headless text interface for playing and inspecting games. See docs/testing.md, section 2.

Commands:
  new --decks red-aggro,green-stompy [--seed N] [--first p1] --out <file>
  new --scenario <name or .yaml> --out <file>
                             start a game from two prebuilt decks, or from a scenario's setup
  show <file> [--as p2]      the board, stack, step and pending decision
  brief <file> --as p1 [--text] [--json]
                             everything p1 may know to decide: each object in detail, what happened since p1
                             last acted and p1's legal actions; --text adds Oracle text, --json is for programs
  actions <file>             the numbered legal actions
  do <file> <n | step>       take action n, or a scenario step ("cast: Shock, targets: [p2], pay: auto")
  ai <file> --until p1 [--agent random|first-legal|by-kind] [--seed N]
                             an agent decides for the other players until p1 must decide
  auto <file> --ai both [--agent random|first-legal|by-kind] [--seed N] [--max-turns 30] [--max-actions N]
                             agents play everyone to the end; prints the log
  log <file> [--brief]       the events so far, one per line
  inspect <file> <ref>       a permanent's characteristics and what produced them ("p2:Grizzly Bears")
  export <file> --scenario [--name ...] [--rules "CR 510.1c,..."]
                             the game so far as a scenario
  replay <file> [--step N]   play the game again from its setup and show it after N actions

Options:
  -h, --help     show this help
  -v, --version  show the engine schema version`;

type Options = NonNullable<ParseArgsConfig["options"]>;

const AGENT: Options = {
  agent: { type: "string" },
  seed: { type: "string" },
  "max-turns": { type: "string" },
  "max-actions": { type: "string" },
};

/** Each command's options; anything else is an error. */
const OPTIONS: Record<string, Options> = {
  new: {
    decks: { type: "string" },
    scenario: { type: "string" },
    seed: { type: "string" },
    first: { type: "string" },
    out: { type: "string" },
  },
  show: { as: { type: "string" } },
  brief: { as: { type: "string" }, text: { type: "boolean" }, json: { type: "boolean" } },
  actions: {},
  do: {},
  ai: { ...AGENT, until: { type: "string" } },
  auto: { ...AGENT, ai: { type: "string" } },
  log: { brief: { type: "boolean" } },
  inspect: {},
  export: { scenario: { type: "boolean" }, name: { type: "string" }, rules: { type: "string" } },
  replay: { step: { type: "string" } },
};

/** Runs one command. Never throws: a problem is reported as output with code 1, as the shell would see it. */
export function run(argv: string[]): { output: string; code: number } {
  try {
    return { output: runCommand(argv), code: 0 };
  } catch (error) {
    return { output: error instanceof Error ? error.message : String(error), code: 1 };
  }
}

function runCommand(argv: string[]): string {
  const command = argv[0];
  if (command === "--version" || command === "-v") return `engine schema version ${ENGINE_VERSION}`;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") return HELP;
  const options = OPTIONS[command];
  if (options === undefined) throw new Error(`Unknown command: ${command}. Run \`pnpm cli --help\`.`);
  const { values: v, positionals } = parseArgs({ args: argv.slice(1), options, allowPositionals: true, strict: true });
  const values = v as Record<string, string | boolean | undefined>;
  const str = (key: string) => (typeof values[key] === "string" ? (values[key] as string) : undefined);
  const [file, ...rest] = positionals;
  // Only `do` (its step) and `inspect` (its reference) take words after the file; anything else is a mistake.
  if (rest.length > 0 && command !== "do" && command !== "inspect") {
    throw new Error(`${command} takes one game file; unexpected: ${rest.join(" ")}`);
  }
  const needFile = (): string => {
    if (file === undefined) throw new Error(`${command} needs a game file`);
    return file;
  };
  const cards = cardDatabase();
  const agentOptions = {
    agent: str("agent"),
    seed: str("seed"),
    "max-turns": str("max-turns"),
    "max-actions": str("max-actions"),
  };
  switch (command) {
    case "new":
      return newCommand(
        { decks: str("decks"), scenario: str("scenario"), seed: str("seed"), first: str("first"), out: str("out") },
        cards,
      );
    case "show":
      return showCommand(needFile(), str("as"), cards);
    case "brief":
      return briefCommand(needFile(), { as: str("as"), text: values.text === true, json: values.json === true }, cards);
    case "actions":
      return actionsCommand(needFile(), cards);
    case "do":
      if (rest.length === 0) throw new Error("do needs an action number or a step");
      return doCommand(needFile(), rest.join(" "), cards);
    case "ai":
      return aiCommand(needFile(), str("until"), agentOptions, cards);
    case "auto":
      return autoCommand(needFile(), str("ai"), agentOptions, cards);
    case "log":
      return logCommand(needFile(), values.brief === true, cards);
    case "inspect":
      return inspectCommand(needFile(), rest.join(" ") || undefined, cards);
    case "export":
      return exportCommand(
        needFile(),
        { scenario: values.scenario === true, name: str("name"), rules: str("rules") },
        cards,
      );
    case "replay":
      return replayCommand(needFile(), str("step"), cards);
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// Run as a command (not when a test imports `run`).
if (import.meta.main) {
  const { output, code } = run(process.argv.slice(2));
  if (code === 0) console.log(output);
  else console.error(output);
  process.exitCode = code;
}
