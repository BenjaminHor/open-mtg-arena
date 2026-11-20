// Effects on libraries and graveyards (M2-05b2b): searching, looking at the top and putting back, shuffling, and
// "this way" results kept for the effects after them (`GameState.resolution`, CR 608.2c). Cards seen in a library are
// shown by identity only, in a fixed order (D-062).

import type { CardDatabase, Effect, ObjectFilter } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import { zoneChangeOf } from "../pipeline/moved.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState, Resolution } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { zoneList, zoneOf } from "../zones/zone-list.ts";
import { askToChoose, seenOf } from "./choose-cards.ts";

type Search = Extract<Effect, { op: "search" }>;
type LookAtTop = Extract<Effect, { op: "lookAtTop" }>;
type MayShuffle = Extract<Effect, { op: "mayShuffle" }>;

const nothing = (state: GameState): Progress => ({ state, events: [] });

/**
 * "You" search `owner`'s library: look at all of it (CR 701.23a), shown by identity, and choose. The cards found are
 * kept as `found` for the effects after it; the search itself moves nothing. Asked whenever the library has cards,
 * even if none fits: the library is hidden, so skipping would tell what it lacks (D-062). An empty library is public
 * (CR 401.3). With a stated quality, finding none is allowed (CR 701.23b); "a card" must be found (CR 701.23d).
 * "All cards with the same name as a card exiled this way" searches only if something was exiled (D-063): the
 * graveyard was public, so not searching tells nothing.
 */
export function search(
  state: GameState,
  owner: PlayerId,
  effect: Search,
  context: EffectContext,
  chosen: readonly ObjectId[] | null,
  cards: CardDatabase,
): Progress {
  const from = { zone: "library", player: owner } as const;
  const library = zoneList(state, from);
  if (chosen !== null) return nothing(remember(state, { found: chosen.filter((id) => library.includes(id)) }));
  const named = effect.sameNameAsExiled === true ? exiledNames(state, cards) : null;
  if (library.length === 0 || named?.length === 0) return nothing(remember(state, { found: [] }));
  const options = library.filter(
    (id) =>
      (effect.filter === undefined || matchesFilter(state, id, effect.filter, context.controller, cards)) &&
      (named === null || named.includes(nameOf(state, id, cards))),
  );
  const anyNumber = effect.count === "anyNumber";
  const stated = effect.filter !== undefined || named !== null;
  return nothing(
    askToChoose(state, {
      chooser: context.controller,
      purpose: "search",
      options,
      // "Any number" may be none; "a card" with no stated quality must be found (CR 701.23b, 701.23d).
      min: stated || anyNumber ? 0 : Math.min(1, options.length),
      max: anyNumber ? options.length : 1,
      endsOnlyOnFinish: anyNumber,
      seen: seenOf(state, from, library),
      effect,
      context,
    }),
  );
}

/**
 * "Look at the top N cards of your library, then put them back in any order": the player is shown them (CR 701.20e)
 * and puts them back one at a time, top first (CR 401.4). Asked even for one card, or they'd never see it. Reordering
 * the cards doesn't make them new objects here (later: CR 701.20d).
 */
export function lookAtTop(
  state: GameState,
  player: PlayerId,
  effect: LookAtTop,
  context: EffectContext,
  chosen: readonly ObjectId[] | null,
  cards: CardDatabase,
): Progress {
  const from = { zone: "library", player } as const;
  if (chosen !== null) return happen(state, { kind: "reorderLibrary", player, top: [...chosen] }, cards);
  const top = zoneList(state, from).slice(0, Math.max(0, effect.count));
  if (top.length === 0) return nothing(state);
  const count = top.length;
  return nothing(
    askToChoose(state, {
      chooser: player,
      purpose: "putOnTop",
      options: top,
      min: count,
      max: count,
      seen: seenOf(state, from, top),
      effect,
      context,
    }),
  );
}

/** "You may shuffle": `player` answers yes or no; yes queues the shuffle (CR 701.24a), no does nothing. */
export function mayShuffle(state: GameState, player: PlayerId, effect: MayShuffle, context: EffectContext): Progress {
  const resume = { effect: { op: "shuffle", who: effect.who } as const, context };
  return nothing(waitFor(state, player, { kind: "chooseYesNo", purpose: "shuffle", resume }));
}

/**
 * Each player shuffles their library (CR 701.24a), even an empty one: `LIBRARY_SHUFFLED` is still emitted, the event
 * "whenever a player shuffles" triggers will see (CR 701.24e).
 */
export function shuffleEach(state: GameState, players: readonly PlayerId[], cards: CardDatabase): Progress {
  return players.reduce<Progress>(
    (p, player) => andThen(p, (s) => happen(s, { kind: "shuffle", player }, cards)),
    nothing(state),
  );
}

/**
 * "Exile all cards from [player]'s graveyard [other than ...]": all at once, and the cards exiled this way are kept
 * as `exiled` for the effects after it (CR 608.2c). Exiled cards are public (CR 406.3).
 */
export function exileGraveyard(
  state: GameState,
  player: PlayerId,
  filter: ObjectFilter | undefined,
  you: PlayerId,
  cards: CardDatabase,
): Progress {
  const graveyard = zoneList(state, { zone: "graveyard", player });
  const exiled = graveyard.filter((id) => filter === undefined || matchesFilter(state, id, filter, you, cards));
  if (exiled.length === 0) return nothing(remember(state, { exiled: [] }));
  const moves = exiled.map((object) => ({ kind: "moveCard", object, to: { zone: "exile" } }) as const);
  const moved = happen(state, { kind: "simultaneous", events: moves }, cards);
  const newIds = exiled.flatMap((id) => {
    const change = zoneChangeOf(moved.events, id);
    return change !== null && change.to.zone === "exile" ? [change.newId] : [];
  });
  return { state: remember(moved.state, { exiled: newIds }), events: moved.events };
}

/** Reveals these objects (CR 701.20a), zone by zone; they stay where they are (CR 701.20b). */
export function revealObjects(state: GameState, ids: readonly ObjectId[], cards: CardDatabase): Progress {
  const present = ids.filter((id) => state.objects[id] !== undefined);
  const key = (id: ObjectId) => JSON.stringify(zoneOf(state, id));
  const zones = present.filter((id, i) => present.findIndex((other) => key(other) === key(id)) === i);
  return zones.reduce<Progress>((p, first) => {
    const inZone = present.filter((id) => key(id) === key(first));
    return andThen(p, (s) => happen(s, { kind: "reveal", from: zoneOf(state, first), objects: inZone }, cards));
  }, nothing(state));
}

/**
 * The names of the cards exiled this way so far: "the same name" (CR 201.2a). One name per card for now; split and
 * double-faced cards have more (later: CR 201.2a's "at least one name in common").
 */
function exiledNames(state: GameState, cards: CardDatabase): string[] {
  return (state.resolution?.exiled ?? []).map((id) => nameOf(state, id, cards));
}

function nameOf(state: GameState, id: ObjectId, cards: CardDatabase): string {
  const obj = state.objects[id];
  return obj?.kind === "card" ? (cards[obj.oracleId]?.printed.name ?? obj.oracleId) : "";
}

/** Keeps a "this way" result for the rest of this resolution (CR 608.2c). */
function remember(state: GameState, result: Partial<Omit<Resolution, "object">>): GameState {
  if (state.resolution === null) return state;
  return { ...state, resolution: { ...state.resolution, ...result } };
}
