// What the heuristic does with priority (CR 117): play a land, then the spell or ability worth the most, else pass.
// It starts only what it can strictly pay for now (`payable`, the engine's own pick of sources) and only what has a
// target worth choosing, so it never starts something it would then cancel: a stateless player that did would see the
// same table again and start it again (the host's loop would never end).

import type { Action, ActionOption, CardDatabase, CardDef, Effect, SeatView, SeenCard } from "@mtg/engine";
import { isManaAbility, manaValue } from "@mtg/engine";
import { cardData, controlledBy, creatureValue, isLand, lifeOf, manaValueOf, opponents, seenCard } from "./board.ts";
import { abilityIntents, cardIntents, type Intent } from "./intents.ts";
import { bestLand } from "./lands.ts";
import { bestTarget, WORTH_CASTING } from "./targets.ts";

export function priorityAction(shown: SeatView, cards: CardDatabase): Action {
  const pass = shown.options.find((o) => o.action.type === "PASS_PRIORITY");
  const land = bestLand(shown, cards);
  if (land !== null) return land;
  let best: { action: Action; value: number } | null = null;
  for (const option of shown.options) {
    const value = optionValue(shown, option, cards);
    if (value !== null && (best === null || value > best.value)) best = { action: option.action, value };
  }
  if (best !== null) return best.action;
  if (pass !== undefined) return pass.action;
  const first = shown.options[0];
  if (first === undefined) throw new Error("no legal actions to choose from");
  return first.action;
}

/** What starting this spell or ability is worth now; null when it isn't worth starting (or can't be paid). */
function optionValue(shown: SeatView, option: ActionOption, cards: CardDatabase): number | null {
  if (option.payable === false) return null;
  switch (option.action.type) {
    case "CAST_SPELL": {
      const card = seenCard(shown, option.action.object);
      const def = card === null ? undefined : cardData(card, cards)?.def;
      if (card === null || def === undefined || option.manaCost === null) return null;
      return spellValue(shown, option, card, def, cards);
    }
    case "ACTIVATE_ABILITY":
      return abilityValue(shown, option, cards);
    case "PASS_PRIORITY":
    case "PLAY_LAND":
    case "ANSWER":
    case "CONCEDE":
      return null;
  }
}

function spellValue(shown: SeatView, option: ActionOption, card: SeenCard, def: CardDef, cards: CardDatabase) {
  const isPermanent = !card.characteristics.types.some((t) => t === "instant" || t === "sorcery");
  if (isPermanent && def.enchant === undefined) {
    // A permanent with no target: worth its size, so the biggest affordable one comes first.
    const size = card.characteristics.types.includes("creature") ? creatureValue(card) : 0;
    return 2 + manaValueOf(card, cards) + size / 4;
  }
  const value = effectsValue(
    shown,
    option,
    cardIntents(def, xEstimate(shown, option)),
    def.spell?.effects ?? [],
    cards,
  );
  return value !== null && value >= WORTH_CASTING ? value : null;
}

function abilityValue(shown: SeatView, option: ActionOption, cards: CardDatabase): number | null {
  const ability = option.ability;
  if (ability === null || isManaAbility(ability) || option.action.type !== "ACTIVATE_ABILITY") return null;
  // A cost that gives up a permanent is left to people for now (later: weigh what's sacrificed).
  if (ability.cost.some((c) => c.kind === "sacrifice" || c.kind === "sacrificeSelf")) return null;
  const source = seenCard(shown, option.action.object);
  // Moving Equipment that's already on a creature only shuffles it around.
  if (ability.keyword === "equip" && source?.attachedTo !== null) return null;
  const loyalty = ability.cost.find((c) => c.kind === "loyalty");
  const left = source?.counters.loyalty ?? 0;
  if (loyalty?.kind === "loyalty") {
    const spent = loyalty.amount === "minusX" ? left - 1 : -loyalty.amount;
    // A planeswalker that would be left with no loyalty dies (CR 704.5i): keep it.
    if (spent >= left && spent > 0) return null;
    const intents = abilityIntents(ability, loyalty.amount === "minusX" ? left - 1 : 0);
    const effect = effectsValue(shown, option, intents, ability.effects, cards);
    if (effect === null) return null;
    // An up ability is good to use every turn; a down ability has to be worth the loyalty it spends.
    if (spent <= 0) return 1 + effect - spent / 2;
    return effect >= WORTH_CASTING ? effect - spent / 2 : null;
  }
  const value = effectsValue(shown, option, abilityIntents(ability, xEstimate(shown, option)), ability.effects, cards);
  // An ability's cost is usually smaller than a card's, so less is enough: pinging a player with a {T} ability.
  return value !== null && value >= WORTH_CASTING / 2 ? value : null;
}

