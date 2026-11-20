// Effects nested in other effects, as the definition checks and the golden cover read them (one place, so a new
// nesting op is placed once: the switch makes TypeScript ask). A condition's effects ("if you can't, ...") run as
// part of the same resolution, so they're read with the effects around them. A delayed triggered ability's effects
// run later, as their own ability, with their own targets and trigger event, so they're read apart (`delayedAbilities`).

import type { Effect, TriggeredAbilityDef } from "@mtg/engine";

/** The effects with those inside each condition listed after it, in order, for the checks that read each. */
export function flatEffects(effects: readonly Effect[]): Effect[] {
  return effects.flatMap((e) => [e, ...flatEffects(conditionalEffects(e))]);
}

/** The effects inside a condition, which run as part of the same resolution. */
export function conditionalEffects(effect: Effect): readonly Effect[] {
  switch (effect.op) {
    case "ifNothingSacrificed":
    case "ifActivatedThisTurn":
      return effect.effects;
    // Its ability's effects run later, as their own resolution: see `delayedAbilities`.
    case "createDelayedTrigger":
    case "regenerate":
    case "revealUntil":
    case "dealDamage":
    case "search":
    case "put":
    case "addMana":
    case "modifyPT":
    case "cantBlock":
    case "mustAttack":
    case "sacrificeSource":
    case "destroy":
    case "destroyOneAtRandom":
    case "destroyAll":
    case "exile":
    case "returnToHand":
    case "putOnTopOfLibrary":
    case "tap":
    case "counter":
    case "gainLife":
    case "loseLife":
    case "draw":
    case "discardAtRandom":
    case "mill":
    case "discard":
    case "revealHand":
    case "putOntoBattlefield":
    case "reveal":
    case "revealTop":
    case "shuffle":
    case "mayShuffle":
    case "lookAtTop":
    case "exileGraveyard":
    case "sacrifice":
      return [];
  }
}

/** The delayed triggered abilities these effects make, in conditions or in delayed abilities' own effects. */
export function delayedAbilities(effects: readonly Effect[]): TriggeredAbilityDef[] {
  return flatEffects(effects).flatMap((e) =>
    e.op === "createDelayedTrigger" ? [e.ability, ...delayedAbilities(e.ability.effects)] : [],
  );
}
