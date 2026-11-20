// The mechanics golden games cover (D-082): what the engine runs when a card's script runs, as readable units such as
// "keyword flying", "effect dealDamage", "trigger spellCast", "cost sacrifice", "target spell", "spell costIncrease",
// plus each kind of decision a player answers and each kind of event. Golden games are chosen to cover every unit the
// pool's cards have, rather than every card: each card is covered by its own scenarios. Interactions between
// mechanics are the interaction matrix's scenarios.
//
// Each field of a card's definition is mapped to its units in a table the compiler checks (`Record<keyof ...>`), so a
// new field, keyword, decision or event kind can't quietly go uncovered.

import type {
  AbilityDef,
  CardDatabase,
  CardDef,
  DecisionKind,
  Effect,
  GameEvent,
  Keyword,
  SpellDef,
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

/**
 * Every kind of event: true if golden games must show it; otherwise why agent games can't. A new event kind must be
 * added here.
 */
const EVENT_TYPES: Record<GameEvent["type"], true | string> = {
  ZONE_CHANGED: true,
  STARTING_PLAYER_CHOSEN: true,
  LIBRARY_SHUFFLED: true,
  CARD_DRAWN: true,
  MULLIGAN_DECLARED: true,
  TURN_BEGAN: true,
  STEP_BEGAN: true,
  PRIORITY_PASSED: true,
  LAND_PLAYED: true,
  SPELL_CAST: true,
  CAST_CANCELLED: true,
  ABILITY_ACTIVATED: true,
  ABILITY_TRIGGERED: true,
  ACTIVATION_CANCELLED: true,
  ABILITY_DID_NOT_RESOLVE: true,
  SPELL_DID_NOT_RESOLVE: true,
  SPELL_RESOLVED: true,
  ABILITY_RESOLVED: true,
  ATTACKERS_DECLARED: true,
  BLOCKERS_DECLARED: true,
  DAMAGE_DEALT: true,
  LIFE_LOST: true,
  EFFECT_CREATED: true,
  EFFECT_ENDED: true,
  STATE_BASED_ACTIONS: true,
  PERMANENT_DESTROYED: true,
  PERMANENT_SACRIFICED: true,
  SPELL_COUNTERED: true,
  ABILITY_COUNTERED: "no card in the pool counters an ability",
  LIFE_GAINED: true,
  PLAYER_LOST: true,
  GAME_ENDED: true,
  MANA_EMPTIED: true,
  MANA_ADDED: true,
  TAPPED_FOR_MANA: true,
  PERMANENT_TAPPED: true,
  PERMANENT_UNTAPPED: true,
  DAMAGE_REMOVED: true,
  CARD_DISCARDED: true,
  CARDS_REVEALED: true,
};

/**
 * When a keyword is credited: `combat` ones as the permanent attacks or blocks, where they do something; `enters` ones
 * as it resolves (flash was used to cast it; shroud stands as it's on the battlefield). A new keyword must be placed.
 */
const KEYWORD_WHEN: Record<Keyword, "combat" | "enters"> = {
  deathtouch: "combat",
  defender: "combat",
  "double strike": "combat",
  "first strike": "combat",
  flash: "enters",
  flying: "combat",
  forestwalk: "combat",
  haste: "combat",
  lifelink: "combat",
  reach: "combat",
  shroud: "enters",
  swampwalk: "combat",
  trample: "combat",
  vigilance: "combat",
};

export const decisionUnit = (kind: DecisionKind["kind"]): string => `decision ${kind}`;
export const eventUnit = (type: GameEvent["type"]): string => `event ${type}`;

/** Every unit the pool's cards have, every decision kind and every event agents can reach: what golden games cover. */
export function wantedMechanics(cards: CardDatabase): string[] {
  const units = Object.values(cards).flatMap((card) => [
    ...permanentUnits(card.def, "combat"),
    ...permanentUnits(card.def, "enters"),
    ...(card.def.spell === undefined ? [] : spellUnits(card.def.spell, true)),
    ...(card.def.abilities ?? []).flatMap(abilityUnits),
    ...(card.def.triggers ?? []).flatMap(triggerUnits),
  ]);
  const decisions = (Object.keys(DECISION_KINDS) as DecisionKind["kind"][]).map(decisionUnit);
  const events = (Object.entries(EVENT_TYPES) as [GameEvent["type"], true | string][])
    .filter(([, wanted]) => wanted === true)
    .map(([type]) => eventUnit(type));
  return [...new Set([...units, ...decisions, ...events])].sort();
}

/**
 * A permanent's keywords credited at `when` (`KEYWORD_WHEN`), and, in combat, its static abilities: every one in the
 * pool is about attacking or blocking.
 */
export function permanentUnits(def: CardDef, when: "combat" | "enters"): string[] {
  const keywords = (def.keywords ?? []).filter((k) => KEYWORD_WHEN[k] === when).map((k) => `keyword ${k}`);
  const statics = when === "combat" ? (def.statics ?? []).map((s) => `static ${s.kind}`) : [];
  return [...keywords, ...statics];
}

/** Each field of a spell's definition, as units; `manyTargets`: more than one target was chosen. */
const SPELL_FIELDS: { [F in keyof SpellDef]-?: (spell: SpellDef, manyTargets: boolean) => string[] } = {
  targets: (spell) => spell.targets.map(targetUnit),
  effects: (spell) => effectOps(spell.effects),
  // "Costs {1} more for each target beyond the first" does something only with a second target.
  costIncrease: (spell, manyTargets) => (spell.costIncrease !== undefined && manyTargets ? ["spell costIncrease"] : []),
  xPaidWith: (spell) => (spell.xPaidWith === undefined ? [] : ["spell xPaidWith"]),
};

const ABILITY_FIELDS: { [F in keyof AbilityDef]-?: (ability: AbilityDef) => string[] } = {
  kind: () => [],
  cost: (ability) => ability.cost.map((c) => `cost ${c.kind}`),
  targets: (ability) => ability.targets.map(targetUnit),
  effects: (ability) => effectOps(ability.effects),
};

const TRIGGER_FIELDS: { [F in keyof TriggeredAbilityDef]-?: (trigger: TriggeredAbilityDef) => string[] } = {
  when: (trigger) => [`trigger ${trigger.when.kind}`],
  onlyIf: (trigger) => (trigger.onlyIf === undefined ? [] : [`intervening if ${trigger.onlyIf.kind}`]),
  optional: (trigger) => (trigger.optional === true ? ["trigger you may"] : []),
  targets: (trigger) => trigger.targets.map(targetUnit),
  effects: (trigger) => effectOps(trigger.effects),
};

/** What a resolving spell runs: each of its fields. */
export function spellUnits(spell: SpellDef, manyTargets: boolean): string[] {
  return Object.values(SPELL_FIELDS).flatMap((units) => units(spell, manyTargets));
}

/** An activated ability: its costs, targets and effects. */
export function abilityUnits(ability: AbilityDef): string[] {
  return Object.values(ABILITY_FIELDS).flatMap((units) => units(ability));
}

/** A triggered ability: its trigger condition, "intervening if" and "you may", targets and effects. */
export function triggerUnits(trigger: TriggeredAbilityDef): string[] {
  return Object.values(TRIGGER_FIELDS).flatMap((units) => units(trigger));
}

const targetUnit = (t: TargetSpec): string => `target ${t.kind}`;

/**
 * Each effect op, those nested in `ifNothingSacrificed` too. Coarse on purpose: a nested op counts when its ability
 * resolves, whether or not its branch ran.
 */
function effectOps(effects: readonly Effect[]): string[] {
  return effects.flatMap((e) => [`effect ${e.op}`, ...(e.op === "ifNothingSacrificed" ? effectOps(e.effects) : [])]);
}
