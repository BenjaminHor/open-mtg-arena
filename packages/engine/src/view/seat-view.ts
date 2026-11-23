// What one player is shown when they must decide (M3-02, D-137): their view, the derived values of what they can see,
// and their legal actions, each with what the table shows a player about it (its cost, whether it can be paid now, what
// it could target). The heuristic AI reads only this, the LLM opponent will too, and the app's Worker posts the same to
// the UI, so a computer player knows nothing a person in its seat wouldn't. Everything in an option is the deciding
// player's own business or public: their own mana, the legal targets among objects they can see.

import type { AbilityDef, CardDatabase, ManaCost } from "../cards/types.ts";
import { attackObeys, attacksCanFinish, blockObeys, blocksCanFinish } from "../combat/declaration-rules.ts";
import { legalActions } from "../game/legal-actions.ts";
import { autoPay } from "../mana/auto-pay.ts";
import { actionManaCost, mightPay, payingState } from "../mana/might-pay.ts";
import { abilitiesOf, sameAbilityRef } from "../rules/abilities.ts";
import { totalCost } from "../rules/costs.ts";
import { legalTargets, targetSpecsOf } from "../rules/targets.ts";
import type { Action } from "../state/actions.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import { type PlayerView, playerView } from "./player-view.ts";
import { type SeenObject, seenObjects } from "./seen-objects.ts";

export type ActionOption = {
  action: Action;
  /**
   * The mana it costs before choices (X as 0); null when it has no mana cost to pay (`actionManaCost`). For an answer
   * announcing X for a spell (CR 601.2b), the spell's whole cost with that X, so a player can see which X they can pay
   * for (no ability in the pool has {X} in its mana cost: later, cover abilities too).
   */
  manaCost: ManaCost | null;
  /** Whether the engine's own pick of sources pays that mana now (X as 0, or as answered); null with none. Strict. */
  payable: boolean | null;
  /** The looser hint auto-pass uses (`mightPay`): yes when the player's mana adds up, even with no plan found. */
  mightPay: boolean | null;
  /** For a spell or an ability: the legal choices now for each "target" in its text (CR 115), in order. */
  targets: Target[][];
  /** For an activation: the ability as the object has it now (`abilitiesOf`), so a player can read what it does. */
  ability: AbilityDef | null;
  /**
   * For a pick in a declaration of attackers or blockers: whether the declaration could still be finished after it,
   * at once or with more picks, breaking no restriction and obeying as many requirements as it could (CR 508.1c-d,
   * 509.1b-c), the rule that offers `finishDeclaring`. A player reads the requirements on the cards ("all creatures able
   * to block it do so"); this saves a computer player from adding a pick it could only take back. Null for any other
   * action.
   */
  finishable: boolean | null;
  /** For a pick in a declaration: how many requirements it obeys ("attacks each combat if able"); null otherwise. */
  obeys: number | null;
};

export type SeatView = {
  player: PlayerId;
  view: PlayerView;
  seen: Record<ObjectId, SeenObject>;
  /** The player's legal actions, in `legalActions` order; empty while another player decides. */
  options: ActionOption[];
};

export function seatView(state: GameState, player: PlayerId, cards: CardDatabase): SeatView {
  const view = playerView(state, player, cards);
  const mine = state.pending?.player === player;
  return {
    player,
    view,
    seen: seenObjects(state, view, cards),
    options: mine ? legalActions(state, player, cards).map((a) => actionOption(state, player, a, cards)) : [],
  };
}

function actionOption(state: GameState, player: PlayerId, action: Action, cards: CardDatabase): ActionOption {
  const manaCost =
    action.type === "ANSWER" ? announcedCost(state, action, cards) : actionManaCost(state, action, cards);
  const paying = manaCost === null || manaCost.length === 0 ? null : manaCost.filter((s) => s.kind !== "x");
  const payingFrom = payingState(state, action, cards);
  const base = {
    action,
    manaCost,
    payable: paying === null ? null : autoPay(payingFrom, player, paying, cards) !== null,
    mightPay: paying === null ? null : mightPay(payingFrom, player, paying, cards),
  };
  const by = (object: ObjectId) => ({ object, controller: player });
  const finishable = declarationFinishable(state, action, cards);
  const obeys = requirementsObeyed(state, action, cards);
  switch (action.type) {
    case "CAST_SPELL": {
      const specs = targetSpecsOf(state, action.object, cards);
      const targets = specs.map((s) => legalTargets(state, s, by(action.object), cards));
      return { ...base, targets, ability: null, finishable, obeys };
    }
    case "ACTIVATE_ABILITY": {
      const found = abilitiesOf(state, action.object, cards).find((a) => sameAbilityRef(a.ref, action.ability));
      const def = found?.def ?? null;
      const targets = (def?.targets ?? []).map((s) => legalTargets(state, s, by(action.object), cards));
      return { ...base, targets, ability: def, finishable, obeys };
    }
    case "PASS_PRIORITY":
    case "PLAY_LAND":
    case "ANSWER":
    case "CONCEDE":
      return { ...base, targets: [], ability: null, finishable, obeys };
  }
}

/** The cost of the spell being cast with this X announced; null for any other answer, or no mana to pay. */
function announcedCost(state: GameState, action: Action, cards: CardDatabase): ManaCost | null {
  const pending = state.pending;
  if (action.type !== "ANSWER" || action.answer.kind !== "announceX" || pending?.kind !== "announceX") return null;
  const obj = state.objects[pending.object];
  if (obj?.kind !== "card" || obj.choices === undefined || obj.choices === null) return null;
  const announced = { ...obj, choices: { ...obj.choices, x: action.answer.value } };
  return totalCost({ ...state, objects: { ...state.objects, [pending.object]: announced } }, pending.object, cards);
}

/** How many requirements this declaration pick obeys; null when it isn't one. */
function requirementsObeyed(state: GameState, action: Action, cards: CardDatabase): number | null {
  if (action.type !== "ANSWER") return null;
  const answer = action.answer;
  if (answer.kind === "declareAttacker") return attackObeys(state, answer.attack, cards);
  if (answer.kind === "declareBlocker") return blockObeys(state, answer.block, cards);
  return null;
}

/** Whether the pending declaration could still be finished with this pick added; null when it isn't such a pick. */
function declarationFinishable(state: GameState, action: Action, cards: CardDatabase): boolean | null {
  const pending = state.pending;
  if (action.type !== "ANSWER" || pending === null) return null;
  const answer = action.answer;
  if (pending.kind === "declareAttackers" && answer.kind === "declareAttacker") {
    return attacksCanFinish(state, [...pending.chosen, answer.attack], cards);
  }
  if (pending.kind === "declareBlockers" && answer.kind === "declareBlocker") {
    return blocksCanFinish(state, [...pending.chosen, answer.block], cards);
  }
  return null;
}
