// Public API of the engine. See docs/architecture.md, "Engine API".
// Nothing is exported here without a reason in docs/decisions.md (types: D-023).

export type { PlayerRelation, TriggerCheck, TriggerCondition, TriggeredAbilityDef } from "./cards/triggers.ts";
export type {
  AbilityDef,
  CardData,
  CardDatabase,
  CardDef,
  CardType,
  Color,
  CostPart,
  Effect,
  EffectSubject,
  Keyword,
  ManaCost,
  ManaSymbol,
  PrintedCard,
  ProtectionQuality,
  ReplacementDef,
  SpellDef,
  StaticAbilityDef,
  Supertype,
  TargetSpec,
} from "./cards/types.ts";
export { legalAmounts, withForcedAnswers } from "./combat/damage-assignment.ts";
export { applyAction } from "./game/apply-action.ts";
export { createGame } from "./game/create-game.ts";
export { legalActions } from "./game/legal-actions.ts";
export { type AutoPayment, autoPay } from "./mana/auto-pay.ts";
export { allPayments, type ManaPayment, manaValue, payFromPool } from "./mana/payment.ts";
export type { RngState } from "./rng/xoshiro128.ts";
export { type ActivatedAbility, abilitiesOf, isManaAbility, sameAbilityRef } from "./rules/abilities.ts";
export { isFixedAmount } from "./rules/amount.ts";
export { type Characteristics, characteristics } from "./rules/characteristics.ts";
export { isAttacking, isBlocking } from "./rules/combat.ts";
export { controllerOf } from "./rules/controller.ts";
export { type LayerSevenCChange, layerSevenCChanges } from "./rules/power-toughness.ts";
export { isFreeOfSummoningSickness } from "./rules/summoning-sickness.ts";
export type { Action, Answer } from "./state/actions.ts";
export type { Casting } from "./state/casting.ts";
export type { Attack, Block, Combat, CombatDivision, DamageDivision } from "./state/combat.ts";
export type { ChoosePurpose, DecisionKind, PendingDecision, Seen } from "./state/decisions.ts";
export type { ContinuousEffect, Duration, EffectChange, EffectContext } from "./state/effects.ts";
export type { DidNotResolve, GameEvent } from "./state/events.ts";
export type { GameState, Resolution } from "./state/game-state.ts";
export type { CardId, DecisionId, ObjectId, OracleId, PlayerId } from "./state/ids.ts";
export type { ManaPool, ManaType } from "./state/mana.ts";
export type {
  AbilityObject,
  AbilityRef,
  BasicLandType,
  CardObject,
  Counters,
  GameObject,
  StackChoices,
  Target,
} from "./state/objects.ts";
export type { PlayerState } from "./state/players.ts";
export type { Pregame } from "./state/pregame.ts";
export type { ChoiceFor, ReplacementEffect, ReplacementRef } from "./state/replacements.ts";
export { replacementEffectCard } from "./state/replacements.ts";
export type {
  EngineError,
  EngineErrorCode,
  EngineResult,
  GameResult,
  Loss,
  LossReason,
} from "./state/result.ts";
export type { GameSetup, Opening, PermanentSetup, PlayerSetup, RuleModifier } from "./state/setup.ts";
export type { StateBasedAction } from "./state/state-based-actions.ts";
export type { PendingTrigger, TriggerEvent } from "./state/triggers.ts";
export { type Phase, phaseOf, type Step, type Turn } from "./state/turn.ts";
export type { WorkItem } from "./state/work.ts";
export type { PlayerZoneName, SharedZoneName, ZoneName, ZoneRef, Zones } from "./state/zones.ts";
export { ENGINE_VERSION } from "./version.ts";
export { eventsFor, type ViewEvent } from "./view/events-for.ts";
export { type PlayerView, playerView, type ViewZones } from "./view/player-view.ts";
export type { ShownOption, ViewChooseCards, ViewChooseYesNo, ViewDecision } from "./view/view-decision.ts";
