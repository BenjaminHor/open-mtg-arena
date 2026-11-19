// Casting a spell from hand (CR 601.2): checking it can begin, and putting the card on the stack. The steps that follow
// (targets, paying, cancelling) are shared with activating abilities, in `casting-steps.ts`.

import type { CardDatabase } from "../cards/types.ts";
import { totalCost } from "../rules/costs.ts";
import { legalTargets, targetSpecsOf } from "../rules/targets.ts";
import { castTimingProblem } from "../rules/timing.ts";
import type { Casting } from "../state/casting.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { moveCard } from "../zones/move-card.ts";
import { zoneList } from "../zones/zone-list.ts";
import { nextCastingStep } from "./casting-steps.ts";
import type { Progress } from "./progress.ts";

/**
 * Why the player can't begin casting this card now, or null: the check that the proposed spell can legally be cast
 * (CR 601.2e), done once, before the card moves (CR 601.2a), rather than after all the choices: it's in
 * their hand and the timing allows it. Two shortcuts give the same result as starting and then reversing the cast
 * (CR 601.2, 734.1): every target requirement must have a legal choice (CR 601.2c), and a card with no mana cost can't be
 * cast (it has no alternative costs yet; CR 118.6 makes the attempt legal, but it could never be paid). Whether the
 * player can pay is NOT checked: attempting is legal (CR 118.6), and a player who can't pay cancels.
 */
export function castProblem(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): string | null {
  if (!zoneList(state, { zone: "hand", player }).includes(card)) return `${card} isn't in ${player}'s hand`;
  const timing = castTimingProblem(state, player, card, cards);
  if (timing !== null) return timing;
  for (const spec of targetSpecsOf(state, card, cards)) {
    if (legalTargets(state, spec, cards).length === 0) return "there's nothing it could target (CR 601.2c)";
  }
  if (totalCost(state, card, cards) === null) return "it has no mana cost, so it could never be paid (CR 118.6)";
  return null;
}

/** CR 601.2a: the card moves to the stack, and the cast continues with its targets and costs. */
export function startCast(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): Progress {
  const obj = state.objects[card];
  const ps = state.players[player];
  if (obj?.kind !== "card" || ps === undefined) throw new Error(`Can't cast ${card}`);
  const handIndex = zoneList(state, { zone: "hand", player }).indexOf(card);
  const moved = moveCard(state, card, { zone: "stack", controller: player });
  const casting: Casting = {
    player,
    object: moved.newId,
    origin: { kind: "card", card: obj, handIndex },
    poolBefore: ps.manaPool,
    tappedForMana: [],
  };
  return { state: nextCastingStep({ ...moved.state, casting }, cards), events: moved.events };
}
