// What the fuzzer checks after every action (docs/testing.md, section 3). Each check returns problems as readable
// messages; none means it holds.

import {
  type CardDatabase,
  eventsFor,
  type GameEvent,
  type GameState,
  layered,
  layeredFresh,
  type ObjectId,
  type PlayerId,
  playerView,
} from "@mtg/engine";
import { invariantProblems } from "@mtg/scenarios";

export type Check = (
  before: GameState,
  after: GameState,
  events: readonly GameEvent[],
  cards: CardDatabase,
) => string[];

/** The engine's invariants: JSON round trip, zones, never stalled, every legal action accepted, no negative mana. */
export const engineInvariants: Check = (_before, after, _events, cards) => invariantProblems(after, cards);

/**
 * Life totals change only through events (CR 119.3): each player's change equals the life gained less the life lost in
 * the events. Paying life (CR 119.4) and setting a total (CR 119.5) will need their events counted too.
 */
export const lifeThroughEvents: Check = (before, after, events) => {
  const problems: string[] = [];
  for (const p of after.turnOrder) {
    const said = events.reduce((n, e) => {
      if (e.type === "LIFE_LOST" && e.player === p) return n - e.amount;
      if (e.type === "LIFE_GAINED" && e.player === p) return n + e.amount;
      return n;
    }, 0);
    const change = (after.players[p]?.life ?? 0) - (before.players[p]?.life ?? 0);
    if (change !== said) problems.push(`${p}'s life changed by ${change}, but the events say ${said}`);
  }
  return problems;
};

/**
 * Views leak nothing (D-044): scrambling what a player can't see leaves their view unchanged, and the events they're
 * shown name no card hidden from them (in another player's hand or library).
 */
export const viewsLeakNothing: Check = (before, after, events) => {
  const problems: string[] = [];
  for (const viewer of after.turnOrder) {
    if (
      JSON.stringify(playerView(scrambleHidden(after, viewer), viewer)) !== JSON.stringify(playerView(after, viewer))
    ) {
      problems.push(`${viewer}'s view changes when only hidden information changes`);
    }
    // A card hidden from the viewer before or after the action must not be named by its card id or its object id,
    // unless the viewer could see it then too: their own draw, a card they saw go into a hand (D-054). That includes a
    // card they saw only during the action, such as one drawn and then discarded by Burning Inquiry. (Not by its
    // oracle id either, but that can't be checked this way: a Mountain in hand shares it with every Mountain out.)
    const shown = JSON.stringify(eventsFor(events, viewer));
    const seen = new Set([
      ...visibleNames(before, viewer),
      ...visibleNames(after, viewer),
      ...arrivedInView(events, viewer),
    ]);
    const hidden = [...hiddenNames(before, viewer), ...hiddenNames(after, viewer)];
    for (const name of new Set(hidden)) {
      if (!seen.has(name) && shown.includes(`"${name}"`)) {
        problems.push(`the events shown to ${viewer} name ${name}, which is hidden from them`);
      }
    }
  }
  return problems;
};

/** The objects `viewer` can see: those in public zones (CR 400.2) and in their own hand (CR 402.3). */
function visibleTo(state: GameState, viewer: PlayerId): ObjectId[] {
  return [
    ...state.zones.battlefield,
    ...state.zones.stack,
    ...state.zones.exile,
    ...state.zones.command,
    ...state.turnOrder.flatMap((p) => state.zones.players[p]?.graveyard ?? []),
    ...(state.zones.players[viewer]?.hand ?? []),
  ];
}

/**
 * The new ids of cards that moved, during the action, into a zone `viewer` can see (public zones, CR 400.2, and their own
 * hand, CR 402.3). Written out here rather than taken from the engine's view, so the check stays independent of it.
 */
function arrivedInView(events: readonly GameEvent[], viewer: PlayerId): string[] {
  return events.flatMap((e) => {
    if (e.type !== "ZONE_CHANGED") return [];
    const visible = e.to.zone === "hand" ? e.to.player === viewer : e.to.zone !== "library";
    return visible ? [e.newId, e.newCardId] : [];
  });
}

/** The ids `viewer` may know: of the objects they can see, and of their own card being cast. */
function visibleNames(state: GameState, viewer: PlayerId): string[] {
  const casting = castingCard(state);
  return [...namesOf(state, visibleTo(state, viewer)), ...(casting?.player === viewer ? casting.names : [])];
}

/** The ids hidden from `viewer`: of hidden objects, and of another player's card being cast (it's in no zone). */
function hiddenNames(state: GameState, viewer: PlayerId): string[] {
  const casting = castingCard(state);
  return [
    ...namesOf(state, hiddenFrom(state, viewer)),
    ...(casting !== null && casting.player !== viewer ? casting.names : []),
  ];
}

/** While a spell is being cast, the card as it was in hand is kept aside (D-035): its object id and card id. */
function castingCard(state: GameState): { player: PlayerId; names: string[] } | null {
  const origin = state.casting?.origin;
  if (state.casting === null || origin?.kind !== "card") return null;
  return { player: state.casting.player, names: [origin.card.id, origin.card.cardId] };
}

