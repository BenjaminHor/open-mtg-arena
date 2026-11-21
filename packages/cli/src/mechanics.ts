// The mechanics golden games cover (D-082): what the engine runs when a card's script runs, as readable units such as
// "keyword flying", "effect dealDamage", "trigger spellCast", "cost sacrifice", "target spell", "spell costIncrease",
// plus each kind of decision a player answers and each kind of event. Golden games are chosen to cover every unit the
// pool's cards have, rather than every card: each card is covered by its own scenarios. Interactions between
// mechanics are the interaction matrix's scenarios.
//
// Each field of a card's definition is mapped to its units in a table the compiler checks (`Record<keyof ...>`), so a
// new field, keyword, decision or event kind can't quietly go uncovered.

import { conditionalEffects, delayedAbilities } from "@mtg/cards";
import type {
  AbilityDef,
  CardDatabase,
  CardDef,
  DecisionKind,
  Effect,
  GameEvent,
  Keyword,
  ReplacementDef,
  SpellDef,
  StaticAbilityDef,
  TargetSpec,
  TriggeredAbilityDef,
} from "@mtg/engine";

/**
 * Every kind of decision: true if golden games must answer it; otherwise why agent games can't. A new one must be
 * added here.
 */
const DECISION_KINDS: Record<DecisionKind["kind"], true | string> = {
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
  // Reachable since M2-08d1, only when Guardian Seraph meets Fog or Safe Passage in one game: rare in agent games.
  chooseReplacement: "two different prevention effects on one damage event are too rare in agent games",
  keepLegend: true,
  chooseName: true,
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
  EXTRA_TURN_ADDED: true,
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
  BECAME_TARGET: true,
  PERMANENT_TAPPED: true,
  PERMANENT_UNTAPPED: true,
  DAMAGE_REMOVED: true,
  PERMANENT_REGENERATED: true,
  DAMAGE_PREVENTED: true,
  CARD_DISCARDED: true,
  CARDS_REVEALED: true,
  COUNTERS_PUT: true,
  COUNTERS_REMOVED: true,
  TOKEN_CREATED: true,
  TOKEN_CEASED_TO_EXIST: true,
  ATTACHED: true,
  UNATTACHED: true,
  AURA_HOST_CHOSEN: true,
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
  // Coarse: it also works against "destroy" outside combat, which isn't credited.
  indestructible: "combat",
  lifelink: "combat",
  reach: "combat",
  shroud: "enters",
  swampwalk: "combat",
  trample: "combat",
  vigilance: "combat",
};

/**
 * A delayed triggered ability resolving: its own unit, as its trigger and effects are usually other cards' units too,
 * and the effect making it is credited whether or not its condition held (`effectOps`).
 */
export const DELAYED_TRIGGER = "trigger delayed";

/**
 * Where each kind of replacement effect does something: it's credited as its card moves there, outside the pregame
 * (coarse, like `effectOps`: entering untapped still checked the condition, and Darksteel Colossus put into a library
 * some other way would count), or, for a prevention, as it prevents damage (`DAMAGE_PREVENTED` by that card). A new
 * kind must be placed.
 */
const REPLACEMENT_WHERE: Record<ReplacementDef["kind"], "battlefield" | "library" | "prevented"> = {
  entersTapped: "battlefield",
  // Instead of a graveyard.
  graveyardToLibrary: "library",
  preventDamageToYou: "prevented",
  entersWithCounters: "battlefield",
  entersWithLoyalty: "battlefield",
  asEntersChooseName: "battlefield",
  preventDamageToSelfRemovingCounters: "prevented",
  preventNoncombatDamageToAttached: "prevented",
};

/** The replacement effects a card's own text makes that apply as it moves to `zone`. */
export function replacementUnits(def: CardDef, where: string): string[] {
  return (def.replacements ?? [])
    .filter((r) => REPLACEMENT_WHERE[r.kind] === where)
    .map((r) => `replacement ${r.kind}`);
}

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
    ...(card.def.replacements ?? []).map((r) => `replacement ${r.kind}`),
    // A delayed triggered ability: wanted, but credited as it resolves.
    ...allEffects(card.def).flatMap((effects) =>
      delayedAbilities(effects).flatMap((ability) => [DELAYED_TRIGGER, ...triggerUnits(ability)]),
    ),
  ]);
  const decisions = (Object.entries(DECISION_KINDS) as [DecisionKind["kind"], true | string][])
    .filter(([, wanted]) => wanted === true)
    .map(([kind]) => decisionUnit(kind));
  const events = (Object.entries(EVENT_TYPES) as [GameEvent["type"], true | string][])
    .filter(([, wanted]) => wanted === true)
    .map(([type]) => eventUnit(type));
  return [...new Set([...units, ...decisions, ...events])].sort();
}

