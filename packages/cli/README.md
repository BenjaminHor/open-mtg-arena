# @mtg/cli

The headless text interface for playing and debugging games. It's stateless: every command reads a game file,
does one thing and writes it back, so a script (or Claude Code) can drive a game one command at a time.

The full command list and output format are in [`docs/testing.md`](../../docs/testing.md), section 2.

## Entry points

- `src/main.ts`: the `pnpm cli` command; `run(argv)` returns the output, so tests call it directly.
- `src/game-file.ts`: the game file (setup, actions, cached state) and `replay` (D-043).
- `src/commands/`: one file per command: `new`, `show`, `actions`, `do`, `ai` (with `auto`), `log`, `inspect`, `export`,
  `replay`.
- `src/agents.ts`, `src/agent-play.ts`: the `first-legal` and `random` agents and the loop that lets them play.
- `src/event-log.ts`: events in words, by turn (`log`, `auto`). `src/deck-setup.ts`: a game between prebuilt decks.
- `src/show.ts`: the board as text; `canSeeHand` is the one place hidden information is hidden. `src/describe.ts`:
  actions, targets and mana in words.
- `src/fuzz.ts`: the `pnpm fuzz` command. A stub that exits with an error until M1-18.

```sh
pnpm cli --help
```

Node runs the TypeScript source directly (type stripping), so there is no build step.

## Tests

`pnpm test` runs this package's tests along with the rest: `test/cli.test.ts` plays games through the commands,
including a whole game from the prebuilt decks; `test/agents.test.ts`, `test/export.test.ts` (exported games
replay exactly) and `test/log-inspect-replay.test.ts` cover the rest; `test/helpers.ts` runs the CLI in-process. Paths given to `pnpm cli` are relative to the repo root,
where pnpm runs scripts.
