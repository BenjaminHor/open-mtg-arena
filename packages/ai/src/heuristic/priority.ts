// What the heuristic does with priority (CR 117): play a land, then the spell or ability worth the most, else pass.
// It starts only what it can strictly pay for now (`payable`, the engine's own pick of sources, X as 0) and only what
// has a target worth choosing, and the choices after (`choices.ts`) keep the cost payable: an X it can pay for, one
// target for a spell that costs more per target. A stateless player that started something it then had to cancel
// would see the same table again and start it again.

import type {
  Action,
  ActionOption,
  CardDatabase,
  CardDef,
  Color,
  Effect,
  ManaCost,
  SeatView,
  SeenCard,
} from "@mtg/engine";
import { isManaAbility, manaValue } from "@mtg/engine";
import { cardData, controlledBy, creatureValue, isLand, manaValueOf, permanentValue, seenCard } from "./board.ts";
import { untargetedValue } from "./effect-value.ts";
import { abilityIntents, cardIntents, type Intent } from "./intents.ts";
import { bestLand, landColors } from "./lands.ts";
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
  const printed = cardData(card, cards)?.printed.manaCost ?? null;
  const x = xEstimate(shown, printed, def.spell?.xPaidWith, cards);
  if (isPermanent && def.enchant === undefined) {
    // A permanent with an X it can't make more than 0 of (Protean Hydra) would enter as nothing worth having.
    if (printed?.some((s) => s.kind === "x") === true && x < 1) return null;
    // A permanent with no target: worth its size, so the biggest affordable one comes first, and what it does as it
    // enters (CR 603.6a) when that needs no target ("each player loses 3 life" can make it not worth casting).
    const size = card.characteristics.types.includes("creature") ? creatureValue(card) : 0;
    const entering = (def.triggers ?? [])
      .filter((t) => t.when.kind === "selfEnters" && t.targets.length === 0)
      .reduce((sum, t) => sum + untargetedValue(shown, t.effects, x, null, cards), 0);
    const value = 2 + manaValueOf(card, cards) + x + size / 4 + entering;
    return value > 0 ? value : null;
  }
  const value = effectsValue(shown, option, cardIntents(def, x), def.spell?.effects ?? [], x, cards);
  return value !== null && value >= WORTH_CASTING ? value : null;
}

function abilityValue(shown: SeatView, option: ActionOption, cards: CardDatabase): number | null {
  const ability = option.ability;
  if (ability === null || isManaAbility(ability) || option.action.type !== "ACTIVATE_ABILITY") return null;
  // Sacrificing another permanent is left to people for now (later: weigh which one goes).
  if (ability.cost.some((c) => c.kind === "sacrifice")) return null;
  const source = seenCard(shown, option.action.object);
  // Sacrificing its own source (a fetch land, Gargoyle Castle) costs what the source is worth.
  const sacrificed = ability.cost.some((c) => c.kind === "sacrificeSelf") && source !== null;
  const given = sacrificed ? permanentValue(source, cards) : 0;
  // Moving Equipment that's already on a creature only shuffles it around.
  const attached = source !== null && source.attachedTo !== null;
  if (ability.keyword === "equip" && attached) return null;
  const loyalty = ability.cost.find((c) => c.kind === "loyalty");
  const left = source?.counters.loyalty ?? 0;
  if (loyalty?.kind === "loyalty") {
    const spent = loyalty.amount === "minusX" ? left - 1 : -loyalty.amount;
    // A planeswalker that would be left with no loyalty dies (CR 704.5i): keep it. A [−X] for 0 does nothing.
    if ((spent >= left && spent > 0) || (loyalty.amount === "minusX" && spent <= 0)) return null;
    const x = loyalty.amount === "minusX" ? spent : 0;
    const effect = effectsValue(shown, option, abilityIntents(ability, x), ability.effects, x, cards);
    if (effect === null) return null;
    // An up ability is good to use every turn; a down ability has to be worth the loyalty it spends.
    if (spent <= 0) return 1 + effect - spent / 2;
    return effect >= WORTH_CASTING ? effect - spent / 2 : null;
  }
  const x = xEstimate(shown, option.manaCost, undefined, cards);
  const gained = effectsValue(shown, option, abilityIntents(ability, x), ability.effects, x, cards);
  const value = gained === null ? null : gained - given;
  // An ability's cost is usually smaller than a card's, so less is enough: pinging a player with a {T} ability.
  return value !== null && value >= WORTH_CASTING / 2 ? value : null;
}

/**
 * Its targets' best scores plus what its untargeted effects do; null when it has a target with no legal choice. A combat
 * trick scores only in combat (`tricks.ts`), so a main phase never wastes one.
 */
function effectsValue(
  shown: SeatView,
  option: ActionOption,
  intents: readonly Intent[],
  effects: readonly Effect[],
  x: number,
  cards: CardDatabase,
): number | null {
  const source = option.action.type === "ACTIVATE_ABILITY" ? seenCard(shown, option.action.object) : null;
  let value = untargetedValue(shown, effects, x, source, cards);
  for (const [i, legal] of option.targets.entries()) {
    const intent = intents[i] ?? { kind: "neutral" };
    const best = bestTarget(shown, legal, intent, cards);
    if (best === null) return null;
    value += best.score;
  }
  return value;
}

/**
 * How big an X it could make with this cost (a spell's printed cost, which still has its {X}): the lands it could
 * still tap after the rest, only those making the color X must be paid with when it says (Consume Spirit's {B}). A
 * guess for weighing the spell; the X announced is one it can pay (`announceXAction`).
 */
function xEstimate(shown: SeatView, cost: ManaCost | null, paidWith: Color | undefined, cards: CardDatabase): number {
  if (cost === null || !cost.some((s) => s.kind === "x")) return 0;
  const untapped = controlledBy(shown, shown.player).filter((c) => isLand(c) && !c.tapped);
  const rest = manaValue(cost.filter((s) => s.kind !== "x"));
  if (paidWith === undefined) return Math.max(0, untapped.length - rest);
  const colored = cost.filter((s) => s.kind === "colored" && s.color === paidWith).length;
  const ofColor = untapped.filter((l) => landColors(l, cards).includes(paidWith)).length;
  return Math.max(0, Math.min(untapped.length - rest, ofColor - colored));
}
