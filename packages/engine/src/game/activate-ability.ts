// Activating an activated ability that isn't a mana ability (CR 602.2): checking it can begin, and creating the
// ability on the stack. The rest follows the casting steps (CR 602.2b), in `casting-steps.ts`.

import type { CardDatabase } from "../cards/types.ts";
import { activationBasicsProblem } from "../mana/activate.ts";
import { findAbility, isManaAbility } from "../rules/abilities.ts";
import { targetsProblem } from "../rules/targets.ts";
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
 * can't pay cancels. Every instance of "target" must have enough legal choices (CR 601.2c, 602.2b).
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
  // Mana and sacrifices so far; {T} on an ability that uses the stack comes with the first card that has one. Whether
  // there's anything to sacrifice isn't checked, as payability isn't (D-035): a player who can't pay cancels.
  if (ability.def.cost.some((part) => part.kind === "tap")) return "{T} in such a cost isn't supported yet";
  // The ability isn't on the stack yet, so its source stands in as what targets; it can target its own source.
  return targetsProblem(state, ability.def.targets, { object: source, controller: player }, cards);
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
    targetCounts: [],
    sacrifices: [],
  };
  return nextCastingStep({ ...created.state, casting }, cards);
}
