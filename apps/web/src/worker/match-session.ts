// The worker's whole job as pure functions: a message in, the session and a reply out. The worker file only wires
// these to `onmessage`, so the logic is tested in Node without a browser. A refused message gets an error reply and
// leaves the session as it was; nothing here throws for something the UI sent.

import { DECKS, type DeckList } from "@mtg/cards";
import { type CardDatabase, type PlayerId, seatView } from "@mtg/engine";
import {
  advance,
  deckGameSetup,
  type MatchState,
  type Seat,
  startMatch,
  submit,
  takeEvents,
  waitingOn,
} from "@mtg/match";
import type { FromWorker, ToWorker } from "./protocol.ts";

/** A match in progress, and whose seat the person plays. */
export type Session = { match: MatchState; human: PlayerId };

export function handle(
  session: Session | null,
  message: ToWorker,
  cards: CardDatabase,
): { session: Session | null; reply: FromWorker } {
  switch (message.type) {
    case "start":
      return start(session, message, cards);
    case "act": {
      if (session === null) return { session, reply: { type: "error", message: "no match has started" } };
      const result = submit(session.match, message.action, cards);
      if (!result.ok) return { session, reply: { type: "error", message: result.error.message } };
      return update({ ...session, match: result.match }, cards);
    }
  }
}

function start(
  session: Session | null,
  message: Extract<ToWorker, { type: "start" }>,
  cards: CardDatabase,
): { session: Session | null; reply: FromWorker } {
  const decks = message.decks.map((name) => DECKS[name]);
  if (decks.some((d) => d === undefined)) {
    return { session, reply: { type: "error", message: `no prebuilt deck ${message.decks.join(" or ")}` } };
  }
  const other: PlayerId = message.human === "p1" ? "p2" : "p1";
  const seats: Record<PlayerId, Seat> = { [message.human]: { kind: "human" }, [other]: { kind: "heuristic" } };
  const setup = deckGameSetup(decks as DeckList[], message.seed, null);
  return update({ match: startMatch(setup, seats, cards), human: message.human }, cards);
}

/** The host acts until the person must decide; the reply is their seat's view and the events they haven't seen. */
function update(session: Session, cards: CardDatabase): { session: Session; reply: FromWorker } {
  const advanced = advance(session.match, cards);
  const { events, match } = takeEvents(advanced, session.human);
  const shown = seatView(match.state, session.human, cards);
  return {
    session: { ...session, match },
    reply: { type: "update", shown, events, waitingOn: waitingOn(match, cards) },
  };
}
