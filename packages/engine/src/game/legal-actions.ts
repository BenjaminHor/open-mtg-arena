// legalActions: every action a player may take right now (docs/architecture.md, "Engine API"). Each one is
// accepted by applyAction, and the scenario runner, the CLI and the AI choose only from this list.

import type { CardDatabase } from "../cards/types.ts";
import type { Action } from "../state/actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { zoneList } from "../zones/zone-list.ts";
import { canMulligan } from "./pregame.ts";

export function legalActions(state: GameState, player: PlayerId, _cards: CardDatabase): Action[] {
  const pending = state.pending;
  if (state.result !== null || pending === null || pending.player !== player) return [];
  const answer = { type: "ANSWER", decisionId: pending.id, player } as const;
  switch (pending.kind) {
    case "chooseStartingPlayer":
      return state.turnOrder.map((p) => ({ ...answer, answer: { kind: "chooseStartingPlayer", player: p } }));
    case "mulligan": {
      const keep: Action = { ...answer, answer: { kind: "mulligan", choice: "keep" } };
      if (!canMulligan(state, player)) return [keep];
      return [keep, { ...answer, answer: { kind: "mulligan", choice: "mulligan" } }];
    }
    case "mulliganBottom":
      return zoneList(state, { zone: "hand", player }).map((object) => ({
        ...answer,
        answer: { kind: "mulliganBottom", object },
      }));
    case "discardToHandSize":
      return zoneList(state, { zone: "hand", player }).map((object) => ({
        ...answer,
        answer: { kind: "discardToHandSize", object },
      }));
    case "priority":
      // Playing lands, casting spells and activating abilities arrive in M1-08 to M1-14.
      return [{ type: "PASS_PRIORITY", decisionId: pending.id, player }];
  }
}