/** The names that identify these objects: their object ids and, for cards, their card ids. */
function namesOf(state: GameState, ids: readonly ObjectId[]): string[] {
  return ids.flatMap((id) => {
    const obj = state.objects[id];
    return obj?.kind === "card" ? [id, obj.cardId] : [id];
  });
}

/** The objects hidden from `viewer`: other players' hands, and every library, their own too (CR 401.2, 402.3). */
function hiddenFrom(state: GameState, viewer: PlayerId): ObjectId[] {
  return state.turnOrder.flatMap((p) => [
    ...(p === viewer ? [] : (state.zones.players[p]?.hand ?? [])),
    ...(state.zones.players[p]?.library ?? []),
  ]);
}

/**
 * The same state with everything `viewer` can't see changed: hidden cards' ids, names and card ids, the order of every
 * library and of other hands, another player's casting details and pending choices, the seed, RNG and internals.
 */
export function scrambleHidden(state: GameState, viewer: PlayerId): GameState {
  const hidden = hiddenObjects(state, viewer);
  // A hidden object's id is renamed everywhere it appears (zone lists, object keys, picks in a pending decision), in
  // reverse order, so a view that names one, or shows the order of their ids (which records how they got there, D-062),
  // changes.
  const renamed = new Map(hidden.map((id, i) => [id as string, `o${1_000_000 + hidden.length - 1 - i}`]));
  const json = JSON.stringify(state).replace(/"o(\d+)"/g, (whole, n: string) => {
    const to = renamed.get(`o${n}`);
    return to === undefined ? whole : `"${to}"`;
  });
  const scrambled = JSON.parse(json) as GameState;
  // Cards the viewer's own decision shows them keep what they are (D-062): only their ids and history change.
  const shown = new Set(shownBy(state, viewer).flatMap((id) => renamed.get(id) ?? []));
  const objects = { ...scrambled.objects };
  for (const [i, id] of hidden.entries()) {
    const newId = renamed.get(id) as ObjectId;
    const obj = objects[newId];
    if (obj?.kind === "card") {
      const oracleId = shown.has(newId) ? obj.oracleId : `scrambled-${i}`;
      objects[newId] = { ...obj, oracleId, cardId: `c${900_000 + i}`, timestamp: obj.timestamp + 1 };
    }
  }
  const players = { ...scrambled.zones.players };
  for (const p of scrambled.turnOrder) {
    const z = players[p];
    if (z === undefined) continue;
    players[p] = { ...z, library: [...z.library].reverse(), hand: p === viewer ? z.hand : [...z.hand].reverse() };
  }
  const casting = scrambled.casting;
  const pending = scrambled.pending;
  return {
    ...scrambled,
    objects,
    zones: { ...scrambled.zones, players },
    casting:
      casting === null || casting.player === viewer
        ? casting
        : {
            ...casting,
            origin:
              casting.origin.kind === "card"
                ? { ...casting.origin, handIndex: casting.origin.handIndex + 1 }
                : casting.origin,
            poolBefore: { ...casting.poolBefore, C: casting.poolBefore.C + 1 },
          },
    // Another player's decision with a detail the view must not show (a pick so far, say).
    pending:
      pending === null || pending.player === viewer
        ? pending
        : ({ ...pending, scrambled: true } as unknown as typeof pending),
    rng: [scrambled.rng[0] ^ 0x5a5a5a5a, scrambled.rng[1] ^ 1, scrambled.rng[2], scrambled.rng[3]],
    setup: { ...scrambled.setup, seed: scrambled.setup.seed + 1, players: [] },
    nextId: scrambled.nextId + 1000,
    nextTimestamp: scrambled.nextTimestamp + 1000,
    nextCardId: scrambled.nextCardId + 1000,
    work: [],
  };
}

/** The cards a `chooseCards` decision of the viewer's offers them: they may see what those are (D-062). */
function shownBy(state: GameState, viewer: PlayerId): ObjectId[] {
  const pending = state.pending;
  return pending?.kind === "chooseCards" && pending.player === viewer ? pending.options : [];
}

/** Every library's objects, and other players' hands. */
function hiddenObjects(state: GameState, viewer: PlayerId): ObjectId[] {
  return state.turnOrder.flatMap((p) => [
    ...(state.zones.players[p]?.library ?? []),
    ...(p === viewer ? [] : (state.zones.players[p]?.hand ?? [])),
  ]);
}

/**
 * The layer pass kept for a state (D-092) is what a fresh pass gives: the pass reads only its inputs, by which it's
 * kept, and the state is never changed in place.
 */
export const layersMatchFreshPass: Check = (_before, after, _events, cards) =>
  JSON.stringify(layered(after, cards)) === JSON.stringify(layeredFresh(after, cards))
    ? []
    : ["the layer pass kept for this state differs from a fresh one (D-092)"];

export const ALL_CHECKS: readonly Check[] = [
  engineInvariants,
  lifeThroughEvents,
  viewsLeakNothing,
  layersMatchFreshPass,
];
