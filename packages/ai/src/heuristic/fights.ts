// The combat math the heuristic uses for attacks, blocks and combat tricks: who kills whom when two creatures fight,
// as their characteristics stand now (a pump is weighed by trying the creature with its new power and toughness).

import type { Keyword, SeenCard } from "@mtg/engine";
import { has, power, toughnessLeft } from "./board.ts";

export function damageDealt(creature: SeenCard): number {
  return has(creature, "double strike") ? 2 * power(creature) : power(creature);
}

/** Flying can be blocked only by flying or reach (CR 702.9b, 702.17b); other evasion isn't weighed yet. */
export function canBlock(blocker: SeenCard, attacker: SeenCard): boolean {
  if (has(attacker, "flying")) return has(blocker, "flying") || has(blocker, "reach");
  return true;
}

/** Whether `a` deals `b` lethal damage in a fight between them, first strike counted (CR 702.7b). */
export function kills(a: SeenCard, b: SeenCard): boolean {
  if (power(a) <= 0 || has(b, "indestructible")) return false;
  const strikesFirst = (x: SeenCard) => has(x, "first strike") || has(x, "double strike");
  // Struck down first, `a` deals no regular combat damage.
  if (strikesFirst(b) && !strikesFirst(a) && lethal(b, a)) return false;
  return lethal(a, b);
}

function lethal(a: SeenCard, b: SeenCard): boolean {
  return has(a, "deathtouch") || damageDealt(a) >= toughnessLeft(b);
}

/** What a pump until end of turn gives a creature (Giant Growth, Overrun, Firebreathing). */
export type Pump = { power: number; toughness: number; keywords: readonly Keyword[] };

/** The creature with its power and toughness raised, to weigh a pump before casting it (CR 613.4c). */
export function pumped(card: SeenCard, pump: Pump): SeenCard {
  const c = card.characteristics;
  return {
    ...card,
    characteristics: {
      ...c,
      power: (c.power ?? 0) + pump.power,
      toughness: (c.toughness ?? 0) + pump.toughness,
      keywords: [...c.keywords, ...pump.keywords.filter((k) => !c.keywords.includes(k))],
    },
  };
}
