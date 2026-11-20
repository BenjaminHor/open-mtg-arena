// Checks that the hand-written definitions agree with the card data. Run by the tests, so `pnpm check` fails
// when Scryfall's Oracle text changes (errata) or a card is missing a definition (docs/card-scripting.md).

import type { CardDef, Effect, EffectSubject, TargetSpec, TriggerCondition } from "@mtg/engine";
import type { PoolCard } from "./pool-data.ts";

/** Keyword actions (CR 701) Scryfall lists among a card's keywords, as the pool's cards use them; add each as it comes. */
const KEYWORD_ACTIONS: readonly string[] = ["mill"];
/**
 * Generic terms Scryfall lists beside the keyword itself, which name no ability of their own: "Landwalk" beside
 * "Swampwalk" (CR 702.14a).
 */
const GENERIC_TERMS: readonly string[] = ["landwalk"];

/** Every disagreement between the definitions and the pool's card data, as readable messages. Empty when they agree. */
export function definitionProblems(defs: readonly CardDef[], pool: readonly PoolCard[]): string[] {
  const problems: string[] = [];
  const cards = new Map(pool.map((c) => [c.name, c]));
  const defined = new Set<string>();

  for (const def of defs) {
    if (defined.has(def.name)) problems.push(`${def.name}: defined twice`);
    defined.add(def.name);
    const card = cards.get(def.name);
    if (card === undefined) {
      problems.push(`${def.name}: has a definition but isn't in pool.txt / data/pool.json`);
      continue;
    }
    if (def.oracle !== card.oracleText) {
      problems.push(
        `${def.name}: Oracle text changed. Re-read the card, update the definition and its scenarios if the ` +
          `behavior changed, then the oracle field.\n  definition: ${JSON.stringify(def.oracle)}\n  ` +
          `Oracle now:  ${JSON.stringify(card.oracleText)}`,
      );
    }
    // Scryfall lists the card's keywords, which catches a missing "flying" or "reach". Its list also has keyword
    // actions (Mill, Scry: CR 701), which aren't keyword abilities (CR 702), so those are left out, and ability words
    // (Landfall, later: CR 207.2c); see docs/future-rules.md before adding a card with those.
    const expected = card.keywords
      .map((k) => k.toLowerCase())
      .filter((k) => !KEYWORD_ACTIONS.includes(k) && !GENERIC_TERMS.includes(k))
      .sort();
    const actual = [...(def.keywords ?? [])].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      problems.push(`${def.name}: keywords ${JSON.stringify(actual)}, but Oracle has ${JSON.stringify(expected)}`);
    }
    if (def.spell !== undefined)
      problems.push(
        ...targetProblems(def.name, def.spell.targets, def.spell.effects, def.spell.costIncrease !== undefined),
      );
    // "Spend only black mana on X" needs an {X} to restrict.
    if (def.spell?.xPaidWith !== undefined && !card.manaCost.includes("{X}"))
      problems.push(`${def.name}: xPaidWith restricts paying X, but the mana cost has no {X}`);
    // "Add one mana of any color" takes its color from the activation, which only a mana ability has (CR 605.1a, D-068).
    const anyColor = (effects: readonly Effect[]) =>
      flatEffects(effects).some((e) => e.op === "addMana" && e.mana === "anyColor");
    if (def.spell !== undefined && anyColor(def.spell.effects))
      problems.push(`${def.name}: mana of any color is only for a mana ability`);
    for (const [i, ability] of (def.abilities ?? []).entries()) {
      if (anyColor(ability.effects) && (ability.targets.length > 0 || ability.cost.some((p) => p.kind !== "tap")))
        problems.push(`${def.name} ability ${i + 1}: mana of any color is only for a mana ability with a {T} cost`);
      problems.push(...targetProblems(`${def.name} ability ${i + 1}`, ability.targets, ability.effects));
      problems.push(...subjectProblems(`${def.name} ability ${i + 1}`, ability.targets, ability.effects));
    }
    if (def.spell !== undefined) problems.push(...subjectProblems(def.name, def.spell.targets, def.spell.effects));
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
    for (const [i, trigger] of (def.triggers ?? []).entries()) {
      if (!suppliesPlayer(trigger.when) && (namesTriggeringPlayer(trigger.effects) || limitsToThatPlayer(trigger)))
        problems.push(`${def.name} trigger ${i + 1}: its event has no "that player"`);
      // "That player controls" is read only where targets are chosen and checked (rules/targets.ts).
      if (limitsToThatPlayer({ when: trigger.when, effects: trigger.effects }))
        problems.push(`${def.name} trigger ${i + 1}: only a target can be limited to what "that player" controls`);
      if (!suppliesObject(trigger.when) && namesTriggering(trigger.effects, "triggeringObject"))
        problems.push(`${def.name} trigger ${i + 1}: its event has no "that creature"`);
      if (!suppliesAmount(trigger.when) && namesThatMuch(trigger.effects))
        problems.push(`${def.name} trigger ${i + 1}: its event has no "that much"`);
      if (anyColor(trigger.effects))
        problems.push(`${def.name} trigger ${i + 1}: mana of any color is only for a mana ability`);
      problems.push(...targetProblems(`${def.name} trigger ${i + 1}`, trigger.targets, trigger.effects));
      problems.push(...subjectProblems(`${def.name} trigger ${i + 1}`, trigger.targets, trigger.effects));
    }
  }
  for (const card of pool) {
    if (!defined.has(card.name)) problems.push(`${card.name}: is in the pool but has no definition`);
  }
  return problems;
}

