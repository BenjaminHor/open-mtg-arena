// Public API of the engine. See docs/architecture.md, "Engine API".
// Nothing is exported here without a reason in docs/decisions.md (types: D-023).

/** The current `GameState.version` (docs/architecture.md), so hosts can reject saves from another schema. See D-019. */
export const ENGINE_VERSION = 0;

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
export type { RngState } from "./rng/xoshiro128.ts";
export type { Action, Answer } from "./state/actions.ts";
export type { DecisionKind, PendingDecision } from "./state/decisions.ts";
export type { GameEvent } from "./state/events.ts";
export type { GameState } from "./state/game-state.ts";
export type { CardId, DecisionId, ObjectId, OracleId, PlayerId } from "./state/ids.ts";
export type { ManaPool, ManaType } from "./state/mana.ts";
export type { AbilityObject, CardObject, Counters, GameObject, StackChoices, Target } from "./state/objects.ts";
export type { PlayerState } from "./state/players.ts";
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
export type { PlayerZoneName, SharedZoneName, ZoneName, ZoneRef, Zones } from "./state/zones.ts";
