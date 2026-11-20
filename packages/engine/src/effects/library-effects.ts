// Effects on libraries and graveyards (M2-05b2b): searching, looking at the top and putting back, shuffling, and
// "this way" results kept for the effects after them (`GameState.resolution`, CR 608.2c). Cards seen in a library are
// shown by identity only, in a fixed order (D-062).

import type { CardDatabase, Effect, ObjectFilter } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import { zoneChangeOf } from "../pipeline/moved.ts";
import { characteristics } from "../rules/characteristics.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState, Resolution } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { zoneList, zoneOf } from "../zones/zone-list.ts";
import { askToChoose, fittingCards, nothing, seenOf } from "./choose-cards.ts";

type Search = Extract<Effect, { op: "search" }>;
type LookAtTop = Extract<Effect, { op: "lookAtTop" }>;
type MayShuffle = Extract<Effect, { op: "mayShuffle" }>;

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
  const fitting = fittingCards(state, library, effect.filter, context.controller, cards);
  const options = fitting.filter((id) => named === null || sameNameAsAny(state, id, named, cards));
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
  const shuffle = { op: "shuffle", who: effect.who } as const;
  const resume = [{ kind: "runEffect", effect: shuffle, context, chosen: null } as const];
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
  const exiled = fittingCards(state, graveyard, filter, you, cards);
  if (exiled.length === 0) return nothing(remember(state, { exiled: [] }));
  const moves = exiled.map((object) => ({ kind: "moveCard", object, to: { zone: "exile" } }) as const);
  const moved = happen(state, { kind: "simultaneous", events: moves }, cards);
  const newIds = exiled.flatMap((id) => {
    const change = zoneChangeOf(moved.events, id);
    return change !== null && change.to.zone === "exile" ? [change.newId] : [];
  });
  return { state: remember(moved.state, { exiled: newIds }), events: moved.events };
}

/**
 * "Reveal the top card of your library": shown to every player, staying on top (CR 701.20a, 701.20b), and kept as
 * `found` ("it", "that card") for the effects after it (CR 608.2c). An empty library reveals nothing.
 */
export function revealTop(state: GameState, player: PlayerId, cards: CardDatabase): Progress {
  const top = zoneList(state, { zone: "library", player })[0];
  if (top === undefined) return nothing(remember(state, { found: [] }));
  const revealed = revealObjects(state, [top], cards);
  return { state: remember(revealed.state, { found: [top] }), events: revealed.events };
}

/**
 * "Reveals cards from the top of their library until they reveal a [filter] card" (Polymorph): the cards from the top
 * down to the first that fits, or the whole library if none does, revealed together (CR 701.20a); they stay in the
 * library (CR 701.20b). The card that fits, if any, is `"found"` (CR 608.2c).
 */
export function revealUntil(state: GameState, player: PlayerId, filter: ObjectFilter, cards: CardDatabase): Progress {
  const library = zoneList(state, { zone: "library", player });
  // A card in a library has no controller; "you" is its owner, who reveals it (CR 108.4a).
  const at = library.findIndex((id) => matchesFilter(state, id, filter, player, cards));
  const revealed = at === -1 ? library : library.slice(0, at + 1);
  const shown = revealObjects(state, revealed, cards);
  const found = at === -1 ? [] : [library[at] as ObjectId];
  return { state: remember(shown.state, { found }), events: shown.events };
}

/**
 * Reveals these objects (CR 701.20a); they stay where they are (CR 701.20b). They're in one zone, as everything a
 * search finds is in the library searched.
 */
export function revealObjects(state: GameState, ids: readonly ObjectId[], cards: CardDatabase): Progress {
  const [first] = ids;
  if (first === undefined) return nothing(state);
  const from = zoneOf(state, first);
  if (ids.some((id) => JSON.stringify(zoneOf(state, id)) !== JSON.stringify(from)))
    throw new Error("revealing cards from several zones at once isn't supported");
  return happen(state, { kind: "reveal", from, objects: [...ids] }, cards);
}

/**
 * The names of the cards exiled this way so far, read through `characteristics()` (layer 1 copies change a name).
 * A card without a name (face down, later: CR 708.2) has none to share.
 */
function exiledNames(state: GameState, cards: CardDatabase): string[] {
  return (state.resolution?.exiled ?? []).flatMap((id) => nameOf(state, id, cards) ?? []);
}

/**
 * Whether the card has the same name as one of these (CR 201.2a): one name per card for now; split and double-faced
 * cards have more (later: CR 201.2a, "at least one name in common"). An object with no name shares none.
 */
function sameNameAsAny(state: GameState, id: ObjectId, names: readonly string[], cards: CardDatabase): boolean {
  const name = nameOf(state, id, cards);
  return name !== null && names.includes(name);
}

function nameOf(state: GameState, id: ObjectId, cards: CardDatabase): string | null {
  const name = characteristics(state, id, cards).name;
  return name === "" ? null : name;
}

/**
 * Keeps a "this way" result for the rest of this resolution (CR 608.2c). Bookkeeping, not an event: the events that
 * did it already went through the pipeline. Only a resolving spell or ability has one (pipeline/README.md).
 */
function remember(state: GameState, result: Partial<Omit<Resolution, "object">>): GameState {
  if (state.resolution === null) throw new Error('a "this way" result outside a resolution');
  return { ...state, resolution: { ...state.resolution, ...result } };
}
