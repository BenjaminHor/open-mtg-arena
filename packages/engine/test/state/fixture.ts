// A hand-built game in the middle of a turn, touching every part of GameState: objects in every zone,
// a spell with targets on the stack, an activated ability above it, mana in a pool, counters, damage,
// a continuous effect, a rule modifier and a pending decision. Built by hand because createGame arrives in M1-05.

import { type CardObject, ENGINE_VERSION, type GameState } from "../../src/index.ts";
import { seedRng } from "../../src/rng/xoshiro128.ts";
import { emptyManaPool } from "../../src/state/mana.ts";

// Readable stand-ins for Scryfall oracle ids (the real ones are UUIDs, from M1-04).
const MOUNTAIN = "oracle-mountain";
const FOREST = "oracle-forest";
const BOLT = "oracle-lightning-bolt";
const WHELP = "oracle-furnace-whelp";
const BEARS = "oracle-grizzly-bears";
const GROWTH = "oracle-giant-growth";

// Timestamps are unique: even objects that arrive together are ordered (CR 613.7m). Here, each is its id number.
function card(fields: Pick<CardObject, "id" | "cardId" | "oracleId" | "owner"> & Partial<CardObject>): CardObject {
  return {
    kind: "card",
    baseController: fields.owner,
    timestamp: Number(fields.id.slice(1)),
    tapped: false,
    damage: 0,
    counters: {},
    controlledSinceTurnStart: false,
    choices: null,
    ...fields,
  };
}

export function midTurnState(): GameState {
  return {
    version: ENGINE_VERSION,
    setup: {
      seed: 42,
      players: [
        {
          id: "p1",
          life: 20,
          library: [MOUNTAIN, MOUNTAIN],
          hand: [BOLT],
          battlefield: [{ oracleId: WHELP, tapped: false, summoningSick: false, damage: 0, counters: {} }],
          graveyard: [],
          exile: [],
          manaPool: emptyManaPool(),
        },
        {
          id: "p2",
          life: 18,
          library: [FOREST],
          hand: [GROWTH],
          battlefield: [{ oracleId: BEARS, tapped: false, summoningSick: true, damage: 0, counters: {} }],
          graveyard: [],
          exile: [],
          manaPool: emptyManaPool(),
        },
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [{ kind: "creaturesGetPT", controller: "p2", power: 1, toughness: 1 }],
    },
    rng: seedRng(42),
    nextId: 20,
    nextTimestamp: 13,
    nextCardId: 11,
    turn: { number: 3, activePlayer: "p1", step: "precombatMain" },
    turnOrder: ["p1", "p2"],
    players: {
      p1: {
        id: "p1",
        life: 20,
        manaPool: { ...emptyManaPool(), R: 1 },
        landsPlayedThisTurn: 1,
        attemptedDrawFromEmptyLibrary: false,
      },
      p2: {
        id: "p2",
        life: 18,
        manaPool: emptyManaPool(),
        landsPlayedThisTurn: 0,
        attemptedDrawFromEmptyLibrary: false,
      },
    },
    objects: {
      o1: card({ id: "o1", cardId: "c1", oracleId: MOUNTAIN, owner: "p1" }),
      o2: card({ id: "o2", cardId: "c2", oracleId: FOREST, owner: "p2" }),
      o3: card({ id: "o3", cardId: "c3", oracleId: GROWTH, owner: "p2" }),
      o4: card({
        id: "o4",
        cardId: "c4",
        oracleId: MOUNTAIN,
        owner: "p1",
        tapped: true,
        controlledSinceTurnStart: true,
      }),
      o5: card({ id: "o5", cardId: "c5", oracleId: WHELP, owner: "p1", controlledSinceTurnStart: true }),
      o6: card({ id: "o6", cardId: "c6", oracleId: BEARS, owner: "p2", damage: 1, counters: { "+1/+1": 1 } }),
      o7: card({ id: "o7", cardId: "c7", oracleId: MOUNTAIN, owner: "p1" }),
      o8: card({ id: "o8", cardId: "c8", oracleId: FOREST, owner: "p2" }),
      o9: card({ id: "o9", cardId: "c9", oracleId: FOREST, owner: "p2" }),
      o10: card({
        id: "o10",
        cardId: "c10",
        oracleId: BOLT,
        owner: "p1",
        choices: { modes: [], x: null, targets: [[{ kind: "object", object: "o6" }]], division: null },
      }),
      o11: {
        kind: "ability",
        id: "o11",
        source: "o5",
        sourceOracleId: WHELP,
        ability: { kind: "printed", index: 0 },
        baseController: "p1",
        timestamp: 11,
        choices: { modes: [], x: null, targets: [], division: null },
      },
    },
    zones: {
      players: {
        p1: { library: ["o1"], hand: [], graveyard: ["o7"] },
        p2: { library: ["o2"], hand: ["o3"], graveyard: ["o8"] },
      },
      battlefield: ["o4", "o5", "o6"],
      stack: ["o10", "o11"],
      exile: ["o9"],
      command: [],
    },
    effects: [
      // From a Giant Growth p2 cast earlier this turn; that spell is gone, so its id is no longer an object.
      {
        source: "o15",
        controller: "p2",
        timestamp: 12,
        duration: "endOfTurn",
        affected: ["o6"],
        change: { kind: "modifyPT", power: 3, toughness: 3 },
      },
    ],
    pregame: null,
    passesInSuccession: 1,
    combat: null,
    casting: null,
    resolution: null,
    dealtDeathtouchDamage: [],
    work: [
      {
        kind: "runEffect",
        effect: { op: "dealDamage", amount: 3, from: "self", to: { target: 0 } },
        context: {
          self: "o10",
          controller: "p1",
          targets: [[{ kind: "player", player: "p2" }]],
          division: [],
          x: null,
        },
        chosen: null,
      },
      { kind: "finishResolving", object: "o10" },
    ],
    pending: { id: "d19", player: "p2", kind: "priority" },
    result: null,
  };
}
