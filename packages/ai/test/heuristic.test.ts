// The heuristic AI (M3-02) on hand-made tables: each test sets up one situation and checks the choice it makes. How
// well it plays whole games is measured by `pnpm eval` (D-145), and a few fixed games run in the CLI's tests.

import { cardDatabase } from "@mtg/cards";
import {
  type Action,
  type Answer,
  applyAction,
  createGame,
  type GameState,
  legalActions,
  type ObjectId,
  type OracleId,
  type PlayerId,
  type Step,
  seatView,
} from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { heuristicAction } from "../src/index.ts";

const cards = cardDatabase();

const id = (name: string): OracleId => {
  const found = Object.values(cards).find((c) => c.printed.name === name);
  if (found === undefined) throw new Error(`no card ${name}`);
  return found.oracleId;
};

type Side = { hand?: string[]; battlefield?: string[]; library?: string[]; life?: number };

function table(p1: Side, p2: Side, active: PlayerId, step: Step): GameState {
  const player = (pid: PlayerId, side: Side) => ({
    id: pid,
    life: side.life ?? 20,
    library: (side.library ?? ["Plains", "Plains", "Plains"]).map(id),
    hand: (side.hand ?? []).map(id),
    battlefield: (side.battlefield ?? []).map((name) => ({
      oracleId: id(name),
      tapped: false,
      summoningSick: false,
      damage: 0,
      counters: {},
    })),
    graveyard: [],
    exile: [],
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  });
  const created = createGame(
    {
      seed: 1,
      players: [player("p1", p1), player("p2", p2)],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: active, step } },
      ruleModifiers: [],
    },
    cards,
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

