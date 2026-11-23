// The messages between the UI and the match host's Web Worker (M3-03): plain JSON both ways, so they cross
// `postMessage` unchanged. The UI only ever gets what the person's seat is shown (`SeatView`, D-144) and the events it
// saw (`ViewEvent`, D-044): never the match or the game state, which hold the other player's hidden cards.

import type { Action, PlayerId, SeatView, ViewEvent } from "@mtg/engine";

/** From the UI to the worker. */
export type ToWorker =
  /** A new match between two prebuilt decks (by name), the person in `human`'s seat, the heuristic AI in the other. */
  | { type: "start"; decks: [string, string]; seed: number; human: PlayerId }
  /** The person's action, one of `shown.options` from the last update. */
  | { type: "act"; action: Action };

/** From the worker to the UI. */
export type FromWorker =
  /**
   * What the person's seat is shown now, and the events it saw since the last update, in order. `waitingOn` is the
   * person when they must decide, null while no one does (the game is over).
   */
  | { type: "update"; shown: SeatView; events: ViewEvent[]; waitingOn: PlayerId | null }
  /** A message the worker refused: an action that isn't legal now, or a start with an unknown deck. */
  | { type: "error"; message: string };
