// Type-level tests: they pass when this file typechecks (`pnpm typecheck` covers tests).
// The runtime assertions only make Vitest count them.

import { describe, expectTypeOf, it } from "vitest";
import type {
  Action,
  CardId,
  DecisionId,
  GameEvent,
  GameObject,
  GameSetup,
  GameState,
  ObjectId,
  PendingDecision,
  PlayerId,
} from "../../src/index.ts";

/** Plain JSON. With exactOptionalPropertyTypes, an optional property is absent or has its type, never undefined, so it fits. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

describe("ids", () => {
  it("keeps object ids and card ids apart (CR 400.7)", () => {
    const objectId: ObjectId = "o1";
    const cardId: CardId = "c1";
    // @ts-expect-error an ObjectId is not a CardId
    const notACard: CardId = objectId;
    // @ts-expect-error a CardId is not an ObjectId
    const notAnObject: ObjectId = cardId;
    // @ts-expect-error a PlayerId is not an ObjectId
    const notAPlayer: ObjectId = "p1" satisfies PlayerId;
    // @ts-expect-error ids have their own prefixes
    const wrongPrefix: DecisionId = "o3";
    expectTypeOf([notACard, notAnObject, notAPlayer, wrongPrefix]).toBeArray();
  });
});

describe("plain JSON", () => {
  it("GameState, GameSetup, actions and events are all JSON types", () => {
    expectTypeOf<GameState>().toExtend<Json>();
    expectTypeOf<GameSetup>().toExtend<Json>();
    expectTypeOf<Action>().toExtend<Json>();
    expectTypeOf<GameEvent>().toExtend<Json>();
  });
});

describe("discriminated unions", () => {
  it("lets a switch on kind handle every kind of object and decision", () => {
    function describeObject(obj: GameObject): string {
      switch (obj.kind) {
        case "card":
          return obj.cardId;
        case "ability":
          return obj.source;
        default:
          return assertNever(obj);
      }
    }
    function describeDecision(decision: PendingDecision): string {
      switch (decision.kind) {
        case "priority":
          return "priority";
        case "chooseStartingPlayer":
          return "choose";
        case "mulligan":
          return `mulligan ${decision.mulligansTaken}`;
        case "mulliganBottom":
          return `bottom ${decision.remaining}`;
        case "discardToHandSize":
          return `discard ${decision.remaining}`;
        case "chooseTarget":
          return `target ${decision.instance}`;
        case "announceX":
          return "X?";
        case "chooseSacrifice":
          return "sacrifice?";
        case "chooseTargetCount":
          return `how many targets for ${decision.instance}`;
        case "divide":
          return `divide ${decision.amount}`;
        case "payMana":
          return `pay for ${decision.object}`;
        case "declareAttackers":
          return `attackers so far: ${decision.chosen.length}`;
        case "declareBlockers":
          return `blockers so far: ${decision.chosen.length}`;
        case "assignDamage":
          return `divide ${decision.amount}`;
        case "chooseCards":
          return `choose ${decision.min} to ${decision.max}`;
        case "chooseYesNo":
          return `yes or no: ${decision.purpose}`;
        case "orderTriggers":
          return `order ${decision.batch.length} triggered abilities`;
        case "chooseReplacement":
          return `choose one of ${decision.options.length} replacement effects`;
        case "keepLegend":
          return `keep one of ${decision.options.length} legendary permanents`;
        case "chooseName":
          return "name a card";
        default:
          return assertNever(decision);
      }
    }
    expectTypeOf(describeObject).returns.toBeString();
    expectTypeOf(describeDecision).returns.toBeString();
  });

  it("doesn't let an ability object pretend to be a card", () => {
    type AbilityObject = Extract<GameObject, { kind: "ability" }>;
    expectTypeOf<AbilityObject>().not.toHaveProperty("cardId");
  });
});

function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