function apply(state: GameState, action: Action): GameState {
  const result = applyAction(state, action, cards);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

function decide(state: GameState): Action {
  const player = state.pending?.player;
  if (player === undefined) throw new Error("nothing pending");
  return heuristicAction(seatView(state, player, cards), cards);
}

/** The heuristic decides for `player` until another player must decide. */
function heuristicActs(state: GameState, player: PlayerId): { state: GameState; actions: Action[] } {
  const actions: Action[] = [];
  let s = state;
  while (s.pending?.player === player && s.result === null) {
    const action = decide(s);
    actions.push(action);
    s = apply(s, action);
  }
  return { state: s, actions };
}

/** Everyone takes the first legal action (passing, declaring nothing) until a decision of this kind. */
function until(state: GameState, kind: string): GameState {
  let s = state;
  for (let i = 0; i < 50 && s.pending?.kind !== kind; i++) {
    const pending = s.pending;
    if (pending === null) throw new Error("nothing pending");
    s = apply(s, legalActions(s, pending.player, cards)[0] as Action);
  }
  if (s.pending?.kind !== kind) throw new Error(`never reached ${kind}`);
  return s;
}

function answering(state: GameState, answer: Answer): GameState {
  const pending = state.pending;
  if (pending === null) throw new Error("nothing pending");
  return apply(state, { type: "ANSWER", decisionId: pending.id, player: pending.player, answer });
}

const named = (state: GameState, name: string, owner: PlayerId): ObjectId => {
  const found = state.zones.battlefield.find((o) => {
    const obj = state.objects[o];
    return obj?.kind === "card" && obj.owner === owner && cards[obj.oracleId]?.printed.name === name;
  });
  if (found === undefined) throw new Error(`no ${name} for ${owner}`);
  return found;
};

describe("the heuristic's main phase", () => {
  it("plays a land first", () => {
    const state = table({ hand: ["Forest", "Grizzly Bears"] }, {}, "p1", "precombatMain");
    expect(decide(state).type).toBe("PLAY_LAND");
  });

  it("burns the creature its damage kills, not a bigger one or the player (CR 120.3)", () => {
    const state = table(
      { hand: ["Shock"], battlefield: ["Mountain"] },
      { battlefield: ["Grizzly Bears", "Hill Giant"] },
      "p1",
      "precombatMain",
    );
    const after = heuristicActs(state, "p1").state;
    const shock = after.zones.stack[0] as ObjectId;
    const bears = named(after, "Grizzly Bears", "p2");
    expect((after.objects[shock] as { choices: { targets: unknown } }).choices.targets).toStrictEqual([
      [{ kind: "object", object: bears }],
    ]);
  });

  it("keeps a burn spell rather than scratch a creature or a player at full life", () => {
    const state = table(
      { hand: ["Shock"], battlefield: ["Mountain"] },
      { battlefield: ["Hill Giant"] },
      "p1",
      "precombatMain",
    );
    expect(decide(state).type).toBe("PASS_PRIORITY");
  });

  it("casts the creature it can pay for", () => {
    const state = table({ hand: ["Grizzly Bears"], battlefield: ["Forest", "Forest"] }, {}, "p1", "precombatMain");
    expect(decide(state)).toMatchObject({ type: "CAST_SPELL" });
  });
});

describe("the heuristic in combat", () => {
  const attacks = (state: GameState) => {
    const { actions } = heuristicActs(until(state, "declareAttackers"), "p1");
    return actions.filter((a) => a.type === "ANSWER" && a.answer.kind === "declareAttacker");
  };

  it("attacks when nothing can block (CR 508.1)", () => {
    expect(attacks(table({ battlefield: ["Grizzly Bears"] }, {}, "p1", "precombatMain"))).toHaveLength(1);
  });

  it("doesn't attack into a blocker that would kill its creature and live", () => {
    const state = table({ battlefield: ["Grizzly Bears"] }, { battlefield: ["Hill Giant"] }, "p1", "precombatMain");
    expect(attacks(state)).toHaveLength(0);
  });

  /** p2 attacks with `attacker`; what p1's heuristic blocks with (CR 509.1). */
  function blocks(p1: Side, attackers: string[]): { blocks: Action[]; state: GameState } {
    let state = until(table(p1, { battlefield: attackers }, "p2", "precombatMain"), "declareAttackers");
    for (const name of attackers) {
      state = answering(state, {
        kind: "declareAttacker",
        attack: { attacker: named(state, name, "p2"), defender: "p1" },
      });
    }
    state = until(answering(state, { kind: "finishDeclaring" }), "declareBlockers");
    const acted = heuristicActs(state, "p1");
    const picks = acted.actions.filter((a) => a.type === "ANSWER" && a.answer.kind === "declareBlocker");
    return { blocks: picks, state: acted.state };
  }

  it("blocks with a creature that kills the attacker and survives", () => {
    expect(blocks({ battlefield: ["Centaur Courser"] }, ["Gray Ogre"]).blocks).toHaveLength(1);
  });

  it("doesn't throw a creature away when the damage isn't lethal", () => {
    expect(blocks({ battlefield: ["Grizzly Bears"] }, ["Hill Giant"]).blocks).toHaveLength(0);
  });

  it("chump blocks when the damage would be lethal", () => {
    expect(blocks({ battlefield: ["Grizzly Bears"], life: 3 }, ["Hill Giant"]).blocks).toHaveLength(1);
  });

  it("obeys a requirement to block instead of picking a block it would have to take back (CR 509.1c)", () => {
    const { blocks: picks, state } = blocks({ battlefield: ["Hill Giant"] }, ["Prized Unicorn", "Gray Ogre"]);
    const unicorn = named(state, "Prized Unicorn", "p2");
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ answer: { block: { attacker: unicorn } } });
    expect(state.pending?.kind).not.toBe("declareBlockers");
  });
});

describe("the heuristic's opening hand (CR 103.5)", () => {
  function opening(library: string[]): Action {
    const created = createGame(
      {
        seed: 1,
        players: (["p1", "p2"] as const).map((pid) => ({
          id: pid,
          life: 20,
          library: library.map(id),
          hand: [],
          battlefield: [],
          graveyard: [],
          exile: [],
          manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        })),
        opening: { kind: "standard", firstPlayer: "p1" },
        ruleModifiers: [],
      },
      cards,
    );
    if (!created.ok) throw new Error(created.error.message);
    return decide(until(created.state, "mulligan"));
  }

  it("keeps three lands in seven", () => {
    const hand = ["Mountain", "Mountain", "Mountain", "Shock", "Shock", "Shock", "Shock"];
    expect(opening(hand)).toMatchObject({ answer: { kind: "mulligan", choice: "keep" } });
  });

  it("mulligans seven lands and seven spells", () => {
    expect(opening(Array(7).fill("Mountain"))).toMatchObject({ answer: { choice: "mulligan" } });
    expect(opening(Array(7).fill("Shock"))).toMatchObject({ answer: { choice: "mulligan" } });
  });
});
