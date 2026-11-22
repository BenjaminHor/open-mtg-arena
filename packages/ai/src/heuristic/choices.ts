// The decisions made while casting or resolving: targets, X, how many targets, dividing damage, paying, sacrificing,
// choosing cards, "you may", names, and new targets for a copy. Each picks among its seat's legal answers, so any pick
// is legal; these make the picks sensible where it matters (CR 601.2b-d, 608.2d).

import type { Action, CardDatabase, ObjectId, SeatView, Target, ViewDecision } from "@mtg/engine";
import { cardDataByOracleId, manaValue } from "@mtg/engine";
import {
  cardData as cardDataOf,
  has,
  opponents,
  permanents,
  permanentValue,
  seenCard,
  toughnessLeft,
} from "./board.ts";
import { auraIntent, type Intent, stackIntents } from "./intents.ts";
import { targetScore } from "./targets.ts";

type AnswerOf = Extract<Action, { type: "ANSWER" }>["answer"];
type DecisionOf<K extends ViewDecision["kind"]> = Extract<ViewDecision, { kind: K }>;

/** The legal answers of one kind, with the action each one is. */
function answers<K extends AnswerOf["kind"]>(
  shown: SeatView,
  kind: K,
): { action: Action; answer: Extract<AnswerOf, { kind: K }> }[] {
  return shown.options.flatMap((o) =>
    o.action.type === "ANSWER" && o.action.answer.kind === kind
      ? [{ action: o.action, answer: o.action.answer as Extract<AnswerOf, { kind: K }> }]
      : [],
  );
}

function best<T>(items: readonly T[], score: (item: T) => number): T | undefined {
  let top: { item: T; score: number } | undefined;
  for (const item of items) {
    const s = score(item);
    if (top === undefined || s > top.score) top = { item, score: s };
  }
  return top?.item;
}

export function targetAction(shown: SeatView, d: DecisionOf<"chooseTarget">, cards: CardDatabase): Action | null {
  const intent = stackIntents(shown, d.object, cards)[d.instance] ?? { kind: "neutral" };
  return (
    best(answers(shown, "chooseTarget"), (a) => targetScore(shown, a.answer.target, intent, cards))?.action ?? null
  );
}

/** For a copy: keep a target, or choose a better one (CR 707.10c). */
export function newTargetAction(shown: SeatView, d: DecisionOf<"chooseNewTarget">, cards: CardDatabase): Action | null {
  const intent = stackIntents(shown, d.object, cards)[d.instance] ?? { kind: "neutral" };
  const original = d.original.targets[d.instance]?.[d.index] ?? null;
  const score = (t: Target | null) => {
    const target = t ?? original;
    return target === null ? -1 : targetScore(shown, target, intent, cards);
  };
  return best(answers(shown, "chooseNewTarget"), (a) => score(a.answer.target))?.action ?? null;
}

/**
 * As many targets as it has good ones (worth more than nothing to aim at), within what's allowed; just one for a spell
 * that costs more for each target beyond the first (Fireball, CR 601.2f), whose X already spent the mana.
 */
export function targetCountAction(shown: SeatView, d: DecisionOf<"chooseTargetCount">, cards: CardDatabase) {
  const intent = stackIntents(shown, d.object, cards)[d.instance] ?? { kind: "neutral" };
  const seen = shown.seen[d.object];
  const costsMore = seen?.kind === "card" && cardDataOf(seen, cards)?.def.spell?.costIncrease !== undefined;
  const candidates: Target[] = [
    ...shown.view.turnOrder.map((player) => ({ kind: "player" as const, player })),
    ...permanents(shown).map((c) => ({ kind: "object" as const, object: c.id })),
  ];
  const good = candidates.filter((t) => targetScore(shown, t, intent, cards) > 0).length;
  const wanted = Math.min(d.max, Math.max(d.min, costsMore ? 1 : good));
  return closest(answers(shown, "chooseTargetCount"), (a) => a.answer.count, wanted);
}

/**
 * The most X it can pay for (each answer shows its whole cost and whether the engine can pay it, D-144); for a loyalty
 * [−X], one less than its loyalty, so the planeswalker stays (CR 704.5i).
 */
export function announceXAction(shown: SeatView, d: DecisionOf<"announceX">): Action | null {
  const seen = shown.seen[d.object];
  const source = seen?.kind === "ability" ? seenCard(shown, seen.source) : null;
  const isLoyalty = source?.characteristics.types.includes("planeswalker") === true;
  const options = shown.options.flatMap((o) =>
    o.action.type === "ANSWER" && o.action.answer.kind === "announceX"
      ? [{ option: o, value: o.action.answer.value }]
      : [],
  );
  const affordable = options.filter((o) => o.option.payable !== false && (!isLoyalty || o.value < d.upTo));
  const pick = best(affordable, (o) => o.value) ?? best(options, (o) => -o.value);
  return pick?.option.action ?? null;
}

/** The answer whose number is `wanted`, or the nearest to it. */
function closest<T extends { action: Action }>(items: readonly T[], value: (item: T) => number, wanted: number) {
  return best(items, (i) => -Math.abs(value(i) - wanted))?.action ?? null;
}

/** Give each target what kills it, in order; the last gets the rest (CR 601.2d). */
export function divideAction(shown: SeatView, d: DecisionOf<"divide">): Action | null {
  const target = d.targets[d.shares.length];
  const needed = target?.kind === "object" ? needToKill(shown, target.object, false) : d.amount;
  return closestAmount(
    answers(shown, "divide").map((a) => ({ action: a.action, amount: a.answer.amount })),
    needed,
  );
}

