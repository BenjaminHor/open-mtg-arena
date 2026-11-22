# @mtg/match

The match host (architecture.md, "Match host"; M3-01): runs one game. It decides for agent seats and does what a
player leaves to the host, until a person must decide. Pure and plain JSON, so it runs the same in tests, the CLI and
the web app's worker (M3-03). Depends on `engine`, `ai` and `cards`, and on no `node:` module (a test checks).

## Entry points

- `src/match-state.ts`: `MatchState` (the setup, every action taken in order, the game, each player's seat and
  settings, the events each human seat hasn't been sent), `startMatch`, `takeEvents` (a player's unsent events, through
  `eventsFor`), `DEFAULT_SETTINGS` (auto-pass and auto-tap on). Treat a `MatchState` as the host's: read it through
  `waitingOn` and `takeEvents`, and change it only through `advance` and `submit`.
- `src/advance.ts`: `advance(match, cards)` acts until a person must decide or the game ends: a built-in agent's
  choice (its random state kept in the match, never the game's), a decision with one legal answer, auto-tap, auto-pass.
  `submit(match, action, cards)` applies a person's action; `waitingOn` names who must decide.
- `src/auto-pass.ts`: `autoPasses`, one pure rule for every seat (D-137): pass when nothing meaningful can be done (a
  land to play, or a spell or non-mana ability the player can pay for now, counts); with your own object on top of the
  stack, pass so it resolves; otherwise stop (D-143). Full control is `autoPass: false`.
- `src/auto-tap.ts`: `autoTapAction`, the engine's `autoPay` pick of mana sources, one action at a time.
- `src/replay.ts`: `replayLog`, the setup and the actions replayed: the log is the replay and the bug report.
- `src/deck-setup.ts`: `deckGameSetup`, a game between prebuilt decks.

## Tests

`test/match.test.ts`: agent seats play whole matches and the log replays to the same state (M3-01's acceptance); a
person's seat is asked only for real decisions and is sent the events it saw. `test/auto-pass.test.ts`: where the
host stops. `test/host.test.ts`: auto-tap, agent seats, refusals, the JSON round trip. `test/browser-safe.test.ts`: no `node:` import in what the host uses.
