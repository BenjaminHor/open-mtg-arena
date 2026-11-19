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

export type Check = (before: GameState, after: GameState, events: readonly GameEvent[], cards: CardDatabase) => string[];

/** The engine's invariants: JSON round trip, zones, never stalled, every legal action accepted, no negative mana. */
export const engineInvariants: Check = (_before, after, _events, cards) => invariantProblems(after, cards);

/** Life totals change only through events (CR 119.3): each player's change equals the life lost in the events. */
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
    if (JSON.stringify(playerView(scrambleHidden(after, viewer), viewer)) !== JSON.stringify(playerView(after, viewer))) {
      problems.push(`${viewer}'s view changes when only hidden information changes`);
    }
    // A card is named by its physical card id across zones. One the viewer saw in a public zone before the action
    // (a cancelled cast's card, back in hand) isn't a secret.
    const shown = JSON.stringify(eventsFor(events, viewer));
    const seen = new Set(publicCardIds(before));
    for (const id of hiddenFrom(after, viewer)) {
      const obj = after.objects[id];
      if (obj?.kind === "card" && !seen.has(obj.cardId) && shown.includes(`"${obj.cardId}"`)) {
        problems.push(`the events shown to ${viewer} name ${obj.cardId}, which is hidden from them`);
      }
    }
  }
  return problems;
};

/** The physical cards in public zones (CR 400.2). */
function publicCardIds(state: GameState): string[] {
  const ids = [
    ...state.zones.battlefield,
    ...state.zones.stack,
    ...state.zones.exile,
    ...state.zones.command,
    ...state.turnOrder.flatMap((p) => state.zones.players[p]?.graveyard ?? []),
  ];
  return ids.flatMap((id) => {
    const obj = state.objects[id];
    return obj?.kind === "card" ? [obj.cardId] : [];
  });
}

/** The objects in other players' hands and libraries. (A player's own library may hold cards they saw go there.) */
function hiddenFrom(state: GameState, viewer: PlayerId): ObjectId[] {
  return state.turnOrder
    .filter((p) => p !== viewer)
    .flatMap((p) => [...(state.zones.players[p]?.hand ?? []), ...(state.zones.players[p]?.library ?? [])]);
}

/** The same state with everything `viewer` can't see changed: hidden cards, library order, seed, RNG and internals. */
export function scrambleHidden(state: GameState, viewer: PlayerId): GameState {
  const objects = { ...state.objects };
  const hidden = state.turnOrder.flatMap((p) => [
    ...(state.zones.players[p]?.library ?? []),
    ...(p === viewer ? [] : (state.zones.players[p]?.hand ?? [])),
  ]);
  for (const [i, id] of hidden.entries()) {
    const obj = objects[id];
    if (obj?.kind === "card") {
      objects[id] = { ...obj, oracleId: `scrambled-${i}`, cardId: `c${900_000 + i}`, timestamp: obj.timestamp + 1 };
    }
  }
  const players = { ...state.zones.players };
  for (const p of state.turnOrder) {
    const z = players[p];
    if (z !== undefined) players[p] = { ...z, library: [...z.library].reverse() };
  }
  return {
    ...state,
    objects,
    zones: { ...state.zones, players },
    rng: [state.rng[0] ^ 0x5a5a5a5a, state.rng[1] ^ 1, state.rng[2], state.rng[3]],
    setup: { ...state.setup, seed: state.setup.seed + 1, players: [] },
    nextId: state.nextId + 1000,
    nextTimestamp: state.nextTimestamp + 1000,
    work: [],
  };
}

export const ALL_CHECKS: readonly Check[] = [engineInvariants, lifeThroughEvents, viewsLeakNothing];
