// The worker's whole job as pure functions: a message in, the session and a reply out. The worker file only wires
// these to `onmessage`, so the logic is tested in Node without a browser. A refused message, or a failure while acting
// on it, gets an error reply and leaves the session as it was: nothing here throws.

import { DECKS, type DeckList } from "@mtg/cards";
import { type CardDatabase, type GameSetup, type PlayerId, seatView } from "@mtg/engine";
import {
  advance,
  DEFAULT_SETTINGS,
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
  try {
    return handleMessage(session, message, cards);
  } catch (error) {
    // An engine or host failure (`HostStuck`, a refused host action) is reported, never left to hang the UI.
    return { session, reply: { type: "error", message: error instanceof Error ? error.message : String(error) } };
  }
}

function handleMessage(
  session: Session | null,
  message: ToWorker,
  cards: CardDatabase,
): { session: Session | null; reply: FromWorker } {
  switch (message.type) {
    case "start":
      return start(session, message, cards);
    case "startFrom":
      return startFrom(session, message.setup, message.human, cards);
    case "act": {
      if (session === null) return { session, reply: { type: "error", message: "no match has started" } };
      const result = submit(session.match, message.action, cards);
      if (!result.ok) return { session, reply: { type: "error", message: result.error.message } };
      return update({ ...session, match: result.match }, cards);
    }
    case "fullControl": {
      if (session === null) return { session, reply: { type: "error", message: "no match has started" } };
      const { match, human } = session;
      const settings = match.settings[human] ?? DEFAULT_SETTINGS;
      // Turned off, the host may pass at once where the person has nothing to do, as auto-pass always would.
      return update(
        {
          ...session,
          match: { ...match, settings: { ...match.settings, [human]: { ...settings, autoPass: !message.on } } },
        },
        cards,
      );
    }
    default: {
      // A message from something other than this app's client: refused, while every known type stays checked.
      const unknown: never = message;
      return { session, reply: { type: "error", message: `unknown message ${JSON.stringify(unknown)}` } };
    }
  }
}

function start(
  session: Session | null,
  message: Extract<ToWorker, { type: "start" }>,
  cards: CardDatabase,
): { session: Session | null; reply: FromWorker } {
  const unknown = message.decks.filter((name) => !Object.hasOwn(DECKS, name));
  if (unknown.length > 0)
    return { session, reply: { type: "error", message: `no prebuilt deck ${unknown.join(", ")}` } };
  if (!Number.isSafeInteger(message.seed) || message.seed < 0) {
    return { session, reply: { type: "error", message: `a seed is a whole number, 0 or more: ${message.seed}` } };
  }
  const decks = message.decks.map((name) => DECKS[name] as DeckList);
  return startFrom(session, deckGameSetup(decks, message.seed, null), message.human, cards);
}

/** A match from this setup: the person in `human`'s seat, the heuristic AI in every other. */
function startFrom(
  session: Session | null,
  setup: GameSetup,
  human: PlayerId,
  cards: CardDatabase,
): { session: Session | null; reply: FromWorker } {
  const players = setup.players.map((p) => p.id);
  if (!players.includes(human)) return { session, reply: { type: "error", message: `no seat ${human}` } };
  const seats: Record<PlayerId, Seat> = Object.fromEntries(
    players.map((p): [PlayerId, Seat] => [p, p === human ? { kind: "human" } : { kind: "heuristic" }]),
  );
  return update({ match: startMatch(setup, seats, cards), human }, cards);
}

/** The host acts until the person must decide; the reply is their seat's view and the events they haven't seen. */
function update(session: Session, cards: CardDatabase): { session: Session; reply: FromWorker } {
  const advanced = advance(session.match, cards);
  const { events, match } = takeEvents(advanced, session.human);
  const shown = seatView(match.state, session.human, cards);
  return {
    session: { ...session, match },
    reply: {
      type: "update",
      shown,
      events,
      waitingOn: waitingOn(match, cards),
      fullControl: match.settings[session.human]?.autoPass === false,
    },
  };
}
