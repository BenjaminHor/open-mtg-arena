// Whether a player might pay for an action now: a hint for hosts and UIs (the match host's auto-pass, `brief`'s "not
// enough mana"), never a rule. The engine lets a player start any listed action and undoes it if the cost can't be
// paid (CR 601.2h, 734). The hint errs toward yes: `autoPay` misses some payments a player could make (its own comment
// says which), so when it finds none but the player's mana adds up to enough, the answer is still yes.

import type { CardDatabase, ManaCost } from "../cards/types.ts";
import { abilitiesOf, isManaAbility, sameAbilityRef } from "../rules/abilities.ts";
import { activationManaCost, totalCost } from "../rules/costs.ts";
import type { Action } from "../state/actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { autoPay, manaAvailable } from "./auto-pay.ts";
import { manaValue } from "./payment.ts";

/**
 * The mana an action would cost before choices are made (X as 0, no extra targets yet: CR 601.2f): a spell's total
 * cost, a non-mana ability's activation cost. Null for an action with no mana cost to pay: a mana ability, a land,
 * passing, an answer, or a spell with no mana cost at all, whose cost can't be paid (CR 118.6).
 */
export function actionManaCost(state: GameState, action: Action, cards: CardDatabase): ManaCost | null {
  switch (action.type) {
    case "CAST_SPELL":
      return totalCost(state, action.object, cards);
    case "ACTIVATE_ABILITY": {
      const ability = abilitiesOf(state, action.object, cards).find((a) => sameAbilityRef(a.ref, action.ability));
      return ability === undefined || isManaAbility(ability.def) ? null : activationManaCost(ability.def);
    }
    case "PLAY_LAND":
    case "PASS_PRIORITY":
    case "ANSWER":
    case "CONCEDE":
      return null;
  }
}

/** Whether the player's pool and untapped sources might pay this mana now, X as 0 (CR 107.3a). */
export function mightPay(state: GameState, player: PlayerId, cost: ManaCost, cards: CardDatabase): boolean {
  const withoutX = cost.filter((s) => s.kind !== "x");
  return autoPay(state, player, withoutX, cards) !== null || manaAvailable(state, player, cards) >= manaValue(withoutX);
}
