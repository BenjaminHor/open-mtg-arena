// One match as plain JSON data (M3-01): the game, who sits in each seat, each seat's settings, the log of every action
// taken (the host's own included), and the events each player hasn't been sent yet. The host's functions take a match
// and give a new one; nothing here waits or calls back (the engine's rule, kept by the host too).

import type { AgentName } from "@mtg/ai";
import {
  type Action,
  type CardDatabase,
  createGame,
  eventsFor,
  type GameEvent,
  type GameSetup,
  type GameState,
  type PlayerId,
  type ViewEvent,
} from "@mtg/engine";

/** Who decides for a player: a person (through the UI), or a built-in agent the host runs. */
export type Seat = { kind: "human" } | { kind: "agent"; agent: AgentName; random: number };

/** What the host does on a seat's behalf (the player's settings in the app). */
export type SeatSettings = {
  /** Pass priority when there's nothing the player could do (`auto-pass.ts`); off is full control. */
  autoPass: boolean;
  /** Pay costs with the host's pick of mana sources (`auto-tap.ts`); off, the player taps by hand. */
  autoTap: boolean;
};

export type MatchState = {
  setup: GameSetup;
  /** Every action applied, in order: with the setup, the whole match (the replay log and the bug report). */
  actions: Action[];
  state: GameState;
  seats: Record<PlayerId, Seat>;
  settings: Record<PlayerId, SeatSettings>;
  /** The events each person's seat saw (`eventsFor`) and hasn't been sent yet; an agent's aren't kept. */
  unsent: Record<PlayerId, ViewEvent[]>;
};

/** Auto-pass and auto-tap on, as Arena plays by default. */
export const DEFAULT_SETTINGS: SeatSettings = { autoPass: true, autoTap: true };

/** A new match from a setup, each player's seat, and settings (the defaults for anyone left out). */
export function startMatch(
  setup: GameSetup,
  seats: Record<PlayerId, Seat>,
  cards: CardDatabase,
  settings: Partial<Record<PlayerId, SeatSettings>> = {},
): MatchState {
  const created = createGame(setup, cards);
  if (!created.ok) throw new Error(`the setup is rejected: ${created.error.message}`);
  const players = created.state.turnOrder;
  for (const p of players) if (seats[p] === undefined) throw new Error(`no seat for ${p}`);
  const match: MatchState = {
    setup,
    actions: [],
    state: created.state,
    seats,
    settings: Object.fromEntries(players.map((p) => [p, settings[p] ?? DEFAULT_SETTINGS])),
    unsent: Object.fromEntries(players.filter((p) => seats[p]?.kind === "human").map((p) => [p, []])),
  };
  return withEvents(match, created.events);
}

/** The events each person's seat sees, queued to be sent (an agent reads the game through its view as it decides). */
export function withEvents(match: MatchState, events: readonly GameEvent[]): MatchState {
  if (events.length === 0) return match;
  const unsent: Record<PlayerId, ViewEvent[]> = {};
  for (const p of Object.keys(match.unsent) as PlayerId[]) {
    unsent[p] = [...(match.unsent[p] ?? []), ...eventsFor(events, p)];
  }
  return { ...match, unsent };
}

/** Takes a player's unsent events, for the host to post: the events, and the match without them. */
export function takeEvents(match: MatchState, player: PlayerId): { events: ViewEvent[]; match: MatchState } {
  return { events: match.unsent[player] ?? [], match: { ...match, unsent: { ...match.unsent, [player]: [] } } };
}
