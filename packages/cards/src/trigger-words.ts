// Words only a triggered ability can use ("that player", "that creature", "that much", "sacrifice it"), each read from
// what its trigger event supplies: misused, the engine would quietly do nothing, so the definition is refused instead.

import type { CardDef, Effect, TriggerCondition, TriggeredAbilityDef } from "@mtg/engine";
import { flatEffects } from "./flat-effects.ts";

/** Problems with the trigger-only words in this definition's spell and activated abilities (triggers: `...Of`). */
export function triggerWordProblems(def: CardDef): string[] {
  const problems: string[] = [];
  // Words only a triggered ability can use, which would otherwise do nothing in silence.
  if (def.spell?.effects.some((e) => e.op === "sacrificeSource"))
    problems.push(`${def.name}: a spell has no source to sacrifice ("sacrifice it" is for an ability)`);
  if (def.spell !== undefined && (namesTriggeringPlayer(def.spell.effects) || limitsToThatPlayer(def.spell)))
    problems.push(`${def.name}: "that player" is only for a triggered ability`);
  if (def.spell !== undefined && namesThatMuch(def.spell.effects))
    problems.push(`${def.name}: "that much" is only for a triggered ability`);
  if (def.spell !== undefined && namesTriggering(def.spell.effects, "triggeringObject"))
    problems.push(`${def.name}: "that creature" is only for a triggered ability`);
  for (const [i, ability] of (def.abilities ?? []).entries()) {
    if (namesTriggeringPlayer(ability.effects) || limitsToThatPlayer(ability))
      problems.push(`${def.name} ability ${i + 1}: "that player" is only for a triggered ability`);
    if (namesThatMuch(ability.effects))
      problems.push(`${def.name} ability ${i + 1}: "that much" is only for a triggered ability`);
    if (namesTriggering(ability.effects, "triggeringObject"))
      problems.push(`${def.name} ability ${i + 1}: "that creature" is only for a triggered ability`);
  }
  return problems;
}

/** Problems with the trigger-only words in one triggered ability, printed or delayed, named `where`. */
export function triggerWordProblemsOf(where: string, trigger: TriggeredAbilityDef): string[] {
  const problems: string[] = [];
  if (!suppliesPlayer(trigger.when) && (namesTriggeringPlayer(trigger.effects) || limitsToThatPlayer(trigger)))
    problems.push(`${where}: its event has no "that player"`);
  // "That player controls" is read only where targets are chosen and checked (rules/targets.ts).
  if (limitsToThatPlayer({ when: trigger.when, effects: trigger.effects }))
    problems.push(`${where}: only a target can be limited to what "that player" controls`);
  if (!suppliesObject(trigger.when) && namesTriggering(trigger.effects, "triggeringObject"))
    problems.push(`${where}: its event has no "that creature"`);
  if (!suppliesAmount(trigger.when) && namesThatMuch(trigger.effects))
    problems.push(`${where}: its event has no "that much"`);
  return problems;
}

/** Whether the trigger's event has an amount "that much" can mean (`TriggerEvent.amount`): only life gained so far. */
function suppliesAmount(when: TriggerCondition): boolean {
  switch (when.kind) {
    case "playerGainsLife":
      return true;
    case "selfEnters":
    case "selfDies":
    case "anotherEnters":
    case "selfAttacks":
    case "beginningOfStep":
    case "spellCast":
    case "playerDraws":
    case "playerDiscards":
    case "landTappedForMana":
    case "selfDealsDamageToPlayer":
    case "selfBlocksOrBlocked":
    case "selfBlocks":
    case "selfBecomesTarget":
    case "attachedBecomesTarget":
    case "selfCountersRemoved":
      return false;
  }
}

/** Whether the trigger's event has an object "that creature" can mean (`TriggerEvent.object`). */
function suppliesObject(when: TriggerCondition): boolean {
  switch (when.kind) {
    // The creature that entered or attacked, the spell cast, the creature on the other side of a block.
    case "selfEnters":
    case "anotherEnters":
    case "selfAttacks":
    case "spellCast":
    case "selfBlocksOrBlocked":
    case "selfBlocks":
      return true;
    // "It" is the source itself ("self"), not the event's object.
    case "selfDies":
      return false;
    case "selfBecomesTarget":
    case "attachedBecomesTarget":
    case "beginningOfStep":
    case "playerDraws":
    case "playerDiscards":
    case "landTappedForMana":
    case "selfDealsDamageToPlayer":
    case "playerGainsLife":
    case "selfCountersRemoved":
      return false;
  }
}

/** Whether any of these effects' amounts is "that much". */
function namesThatMuch(effects: readonly Effect[]): boolean {
  return flatEffects(effects).some((e) => "amount" in e && e.amount === "thatMuch");
}

/** Whether the trigger's event has a player "that player" can mean (`TriggerEvent.player`). */
function suppliesPlayer(when: TriggerCondition): boolean {
  switch (when.kind) {
    case "selfEnters":
    case "selfDies":
    case "anotherEnters":
    case "selfAttacks":
    case "selfBlocksOrBlocked":
    case "selfBlocks":
    case "selfBecomesTarget":
    case "attachedBecomesTarget":
    case "selfCountersRemoved":
      return false;
    // The player whose step it is, who cast the spell, drew, discarded, tapped the land, was dealt damage or gained life.
    case "beginningOfStep":
    case "spellCast":
    case "playerDraws":
    case "playerDiscards":
    case "landTappedForMana":
    case "selfDealsDamageToPlayer":
    case "playerGainsLife":
      return true;
  }
}

/** Whether a filter anywhere in this text (targets, effects, a trigger condition) says "that player controls". */
function limitsToThatPlayer(text: object): boolean {
  return JSON.stringify(text).includes('"controller":"triggeringPlayer"');
}

/** Whether any of these effects names "that player" (the subject `triggeringPlayer`), in any of its subject fields. */
function namesTriggeringPlayer(effects: readonly Effect[]): boolean {
  return namesTriggering(effects, "triggeringPlayer");
}

/** Whether any of these effects names "that player" or "that creature", in any of its subject fields. */
function namesTriggering(effects: readonly Effect[], subject: "triggeringPlayer" | "triggeringObject"): boolean {
  return flatEffects(effects).some((e) => Object.values(e).includes(subject));
}
