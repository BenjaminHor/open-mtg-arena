# @mtg/cli

The headless text interface for playing and debugging games. It's stateless: every command reads a game file,
does one thing and writes it back, so a person, a script or a test can drive a game one command at a time.

The full command list and output format are in [`docs/testing.md`](../../docs/testing.md), section 2.

## Entry points

- `src/main.ts`: the `pnpm cli` command; `run(argv)` returns the output, so tests call it directly.
- `src/game-file.ts`: the game file (setup, actions, cached state) and `replay` (D-043).
- `src/commands/`: one file per command: `new`, `show`, `brief`, `actions`, `do`, `ai` (with `auto`), `log`, `inspect`,
  `export`, `replay`.
- `src/brief/`: `brief`, one player's whole situation as data (`brief.ts`, `brief-objects.ts`, and `action-info.ts` for
  each action's cost, mana hint and targets), the events they saw since they last acted (`recent-events.ts`), and the
  same data as text (`brief-text.ts`) (D-135).
- `src/agents.ts`, `src/agent-play.ts`: the `first-legal`, `random` and `by-kind` agents and the loop that lets them
  play. `src/pick-action.ts`: the `by-kind` pick, a kind of action first (the fuzzer's, D-061). `src/seeded-random.ts`:
  the seeded random numbers. `src/random-decks.ts`: random 40-card decks from the pool.
- `src/event-log.ts`: events in words, by turn (`log`, `auto`). `src/deck-setup.ts`: a game between prebuilt decks.
- `src/show.ts`: the board as text; `canSeeHand` is the one place hidden information is hidden. `src/describe.ts`:
  actions, targets and mana in words.
- `src/fuzz.ts`: the `pnpm fuzz` command (docs/testing.md, section 3; D-046). `src/fuzz/`: `checks.ts` (what's
  checked after every action, including `scrambleHidden` for views), `run-game.ts` (`fuzzDecks`, `fuzzGame`: one seed,
  one game), `run-fuzz.ts` (many games, failures written to `fuzz-failures/`), `parallel.ts` and `worker.ts` (the same
  games on worker threads, `--jobs`, D-117).
- `src/replays.ts`: the saved replays in `packages/engine/test/replays/` and `pnpm replays:update`.
- `src/rules-coverage.ts`: `pnpm coverage:rules`, the rules coverage report (D-048). `src/coverage/`: reading
  citations (`citations.ts`), what's cited and tested (`collect.ts`), the report and its gaps (`report.ts`).
- `src/bench.ts`: `pnpm bench [--update]` against `bench/baseline.json` (D-049). `src/bench/`: the workloads
  (`workloads.ts`) and the interleaved timing with its reference loop (`timing.ts`).
- `src/golden.ts`: the golden games in `packages/engine/test/golden/`, `pnpm golden:update` and `pnpm golden:add`
  (D-047). `src/golden-cover.ts`: what a game uses, and `pnpm golden:cover`, which adds games until the golden games
  use the whole pool (D-069).

```sh
pnpm cli --help
```

Node runs the TypeScript source directly (type stripping), so there is no build step.

## Tests

`pnpm test` runs this package's tests along with the rest: `test/cli.test.ts` plays games through the commands,
including a whole game from the prebuilt decks; `test/agents.test.ts`, `test/export.test.ts` (exported games replay
exactly), `test/log-inspect-replay.test.ts`, `test/fuzz.test.ts` (the checks, failure files, and the short fuzz `pnpm
check` runs), `test/replays.test.ts` (every saved replay), `test/coverage.test.ts` (the report and its gap check),
`test/bench.test.ts` (the bench workloads build and run) and `test/golden.test.ts` (every golden game's log) cover the
rest; `test/helpers.ts` runs the CLI in-process. Paths given to `pnpm cli` are relative to the repo root, where pnpm
runs scripts.
