// Events: what happened, returned by every engine call. They're the UI's animation script and the
// tests' and AI's record of the game. State can always be rebuilt without them.
//
// Each task adds the events it produces. Every visible change must produce one (docs/future-rules.md).

import type { CardId, ObjectId, PlayerId } from "./ids.ts";
import type { CardObject } from "./objects.ts";
import type { GameResult } from "./result.ts";
import type { ZoneRef } from "./zones.ts";

export type GameEvent =
  /**
   * An object moved between zones and became a new object (CR 400.7). `object` is the old object as it last
   * existed, so triggers that look back in time (CR 603.10) can use it later. Abilities never change zones: they
   * leave the stack and cease to exist. Events can carry hidden information (a drawn card's `oracleId`), so hosts
   * filter them per player before the UI or AI sees them, as `playerView` does for state.
   */
  | {
      type: "ZONE_CHANGED";
      from: ZoneRef;
      to: ZoneRef;
      oldId: ObjectId;
      newId: ObjectId;
      cardId: CardId;
      object: CardObject;
    }
  | { type: "PLAYER_CONCEDED"; player: PlayerId } // CR 104.3a
  | { type: "GAME_ENDED"; result: GameResult };
