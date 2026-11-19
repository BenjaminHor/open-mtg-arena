# @mtg/cli

The headless text interface for playing and debugging games. It's stateless: every command reads a game file,
does one thing and writes it back, so a script (or Claude Code) can drive a game one command at a time.

The full command list and output format are in [`docs/testing.md`](../../docs/testing.md), section 2.

## Entry points

- `src/main.ts`: the `pnpm cli` command; `run(argv)` returns the output, so tests call it directly.
- `src/game-file.ts`: the game file (setup, actions, cached state) and `replay` (D-043).
- `src/commands/`: one file per command: `new`, `show`, `actions`, `do`. `ai`, `auto`, `log`, `inspect`, `export` and
  `replay` come with the second part of M1-17.
- `src/show.ts`: the board as text; `canSeeHand` is the one place hidden information is hidden. `src/describe.ts`:
  actions, targets and mana in words.
- `src/fuzz.ts`: the `pnpm fuzz` command. A stub that exits with an error until M1-18.

```sh
pnpm cli --help
```

Node runs the TypeScript source directly (type stripping), so there is no build step.

## Tests

`pnpm test` runs this package's tests along with the rest: `test/cli.test.ts` plays games through the commands,
including a whole game from the prebuilt decks.
