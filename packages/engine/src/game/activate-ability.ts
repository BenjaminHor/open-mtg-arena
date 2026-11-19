// Activating an activated ability that isn't a mana ability (CR 602.2): checking it can begin, and creating the
// ability on the stack. The rest follows the casting steps (CR 602.2b), in `casting-steps.ts`.

import type { CardDatabase } from "../cards/types.ts";
import { activationBasicsProblem } from "../mana/activate.ts";
import { findAbility, isManaAbility } from "../rules/abilities.ts";
import { legalTargets } from "../rules/targets.ts";
import type { Casting } from "../state/casting.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { AbilityRef } from "../state/objects.ts";
import { putAbilityOnStack } from "../zones/stack-abilities.ts";
import { nextCastingStep } from "./casting-steps.ts";
import type { Progress } from "./progress.ts";

/**
 * Why the player can't begin activating this ability now, or null. Only the controller of a permanent activates its
 * abilities (CR 602.2), whenever they have priority (CR 113.3b): there's no timing restriction in the pool. Mana
 * abilities go through `mana/activate.ts` instead. As with casting, payability isn't checked (D-035): a player who
 * can't pay cancels. Every target requirement must have a legal choice (CR 601.2c, 602.2b).
 */
export function activationProblem(
  state: GameState,
  player: PlayerId,
  source: ObjectId,
  ref: AbilityRef,
  cards: CardDatabase,
): string | null {
  const basics = activationBasicsProblem(state, player, source, ref, cards);
  if (basics !== null) return basics;
  const ability = findAbility(state, source, ref, cards);
  if (ability === null) return `${source} has no such ability`;
  if (isManaAbility(ability.def)) return "that's a mana ability";
  // Only mana in activation costs so far; {T} and other costs come with the first card that has one.
  if (ability.def.cost.some((part) => part.kind !== "mana")) return "costs other than mana aren't supported yet";
  for (const spec of ability.def.targets) {
    if (legalTargets(state, spec, cards).length === 0) return "there's nothing it could target (CR 601.2c)";
  }
  return null;
}

/** CR 602.2a: the ability is created on the stack, and the activation continues with its targets and costs. */
export function startActivation(
  state: GameState,
  player: PlayerId,
  source: ObjectId,
  ability: AbilityRef,
  cards: CardDatabase,
): Progress {
  const obj = state.objects[source];
  const ps = state.players[player];
  if (obj?.kind !== "card" || ps === undefined) throw new Error(`Can't activate ${source}`);
  const created = putAbilityOnStack(state, source, obj.oracleId, ability, player);
  const casting: Casting = {
    player,
    object: created.id,
    origin: { kind: "ability", source },
    poolBefore: ps.manaPool,
    tappedForMana: [],
  };
  return { state: nextCastingStep({ ...created.state, casting }, cards), events: [] };
}
