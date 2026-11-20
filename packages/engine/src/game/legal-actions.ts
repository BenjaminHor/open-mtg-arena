// legalActions: every action a player may take right now (docs/architecture.md, "Engine API"), except `CONCEDE`,
// which is always allowed and never listed (D-042). Each one is accepted by applyAction, and the scenario runner, the
// CLI and the AI choose from this list.

import type { CardDatabase } from "../cards/types.ts";
import { damageLeft } from "../combat/combat-damage.ts";
import { possibleAttacks } from "../combat/declare-attackers.ts";
import { possibleBlocks } from "../combat/declare-blockers.ts";
import { manaAbilityProblem } from "../mana/activate.ts";
import { allPayments } from "../mana/payment.ts";
import { abilitiesOf, isManaAbility } from "../rules/abilities.ts";
import type { Action } from "../state/actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { DecisionId, PlayerId } from "../state/ids.ts";
import { zoneList } from "../zones/zone-list.ts";
import { activationProblem } from "./activate-ability.ts";
import { castProblem } from "./cast.ts";
import { largestShare, possibleTargets } from "./choose-targets.ts";
import { playLandProblem } from "./play-land.ts";
import { canMulligan } from "./pregame.ts";

export function legalActions(state: GameState, player: PlayerId, cards: CardDatabase): Action[] {
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
      return zoneList(state, { zone: "hand", player })
        .filter((object) => !pending.chosen.includes(object))
        .map((object) => ({
          ...answer,
          answer: { kind: "discardToHandSize", object },
        }));
    case "declareAttackers": {
      const add = possibleAttacks(state, pending.chosen, cards).map(
        (attack): Action => ({ ...answer, answer: { kind: "declareAttacker", attack } }),
      );
      return [...add, { ...answer, answer: { kind: "finishDeclaring" } }];
    }
    case "declareBlockers": {
      const add = possibleBlocks(state, pending.chosen, cards).map(
        (block): Action => ({ ...answer, answer: { kind: "declareBlocker", block } }),
      );
      return [...add, { ...answer, answer: { kind: "finishDeclaring" } }];
    }
    case "assignDamage": {
      // 0 up to what's left: one answer per amount, so the list grows with power, not with the number of divisions.
      const left = damageLeft(pending.amount, pending.assigned);
      return Array.from(
        { length: left + 1 },
        (_, amount): Action => ({
          ...answer,
          answer: { kind: "assignDamage", amount },
        }),
      );
    }
    case "chooseTargetCount": {
      const { min, max } = pending;
      const counts = Array.from(
        { length: Math.max(0, max - min + 1) },
        (_, i): Action => ({ ...answer, answer: { kind: "chooseTargetCount", count: min + i } }),
      );
      // The player can cancel at any step of a cast (D-035).
      return [...counts, { ...answer, answer: { kind: "cancelCast" } }];
    }
    case "chooseTarget": {
      const targets = possibleTargets(state, cards).map(
        (target): Action => ({ ...answer, answer: { kind: "chooseTarget", target } }),
      );
      return [...targets, { ...answer, answer: { kind: "cancelCast" } }];
    }
    case "divide": {
      const shares = Array.from(
        { length: largestShare(pending) },
        (_, i): Action => ({ ...answer, answer: { kind: "divide", amount: i + 1 } }),
      );
      return [...shares, { ...answer, answer: { kind: "cancelCast" } }];
    }
    case "payMana": {
      // Every payment the pool covers, since which mana pays is the player's choice (CR 601.2h); mana abilities to make
      // more; and cancelling, always possible, so a cast can never get stuck (D-035).
      const cancel: Action = { ...answer, answer: { kind: "cancelCast" } };
      const pool = state.players[player]?.manaPool;
      const pay: Action[] =
        pool === undefined
          ? []
          : allPayments(pool, pending.cost).map(
              (payment): Action => ({ ...answer, answer: { kind: "payMana", payment } }),
            );
      return [...pay, cancel, ...manaAbilityActions(state, player, pending.id, cards)];
    }
    case "priority":
      return [
        { type: "PASS_PRIORITY", decisionId: pending.id, player },
        ...landActions(state, player, pending.id, cards),
        ...castActions(state, player, pending.id, cards),
        ...manaAbilityActions(state, player, pending.id, cards),
        ...activationActions(state, player, pending.id, cards),
      ];
  }
}

/** Every mana ability the player could activate now (CR 605.3a), on permanents in battlefield order. */
function manaAbilityActions(state: GameState, player: PlayerId, decisionId: DecisionId, cards: CardDatabase): Action[] {
  return state.zones.battlefield.flatMap((object) =>
    abilitiesOf(state, object, cards)
      .filter(({ ref, def }) => isManaAbility(def) && manaAbilityProblem(state, player, object, ref, cards) === null)
      .map(({ ref }) => ({ type: "ACTIVATE_ABILITY", decisionId, player, object, ability: ref }) as const),
  );
}

/** Every other activated ability the player could begin activating now (CR 602.2), in battlefield order. */
function activationActions(state: GameState, player: PlayerId, decisionId: DecisionId, cards: CardDatabase): Action[] {
  return state.zones.battlefield.flatMap((object) =>
    abilitiesOf(state, object, cards)
      .filter(({ ref, def }) => !isManaAbility(def) && activationProblem(state, player, object, ref, cards) === null)
      .map(({ ref }) => ({ type: "ACTIVATE_ABILITY", decisionId, player, object, ability: ref }) as const),
  );
}

function landActions(state: GameState, player: PlayerId, decisionId: DecisionId, cards: CardDatabase): Action[] {
  return zoneList(state, { zone: "hand", player })
    .filter((object) => playLandProblem(state, player, object, cards) === null)
    .map((object) => ({ type: "PLAY_LAND", decisionId, player, object }) as const);
}

function castActions(state: GameState, player: PlayerId, decisionId: DecisionId, cards: CardDatabase): Action[] {
  return zoneList(state, { zone: "hand", player })
    .filter((object) => castProblem(state, player, object, cards) === null)
    .map((object) => ({ type: "CAST_SPELL", decisionId, player, object }) as const);
}
