// The headless game CLI. Stateless: each command reads a game file, does one thing,
// and writes it back. The full command list is in docs/testing.md, section 2.
// Commands arrive with the engine (M1-17); for now only --help works.

import { parseArgs } from "node:util";
import { ENGINE_VERSION } from "@mtg/engine";

const HELP = `Usage: pnpm cli <command> [options]

Headless text interface for playing and inspecting games. See docs/testing.md.

Commands (arriving in M1-17):
  new       start a game from decks or a scenario
  show      print the board, stack, step and pending decision
  actions   list the numbered legal actions
  do        take a legal action by number or step syntax
  ai        let the AI act until a player must decide
  auto      play AI vs AI to the end and print a log
  log       print the events so far
  inspect   print an object's computed characteristics
  export    print the game so far as a scenario
  replay    replay a saved log

Options:
  -h, --help     show this help
  -v, --version  show the engine schema version`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.version === true) {
    console.log(`engine schema version ${ENGINE_VERSION}`);
    return 0;
  }

  const command = positionals[0];
  if (values.help === true || command === undefined || command === "help") {
    console.log(HELP);
    return 0;
  }

  console.error(`Unknown or not yet implemented command: ${command}. Run \`pnpm cli --help\`.`);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
