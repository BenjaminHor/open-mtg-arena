// The declare attackers step's turn-based action (CR 508.1).

import type { CardDatabase } from "../cards/types.ts";
import { waitFor } from "../game/decide.ts";
import { andThen, type Progress } from "../game/progress.ts";
import { currentTurn } from "../game/turn.ts";
import { queueWork } from "../game/work.ts";
import { happen } from "../pipeline/happen.ts";
import type { ProposedEvent } from "../pipeline/proposed.ts";
import { keywordsOf } from "../rules/abilities.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { canAttack, canAttackPlayer } from "../rules/combat.ts";
import { controllerOf } from "../rules/controller.ts";
import { type Attack, newCombat } from "../state/combat.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { PlayerId } from "../state/ids.ts";
import { detectTriggers } from "../triggers/detect.ts";

/**
 * Every attack the active player could still add to the declaration: each creature that can attack and isn't chosen
 * yet, against each other player it may attack, and each planeswalker that player controls (CR 508.1a-b; restrictions
 * on attacking a player, such as "unless defending player controls an Island", CR 508.1c, are about the defending
 * player, so they hold for their planeswalkers too). Creatures in battlefield order, then players in turn order, each
 * player before their planeswalkers, those in battlefield order.
 */
export function possibleAttacks(state: GameState, chosen: readonly Attack[], cards: CardDatabase): Attack[] {
  const active = currentTurn(state).activePlayer;
  const defenders = state.turnOrder.filter((p) => p !== active);
  // Found once, not per attacker: this runs whenever legal actions are listed.
  const planeswalkers = state.zones.battlefield.filter((id) => cardTypesOf(state, id, cards).includes("planeswalker"));
  const planeswalkersOf = (player: PlayerId) =>
    planeswalkers.length === 0 ? [] : planeswalkers.filter((id) => controllerOf(state, id, cards) === player);
  return state.zones.battlefield
    .filter((id) => canAttack(state, id, active, cards) && !chosen.some((a) => a.attacker === id))
    .flatMap((attacker) =>
      defenders
        .filter((d) => canAttackPlayer(state, attacker, d, cards))
        .flatMap((defender) => [
          { attacker, defender },
          ...planeswalkersOf(defender).map((attacked) => ({ attacker, defender, attacked })),
        ]),
    );
}

/**
 * Asks the active player for attackers, one at a time, until they finish (CR 508.1). If no creature could attack,
 * no one is asked: the declaration is empty.
 */
export function declareAttackers(state: GameState, chosen: Attack[], cards: CardDatabase): Progress {
  const active = currentTurn(state).activePlayer;
  if (chosen.length === 0 && possibleAttacks(state, chosen, cards).length === 0)
    return finishAttackers(state, [], cards);
  return { state: waitFor(state, active, { kind: "declareAttackers", chosen }), events: [] };
}

/**
 * The attack as the engine lists it, if this one can be added (CR 508.1a-c), or why it can't. The engine's own copy is
 * what's stored, not the answer as sent, so an answer can't bring in extra keys or an `undefined` (plain JSON).
 */
export function possibleAttack(
  state: GameState,
  chosen: readonly Attack[],
  attack: Attack,
  cards: CardDatabase,
): Attack | string {
  const found = possibleAttacks(state, chosen, cards).find(
    (a) => a.attacker === attack.attacker && a.defender === attack.defender && a.attacked === attack.attacked,
  );
  return found ?? `${attack.attacker} can't attack ${attack.attacked ?? attack.defender} (CR 508.1a-c)`;
}

/**
 * The declaration is complete, and legal: the whole-declaration rules were checked as it was finished
 * (`declaration-rules.ts`, CR 508.1c–d). The attackers tap (CR 508.1f) and become attacking creatures (CR 508.1k); then
 * the active player gets priority (CR 508.2).
 */
export function finishAttackers(state: GameState, chosen: readonly Attack[], cards: CardDatabase): Progress {
  const active = currentTurn(state).activePlayer;
  const progress = happen(state, attackersTap(state, chosen, cards), cards);
  const declared: GameEvent = { type: "ATTACKERS_DECLARED", player: active, attacks: [...chosen] };
  return andThen(progress, (s) => {
    const withCombat = { ...s, combat: { ...(s.combat ?? newCombat()), attacks: [...chosen] } };
    // "Whenever this creature attacks" triggers as it's declared (CR 508.3a); only this event is matched here, the
    // tapping already went through the pipeline.
    const triggered = detectTriggers(s, withCombat, [declared], cards);
    return { state: queueWork(triggered, { kind: "givePriority", player: active }), events: [declared] };
  });
}

/**
 * The attackers tap together (CR 508.1f), as part of the one turn-based action that declares them (CR 508.1), except
 * those with vigilance (CR 702.20b).
 */
export function attackersTap(state: GameState, chosen: readonly Attack[], cards: CardDatabase): ProposedEvent {
  const tapping = chosen.filter(({ attacker }) => !keywordsOf(state, attacker, cards).includes("vigilance"));
  return { kind: "simultaneous", events: tapping.map(({ attacker }) => ({ kind: "tap", object: attacker }) as const) };
}
