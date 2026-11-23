// Seat views for the web app's tests: each fixture board as the person (p1) is first shown it, through the worker's
// own session logic, so the tests see exactly what the app would draw.

import { cardDatabase } from "@mtg/cards";
import type { SeatView } from "@mtg/engine";
import { type Fixture, fixtureSetup, setupOf } from "../src/fixtures/fixtures.ts";
import { handle } from "../src/worker/match-session.ts";
import type { ToWorker } from "../src/worker/protocol.ts";

export const cards = cardDatabase();

export function shownAt(message: ToWorker): SeatView {
  const reply = handle(null, message, cards).reply;
  if (reply.type !== "update") throw new Error(reply.message);
  return reply.shown;
}

export function fixtureView(name: string): SeatView {
  const setup = fixtureSetup(name);
  if (setup === null) throw new Error(`no fixture ${name}`);
  return shownAt({ type: "startFrom", setup, human: "p1" });
}

export function mulliganView(): SeatView {
  return shownAt({ type: "start", decks: ["red-green-beats", "white-soldiers"], seed: 7, human: "p1" });
}

/** A board the test writes itself, as the person is first shown it. */
export function boardView(fixture: Fixture): SeatView {
  return shownAt({ type: "startFrom", setup: setupOf(fixture), human: "p1" });
}
