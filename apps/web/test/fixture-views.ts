// Seat views for the web app's tests: each fixture board as the person (p1) is first shown it, through the worker's
// own session logic, so the tests see exactly what the app would draw.

import { cardDatabase } from "@mtg/cards";
import type { Action, SeatView } from "@mtg/engine";
import { type Fixture, fixtureSetup, setupOf } from "../src/fixtures/fixtures.ts";
import { handle, type Session } from "../src/worker/match-session.ts";
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

/**
 * A match played from a board by the test's own actions, the person's seat in full control (the host never passes
 * for them), so a test can put several objects on the stack itself rather than wait for the AI to. `act` sends the
 * first option whose action matches, and fails when none does.
 */
export function playFrom(fixture: Fixture): {
  shown: () => SeatView;
  act: (matches: (action: Action) => boolean, what: string) => SeatView;
} {
  let session: Session | null = null;
  let shown: SeatView | null = null;
  const send = (message: ToWorker): SeatView => {
    const result = handle(session, message, cards);
    session = result.session;
    if (result.reply.type !== "update") throw new Error(result.reply.message);
    shown = result.reply.shown;
    return shown;
  };
  send({ type: "startFrom", setup: setupOf(fixture), human: "p1" });
  send({ type: "fullControl", on: true });
  const now = () => {
    if (shown === null) throw new Error("not started");
    return shown;
  };
  return {
    shown: now,
    act: (matches, what) => {
      const option = now().options.find((o) => matches(o.action));
      if (option === undefined) throw new Error(`no option to ${what}`);
      return send({ type: "act", action: option.action });
    },
  };
}