/**
 * Its targets' best scores plus what its untargeted effects do. Null when it has a target with no legal choice, or is a
 * combat trick (a pump until end of turn), which a main phase would waste (later: cast it in combat).
 */
function effectsValue(
  shown: SeatView,
  option: ActionOption,
  intents: readonly Intent[],
  effects: readonly Effect[],
  cards: CardDatabase,
): number | null {
  let value = untargetedValue(shown, effects);
  for (const [i, legal] of option.targets.entries()) {
    const intent = intents[i] ?? { kind: "neutral" };
    if (intent.kind === "help" && intent.untilEndOfTurn) return null;
    const best = bestTarget(shown, legal, intent, cards);
    if (best === null) return null;
    value += best.score;
  }
  return value;
}

/** What the effects that don't target do for the heuristic: a rough count of cards, bodies, life and damage. */
function untargetedValue(shown: SeatView, effects: readonly Effect[]): number {
  let value = 0;
  for (const effect of effects) {
    switch (effect.op) {
      case "draw":
        value += effect.who === "you" ? 1.5 * fixed(effect.amount) : 0;
        break;
      case "createTokens":
        value += 2 * fixed(effect.amount);
        break;
      case "gainLife":
        value += effect.who === "you" ? 0.3 * fixed(effect.amount) : 0;
        break;
      case "extraTurn":
        value += 5;
        break;
      case "search":
        value += 1;
        break;
      case "dealDamage":
      case "loseLife": {
        const who = effect.op === "dealDamage" ? effect.to : effect.who;
        if (who !== "eachOpponent") break;
        const amount = fixed(effect.amount);
        value += opponents(shown).some((p) => lifeOf(shown, p) <= amount) ? 100 : amount / 2;
        break;
      }
      case "destroy":
      case "exile":
        if (typeof effect.of === "object" && "each" in effect.of) value += sweepValue(shown, effect.of.each.types);
        break;
      default:
        break;
    }
  }
  return value;
}

/** "Destroy all creatures": worth what the opponents lose less what it costs the heuristic. */
function sweepValue(shown: SeatView, types: readonly string[] | undefined): number {
  const hit = (c: SeenCard) => types === undefined || c.characteristics.types.some((t) => types.includes(t));
  const worth = (cs: SeenCard[]) => cs.filter(hit).reduce((sum, c) => sum + creatureValue(c), 0);
  const theirs = opponents(shown).reduce((sum, p) => sum + worth(controlledBy(shown, p)), 0);
  return theirs - worth(controlledBy(shown, shown.player));
}

function fixed(amount: unknown): number {
  return typeof amount === "number" ? amount : 1;
}

/** How big an X it could make: the lands it could still tap after the rest of the cost. A guess, not a plan. */
function xEstimate(shown: SeatView, option: ActionOption): number {
  if (!(option.manaCost ?? []).some((s) => s.kind === "x")) return 0;
  const untapped = controlledBy(shown, shown.player).filter((c) => isLand(c) && !c.tapped).length;
  const rest = manaValue((option.manaCost ?? []).filter((s) => s.kind !== "x"));
  return Math.max(0, untapped - rest);
}
