// legalActions: every action a player may take right now (docs/architecture.md, "Engine API"). Each one is
// accepted by applyAction, and the scenario runner, the CLI and the AI choose only from this list.

import type { CardDatabase } from "../cards/types.ts";
import { manaAbilityProblem } from "../mana/activate.ts";
import { autoPay } from "../mana/auto-pay.ts";
import { abilitiesOf, isManaAbility } from "../rules/abilities.ts";
import { legalTargets } from "../rules/targets.ts";
import type { Action } from "../state/actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { DecisionId, PlayerId } from "../state/ids.ts";
import { zoneList } from "../zones/zone-list.ts";
import { castProblem, targetSpecsOf } from "./cast.ts";
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
    case "chooseTarget": {
      const casting = state.casting;
      const spec = casting === null ? undefined : targetSpecsOf(state, casting.spell, cards)[pending.instance];
      if (spec === undefined) return [];
      return legalTargets(state, spec, cards).map((target) => ({
        ...answer,
        answer: { kind: "chooseTarget", target },
      }));
    }
    case "payMana": {
      // Cancelling is always possible, so a cast can never get stuck (CR 734.1). A payment is listed when the pool
      // already covers the cost; otherwise the player activates mana abilities first.
      const cancel: Action = { ...answer, answer: { kind: "cancelCast" } };
      const plan = autoPay(state, player, pending.cost, cards);
      const pay: Action[] =
        plan !== null && plan.activations.length === 0
          ? [{ ...answer, answer: { kind: "payMana", payment: plan.payment } }]
          : [];
      return [...pay, cancel, ...manaAbilityActions(state, player, pending.id, cards)];
    }
    case "priority":
      // Other activated abilities arrive in M1-14.
      return [
        { type: "PASS_PRIORITY", decisionId: pending.id, player },
        ...landActions(state, player, pending.id, cards),
        ...castActions(state, player, pending.id, cards),
        ...manaAbilityActions(state, player, pending.id, cards),
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
