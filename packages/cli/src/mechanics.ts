// The mechanics golden games cover (D-082): what the engine runs when a card's script runs, as readable units such as
// "keyword flying", "effect dealDamage", "trigger spellCast", "cost sacrifice", "target spell", plus each kind of
// decision a player answers. Golden games are chosen to cover every unit the pool's cards have, rather than every
// card: each card is covered by its own scenarios. Interactions between mechanics are the interaction matrix's
// scenarios.

import type {
  AbilityDef,
  CardDatabase,
  CardDef,
  DecisionKind,
  Effect,
  TargetSpec,
  TriggeredAbilityDef,
} from "@mtg/engine";

/** Every kind of decision, so a new one must be added here (and covered). */
const DECISION_KINDS: Record<DecisionKind["kind"], true> = {
  chooseStartingPlayer: true,
  mulligan: true,
  mulliganBottom: true,
  priority: true,
  chooseTarget: true,
  chooseTargetCount: true,
  announceX: true,
  divide: true,
  chooseSacrifice: true,
  payMana: true,
  declareAttackers: true,
  declareBlockers: true,
  assignDamage: true,
  discardToHandSize: true,
  chooseCards: true,
  chooseYesNo: true,
  orderTriggers: true,
};

export const decisionUnit = (kind: DecisionKind["kind"]): string => `decision ${kind}`;

/** Every unit the cards in the pool have between them, and every decision kind: what golden games must cover. */
export function wantedMechanics(cards: CardDatabase): string[] {
  const units = Object.values(cards).flatMap((card) => [
    ...permanentUnits(card.def),
    ...(card.def.spell === undefined ? [] : effectUnits(card.def.spell.targets, card.def.spell.effects)),
    ...(card.def.abilities ?? []).flatMap(abilityUnits),
    ...(card.def.triggers ?? []).flatMap(triggerUnits),
  ]);
  const decisions = (Object.keys(DECISION_KINDS) as DecisionKind["kind"][]).map(decisionUnit);
  return [...new Set([...units, ...decisions])].sort();
}

/** What a permanent brings as it's on the battlefield: its keywords and its static abilities. */
export function permanentUnits(def: CardDef): string[] {
  return [...(def.keywords ?? []).map((k) => `keyword ${k}`), ...(def.statics ?? []).map((s) => `static ${s.kind}`)];
}

/** What a resolving spell or ability does: each effect op (nested ones too) and each kind of target. */
export function effectUnits(targets: readonly TargetSpec[], effects: readonly Effect[]): string[] {
  const ops = (list: readonly Effect[]): string[] =>
    list.flatMap((e) => [`effect ${e.op}`, ...(e.op === "ifNothingSacrificed" ? ops(e.effects) : [])]);
  return [...targets.map((t) => `target ${t.kind}`), ...ops(effects)];
}

/** An activated ability: its costs, targets and effects. */
export function abilityUnits(ability: AbilityDef): string[] {
  return [...ability.cost.map((c) => `cost ${c.kind}`), ...effectUnits(ability.targets, ability.effects)];
}

/** A triggered ability: its trigger condition, "intervening if" and "you may", targets and effects. */
export function triggerUnits(trigger: TriggeredAbilityDef): string[] {
  return [
    `trigger ${trigger.when.kind}`,
    ...(trigger.onlyIf === undefined ? [] : [`intervening if ${trigger.onlyIf.kind}`]),
    ...(trigger.optional === true ? ["trigger you may"] : []),
    ...effectUnits(trigger.targets, trigger.effects),
  ];
}