/** Every list of effects a card's definition has: its spell's, its abilities' and its triggers'. */
function allEffects(def: CardDef): (readonly Effect[])[] {
  return [
    ...(def.spell === undefined ? [] : [def.spell.effects]),
    ...(def.abilities ?? []).map((a) => a.effects),
    ...(def.triggers ?? []).map((t) => t.effects),
  ];
}

/**
 * A card's keywords, protection and static abilities credited at `when` (`KEYWORD_WHEN`, `STATIC_WHEN`): in combat, or
 * as it resolves ("enters": a permanent spell's flash and shroud, a spell's "can't be countered", anthems).
 */
export function permanentUnits(def: CardDef, when: "combat" | "enters"): string[] {
  const keywords = (def.keywords ?? []).filter((k) => KEYWORD_WHEN[k] === when).map((k) => `keyword ${k}`);
  // Coarse, like indestructible: protection also stops targeting outside combat, which isn't credited.
  const protection = when === "combat" && (def.protections ?? []).length > 0 ? ["keyword protection"] : [];
  const statics = (def.statics ?? []).filter((s) => STATIC_WHEN[s.kind] === when).map((s) => `static ${s.kind}`);
  return [...keywords, ...protection, ...statics];
}

/**
 * When a static ability is credited, like `KEYWORD_WHEN`: most are about attacking or blocking; "can't be countered"
 * as the spell resolves (coarse: it did something only if a counter was tried). A new kind must be placed.
 */
const STATIC_WHEN: Record<StaticAbilityDef["kind"], "combat" | "enters"> = {
  cantBeBlocked: "combat",
  canBlockAnyNumber: "combat",
  cantAttackOrBlockAlone: "combat",
  attacksEachCombat: "combat",
  mustBeBlockedByAllAble: "combat",
  cantBeCountered: "enters",
  // Anthems, coarsely, as their permanent resolves: many are on noncreatures (Honor of the Pure, Coat of Arms), which
  // never attack or block.
  creaturesGet: "enters",
  plusPerSharedCreatureType: "enters",
  plusPerOtherSameName: "enters",
  // Coarse, like anthems: it does something wherever the card is, and its permanent's resolving shows it.
  powerToughnessEachEqual: "enters",
  cantAttackUnlessDefenderControls: "combat",
  // As its permanent resolves, like anthems: it does something only at a cleanup with too many cards.
  noMaximumHandSize: "enters",
  // Coarse, like anthems: an Aura's resolving shows it; it does something only in an untap step.
  attachedDoesntUntap: "enters",
  // Coarse, like anthems: it does something only when its controller would lose.
  cantLoseOpponentsCantWin: "enters",
  // Coarse, like anthems: its permanent's resolving shows it.
  chosenNameCantActivate: "enters",
  // As its Aura resolves, like anthems. Pacifism's restriction is on the Aura, which never attacks or blocks, so
  // crediting it in combat would never count; its Aura resolving is when it starts to apply.
  attachedGets: "enters",
  attachedCantAttackOrBlock: "enters",
  // Evasion, like "can't be blocked": its creature attacking shows it.
  attachedCantBeBlocked: "enters",
  attachedControl: "enters",
  attachedCantActivate: "enters",
};

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
  timing: (ability) => (ability.timing === undefined ? [] : [`timing ${ability.timing}`]),
  keyword: (ability) => (ability.keyword === undefined ? [] : [`keyword ${ability.keyword}`]),
  zone: (ability) => (ability.zone === undefined ? [] : [`zone ${ability.zone}`]),
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
 * Each effect op, those inside a condition too (`conditionalEffects`). Coarse on purpose: a nested op counts when its
 * ability resolves, whether or not its branch ran.
 */
function effectOps(effects: readonly Effect[]): string[] {
  return effects.flatMap((e) => [`effect ${e.op}`, ...effectOps(conditionalEffects(e))]);
}
