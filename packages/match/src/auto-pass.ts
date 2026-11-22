// Smart auto-pass (architecture.md, "Match host"; ui.md, "The player only makes meaningful decisions"): the host
// passes priority for a player who has nothing worth doing, so the game never stops on an empty choice, as Arena does.
// One pure function of the decision, the player's own options and their settings, used for every seat alike, the AI's
// too (D-137). It errs toward stopping: when in doubt, the player is asked.

import {
  type Action,
  abilitiesOf,
  autoPay,
  type CardDatabase,
  cardDataOf,
  controllerOf,
  type GameState,
  isManaAbility,
  type ManaCost,
  type PlayerId,
  sameAbilityRef,
} from "@mtg/engine";
import type { SeatSettings } from "./match-state.ts";

/**
 * Whether the host passes for `player`, who has priority, given their legal actions. Never with auto-pass off. Always
 * when nothing meaningful can be done (only mana abilities, or spells and abilities the player can't pay for now).
 * Otherwise: with their own spell or ability on top of the stack, pass so it resolves (they'd rarely respond to it);
 * with an opponent's on top, stop, as they could respond; with an empty stack, stop only at the player's stops.
 */
export function autoPasses(
  state: GameState,
  player: PlayerId,
  actions: readonly Action[],
  settings: SeatSettings,
  cards: CardDatabase,
): boolean {
  if (!settings.autoPass || state.pending?.kind !== "priority" || state.pending.player !== player) return false;
  if (!actions.some((a) => isMeaningful(state, player, a, cards))) return true;
  const top = state.zones.stack.at(-1);
  if (top !== undefined) return controllerOf(state, top, cards) === player;
  const turn = state.turn;
  if (turn === null) return false;
  const stops = turn.activePlayer === player ? settings.stops.own : settings.stops.opponents;
  return !stops.includes(turn.step);
}

/** Something worth stopping for: a land to play, or a spell or a non-mana ability whose mana the player can pay now. */
function isMeaningful(state: GameState, player: PlayerId, action: Action, cards: CardDatabase): boolean {
  switch (action.type) {
    case "PLAY_LAND":
      return true;
    case "CAST_SPELL": {
      const obj = state.objects[action.object];
      const cost = obj?.kind === "card" ? (cardDataOf(obj, cards)?.printed.manaCost ?? null) : null;
      // A spell with no mana cost can't be cast at all (CR 202.1b); the engine lists it only to refuse it.
      return cost !== null && canPay(state, player, cost, cards);
    }
    case "ACTIVATE_ABILITY": {
      const ability = abilitiesOf(state, action.object, cards).find((a) => sameAbilityRef(a.ref, action.ability));
      if (ability === undefined || isManaAbility(ability.def)) return false;
      const mana = ability.def.cost.flatMap((c) => (c.kind === "mana" ? c.cost : []));
      return canPay(state, player, mana, cards);
    }
    case "PASS_PRIORITY":
    case "ANSWER":
    case "CONCEDE":
      return false;
  }
}

/** Whether the player's pool and untapped sources could pay this mana now, X as 0 (CR 107.3a). */
function canPay(state: GameState, player: PlayerId, cost: ManaCost, cards: CardDatabase): boolean {
  return (
    autoPay(
      state,
      player,
      cost.filter((s) => s.kind !== "x"),
      cards,
    ) !== null
  );
}
