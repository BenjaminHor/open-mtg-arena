// What the effects of a spell or ability that don't target are worth to the heuristic: a rough count of cards drawn,
// bodies made, life and damage. Effects it doesn't weigh yet count as nothing, so they never make it cast a spell.

import type { CardDatabase, Effect, EffectSubject, SeatView, SeenCard } from "@mtg/engine";
import {
  controlledBy,
  creaturesOf,
  creatureValue,
  LETHAL,
  lifeOf,
  opponents,
  seenCard,
  toughnessLeft,
} from "./board.ts";
import type { Pump } from "./fights.ts";
import { stackIntents } from "./intents.ts";
import { losesFight, type Pumping, pumpsValue } from "./tricks.ts";

/**
 * `source`: the permanent whose ability this is ("this creature", "enchanted creature"); null for a spell. `repeats`:
 * how many times it can be done now (Firebreathing's "{R}: +1/+0" with three Mountains untapped): its pumps are weighed
 * all together, as one activation is worth what the activations it starts lead to. The pumps until end of turn of one
 * spell are weighed together too (Overrun's +3/+3 and trample), as their worth lies in what they do at once.
 */
export function untargetedValue(
  shown: SeatView,
  effects: readonly Effect[],
  x: number,
  source: SeenCard | null,
  cards: CardDatabase,
  repeats = 1,
): number {
  const rest = effects.reduce((sum, effect) => sum + effectValue(shown, effect, x, source, cards), 0);
  const pumps = untilEndOfTurnPumps(shown, effects, source, repeats);
  return rest + (pumps.length === 0 ? 0 : pumpsValue(shown, pumps));
}

/** Every pump until end of turn in these effects, merged into one per creature, `repeats` times over. */
function untilEndOfTurnPumps(shown: SeatView, effects: readonly Effect[], source: SeenCard | null, repeats: number) {
  const merged: Pumping[] = [];
  const add = (subject: EffectSubject, pump: Pump) => {
    for (const creature of subjectCreatures(shown, subject, source)) {
      const at = merged.findIndex((m) => m.creature.id === creature.id);
      const was = at === -1 ? NO_PUMP : (merged[at] as Pumping).pump;
      const now = {
        power: was.power + pump.power * repeats,
        toughness: was.toughness + pump.toughness * repeats,
        keywords: [...was.keywords, ...pump.keywords],
      };
      if (at === -1) merged.push({ creature, pump: now });
      else merged[at] = { creature, pump: now };
    }
  };
  for (const e of effects) {
    if (e.op === "modifyPT" && e.duration === "endOfTurn")
      add(e.of, { power: e.power, toughness: e.toughness, keywords: [] });
    if (e.op === "gainKeywords" && e.duration === "endOfTurn")
      add(e.of, { power: 0, toughness: 0, keywords: e.keywords });
  }
  return merged;
}

type Amount = Extract<Effect, { op: "draw" }>["amount"];

function effectValue(shown: SeatView, effect: Effect, x: number, source: SeenCard | null, cards: CardDatabase): number {
  const amount = (a: Amount) => (typeof a === "number" ? a : a === "X" ? x : 1);
  switch (effect.op) {
    case "draw":
      return effect.who === "you" ? 1.5 * amount(effect.amount) : 0;
    case "createTokens": {
      // Each token worth about half a creature of its size, at least 1 (a "*" one, as a 1/1): a body on the table.
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
    case "regenerate":
      return regenerateValue(shown, subjectCreatures(shown, effect.of, source)[0] ?? null, cards);
    // Pumps until end of turn, weighed all together (`untilEndOfTurnPumps`); targeted effects, weighed by `targets.ts`;
    // and what isn't weighed yet.
    case "modifyPT":
    case "gainKeywords":
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
 * The heuristic's own creatures an untargeted effect is about: "this creature", "enchanted creature", "creatures you
 * control" (Overrun), "attacking creatures" (Trumpet Blast). Targeted ones are weighed with their target (`targets.ts`).
 */
function subjectCreatures(shown: SeatView, subject: EffectSubject, source: SeenCard | null): SeenCard[] {
  const mine = creaturesOf(shown, shown.player);
  const one = (c: SeenCard | null | undefined) => (c === null || c === undefined ? [] : [c]);
  if (subject === "self") return one(source);
  if (subject === "attached") return one(source?.attachedTo == null ? null : seenCard(shown, source.attachedTo));
  if (typeof subject !== "object" || !("each" in subject)) return [];
  const filter = subject.each;
  if (filter.controller !== undefined && filter.controller !== "you") return [];
  if (filter.combat === "attacking") return mine.filter((c) => c.attacking !== null);
  return filter.controller === "you" ? mine : [];
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
  if (mine <= amount) return -LETHAL;
  const ownLoss = mine - amount <= 5 ? amount : amount / 2;
  return toOpponents(shown, amount) - ownLoss;
}

/** Damage or life loss for each opponent: the game when it's lethal, half a point a point before. */
function toOpponents(shown: SeatView, amount: number): number {
  return opponents(shown).some((p) => lifeOf(shown, p) <= amount) ? LETHAL : amount / 2;
}

/** "Destroy all creatures": worth what the opponents lose less what it costs the heuristic. */
function sweepValue(shown: SeatView, types: readonly string[] | undefined): number {
  const hit = (c: SeenCard) => types === undefined || c.characteristics.types.some((t) => types.includes(t));
  const worth = (cs: SeenCard[]) => cs.filter(hit).reduce((sum, c) => sum + creatureValue(c), 0);
  const theirs = opponents(shown).reduce((sum, p) => sum + worth(controlledBy(shown, p)), 0);
  return theirs - worth(controlledBy(shown, shown.player));
}