/** An attacker's combat damage: lethal to each blocker in order, the rest on (CR 510.1c, 702.19b). */
export function assignDamageAction(shown: SeatView, d: DecisionOf<"assignDamage">): Action | null {
  const i = d.assigned.length;
  const recipient = d.recipients[i];
  const source = seenCard(shown, d.source);
  const deathtouch = source !== null && has(source, "deathtouch");
  const needed =
    d.lethal?.[i] ?? (recipient?.kind === "object" ? needToKill(shown, recipient.object, deathtouch) : d.amount);
  return closestAmount(
    answers(shown, "assignDamage").map((a) => ({ action: a.action, amount: a.answer.amount })),
    needed,
  );
}

/** Damage that's lethal to a creature (CR 702.2c: any amount, from deathtouch), or a planeswalker's loyalty. */
function needToKill(shown: SeatView, object: ObjectId, deathtouch: boolean): number {
  const card = seenCard(shown, object);
  if (card === null) return 0;
  if (card.characteristics.types.includes("creature")) return deathtouch ? 1 : Math.max(0, toughnessLeft(card));
  return card.counters.loyalty ?? 0;
}

/** The largest listed amount that's at most `wanted`, or the smallest when none is. */
function closestAmount(options: readonly { action: Action; amount: number }[], wanted: number): Action | null {
  const fitting = options.filter((o) => o.amount <= wanted);
  const pick = fitting.length > 0 ? best(fitting, (o) => o.amount) : best(options, (o) => -o.amount);
  return pick?.action ?? null;
}

/** Pay from the pool if it can; else a mana ability; cancelling only when nothing else is left. */
export function payManaAction(shown: SeatView): Action | null {
  const pay = answers(shown, "payMana")[0];
  if (pay !== undefined) return pay.action;
  const mana = shown.options.find((o) => o.action.type === "ACTIVATE_ABILITY");
  return mana?.action ?? null;
}

/** Sacrifice what's worth least. */
export function sacrificeAction(shown: SeatView, cards: CardDatabase): Action | null {
  const worth = (id: ObjectId) => {
    const card = seenCard(shown, id);
    return card === null ? 0 : -permanentValue(card, cards);
  };
  return best(answers(shown, "chooseSacrifice"), (a) => worth(a.answer.object))?.action ?? null;
}

/** Losing cards (discard, sacrifice, the bottom): as few as allowed, the least valuable. The rest: the most, the best. */
export function chooseCardsAction(shown: SeatView, d: DecisionOf<"chooseCards">, cards: CardDatabase): Action | null {
  const losing = d.purpose === "discard" || d.purpose === "sacrifice" || d.purpose === "putOnBottom";
  const enchanting = d.for !== null && d.purpose === "enchant" ? auraFor(d.for.oracleId, cards) : null;
  const worth = (i: number) => {
    const option = d.options[i];
    if (option === undefined) return 0;
    if (enchanting !== null && option.object !== null) {
      return targetScore(shown, { kind: "object", object: option.object }, enchanting, cards);
    }
    const value = option.object === null ? null : seenCard(shown, option.object);
    const printed = cardDataByOracleId(option.oracleId, cards)?.printed.manaCost ?? null;
    const own = value === null ? (printed === null ? 0 : manaValue(printed)) : permanentValue(value, cards);
    return losing ? -own : own;
  };
  const ranked = d.options.map((_, i) => i).sort((a, b) => worth(b) - worth(a));
  const wanted = losing ? d.min : d.max;
  const next = ranked.find((i) => !d.chosen.includes(i));
  const finish = answers(shown, "finishChoosing")[0];
  if ((d.chosen.length >= wanted || next === undefined) && finish !== undefined) return finish.action;
  const pick = answers(shown, "chooseCard").find((a) => a.answer.option === next);
  return pick?.action ?? finish?.action ?? answers(shown, "chooseCard")[0]?.action ?? null;
}

function auraFor(oracleId: Parameters<typeof cardDataByOracleId>[0], cards: CardDatabase): Intent | null {
  const def = cardDataByOracleId(oracleId, cards)?.def;
  return def?.enchant === undefined ? null : auraIntent(def);
}

/** The legend rule (CR 704.5j): keep the one worth most. */
export function keepLegendAction(shown: SeatView, d: DecisionOf<"keepLegend">, cards: CardDatabase): Action | null {
  const worth = (option: number) => {
    const id = d.options[option];
    const card = id === undefined ? null : seenCard(shown, id);
    return card === null ? 0 : permanentValue(card, cards);
  };
  return best(answers(shown, "chooseCard"), (a) => worth(a.answer.option))?.action ?? null;
}

/** "You may": yes, when yes is possible; the heuristic's cards' optional effects help their controller. */
export function yesNoAction(shown: SeatView, d: DecisionOf<"chooseYesNo">): Action | null {
  const yes = d.canSayYes;
  return answers(shown, "chooseYesNo").find((a) => a.answer.yes === yes)?.action ?? null;
}

/** A card name: one of an opponent's permanents' if it can, so "can't" effects hit them (Pithing Needle). */
export function nameAction(shown: SeatView): Action | null {
  const theirs = permanents(shown)
    .filter((c) => opponents(shown).includes(c.characteristics.controller) && !c.characteristics.types.includes("land"))
    .map((c) => c.characteristics.name);
  const options = answers(shown, "chooseName");
  return (options.find((a) => theirs.includes(a.answer.name)) ?? options[0])?.action ?? null;
}
