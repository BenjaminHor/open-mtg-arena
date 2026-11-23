// The messages between the UI and the match host's Web Worker (M3-03): plain JSON both ways, so they cross
// `postMessage` unchanged. The UI only ever gets what the person's seat is shown (`SeatView`, D-144) and the events it
// saw (`ViewEvent`, D-044): never the match or the game state, which hold the other player's hidden cards.

import type { Action, GameSetup, PlayerId, SeatView, ViewEvent } from "@mtg/engine";

/** From the UI to the worker. */
export type ToWorker =
  /** A new match between two prebuilt decks (by name), the person in `human`'s seat, the heuristic AI in the other. */
  | { type: "start"; decks: [string, string]; seed: number; human: PlayerId }
  /** A match from a given setup, the person in `human`'s seat: a fixture board for tests and screenshots. */
  | { type: "startFrom"; setup: GameSetup; human: PlayerId }
  /** The person's action, one of `shown.options` from the last update. */
  | { type: "act"; action: Action }
  /**
   * Full control on or off for the person's seat (arena-research.md, "Full control"): on, the host never passes
   * priority for them; off, it passes where they have nothing to do (`@mtg/match` auto-pass, D-143, D-157).
   */
  | { type: "fullControl"; on: boolean };

/** From the worker to the UI. */
export type FromWorker =
  /**
   * What the person's seat is shown now, and the events it saw since the last update, in order. `waitingOn` is the
   * person when they must decide, null while no one does (the game is over).
   */
  | {
      type: "update";
      /**
       * What happened on the way here, a frame per thing worth a moment's look (D-172), oldest first: the app shows
       * each in turn before `shown`. Empty when nothing did.
       */
      frames: Frame[];
      shown: SeatView;
      /** The events since the last frame (all of them, with no frames). */
      events: ViewEvent[];
      waitingOn: PlayerId | null;
      fullControl: boolean;
    }
  /** A message the worker refused: an action that isn't legal now, or a start with an unknown deck. */
  | { type: "error"; message: string };

/** One moment on the way to the person's next decision: their seat's view then, and the events that led to it. */
export type Frame = { shown: SeatView; events: ViewEvent[] };
