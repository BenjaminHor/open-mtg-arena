// Checks that the hand-written definitions agree with the card data. Run by the tests, so `pnpm check` fails
// when Scryfall's Oracle text changes (errata) or a card is missing a definition (docs/card-scripting.md).

import type { CardDef, Effect, EffectSubject, TargetSpec } from "@mtg/engine";
import type { PoolCard } from "./pool-data.ts";

/** Keyword actions (CR 701) Scryfall lists among a card's keywords, as the pool's cards use them; add each as it comes. */
const KEYWORD_ACTIONS: readonly string[] = ["mill"];

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
      .filter((k) => !KEYWORD_ACTIONS.includes(k))
      .sort();
    const actual = [...(def.keywords ?? [])].sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      problems.push(`${def.name}: keywords ${JSON.stringify(actual)}, but Oracle has ${JSON.stringify(expected)}`);
    }
    if (def.spell !== undefined)
      problems.push(
        ...targetProblems(def.name, def.spell.targets, def.spell.effects, def.spell.costIncrease !== undefined),
      );
    for (const [i, ability] of (def.abilities ?? []).entries()) {
      problems.push(...targetProblems(`${def.name} ability ${i + 1}`, ability.targets, ability.effects));
      problems.push(...subjectProblems(`${def.name} ability ${i + 1}`, ability.targets, ability.effects));
    }
    if (def.spell !== undefined) problems.push(...subjectProblems(def.name, def.spell.targets, def.spell.effects));
  }
  for (const card of pool) {
    if (!defined.has(card.name)) problems.push(`${card.name}: is in the pool but has no definition`);
  }
  return problems;
}

/**
 * Target shapes the engine can't use, caught here rather than in a game: a count whose minimum is above its maximum, and
 * a divided effect that doesn't divide among an instance of "target", or divides less than that instance's minimum,
 * since each target needs at least one (CR 601.2d).
 */
function targetProblems(
  where: string,
  targets: readonly TargetSpec[],
  effects: readonly Effect[],
  costIncrease = false,
): string[] {
  const problems: string[] = [];
  for (const [i, spec] of targets.entries()) {
    const count = spec.count;
    if (count !== undefined && count.max !== "any" && count.min > count.max)
      problems.push(`${where}: target ${i} has a minimum above its maximum`);
  }
  if (costIncrease && targets.length !== 1)
    problems.push(`${where}: a cost increase per target is only read for a spell with one instance of "target"`);
  for (const effect of effects) {
    if (effect.op !== "dealDamage" || effect.divided === undefined) continue;
    const spec = typeof effect.to === "string" ? undefined : targets[effect.to.target];
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
};

/**
 * Subjects of the wrong kind, which would quietly do nothing: an op on objects naming a player ("you", "each player", a
 * player target), or an op on players naming an object ("self", an object target).
 */
function subjectProblems(where: string, targets: readonly TargetSpec[], effects: readonly Effect[]): string[] {
  const problems: string[] = [];
  const targetKind = (s: EffectSubject) => (typeof s === "object" ? targets[s.target]?.kind : undefined);
  const playerOnly = (s: EffectSubject) => {
    const kind = targetKind(s);
    return (
      s === "you" || s === "eachPlayer" || kind === "player" || kind === "opponent" || kind === "playerOrPlaneswalker"
    );
  };
  const objectOnly = (s: EffectSubject) => {
    const kind = targetKind(s);
    return s === "self" || s === "found" || kind === "permanent" || kind === "spell" || kind === "cardInGraveyard";
  };
  for (const effect of effects) {
    const of = OBJECT_SUBJECTS[effect.op];
    if (of !== undefined && playerOnly(of(effect)))
      problems.push(`${where}: ${effect.op} acts on objects, not players`);
    const who = PLAYER_SUBJECTS[effect.op];
    if (who !== undefined && objectOnly(who(effect)))
      problems.push(`${where}: ${effect.op} is for players, not objects`);
    // A chosen discard waits for one player's choice; several players' would need APNAP order (later: CR 608.2e).
    if (effect.op === "discard" && effect.who === "eachPlayer")
      problems.push(`${where}: a chosen discard names one player, not each player`);
    // "Found" and "exiled this way" are results of an earlier effect of the same resolution (CR 608.2c).
    const earlier = effects.slice(0, effects.indexOf(effect));
    if (JSON.stringify(effect).includes('"found"') && !earlier.some((e) => e.op === "search"))
      problems.push(`${where}: ${effect.op} names the cards found, but no search comes before it`);
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