/** Whether the trigger's event has an amount "that much" can mean (`TriggerEvent.amount`): only life gained so far. */
function suppliesAmount(when: TriggerCondition): boolean {
  switch (when.kind) {
    case "playerGainsLife":
      return true;
    case "selfEnters":
    case "anotherEnters":
    case "selfAttacks":
    case "beginningOfStep":
    case "spellCast":
    case "playerDraws":
    case "playerDiscards":
    case "landTappedForMana":
    case "selfDealsDamageToPlayer":
    case "selfBlocksOrBlocked":
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
      return true;
    case "beginningOfStep":
    case "playerDraws":
    case "playerDiscards":
    case "landTappedForMana":
    case "selfDealsDamageToPlayer":
    case "playerGainsLife":
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
    case "anotherEnters":
    case "selfAttacks":
    case "selfBlocksOrBlocked":
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

/** The effects with those nested in `ifNothingSacrificed` listed after it, in order, for the checks that read each. */
function flatEffects(effects: readonly Effect[]): Effect[] {
  return effects.flatMap((e) => (e.op === "ifNothingSacrificed" ? [e, ...flatEffects(e.effects)] : [e]));
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

/**
 * Target shapes the engine can't use, caught here rather than in a game: a count whose minimum is above its maximum, and
 * a divided effect that doesn't divide among an instance of "target", or divides less than that instance's minimum,
 * since each target needs at least one (CR 601.2d).
 */
function targetProblems(
  where: string,
  targets: readonly TargetSpec[],
  written: readonly Effect[],
  costIncrease = false,
): string[] {
  const effects = flatEffects(written);
  const problems: string[] = [];
  for (const [i, spec] of targets.entries()) {
    const count = spec.count;
    if (count !== undefined && count.max !== "any" && count.min > count.max)
      problems.push(`${where}: target ${i} has a minimum above its maximum`);
  }
  if (costIncrease && targets.length !== 1)
    problems.push(`${where}: a cost increase per target is only read for a spell with one instance of "target"`);
  for (const effect of effects) {
    // "Can't block" is a rules effect: on targets its set is fixed by them (CR 608.2b), but on "each creature ..." it
    // would apply to creatures arriving later (later: CR 611.2c, 613.11), which nothing reads yet.
    const onTargets = (of: unknown) => typeof of === "object" && of !== null && "target" in of;
    if ((effect.op === "cantBlock" || effect.op === "mustAttack") && !onTargets(effect.of))
      problems.push(`${where}: ${effect.op} applies only to targets until rules effects read their set live`);
    if (effect.op !== "dealDamage" || effect.divided === undefined) continue;
    // A division is announced as it's cast (CR 601.2d), when nothing can be counted yet.
    if (typeof effect.amount === "object" || (typeof effect.amount === "string" && effect.amount !== "X"))
      problems.push(`${where}: a divided amount is a number or X`);
    const spec = typeof effect.to === "object" && "target" in effect.to ? targets[effect.to.target] : undefined;
    if (spec === undefined) {
      problems.push(`${where}: divided damage must divide among an instance of "target"`);
    } else if (
      effect.divided === "asYouChoose" &&
      typeof effect.amount === "number" &&
      (spec.count?.min ?? 1) > effect.amount
    ) {
      problems.push(
        `${where}: divided damage of ${effect.amount} can't give each of at least ${spec.count?.min} targets 1`,
      );
    }
  }
  return problems;
}

/** Ops that act on objects, and the subject each names them with. */
const OBJECT_SUBJECTS: Partial<Record<Effect["op"], (e: Effect) => EffectSubject>> = {
  destroy: (e) => (e as { of: EffectSubject }).of,
  exile: (e) => (e as { of: EffectSubject }).of,
  returnToHand: (e) => (e as { of: EffectSubject }).of,
  putOnTopOfLibrary: (e) => (e as { of: EffectSubject }).of,
  tap: (e) => (e as { of: EffectSubject }).of,
  counter: (e) => (e as { of: EffectSubject }).of,
  modifyPT: (e) => (e as { of: EffectSubject }).of,
  reveal: (e) => (e as { of: EffectSubject }).of,
  put: (e) => (e as { of: EffectSubject }).of,
};

/** Ops that act on players, and the subject each names them with. */
const PLAYER_SUBJECTS: Partial<Record<Effect["op"], (e: Effect) => EffectSubject>> = {
  gainLife: (e) => (e as { who: EffectSubject }).who,
  loseLife: (e) => (e as { who: EffectSubject }).who,
  draw: (e) => (e as { who: EffectSubject }).who,
  discardAtRandom: (e) => (e as { who: EffectSubject }).who,
  mill: (e) => (e as { who: EffectSubject }).who,
  discard: (e) => (e as { who: EffectSubject }).who,
  revealHand: (e) => (e as { who: EffectSubject }).who,
  search: (e) => (e as { library: EffectSubject }).library,
  shuffle: (e) => (e as { who: EffectSubject }).who,
  mayShuffle: (e) => (e as { who: EffectSubject }).who,
  exileGraveyard: (e) => (e as { of: EffectSubject }).of,
  sacrifice: (e) => (e as { who: EffectSubject }).who,
  revealTop: (e) => (e as { who: EffectSubject }).who,
};

/**
 * Subjects of the wrong kind, which would quietly do nothing: an op on objects naming a player ("you", "each player", a
 * player target), or an op on players naming an object ("self", an object target).
 */
function subjectProblems(where: string, targets: readonly TargetSpec[], written: readonly Effect[]): string[] {
  const effects = flatEffects(written);
  const problems: string[] = [];
  const targetKind = (s: EffectSubject) =>
    typeof s === "object" && "target" in s ? targets[s.target]?.kind : undefined;
  const playerOnly = (s: EffectSubject) => {
    const kind = targetKind(s);
    return (
      s === "you" ||
      s === "eachPlayer" ||
      s === "eachOpponent" ||
      kind === "player" ||
      kind === "opponent" ||
      kind === "playerOrPlaneswalker"
    );
  };
  const objectOnly = (s: EffectSubject) => {
    const kind = targetKind(s);
    const each = typeof s === "object" && "each" in s;
    return (
      s === "self" || s === "found" || each || kind === "permanent" || kind === "spell" || kind === "cardInGraveyard"
    );
  };
  for (const effect of effects) {
    // Damage comes from one object (CR 120.2b): never a player, nor "each" of something.
    if (
      effect.op === "dealDamage" &&
      (playerOnly(effect.from) || (typeof effect.from === "object" && "each" in effect.from))
    )
      problems.push(`${where}: damage comes from one object`);
    const of = OBJECT_SUBJECTS[effect.op];
    if (of !== undefined && playerOnly(of(effect)))
      problems.push(`${where}: ${effect.op} acts on objects, not players`);
    const who = PLAYER_SUBJECTS[effect.op];
    if (who !== undefined && objectOnly(who(effect)))
      problems.push(`${where}: ${effect.op} is for players, not objects`);
    // A chosen discard waits for one player's choice; several players' would need APNAP order (later: CR 608.2e).
    const onePlayerOps: Effect["op"][] = ["discard", "search", "mayShuffle", "exileGraveyard", "sacrifice"];
    if (onePlayerOps.includes(effect.op) && PLAYER_SUBJECTS[effect.op]?.(effect) === "eachPlayer")
      problems.push(`${where}: ${effect.op} names one player, not each player`);
    // "Found" and "exiled this way" are results of an earlier effect of the same resolution (CR 608.2c).
    const earlier = effects.slice(0, effects.indexOf(effect));
    const names = (s: EffectSubject | undefined) => s === "found";
    const foundNamed = names(OBJECT_SUBJECTS[effect.op]?.(effect)) || names(PLAYER_SUBJECTS[effect.op]?.(effect));
    if (foundNamed && !earlier.some((e) => e.op === "search" || e.op === "revealTop"))
      problems.push(`${where}: ${effect.op} names the cards found, but no search or reveal comes before it`);
    const readsSacrificed =
      effect.op === "ifNothingSacrificed" || ("amount" in effect && effect.amount === "sacrificedPower");
    if (readsSacrificed && !earlier.some((e) => e.op === "sacrifice"))
      problems.push(`${where}: ${effect.op} reads what was sacrificed, but no sacrifice comes before it`);
    if (effect.op === "search" && effect.sameNameAsExiled === true && !earlier.some((e) => e.op === "exileGraveyard"))
      problems.push(`${where}: a search for the cards exiled this way must follow exiling them`);
    // A filter, or "you" choosing from another player's hand, would show or hint at a hidden hand's cards unless it was
    // just revealed (D-062).
    if (effect.op === "discard" && (effect.filter !== undefined || effect.chosenBy !== undefined)) {
      const revealed = effects
        .slice(0, effects.indexOf(effect))
        .some((e) => e.op === "revealHand" && JSON.stringify(e.who) === JSON.stringify(effect.who));
      if (!revealed)
        problems.push(`${where}: a discard with a filter or chosen by "you" must follow revealing that hand`);
    }
  }
  return problems;
}
