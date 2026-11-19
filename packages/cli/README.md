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
- `src/fuzz.ts`: the `pnpm fuzz` command (docs/testing.md, section 3; D-046). `src/fuzz/`: `checks.ts` (what's
  checked after every action, including `scrambleHidden` for views), `run-game.ts` (`fuzzGame`: one seed, one game),
  `run-fuzz.ts` (many games, failures written to `fuzz-failures/`).
- `src/replays.ts`: the saved replays in `packages/engine/test/replays/` and `pnpm replays:update`.
- `src/golden.ts`: the golden games in `packages/engine/test/golden/`, `pnpm golden:update` and `pnpm golden:add`
  (D-047).

```sh
pnpm cli --help
```

Node runs the TypeScript source directly (type stripping), so there is no build step.

## Tests

`pnpm test` runs this package's tests along with the rest: `test/cli.test.ts` plays games through the commands,
including a whole game from the prebuilt decks; `test/agents.test.ts`, `test/export.test.ts` (exported games
replay exactly), `test/log-inspect-replay.test.ts`, `test/fuzz.test.ts` (the checks, failure files, and the short
fuzz `pnpm check` runs) `test/replays.test.ts` (every saved replay) and `test/golden.test.ts` (every golden game's log) cover the rest; `test/helpers.ts` runs the CLI in-process. Paths given to `pnpm cli` are relative to the repo root,
where pnpm runs scripts.
