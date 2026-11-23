// The match host (architecture.md, "Match host"; M3-01): runs one game, deciding for agent seats and doing what a
// player leaves to the host (auto-pass, auto-tap, forced answers), until a person must decide. Pure and plain JSON,
// so it runs the same in the CLI, in tests, and in the web app's worker.

export { advance, advanceOne, HostStuck, MOST_ACTIONS, submit, waitingOn } from "./advance.ts";
export { autoPasses } from "./auto-pass.ts";
export { autoTapAction } from "./auto-tap.ts";
export { deckGameSetup } from "./deck-setup.ts";
export {
  DEFAULT_SETTINGS,
  type MatchState,
  type Seat,
  type SeatSettings,
  startMatch,
  takeEvents,
  withSettings,
} from "./match-state.ts";
export { replayLog } from "./replay.ts";
