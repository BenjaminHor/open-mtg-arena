// The headless game CLI. Stateless: each command reads a game file, does one thing, and writes it back. The full
// command list is in docs/testing.md, section 2.

import { parseArgs } from "node:util";
import { cardDatabase } from "@mtg/cards";
import { ENGINE_VERSION } from "@mtg/engine";
import { actionsCommand } from "./commands/actions.ts";
import { doCommand } from "./commands/do.ts";
import { newCommand } from "./commands/new.ts";
import { showCommand } from "./commands/show.ts";

const HELP = `Usage: pnpm cli <command> [options]

Headless text interface for playing and inspecting games. See docs/testing.md, section 2.

Commands:
  new --decks red-aggro,green-stompy [--seed N] [--first p1] --out <file>
  new --scenario <name or .yaml> --out <file>
            start a game from two prebuilt decks, or from a scenario's setup
  show <file> [--as p2]      print the board, stack, step and pending decision
  actions <file>             list the numbered legal actions
  do <file> <n | step>       take action n, or a scenario step ("cast: Shock, targets: [p2], pay: auto")

Coming in the second part of M1-17: ai, auto, log, inspect, export, replay.

Options:
  -h, --help     show this help
  -v, --version  show the engine schema version`;

export function run(argv: string[]): { output: string; code: number } {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      decks: { type: "string" },
      scenario: { type: "string" },
      seed: { type: "string" },
      first: { type: "string" },
      out: { type: "string" },
      as: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.version === true) return { output: `engine schema version ${ENGINE_VERSION}`, code: 0 };
  const [command, file, ...rest] = positionals;
  if (values.help === true || command === undefined || command === "help") return { output: HELP, code: 0 };
  const cards = cardDatabase();
  const needFile = (): string => {
    if (file === undefined) throw new Error(`${command} needs a game file`);
    return file;
  };
  switch (command) {
    case "new":
      return { output: newCommand(values, cards), code: 0 };
    case "show":
      return { output: showCommand(needFile(), values.as, cards), code: 0 };
    case "actions":
      return { output: actionsCommand(needFile(), cards), code: 0 };
    case "do":
      if (rest.length === 0) throw new Error("do needs an action number or a step");
      return { output: doCommand(needFile(), rest.join(" "), cards), code: 0 };
    default:
      return { output: `Unknown or not yet implemented command: ${command}. Run \`pnpm cli --help\`.`, code: 1 };
  }
}

// Run as a command (not when a test imports `run`).
if (import.meta.main) {
  try {
    const { output, code } = run(process.argv.slice(2));
    if (code === 0) console.log(output);
    else console.error(output);
    process.exitCode = code;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
