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

/** A permanent by name, or with counters on it ("Chandra Nalaar" with 1 loyalty). */
type Permanent = string | { name: string; counters: Record<string, number> };
type Side = { hand?: string[]; battlefield?: Permanent[]; library?: string[]; life?: number };

function table(p1: Side, p2: Side, active: PlayerId, step: Step): GameState {
  const player = (pid: PlayerId, side: Side) => ({
    id: pid,
    life: side.life ?? 20,
    library: (side.library ?? ["Plains", "Plains", "Plains"]).map(id),
    hand: (side.hand ?? []).map(id),
    battlefield: (side.battlefield ?? []).map((p) => ({
      oracleId: id(typeof p === "string" ? p : p.name),
      tapped: false,
      summoningSick: false,
      damage: 0,
      counters: typeof p === "string" ? {} : p.counters,
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

describe("the heuristic's X, targets, abilities and counterspells", () => {
  it("casts an X spell with all the X it can pay, at one target, so the cost stays payable (CR 601.2b, 601.2f)", () => {
    const state = table(
      { hand: ["Fireball"], battlefield: ["Mountain", "Mountain", "Mountain", "Mountain"] },
      { battlefield: ["Hill Giant", "Grizzly Bears"] },
      "p1",
      "precombatMain",
    );
    const { state: after, actions } = heuristicActs(state, "p1");
    expect(actions.some((a) => a.type === "ANSWER" && a.answer.kind === "cancelCast")).toBe(false);
    const fireball = after.objects[after.zones.stack[0] as ObjectId] as {
      choices: { x: number; targets: unknown[][] };
    };
    expect(fireball.choices.x).toBe(3);
    expect(fireball.choices.targets).toStrictEqual([[{ kind: "object", object: named(after, "Hill Giant", "p2") }]]);
  });

  it("doesn't spend a planeswalker's last loyalty on a [−X] for 0 (CR 606.6)", () => {
    const state = table(
      { battlefield: [{ name: "Chandra Nalaar", counters: { loyalty: 1 } }] },
      { battlefield: ["Grizzly Bears"] },
      "p1",
      "precombatMain",
    );
    const action = decide(state);
    expect(action.type).toBe("ACTIVATE_ABILITY");
    expect(action).toMatchObject({ ability: { kind: "printed", index: 0 } });
  });

  it("equips its creature (CR 702.6a)", () => {
    const state = table(
      { battlefield: ["Gorgon Flail", "Grizzly Bears", "Plains", "Plains"] },
      {},
      "p1",
      "precombatMain",
    );
    const after = heuristicActs(state, "p1").state;
    const flail = named(after, "Gorgon Flail", "p1");
    const bears = named(after, "Grizzly Bears", "p1");
    const resolved = until(after, "declareAttackers");
    expect((resolved.objects[flail] as { attachedTo?: ObjectId }).attachedTo).toBe(bears);
  });

  /** p1 casts Shock at its own Hill Giant, or at p2's Grizzly Bears; what p2, holding Cancel, does then. */
  function answerToShock(at: "own" | "theirs"): Action {
    let state = table(
      { battlefield: ["Hill Giant", "Mountain"], hand: ["Shock"] },
      { hand: ["Cancel"], battlefield: ["Island", "Island", "Island", "Grizzly Bears"] },
      "p1",
      "precombatMain",
    );
    const pending = state.pending;
    if (pending === null) throw new Error("nothing pending");
    const target = at === "own" ? named(state, "Hill Giant", "p1") : named(state, "Grizzly Bears", "p2");
    const shock = state.zones.players.p1?.hand[0] as ObjectId;
    state = apply(state, { type: "CAST_SPELL", decisionId: pending.id, player: "p1", object: shock });
    state = answering(state, { kind: "chooseTarget", target: { kind: "object", object: target } });
    // p1 pays for it and passes priority with it on the stack.
    state = heuristicActs(state, "p1").state;
    expect(state.zones.stack).toHaveLength(1);
    return decide(state);
  }

  it("counters an opponent's spell aimed at its creature (CR 701.5a)", () => {
    expect(answerToShock("theirs")).toMatchObject({ type: "CAST_SPELL" });
  });

  it("never counters its own spell", () => {
    const state = table(
      { hand: ["Doom Blade", "Cancel"], battlefield: ["Swamp", "Swamp", "Island", "Island", "Island"] },
      { battlefield: ["Serra Angel"] },
      "p1",
      "precombatMain",
    );
    const after = heuristicActs(state, "p1").state;
    expect(after.zones.stack).toHaveLength(1);
  });

  it("doesn't cast a creature whose X it can't make more than 0 (CR 107.3a, 704.5f)", () => {
    const state = table({ hand: ["Protean Hydra"], battlefield: ["Forest"] }, {}, "p1", "precombatMain");
    expect(decide(state).type).toBe("PASS_PRIORITY");
  });

  it("lets an opponent's spell resolve when it only hurts that opponent", () => {
    expect(answerToShock("own").type).toBe("PASS_PRIORITY");
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

  it("attacks with only what a requirement forces when nothing else is safe (CR 508.1d)", () => {
    const state = table(
      { battlefield: ["Llanowar Elves", "Grizzly Bears", "Berserkers of Blood Ridge"] },
      { battlefield: ["Enormous Baloth"] },
      "p1",
      "precombatMain",
    );
    const picks = attacks(state);
    const berserkers = named(state, "Berserkers of Blood Ridge", "p1");
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ answer: { attack: { attacker: berserkers } } });
  });

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

  it("puts every creature able to block on the attacker all must block, with no pick it must take back", () => {
    const p1 = { battlefield: ["Hill Giant", "Grizzly Bears"] };
    const { blocks: picks, state } = blocks(p1, ["Prized Unicorn", "Gray Ogre"]);
    const unicorn = named(state, "Prized Unicorn", "p2");
    expect(picks).toHaveLength(2);
    for (const pick of picks) expect(pick).toMatchObject({ answer: { block: { attacker: unicorn } } });
    expect(state.pending?.kind).not.toBe("declareBlockers");
  });
});

describe("the heuristic's combat damage", () => {
  it("gives each blocker lethal damage in order, and the rest to the last (CR 510.1c)", () => {
    let state = until(
      table(
        { battlefield: ["Craw Wurm"] },
        { battlefield: ["Grizzly Bears", "Llanowar Elves"] },
        "p1",
        "precombatMain",
      ),
      "declareAttackers",
    );
    const wurm = named(state, "Craw Wurm", "p1");
    state = answering(state, { kind: "declareAttacker", attack: { attacker: wurm, defender: "p2" } });
    state = until(answering(state, { kind: "finishDeclaring" }), "declareBlockers");
    for (const blocker of ["Grizzly Bears", "Llanowar Elves"]) {
      state = answering(state, {
        kind: "declareBlocker",
        block: { blocker: named(state, blocker, "p2"), attacker: wurm },
      });
    }
    state = until(answering(state, { kind: "finishDeclaring" }), "assignDamage");
    const first = decide(state);
    // Craw Wurm is 6/4: the first blocker in order gets what kills it, no more.
    const pending = state.pending as { recipients: { kind: string; object?: ObjectId }[] };
    const firstBlocker = state.objects[pending.recipients[0]?.object as ObjectId] as { oracleId: OracleId };
    const toughness = cards[firstBlocker.oracleId]?.printed.toughness;
    expect(first).toMatchObject({ answer: { kind: "assignDamage", amount: toughness } });
  });
});

describe("the heuristic's combat tricks and costs", () => {
  it("keeps a pump spell in its main phase, and casts it once its blocked creature would lose the fight (CR 509)", () => {
    const start = table(
      { battlefield: ["Grizzly Bears", "Forest"], hand: ["Giant Growth"] },
      { battlefield: ["Hill Giant"] },
      "p1",
      "precombatMain",
    );
    expect(decide(start).type).toBe("PASS_PRIORITY");
    let state = until(start, "declareAttackers");
    const bears = named(state, "Grizzly Bears", "p1");
    state = answering(state, { kind: "declareAttacker", attack: { attacker: bears, defender: "p2" } });
    state = until(answering(state, { kind: "finishDeclaring" }), "declareBlockers");
    state = answering(state, {
      kind: "declareBlocker",
      block: { blocker: named(state, "Hill Giant", "p2"), attacker: bears },
    });
    state = answering(state, { kind: "finishDeclaring" });
    expect(state.pending).toMatchObject({ player: "p1", kind: "priority" });
    expect(decide(state)).toMatchObject({ type: "CAST_SPELL" });
  });

  it("cracks a fetch land: its own land is worth less than the land it finds (CR 701.23)", () => {
    const state = table({ battlefield: ["Terramorphic Expanse"] }, {}, "p1", "precombatMain");
    expect(decide(state)).toMatchObject({ type: "ACTIVATE_ABILITY" });
  });

  it("blocks a big attacker with two creatures that kill it together, losing at most one (CR 509.1a, 510.1c)", () => {
    const { blocks: picks, state } = blocks({ battlefield: ["Giant Spider", "Hill Giant"] }, ["Craw Wurm"]);
    const wurm = named(state, "Craw Wurm", "p2");
    expect(picks).toHaveLength(2);
    for (const pick of picks) expect(pick).toMatchObject({ answer: { block: { attacker: wurm } } });
  });

  it("spreads chump blocks over the attackers instead of piling them on one", () => {
    const { blocks: picks } = blocks({ battlefield: ["Grizzly Bears", "Llanowar Elves"], life: 3 }, [
      "Hill Giant",
      "Gray Ogre",
    ]);
    const attackers = picks.map((p) =>
      p.type === "ANSWER" && p.answer.kind === "declareBlocker" ? p.answer.block.attacker : null,
    );
    expect(picks).toHaveLength(2);
    expect(new Set(attackers).size).toBe(2);
  });

  it("doesn't pay its last life to draw cards (Sign in Blood at 2 life)", () => {
    const state = table(
      { hand: ["Sign in Blood"], battlefield: ["Swamp", "Swamp", "Swamp"], life: 2 },
      {},
      "p1",
      "precombatMain",
    );
    expect(decide(state).type).toBe("PASS_PRIORITY");
  });
});

describe("the heuristic reads more of the cards", () => {
  const attacksWith = (state: GameState) =>
    heuristicActs(until(state, "declareAttackers"), "p1").actions.filter(
      (a) => a.type === "ANSWER" && a.answer.kind === "declareAttacker",
    );

  it("attacks with a creature that can't be blocked, whatever stands in its way (CR 509.1b)", () => {
    const state = table({ battlefield: ["Phantom Warrior"] }, { battlefield: ["Hill Giant"] }, "p1", "precombatMain");
    expect(attacksWith(state)).toHaveLength(1);
  });

  it("blocks with a creature it can regenerate, and regenerates it as it would die (CR 701.19a)", () => {
    const { blocks: picks, state } = blocks({ battlefield: ["Wall of Bone", "Swamp"] }, ["Craw Wurm"]);
    expect(picks).toHaveLength(1);
    // p2, the active player, gets priority first in the declare blockers step and passes; then p1 decides.
    expect(state.pending).toMatchObject({ kind: "priority", player: "p2" });
    const passed = apply(state, legalActions(state, "p2", cards).find((a) => a.type === "PASS_PRIORITY") as Action);
    const wall = named(passed, "Wall of Bone", "p1");
    const regenerate = heuristicActs(passed, "p1").actions.find((a) => a.type === "ACTIVATE_ABILITY");
    expect(regenerate).toMatchObject({ object: wall });
  });

  it("doesn't regenerate a creature that already has a shield", () => {
    const { state } = blocks({ battlefield: ["Wall of Bone", "Swamp", "Swamp"] }, ["Craw Wurm"]);
    const passed = apply(state, legalActions(state, "p2", cards).find((a) => a.type === "PASS_PRIORITY") as Action);
    const wall = named(passed, "Wall of Bone", "p1");
    const shielded = { ...passed, replacements: [{ kind: "regenerationShield" as const, object: wall }] };
    expect(decide(shielded).type).toBe("PASS_PRIORITY");
  });

  it("doesn't start an ability its own {T} keeps it from paying (Gargoyle Castle with four other lands)", () => {
    const state = table(
      { battlefield: ["Gargoyle Castle", "Plains", "Plains", "Plains", "Plains"] },
      {},
      "p1",
      "precombatMain",
    );
    const castle = named(state, "Gargoyle Castle", "p1");
    const ability = seatView(state, "p1", cards).options.find(
      (o) =>
        o.action.type === "ACTIVATE_ABILITY" &&
        o.action.object === castle &&
        o.ability?.cost.some((c) => c.kind === "sacrificeSelf"),
    );
    expect(ability?.payable).toBe(false);
    expect(decide(state).type).toBe("PASS_PRIORITY");
  });

  it("doesn't cast a creature whose entering would cost it its last life (Howling Banshee at 3)", () => {
    const state = table(
      { hand: ["Howling Banshee"], battlefield: ["Swamp", "Swamp", "Swamp", "Swamp"], life: 3 },
      {},
      "p1",
      "precombatMain",
    );
    expect(decide(state).type).toBe("PASS_PRIORITY");
  });

  it("doesn't aim a discard at an empty hand", () => {
    const state = table({ hand: ["Mind Rot"], battlefield: ["Swamp", "Swamp", "Swamp"] }, {}, "p1", "precombatMain");
    expect(decide(state).type).toBe("PASS_PRIORITY");
  });
});

describe("the heuristic's second review", () => {
  it("breathes fire as many times as it takes for an unblocked Shivan Dragon to be lethal", () => {
    let state = until(
      table(
        { battlefield: ["Shivan Dragon", "Mountain", "Mountain"] },
        { battlefield: ["Grizzly Bears"], life: 7 },
        "p1",
        "precombatMain",
      ),
      "declareAttackers",
    );
    const dragon = named(state, "Shivan Dragon", "p1");
    state = answering(state, { kind: "declareAttacker", attack: { attacker: dragon, defender: "p2" } });
    state = answering(state, { kind: "finishDeclaring" });
    // Nothing can block a flier here, so no one declares blockers: pass until p1 has priority after blocks.
    for (let i = 0; i < 10 && !(state.turn?.step === "declareBlockers" && state.pending?.player === "p1"); i++) {
      state = apply(state, legalActions(state, state.pending?.player ?? "p1", cards)[0] as Action);
    }
    expect(state.pending).toMatchObject({ player: "p1", kind: "priority" });
    // 5 power against 7 life: two {R} for +2/+0 make it lethal; one alone wouldn't.
    expect(decide(state)).toMatchObject({ type: "ACTIVATE_ABILITY", object: dragon });
  });

  it("casts Overrun before combat when it makes attacking with everything lethal (CR 702.19b)", () => {
    const state = table(
      {
        hand: ["Overrun"],
        battlefield: ["Grizzly Bears", "Grizzly Bears", "Forest", "Forest", "Forest", "Forest", "Forest"],
      },
      // Two 5/5 tramplers against one 3/3 blocker: 5 + 2 through, lethal at 7; without Overrun only 2.
      { battlefield: ["Hill Giant"], life: 7 },
      "p1",
      "precombatMain",
    );
    expect(decide(state)).toMatchObject({ type: "CAST_SPELL" });
  });

  it("doesn't gang block when it would lose as much as it kills", () => {
    expect(blocks({ battlefield: ["Llanowar Elves", "Grizzly Bears"] }, ["Hill Giant"]).blocks).toHaveLength(0);
  });

  it("attacks with swampwalk only when the defending player has a Swamp (CR 702.14c)", () => {
    const attacksInto = (land: string) =>
      heuristicActs(
        until(
          table({ battlefield: ["Bog Wraith"] }, { battlefield: ["Craw Wurm", land] }, "p1", "precombatMain"),
          "declareAttackers",
        ),
        "p1",
      ).actions.filter((a) => a.type === "ANSWER" && a.answer.kind === "declareAttacker");
    expect(attacksInto("Swamp")).toHaveLength(1);
    expect(attacksInto("Plains")).toHaveLength(0);
  });

  it("doesn't count on regenerating without a land that makes its color", () => {
    expect(blocks({ battlefield: ["Wall of Bone", "Plains"] }, ["Craw Wurm"]).blocks).toHaveLength(0);
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

  it("mulligans five lands in seven", () => {
    const hand = ["Mountain", "Mountain", "Mountain", "Mountain", "Mountain", "Shock", "Shock"];
    expect(opening(hand)).toMatchObject({ answer: { choice: "mulligan" } });
  });

  it("mulligans seven lands and seven spells", () => {
    expect(opening(Array(7).fill("Mountain"))).toMatchObject({ answer: { choice: "mulligan" } });
    expect(opening(Array(7).fill("Shock"))).toMatchObject({ answer: { choice: "mulligan" } });
  });
});
