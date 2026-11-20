// Checks that the hand-written definitions agree with the card data. Run by the tests, so `pnpm check` fails
// when Scryfall's Oracle text changes (errata) or a card is missing a definition (docs/card-scripting.md).

import type { CardDef, Effect, TargetSpec } from "@mtg/engine";
import type { PoolCard } from "./pool-data.ts";

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
    // actions (Scry, CR 701) and ability words (Landfall, later: CR 207.2c), which aren't keyword abilities; see
    // docs/future-rules.md before adding a card with those.
    const expected = card.keywords.map((k) => k.toLowerCase()).sort();
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
    }
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
