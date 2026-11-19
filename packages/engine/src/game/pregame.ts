// The start of a standard game (CR 103): choosing the starting player, shuffling, opening hands and mulligans.

import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Pregame } from "../state/pregame.ts";
import { drawCards } from "../zones/draw.ts";
import { moveCard } from "../zones/move-card.ts";
import { shuffleLibrary } from "../zones/shuffle.ts";
import { zoneList } from "../zones/zone-list.ts";
import { waitFor } from "./decide.ts";
import { beginFirstTurn } from "./first-turn.ts";
import { andThen, type Progress } from "./progress.ts";
import { STARTING_HAND_SIZE } from "./setup-validation.ts";

/**
 * The starting player is decided (CR 103.1). Turn order starts with them and follows the seating order. Then each
 * library is shuffled (CR 103.3), each player draws their opening hand (CR 103.5), and mulligans begin.
 */
export function setStartingPlayer(state: GameState, player: PlayerId, chosenBy: PlayerId | null): Progress {
  const seats = state.turnOrder;
  const at = seats.indexOf(player);
  const turnOrder = [...seats.slice(at), ...seats.slice(0, at)];
  let progress: Progress = {
    state: { ...state, turnOrder, pregame: { ...pregameOf(state), startingPlayer: player } },
    events: [{ type: "STARTING_PLAYER_CHOSEN", player, chosenBy }],
  };
  for (const p of turnOrder) progress = andThen(progress, (s) => shuffleLibrary(s, p));
  for (const p of turnOrder) progress = andThen(progress, (s) => drawCards(s, p, STARTING_HAND_SIZE));
  return andThen(progress, nextDeclaration);
}

/** Whether a player may still take a mulligan: not once their opening hand would be zero cards (CR 103.5). */
export function canMulligan(state: GameState, player: PlayerId): boolean {
  return (pregameOf(state).mulligans[player] ?? 0) < STARTING_HAND_SIZE;
}

/** A player declares keep or mulligan (CR 103.5). */
export function declareMulligan(state: GameState, player: PlayerId, choice: "keep" | "mulligan"): Progress {
  const pregame = pregameOf(state);
  const next: Pregame = {
    ...pregame,
    declarations: [...pregame.declarations, { player, choice }],
    kept: choice === "keep" ? [...pregame.kept, player] : pregame.kept,
  };
  return andThen(
    { state: { ...state, pregame: next }, events: [{ type: "MULLIGAN_DECLARED", player, choice }] },
    nextDeclaration,
  );
}

/** A player puts one card from their hand on the bottom of their library, below any put there before it. */
export function putOnBottom(state: GameState, player: PlayerId, object: ObjectId): Progress {
  const pregame = pregameOf(state);
  const moved = moveCard(state, object, { zone: "library", position: "bottom" });
  const [first, ...rest] = pregame.bottom;
  const remaining = (first?.remaining ?? 1) - 1;
  const bottom = remaining > 0 ? [{ player, remaining }, ...rest] : rest;
  return andThen(
    { state: { ...moved.state, pregame: { ...pregame, bottom } }, events: moved.events },
    nextBottomOrRound,
  );
}

/**
 * Asks the next player in turn order who hasn't kept or declared this round. When everyone has declared, everyone
 * who chose to mulligan does so at the same time (CR 103.5).
 */
function nextDeclaration(state: GameState): Progress {
  const pregame = pregameOf(state);
  const declared = pregame.declarations.map((d) => d.player);
  const next = state.turnOrder.find((p) => !pregame.kept.includes(p) && !declared.includes(p));
  if (next !== undefined) {
    return {
      state: waitFor(state, next, { kind: "mulligan", mulligansTaken: pregame.mulligans[next] ?? 0 }),
      events: [],
    };
  }
  return takeMulligans(state);
}

/**
 * Each player who chose to mulligan shuffles their hand into their library, draws a new hand, then puts as many cards
 * on the bottom as the number of mulligans they've now taken (CR 103.5).
 */
function takeMulligans(state: GameState): Progress {
  const pregame = pregameOf(state);
  const takers = state.turnOrder.filter((p) =>
    pregame.declarations.some((d) => d.player === p && d.choice === "mulligan"),
  );
  let progress: Progress = { state, events: [] };
  for (const player of takers) {
    for (const card of zoneList(progress.state, { zone: "hand", player })) {
      progress = andThen(progress, (s) => moveCard(s, card, { zone: "library", position: "top" }));
    }
    progress = andThen(progress, (s) => shuffleLibrary(s, player));
    progress = andThen(progress, (s) => drawCards(s, player, STARTING_HAND_SIZE));
  }
  const mulligans = { ...pregame.mulligans };
  for (const player of takers) mulligans[player] = (mulligans[player] ?? 0) + 1;
  // Players who mulligan together put cards on the bottom at the same time. With no active player yet, their choices
  // are taken in turn order from the starting player (the order CR 101.4 uses for simultaneous choices).
  const bottom = takers.map((player) => ({ player, remaining: mulligans[player] ?? 0 }));
  const next: Pregame = { ...pregame, mulligans, declarations: [], bottom };
  return andThen({ state: { ...progress.state, pregame: next }, events: progress.events }, nextBottomOrRound);
}

/** After a round's mulligans: cards still to put on the bottom, else the next round, else the first turn. */
function nextBottomOrRound(state: GameState): Progress {
  const pregame = pregameOf(state);
  const first = pregame.bottom[0];
  if (first !== undefined) {
    return { state: waitFor(state, first.player, { kind: "mulliganBottom", remaining: first.remaining }), events: [] };
  }
  // The process repeats until no player takes a mulligan (CR 103.5).
  if (state.turnOrder.every((p) => pregame.kept.includes(p))) return beginFirstTurn(state);
  return nextDeclaration(state);
}

export function pregameOf(state: GameState): Pregame {
  if (state.pregame === null) throw new Error("The game has already started");
  return state.pregame;
}
