// legalActions: every action a player may take right now (docs/architecture.md, "Engine API"), except `CONCEDE`,
// which is always allowed and never listed (D-042), and values of X above the decision's `upTo`, which are legal but
// endless (D-058). Each one is accepted by applyAction, and the scenario runner, the CLI and the AI choose from this
// list.

import type { CardDatabase } from "../cards/types.ts";
import { legalAmounts } from "../combat/damage-assignment.ts";
import { attackDeclarationProblem, blockDeclarationProblem } from "../combat/declaration-rules.ts";
import { possibleAttacks } from "../combat/declare-attackers.ts";
import { possibleBlocks } from "../combat/declare-blockers.ts";
import { manaAbilityProblem, manaChoices } from "../mana/activate.ts";
import { allPayments } from "../mana/payment.ts";
import { abilitiesOf, isManaAbility } from "../rules/abilities.ts";
import type { Action } from "../state/actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { DecisionId, PlayerId } from "../state/ids.ts";
import { orderTriggersProblem } from "../triggers/put-on-stack.ts";
import { zoneList } from "../zones/zone-list.ts";
import { activationProblem } from "./activate-ability.ts";
import { castProblem } from "./cast.ts";
import { largestShare, possibleTargets } from "./choose-targets.ts";
import { redirectShareRange } from "./divide-redirect.ts";
import { playLandProblem } from "./play-land.ts";
import { canMulligan } from "./pregame.ts";
import { nextSacrificeOptions } from "./sacrifice-costs.ts";
import { canTapForCost, tapsForCost } from "./tap-costs.ts";

export function legalActions(state: GameState, player: PlayerId, cards: CardDatabase): Action[] {
  const actions = decisionActions(state, player, cards);
  // A triggered ability being put on the stack can't be cancelled: it isn't the player's action to take back
  // (CR 603.3d).
  if (state.casting?.origin.kind !== "trigger") return actions;
  return actions.filter((a) => a.type !== "ANSWER" || a.answer.kind !== "cancelCast");
}

function decisionActions(state: GameState, player: PlayerId, cards: CardDatabase): Action[] {
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
    case "chooseCards": {
      // Only answers: no spells and no other abilities during resolution (CR 608.2g).
      const add = pending.options.flatMap((_, option): Action[] =>
        pending.chosen.includes(option) ? [] : [{ ...answer, answer: { kind: "chooseCard", option } }],
      );
      const finish: Action[] =
        pending.chosen.length >= pending.min ? [{ ...answer, answer: { kind: "finishChoosing" } }] : [];
      return [...add, ...finish];
    }
    case "chooseYesNo":
      return [true, false].map((yes): Action => ({ ...answer, answer: { kind: "chooseYesNo", yes } }));
    case "chooseReplacement":
      return pending.options.map((_, option): Action => ({ ...answer, answer: { kind: "chooseReplacement", option } }));
    case "orderTriggers":
      return pending.batch.flatMap((_, index): Action[] =>
        orderTriggersProblem(pending.batch, player, index) === null
          ? [{ ...answer, answer: { kind: "orderTrigger", index } }]
          : [],
      );
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
      const finish = attackDeclarationProblem(state, pending.chosen, cards) === null;
      return declarationActions(answer, add, finish, pending.chosen.length > 0);
    }
    case "declareBlockers": {
      const add = possibleBlocks(state, pending.chosen, cards).map(
        (block): Action => ({ ...answer, answer: { kind: "declareBlocker", block } }),
      );
      const finish = blockDeclarationProblem(state, pending.chosen, cards) === null;
      return declarationActions(answer, add, finish, pending.chosen.length > 0);
    }
    case "assignDamage": {
      // 0 up to what's left, but those trample forbids: one answer per amount, so the list grows with power, not with
      // the number of divisions.
      return legalAmounts(pending).map((amount): Action => ({ ...answer, answer: { kind: "assignDamage", amount } }));
    }
    case "announceX": {
      // Any whole number is legal (CR 107.3a); these are the ones the player could pay for now, from 0.
      const values = Array.from(
        { length: pending.upTo + 1 },
        (_, value): Action => ({ ...answer, answer: { kind: "announceX", value } }),
      );
      return [...values, { ...answer, answer: { kind: "cancelCast" } }];
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
    case "divideRedirect": {
      const { min, max } = redirectShareRange(pending);
      return Array.from(
        { length: max - min + 1 },
        (_, i): Action => ({ ...answer, answer: { kind: "redirectShare", amount: min + i } }),
      );
    }
    case "divide": {
      const shares = Array.from(
        { length: largestShare(pending) },
        (_, i): Action => ({ ...answer, answer: { kind: "divide", amount: i + 1 } }),
      );
      return [...shares, { ...answer, answer: { kind: "cancelCast" } }];
    }
    case "chooseSacrifice": {
      const options = nextSacrificeOptions(state, cards).map(
        (object): Action => ({ ...answer, answer: { kind: "chooseSacrifice", object } }),
      );
      return [...options, { ...answer, answer: { kind: "cancelCast" } }];
    }
    case "payMana": {
      // Every payment the pool covers, since which mana pays is the player's choice (CR 601.2h); mana abilities to make
      // more; and cancelling, always possible, so a cast can never get stuck (D-035).
      const cancel: Action = { ...answer, answer: { kind: "cancelCast" } };
      // Once a permanent the cost taps is tapped or gone, no payment can succeed (CR 107.5, 601.2h): only cancel.
      const pool = state.players[player]?.manaPool;
      const payable = tapsForCost(state, cards).every((id) => canTapForCost(state, id));
      const pay: Action[] =
        pool === undefined || !payable
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

/**
 * Every mana ability the player could activate now (CR 605.3a), on permanents in battlefield order; one with a choice of
 * color ("any color", "{G} or {W}") once per color, the color being part of the activation (D-068).
 */
function manaAbilityActions(state: GameState, player: PlayerId, decisionId: DecisionId, cards: CardDatabase): Action[] {
  return state.zones.battlefield.flatMap((object) =>
    abilitiesOf(state, object, cards)
      .filter(({ ref, def }) => isManaAbility(def) && manaAbilityProblem(state, player, object, ref, cards) === null)
      .flatMap(({ ref, def }): Action[] => {
        const action = { type: "ACTIVATE_ABILITY", decisionId, player, object, ability: ref } as const;
        const choices = manaChoices(def);
        if (choices.length === 0) return [action];
        return choices.map((color) => ({ ...action, color }));
      }),
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

/**
 * A declaration's actions: finishing it first, offered only when it's legal (CR 508.1c–d, 509.1b–c); then each pick that
 * can be added; then taking back the last pick, so a declaration that can't be finished isn't stuck. Finishing comes
 * first so an agent taking the first action declares nothing, rather than adding and taking back the same pick forever.
 */
function declarationActions(
  answer: { type: "ANSWER"; decisionId: DecisionId; player: PlayerId },
  picks: Action[],
  canFinish: boolean,
  canTakeBack: boolean,
): Action[] {
  const finish: Action[] = canFinish ? [{ ...answer, answer: { kind: "finishDeclaring" } }] : [];
  const takeBack: Action[] = canTakeBack ? [{ ...answer, answer: { kind: "takeBack" } }] : [];
  return [...finish, ...picks, ...takeBack];
}
