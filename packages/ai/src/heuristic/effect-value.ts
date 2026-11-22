// What the effects of a spell or ability that don't target are worth to the heuristic: a rough count of cards drawn,
// bodies made, life and damage. Effects it doesn't weigh yet count as nothing, so they never make it cast a spell.

import type { Effect, SeatView, SeenCard } from "@mtg/engine";
import { controlledBy, creatureValue, lifeOf, opponents } from "./board.ts";

export function untargetedValue(shown: SeatView, effects: readonly Effect[], x: number): number {
  return effects.reduce((sum, effect) => sum + effectValue(shown, effect, x), 0);
}

type Amount = Extract<Effect, { op: "draw" }>["amount"];

function effectValue(shown: SeatView, effect: Effect, x: number): number {
  const amount = (a: Amount) => (typeof a === "number" ? a : a === "X" ? x : 1);
  switch (effect.op) {
    case "draw":
      return effect.who === "you" ? 1.5 * amount(effect.amount) : 0;
    case "createTokens":
      return 2 * amount(effect.amount);
    case "gainLife":
      return effect.who === "you" ? 0.3 * amount(effect.amount) : 0;
    case "extraTurn":
      return effect.who === "you" ? 5 : 0;
    case "search":
      return 1;
    case "dealDamage":
      return effect.to === "eachOpponent" ? toOpponents(shown, amount(effect.amount)) : 0;
    case "loseLife":
      return effect.who === "eachOpponent" ? toOpponents(shown, amount(effect.amount)) : 0;
    case "destroy":
    case "exile":
      return typeof effect.of === "object" && "each" in effect.of ? sweepValue(shown, effect.of.each.types) : 0;
    case "if":
      // Its condition isn't weighed: half of what it would do.
      return untargetedValue(shown, effect.effects, x) / 2;
    // Targeted (weighed by `targets.ts`), or not weighed yet.
    case "addMana":
    case "modifyPT":
    case "cantBlock":
    case "gainKeywords":
    case "cantBeBlocked":
    case "mustAttack":
    case "gainControl":
    case "attachSelf":
    case "untap":
    case "doesntUntap":
    case "putCounters":
    case "cantCastSpells":
    case "becomes":
    case "sacrificeSource":
    case "preventAllDamage":
    case "regenerate":
    case "revealUntil":
    case "destroyOneAtRandom":
    case "returnToHand":
    case "putOnTopOfLibrary":
    case "tap":
    case "counter":
    case "discardAtRandom":
    case "mill":
    case "discard":
    case "revealHand":
    case "putOntoBattlefield":
    case "returnAllToBattlefield":
    case "nameCard":
    case "reveal":
    case "put":
    case "revealTop":
    case "shuffleIntoLibraries":
    case "copySpell":
    case "mayPlayWithoutPaying":
    case "shuffle":
    case "lookAtTop":
    case "choose":
    case "exileAll":
    case "sacrifice":
    case "createDelayedTrigger":
      return 0;
  }
}

/** Damage or life loss for each opponent: the game when it's lethal, half a point a point before. */
function toOpponents(shown: SeatView, amount: number): number {
  return opponents(shown).some((p) => lifeOf(shown, p) <= amount) ? 100 : amount / 2;
}

/** "Destroy all creatures": worth what the opponents lose less what it costs the heuristic. */
function sweepValue(shown: SeatView, types: readonly string[] | undefined): number {
  const hit = (c: SeenCard) => types === undefined || c.characteristics.types.some((t) => types.includes(t));
  const worth = (cs: SeenCard[]) => cs.filter(hit).reduce((sum, c) => sum + creatureValue(c), 0);
  const theirs = opponents(shown).reduce((sum, p) => sum + worth(controlledBy(shown, p)), 0);
  return theirs - worth(controlledBy(shown, shown.player));
}
