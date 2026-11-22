// Tokens (CR 111): creating one, and one ceasing to exist. A token is an object like a card's, with its own data kept
// on it (CR 111.3): everything that works on permanents works on it (CR 111.6).

import { isToken } from "../cards/card-data.ts";
import type { CardData } from "../cards/types.ts";
import { newCardId, newObjectId, newTimestamp } from "../game/ids.ts";
import type { Progress } from "../game/progress.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import { withZoneList, zoneList, zoneOf } from "./zone-list.ts";

/**
 * Puts a new token onto the battlefield: `player` created it, so owns it, and it enters under their control
 * (CR 111.2). It enters as a new object does (CR 110.5b, 302.6): untapped, no damage or counters, summoning sick.
 */
export function createToken(state: GameState, token: CardData, player: PlayerId): Progress {
  const allocated = newObjectId(state);
  // A timestamp as it enters (CR 613.7d); tokens made together get theirs in order (later: CR 613.7m).
  const stamped = newTimestamp(allocated.state);
  // A token has no physical card, but the UI follows objects by card id (D-054), so it gets one of its own.
  const minted = newCardId(stamped.state);
  const obj: CardObject = {
    kind: "card",
    id: allocated.id,
    cardId: minted.id,
    oracleId: token.oracleId,
    owner: player,
    baseController: player,
    timestamp: stamped.timestamp,
    tapped: false,
    damage: 0,
    counters: {},
    controlledSinceTurnStart: false,
    choices: null,
    token,
  };
  const next = { ...minted.state, objects: { ...minted.state.objects, [obj.id]: obj } };
  const battlefield = { zone: "battlefield" } as const;
  return {
    state: withZoneList(next, battlefield, [...zoneList(next, battlefield), obj.id]),
    events: [{ type: "TOKEN_CREATED", player, object: obj.id, cardId: obj.cardId }],
  };
}

/**
 * A token outside the battlefield (CR 111.7, 704.5d), or a copy of a spell outside the stack (CR 707.10a, 704.5e),
 * ceases to exist: it leaves its zone and the game.
 */
export function ceaseToExist(state: GameState, id: ObjectId): Progress {
  const object = state.objects[id];
  if (object?.kind !== "card" || (!isToken(object) && object.copy !== true))
    throw new Error(`${id} isn't a token or a copy of a spell`);
  const from = zoneOf(state, id);
  const next = withZoneList(
    state,
    from,
    zoneList(state, from).filter((x) => x !== id),
  );
  const { [id]: _gone, ...objects } = next.objects;
  const type = object.copy === true ? "COPY_CEASED_TO_EXIST" : "TOKEN_CEASED_TO_EXIST";
  return { state: { ...next, objects }, events: [{ type, from, object }] };
}
