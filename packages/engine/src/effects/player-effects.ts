// Effects on players' cards: drawing several, discarding at random and milling (CR 121, 701.9, 701.17). These aren't
// primitives: each proposes its events to the pipeline with `happen`. The random choices use the game's seeded RNG.

import type { CardDatabase } from "../cards/types.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import { randomInt } from "../rng/xoshiro128.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { zoneList } from "../zones/zone-list.ts";

/**
 * Each player draws `amount` cards, one draw at a time (CR 121.2), all of one player's draws before the next player's
 * (CR 121.2c; the players are given in APNAP order). Each draw is its own event, so a replacement of one draw can act
 * before the next (later: CR 614.11a).
 */
export function drawEach(
  state: GameState,
  players: readonly PlayerId[],
  amount: number,
  cards: CardDatabase,
): Progress {
  let progress: Progress = { state, events: [] };
  for (const player of players) {
    for (let i = 0; i < amount; i++) progress = andThen(progress, (s) => happen(s, { kind: "draw", player }, cards));
  }
  return progress;
}

/**
 * Each player discards `amount` cards at random (CR 701.9b), or their whole hand if it's smaller: as much as possible
 * (CR 609.3). The random picks are made in APNAP order, then every card is discarded at the same time (Burning
 * Inquiry's ruling, CR 101.4). Advancing the RNG is bookkeeping, not a game event (pipeline/README.md).
 */
export function discardAtRandom(
  state: GameState,
  players: readonly PlayerId[],
  amount: number,
  cards: CardDatabase,
): Progress {
  let rng = state.rng;
  const picked: ObjectId[] = [];
  for (const player of players) {
    const hand = [...zoneList(state, { zone: "hand", player })];
    for (let i = 0; i < amount && hand.length > 0; i++) {
      const pick = randomInt(rng, hand.length);
      rng = pick.rng;
      picked.push(...hand.splice(pick.value, 1));
    }
  }
  const next = { ...state, rng };
  if (picked.length === 0) return { state: next, events: [] };
  return happen(
    next,
    { kind: "simultaneous", events: picked.map((object) => ({ kind: "discard", object }) as const) },
    cards,
  );
}

/**
 * Each player mills: the top cards of their library go to their graveyard (CR 701.17a), as many as there are if fewer
 * (CR 701.17b, 609.3; Tome Scour's ruling), all at once. They go in library order, top first (later: CR 404.3 lets
 * their owner order them, Traumatize's ruling). "Half their library, rounded down" is worked out for each player
 * (CR 107.1a).
 */
export function mill(
  state: GameState,
  players: readonly PlayerId[],
  amount: number | "halfTheirLibrary",
  cards: CardDatabase,
): Progress {
  const milled = players.flatMap((player) => {
    const library = zoneList(state, { zone: "library", player });
    const count = amount === "halfTheirLibrary" ? Math.floor(library.length / 2) : amount;
    return library.slice(0, Math.max(0, count));
  });
  if (milled.length === 0) return { state, events: [] };
  const moves = milled.map((object) => ({ kind: "moveCard", object, to: { zone: "graveyard" } }) as const);
  return happen(state, { kind: "simultaneous", events: moves }, cards);
}
