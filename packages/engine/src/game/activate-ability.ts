// Activating an activated ability that isn't a mana ability (CR 602.2): checking it can begin, and creating the
// ability on the stack. The rest follows the casting steps (CR 602.2b), in `casting-steps.ts`.

import type { CardDatabase } from "../cards/types.ts";
import { activationBasicsProblem } from "../mana/activate.ts";
import { findAbility, isManaAbility } from "../rules/abilities.ts";
import { namedCantActivate } from "../rules/chosen-name.ts";
import { targetsProblem } from "../rules/targets.ts";
import { mainPhaseEmptyStack } from "../rules/timing.ts";
import type { Casting } from "../state/casting.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { AbilityRef } from "../state/objects.ts";
import { putAbilityOnStack } from "../zones/stack-abilities.ts";
import { castingBegins, nextCastingStep } from "./casting-steps.ts";
import { loyaltyAbilityProblem } from "./loyalty-abilities.ts";
import type { Progress } from "./progress.ts";

/**
 * Why the player can't begin activating this ability now, or null. Only the controller of a permanent activates its
 * abilities (CR 602.2), whenever they have priority (CR 113.3b), unless the ability says "activate only as a sorcery"
 * (CR 602.5d). Mana abilities go through `mana/activate.ts` instead. As with casting, payability isn't checked (D-035):
 * a player who can't pay cancels. Every instance of "target" must have enough legal choices (CR 601.2c, 602.2b).
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
  // "Can't be activated unless they're mana abilities" (Pithing Needle, CR 602.5): only this check, not mana abilities'.
  const named = namedCantActivate(state, source, cards);
  if (named !== null) return `activated abilities of sources named ${named} can't be activated`;
  // "Activate only as a sorcery": the timing of a sorcery (CR 602.5d, 117.1a), as equip is (CR 702.6a).
  if (ability.def.timing === "sorcery" && !mainPhaseEmptyStack(state, player))
    return "only as a sorcery: in your main phase with an empty stack (CR 602.5d)";
  // A loyalty ability: as a sorcery, once per turn for its permanent, and enough counters (CR 606.3, 606.6).
  const loyalty = loyaltyAbilityProblem(state, player, source, ability.def, cards);
  if (loyalty !== null) return loyalty;
  // {T} was checked with the basics. Whether there's anything to sacrifice isn't checked, as payability isn't (D-035):
  // a player who can't pay cancels.
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
    ...castingBegins(state),
  };
  return nextCastingStep({ ...created.state, casting }, cards);
}
