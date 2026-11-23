// The worker's whole job as pure functions: a message in, the session and a reply out. The worker file only wires
// these to `onmessage`, so the logic is tested in Node without a browser. A refused message, or a failure while acting
// on it, gets an error reply and leaves the session as it was: nothing here throws.

import { DECKS, type DeckList } from "@mtg/cards";
import { type CardDatabase, type GameSetup, type PlayerId, seatView, type ViewEvent } from "@mtg/engine";
import {
  advanceOne,
  DEFAULT_SETTINGS,
  deckGameSetup,
  HostStuck,
  type MatchState,
  type Seat,
  startMatch,
  submit,
  takeEvents,
  waitingOn,
  withSettings,
} from "@mtg/match";
import { frameHold } from "../interaction/pacing.ts";
import type { Frame, FromWorker, ToWorker } from "./protocol.ts";

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
      return update({ ...session, match: withSettings(match, human, { ...settings, autoPass: !message.on }) }, cards);
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

/** Enough frames for any one reply (a long opponent turn has a few dozen); past it, the rest fold into the last view. */
const MOST_FRAMES = 80;
/** As the host's own `advance`: reaching this many actions without a person deciding means it's stuck in a loop. */
const MOST_ACTIONS = 100_000;

/**
 * The host acts until the person must decide; the reply is their seat's view and the events they haven't seen. On the
 * way, a frame is kept wherever something worth a moment's look happened (`interaction/pacing.ts`): the seat view just
 * after it and the events since the last frame, so the app can show the run in order rather than jump to its end
 * (D-172). The frames' events and the reply's own, in order, are every event the person saw.
 */
function update(session: Session, cards: CardDatabase): { session: Session; reply: FromWorker } {
  const human = session.human;
  let match = session.match;
  const frames: Frame[] = [];
  let since: ViewEvent[] = [];
  const take = (next: typeof match) => {
    const taken = takeEvents(next, human);
    match = taken.match;
    since = [...since, ...taken.events];
    return taken.events;
  };
  // The person's own action's events, before the host acts.
  take(match);
  for (let i = 0; ; i++) {
    if (i === MOST_ACTIONS) throw new HostStuck(`the host took ${MOST_ACTIONS} actions without anyone deciding`);
    const next = advanceOne(match, cards);
    if (next === null) break;
    const events = take(next);
    if (frames.length < MOST_FRAMES && frameHold(events, human) > 0) {
      frames.push({ shown: seatView(match.state, human, cards), events: since });
      since = [];
    }
  }
  const shown = seatView(match.state, human, cards);
  return {
    session: { ...session, match },
    reply: {
      type: "update",
      frames,
      shown,
      events: since,
      waitingOn: waitingOn(match, cards),
      fullControl: match.settings[human]?.autoPass === false,
    },
  };
}
