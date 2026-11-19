// Public API of the engine. See docs/architecture.md, "Engine API".
// Nothing is exported here without a reason in docs/decisions.md (types: D-023).

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
  SpellDef,
  Supertype,
  TargetSpec,
} from "./cards/types.ts";
export { applyAction } from "./game/apply-action.ts";
export { createGame } from "./game/create-game.ts";
export { legalActions } from "./game/legal-actions.ts";
export type { RngState } from "./rng/xoshiro128.ts";
export { controllerOf } from "./rules/controller.ts";
export type { Action, Answer } from "./state/actions.ts";
export type { DecisionKind, PendingDecision } from "./state/decisions.ts";
export type { GameEvent } from "./state/events.ts";
export type { GameState } from "./state/game-state.ts";
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
export type {
  EngineError,
  EngineErrorCode,
  EngineResult,
  GameResult,
  Loss,
  LossReason,
} from "./state/result.ts";
export type { GameSetup, Opening, PermanentSetup, PlayerSetup, RuleModifier } from "./state/setup.ts";
export type { Phase, Step, Turn } from "./state/turn.ts";
export type { WorkItem } from "./state/work.ts";
export type { PlayerZoneName, SharedZoneName, ZoneName, ZoneRef, Zones } from "./state/zones.ts";
export { ENGINE_VERSION } from "./version.ts";
