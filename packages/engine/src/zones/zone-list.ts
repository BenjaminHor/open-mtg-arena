// Reading and replacing the list of object ids in one zone.

import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { ZoneRef } from "../state/zones.ts";

export function zoneList(state: GameState, ref: ZoneRef): ObjectId[] {
  switch (ref.zone) {
    case "library":
    case "hand":
    case "graveyard":
      return playerZones(state, ref.player)[ref.zone];
    case "battlefield":
    case "stack":
    case "exile":
    case "command":
      return state.zones[ref.zone];
  }
}

export function withZoneList(state: GameState, ref: ZoneRef, ids: ObjectId[]): GameState {
  switch (ref.zone) {
    case "library":
    case "hand":
    case "graveyard": {
      const zones = playerZones(state, ref.player);
      return {
        ...state,
        zones: { ...state.zones, players: { ...state.zones.players, [ref.player]: { ...zones, [ref.zone]: ids } } },
      };
    }
    case "battlefield":
    case "stack":
    case "exile":
    case "command":
      return { ...state, zones: { ...state.zones, [ref.zone]: ids } };
  }
}

/** The zone an object is in. Throws if it's in none, which would break an engine invariant. */
export function zoneOf(state: GameState, id: ObjectId): ZoneRef {
  for (const player of state.turnOrder) {
    for (const zone of ["library", "hand", "graveyard"] as const) {
      if (playerZones(state, player)[zone].includes(id)) return { zone, player };
    }
  }
  for (const zone of ["battlefield", "stack", "exile", "command"] as const) {
    if (state.zones[zone].includes(id)) return { zone };
  }
  throw new Error(`Object ${id} isn't in any zone`);
}

function playerZones(state: GameState, player: string) {
  const zones = state.zones.players[player as keyof typeof state.zones.players];
  if (zones === undefined) throw new Error(`No player ${player}`);
  return zones;
}
