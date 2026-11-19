// What the fuzzer checks after every action (docs/testing.md, section 3). Each check returns problems as readable
// messages; none means it holds.

import {
  type CardDatabase,
  eventsFor,
  type GameEvent,
  type GameState,
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
 * Life totals change only through events (CR 119.3): each player's change equals the life lost in the events. In the
 * M1 pool all of it is damage (CR 120.3a); paying life (CR 119.4), setting a total (CR 119.5) and life gain will need
 * their events counted too.
 */
export const lifeThroughEvents: Check = (before, after, events) => {
  const problems: string[] = [];
  for (const p of after.turnOrder) {
    const lost = events.reduce((n, e) => n + (e.type === "LIFE_LOST" && e.player === p ? e.amount : 0), 0);
    const change = (after.players[p]?.life ?? 0) - (before.players[p]?.life ?? 0);
    if (change !== -lost) problems.push(`${p}'s life changed by ${change}, but the events say ${-lost}`);
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
    // unless the viewer could see it then too: their own draw, a card they saw go into a hand (D-054). (Not by its
    // oracle id either, but that can't be checked this way: a Mountain in hand shares it with every Mountain out.)
    const shown = JSON.stringify(eventsFor(events, viewer));
    const seen = new Set([...namesOf(before, visibleTo(before, viewer)), ...namesOf(after, visibleTo(after, viewer))]);
    const hidden = [...namesOf(before, hiddenFrom(before, viewer)), ...namesOf(after, hiddenFrom(after, viewer))];
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
  // A hidden object's id is renamed everywhere it appears (zone lists, object keys, picks in a pending decision), so a
  // view that names one, or keeps its order, changes.
  const renamed = new Set<string>(hidden);
  const json = JSON.stringify(state).replace(/"o(\d+)"/g, (whole, n: string) =>
    renamed.has(`o${n}`) ? `"o${Number(n) + 1_000_000}"` : whole,
  );
  const scrambled = JSON.parse(json) as GameState;
  const objects = { ...scrambled.objects };
  for (const [i, id] of hidden.entries()) {
    const newId = `o${Number(id.slice(1)) + 1_000_000}` as ObjectId;
    const obj = objects[newId];
    if (obj?.kind === "card") {
      objects[newId] = { ...obj, oracleId: `scrambled-${i}`, cardId: `c${900_000 + i}`, timestamp: obj.timestamp + 1 };
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
    work: [],
  };
}

/** Every library's objects, and other players' hands. */
function hiddenObjects(state: GameState, viewer: PlayerId): ObjectId[] {
  return state.turnOrder.flatMap((p) => [
    ...(state.zones.players[p]?.library ?? []),
    ...(p === viewer ? [] : (state.zones.players[p]?.hand ?? [])),
  ]);
}

export const ALL_CHECKS: readonly Check[] = [engineInvariants, lifeThroughEvents, viewsLeakNothing];
