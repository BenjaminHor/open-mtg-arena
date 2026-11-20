// Casting a spell from hand (CR 601.2): checking it can begin, and putting the card on the stack. The steps that follow
// (targets, paying, cancelling) are shared with activating abilities, in `casting-steps.ts`.

import type { CardDatabase } from "../cards/types.ts";
import { happen } from "../pipeline/happen.ts";
import { zoneChangeOf } from "../pipeline/moved.ts";
import { totalCost } from "../rules/costs.ts";
import { targetSpecsOf, targetsProblem } from "../rules/targets.ts";
import { castTimingProblem } from "../rules/timing.ts";
import type { Casting } from "../state/casting.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { zoneList } from "../zones/zone-list.ts";
import { nextCastingStep } from "./casting-steps.ts";
import type { Progress } from "./progress.ts";

/**
 * Why the player can't begin casting this card now, or null: the check that the proposed spell can legally be cast
 * (CR 601.2e), done once, before the card moves (CR 601.2a), rather than after all the choices: it's in
 * their hand and the timing allows it. Two shortcuts give the same result as starting and then reversing the cast
 * (CR 601.2, 734.1): every instance of "target" must have enough legal choices (CR 601.2c, 115.3), and a card with no mana cost can't be
 * cast (it has no alternative costs yet; CR 118.6 makes the attempt legal, but it could never be paid). Whether the
 * player can pay is NOT checked: attempting is legal (CR 118.6), and a player who can't pay cancels.
 */
export function castProblem(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): string | null {
  if (!zoneList(state, { zone: "hand", player }).includes(card)) return `${card} isn't in ${player}'s hand`;
  const timing = castTimingProblem(state, player, card, cards);
  if (timing !== null) return timing;
  const targets = targetsProblem(state, targetSpecsOf(state, card, cards), { object: card, controller: player }, cards);
  if (targets !== null) return targets;
  if (totalCost(state, card, cards) === null) return "it has no mana cost, so it could never be paid (CR 118.6)";
  return null;
}

/** CR 601.2a: the card moves to the stack, and the cast continues with its targets and costs. */
export function startCast(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): Progress {
  const obj = state.objects[card];
  const ps = state.players[player];
  if (obj?.kind !== "card" || ps === undefined) throw new Error(`Can't cast ${card}`);
  const handIndex = zoneList(state, { zone: "hand", player }).indexOf(card);
  const moved = happen(state, { kind: "moveCard", object: card, to: { zone: "stack", controller: player } }, cards);
  const change = zoneChangeOf(moved.events, card);
  if (change === null) throw new Error(`${card} didn't move to the stack`);
  const casting: Casting = {
    player,
    object: change.newId,
    origin: { kind: "card", card: obj, handIndex },
    poolBefore: ps.manaPool,
    tappedForMana: [],
    targetCounts: [],
    sacrifices: [],
    pendingTriggersBefore: state.pendingTriggers.length,
  };
  const next = nextCastingStep({ ...moved.state, casting }, cards);
  return { state: next.state, events: [...moved.events, ...next.events] };
}
