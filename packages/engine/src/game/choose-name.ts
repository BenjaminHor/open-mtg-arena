// Answering a `chooseName` decision: checking the name (a card's, CR 201.4, or a basic land type, CR 205.3i), then
// using it for what it was asked for (`NameFor`).

import { isCardName } from "../cards/card-data.ts";
import type { CardDatabase } from "../cards/types.ts";
import type { ChooseWhat, PendingDecision } from "../state/decisions.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import { isBasicLandType } from "../state/objects.ts";
import { oracleIdOf, publicIdOf } from "../zones/shown-order.ts";
import type { Progress } from "./progress.ts";
import { resumeAsEnters } from "./work.ts";

/** Why this isn't a name a `chooseName` decision takes, or null: a card's (CR 201.4) or a basic land type (CR 205.3i). */
export function nameProblem(what: ChooseWhat, name: string, cards: CardDatabase): string | null {
  switch (what) {
    case "cardName":
      return isCardName(name, cards) ? null : `no card is named ${name}`;
    case "basicLandType":
      return isBasicLandType(name) ? null : `${name} isn't a basic land type`;
  }
}

/**
 * A name chosen, told to everyone. As a permanent enters (CR 614.12a), so a player choosing after knows it (CR 101.4b),
 * and the event is replaced again from the start with it kept; during a resolution, as the player announces it while
 * applying the effect (CR 608.2d), and it's kept for the effects after it.
 */
export function answerName(
  state: GameState,
  pending: Extract<PendingDecision, { kind: "chooseName" }>,
  name: string,
): Progress {
  const answering = pending.answering;
  switch (answering.kind) {
    case "asEnters": {
      const choice = { kind: "asEnters", for: answering.for, ref: answering.ref, chosen: name } as const;
      const event: GameEvent = {
        type: "NAME_CHOSEN",
        player: pending.player,
        object: publicIdOf(state, answering.for.object),
        card: oracleIdOf(state, answering.for.object),
        what: pending.what,
        name,
      };
      return {
        state: resumeAsEnters(state, answering, choice),
        events: [event],
      };
    }
    case "resolution": {
      const resolution = state.resolution;
      if (resolution === null) throw new Error("a name chosen while nothing resolves");
      return {
        state: { ...state, resolution: { ...resolution, named: name } },
        events: [
          {
            type: "NAME_CHOSEN",
            player: pending.player,
            object: resolution.object,
            card: null,
            what: pending.what,
            name,
          },
        ],
      };
    }
  }
}
