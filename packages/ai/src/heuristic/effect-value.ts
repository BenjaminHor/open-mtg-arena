// What the effects of a spell or ability that don't target are worth to the heuristic: a rough count of cards drawn,
// bodies made, life and damage. Effects it doesn't weigh yet count as nothing, so they never make it cast a spell.

import type { CardDatabase, Effect, EffectSubject, SeatView, SeenCard } from "@mtg/engine";
import { controlledBy, creaturesOf, creatureValue, lifeOf, opponents, seenCard, toughnessLeft } from "./board.ts";
import type { Pump } from "./fights.ts";
import { stackIntents } from "./intents.ts";
import { losesFight, type Pumping, pumpsValue } from "./tricks.ts";

/** `source`: the permanent whose ability this is ("this creature", "enchanted creature"); null for a spell. */
export function untargetedValue(
  shown: SeatView,
  effects: readonly Effect[],
  x: number,
  source: SeenCard | null,
  cards: CardDatabase,
): number {
  return effects.reduce((sum, effect) => sum + effectValue(shown, effect, x, source, cards), 0);
}

type Amount = Extract<Effect, { op: "draw" }>["amount"];

function effectValue(shown: SeatView, effect: Effect, x: number, source: SeenCard | null, cards: CardDatabase): number {
  const amount = (a: Amount) => (typeof a === "number" ? a : a === "X" ? x : 1);
  switch (effect.op) {
    case "draw":
      return effect.who === "you" ? 1.5 * amount(effect.amount) : 0;
    case "createTokens": {
      // Each token about as much as a creature of its size (a "*" one, as a 1/1).
      const { power, toughness } = effect.token;
      const size = 1.5 * (typeof power === "number" ? power : 1) + (typeof toughness === "number" ? toughness : 1);
      return amount(effect.amount) * Math.max(1, size / 2);
    }
    case "gainLife":
      return effect.who === "you" ? 0.3 * amount(effect.amount) : 0;
    case "extraTurn":
      return effect.who === "you" ? 5 : 0;
    // A card from the library: a land onto the battlefield, or a card to hand, worth about a card.
    case "search":
      return 2;
    case "dealDamage":
      return effect.to === "eachOpponent" ? toOpponents(shown, amount(effect.amount)) : 0;
    case "loseLife":
      if (effect.who === "eachOpponent") return toOpponents(shown, amount(effect.amount));
      return effect.who === "eachPlayer" ? toEveryone(shown, amount(effect.amount)) : 0;
    case "destroy":
    case "exile":
      return typeof effect.of === "object" && "each" in effect.of ? sweepValue(shown, effect.of.each.types) : 0;
    case "if":
      // Its condition isn't weighed: half of what it would do.
      return untargetedValue(shown, effect.effects, x, source, cards) / 2;
    case "modifyPT":
      if (effect.duration !== "endOfTurn") return 0;
      return pumpsValue(
        shown,
        pumpedBy(shown, effect.of, source, { power: effect.power, toughness: effect.toughness, keywords: [] }),
      );
    case "gainKeywords":
      if (effect.duration !== "endOfTurn") return 0;
      return pumpsValue(
        shown,
        pumpedBy(shown, effect.of, source, { power: 0, toughness: 0, keywords: effect.keywords }),
      );
    // Targeted (weighed by `targets.ts`), or not weighed yet.
    case "regenerate":
      return regenerateValue(shown, pumpedBy(shown, effect.of, source, NO_PUMP)[0]?.creature ?? null, cards);
    case "addMana":
    case "cantBlock":
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

/**
 * The creatures an untargeted pump gives to, among the heuristic's own: "this creature", "enchanted creature", or "creatures
 * you control" (Overrun). Targeted ones are weighed with their target (`targets.ts`).
 */
function pumpedBy(shown: SeatView, subject: EffectSubject, source: SeenCard | null, pump: Pump): Pumping[] {
  const mine = creaturesOf(shown, shown.player);
  const of = (c: SeenCard | null | undefined): Pumping[] =>
    c === null || c === undefined ? [] : [{ creature: c, pump }];
  if (subject === "self") return of(source);
  if (subject === "attached")
    return of(source?.attachedTo === null || source === null ? null : seenCard(shown, source.attachedTo));
  if (typeof subject === "object" && "each" in subject && subject.each.controller === "you") {
    return mine.map((creature) => ({ creature, pump }));
  }
  return [];
}

const NO_PUMP: Pump = { power: 0, toughness: 0, keywords: [] };

/**
 * A regeneration shield (CR 701.19a) is worth the creature when it would otherwise be destroyed now: it loses the fight
 * it's in, or an opponent's spell or ability on the stack would kill it. Nothing once it has a shield already.
 */
function regenerateValue(shown: SeatView, creature: SeenCard | null, cards: CardDatabase): number {
  if (creature === null || creature.regenerationShields > 0) return 0;
  return losesFight(shown, creature) || aimedAt(shown, creature, cards) ? creatureValue(creature) : 0;
}

/**
 * An opponent's spell or ability on the stack would destroy it or deal it lethal damage, what regeneration answers
 * (not a bounce, an exile or an Aura, CR 701.19a).
 */
function aimedAt(shown: SeatView, creature: SeenCard, cards: CardDatabase): boolean {
  return shown.view.zones.stack.some((id) => {
    const seen = shown.seen[id];
    if (seen === undefined) return false;
    const controller = seen.kind === "card" ? seen.characteristics.controller : seen.controller;
    if (controller === shown.player) return false;
    const intents = stackIntents(shown, id, cards);
    return (seen.choices?.targets ?? []).some((group, i) => {
      const intent = intents[i];
      if (intent?.kind !== "harm" || !group.some((t) => t.kind === "object" && t.object === creature.id)) return false;
      return intent.destroys === true || (intent.damage !== null && intent.damage >= toughnessLeft(creature));
    });
  });
}

/** Life loss for every player, the heuristic too (Howling Banshee): never when its own share is lethal. */
function toEveryone(shown: SeatView, amount: number): number {
  const mine = lifeOf(shown, shown.player);
  if (mine <= amount) return -100;
  const ownLoss = mine - amount <= 5 ? amount : amount / 2;
  return toOpponents(shown, amount) - ownLoss;
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
