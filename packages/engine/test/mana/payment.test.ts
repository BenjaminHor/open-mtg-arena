// Paying mana costs (CR 601.2h, 107.4) and the autoPay helper (D-034).

import { describe, expect, it } from "vitest";
import {
  autoPay,
  type GameState,
  isManaAbility,
  type ManaCost,
  type ManaPool,
  type ObjectId,
  payFromPool,
} from "../../src/index.ts";
import { abilitiesOf } from "../../src/rules/abilities.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { act, type Game, playerSetup, start } from "../support/game.ts";

const pool = (fields: Partial<ManaPool> = {}): ManaPool => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...fields });
const R = { kind: "colored", color: "R" } as const;
const G = { kind: "colored", color: "G" } as const;
const generic = (amount: number) => ({ kind: "generic", amount }) as const;

describe("payFromPool (CR 601.2h, 107.4)", () => {
  it("pays an exact cost and returns what's left", () => {
    expect(payFromPool(pool({ R: 2, G: 1 }), [generic(1), R], pool({ R: 1, G: 1 }))).toStrictEqual(pool({ R: 1 }));
  });

  it("lets generic be paid with any type, colored only with its color", () => {
    expect(payFromPool(pool({ C: 1, R: 1 }), [generic(1), R], pool({ C: 1, R: 1 }))).toStrictEqual(pool());
    expect(payFromPool(pool({ C: 1, G: 1 }), [generic(1), R], pool({ C: 1, G: 1 }))).toBeNull();
  });

  it("refuses a payment the pool can't cover, too little, or too much, leaving the pool unchanged (CR 601.2h)", () => {
    const start = pool({ R: 1 });
    expect(payFromPool(start, [generic(1), R], pool({ R: 2 }))).toBeNull(); // more than the pool has
    expect(payFromPool(pool({ R: 3 }), [generic(1), R], pool({ R: 1 }))).toBeNull(); // partial payment
    expect(payFromPool(pool({ R: 3 }), [generic(1), R], pool({ R: 3 }))).toBeNull(); // overpaying
    expect(start).toStrictEqual(pool({ R: 1 }));
  });
});

describe("mana abilities (CR 605.1a)", () => {
  it("counts Llanowar Elves' ability as a mana ability, but not firebreathing", () => {
    const game = board(["llanowar-elves", "furnace-whelp"]);
    const [elves, whelp] = game.state.zones.battlefield as [ObjectId, ObjectId];
    expect(abilitiesOf(game.state, elves, TEST_CARDS).map((a) => isManaAbility(a.def))).toStrictEqual([true]);
    expect(abilitiesOf(game.state, whelp, TEST_CARDS).map((a) => isManaAbility(a.def))).toStrictEqual([false]);
  });
});

/** p1 in their precombat main phase with these permanents, none of them summoning sick. */
function board(permanents: string[], manaPool: ManaPool = pool()): Game {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest", "forest"],
        manaPool,
        battlefield: permanents.map((oracleId) => ({
          oracleId,
          tapped: false,
          summoningSick: false,
          damage: 0,
          counters: {},
        })),
      }),
      playerSetup("p2", { library: ["mountain", "mountain"] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

/** Activates the chosen abilities through applyAction, then pays from the pool: the whole autoPay plan, checked. */
function carryOut(game: Game, cost: ManaCost): ManaPool | null {
  const plan = autoPay(game.state, "p1", cost, TEST_CARDS);
  if (plan === null) return null;
  let g = game;
  for (const { object, ability } of plan.activations) {
    const pending = g.state.pending;
    if (pending === null) throw new Error("expected priority");
    g = act(g, { type: "ACTIVATE_ABILITY", decisionId: pending.id, player: "p1", object, ability });
  }
  const after = payFromPool(g.state.players.p1?.manaPool ?? pool(), cost, plan.payment);
  if (after === null) throw new Error(`autoPay's payment didn't work: ${JSON.stringify(plan)}`);
  return after;
}

describe("autoPay (D-034)", () => {
  it("uses mana already in the pool first", () => {
    const plan = autoPay(board(["mountain"], pool({ R: 1 })).state, "p1", [R], TEST_CARDS);
    expect(plan).toStrictEqual({ activations: [], payment: pool({ R: 1 }) });
  });

  it("taps lands before creatures, and pays colored symbols before generic", () => {
    const game = board(["llanowar-elves", "forest", "mountain"]);
    const [elves, forest, mountain] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    const plan = autoPay(game.state, "p1", [generic(1), G], TEST_CARDS);
    // G first: the Forest (a land) rather than the Elves. Then generic: the Mountain, the next land.
    expect(plan?.activations.map((a) => a.object)).toStrictEqual([forest, mountain]);
    expect(plan?.activations.map((a) => a.object)).not.toContain(elves);
    expect(carryOut(game, [generic(1), G])).toStrictEqual(pool());
  });

  it("says there's no way to pay when there isn't", () => {
    expect(autoPay(board(["forest", "forest"]).state, "p1", [R], TEST_CARDS)).toBeNull();
    expect(autoPay(board(["mountain"]).state, "p1", [generic(1), R], TEST_CARDS)).toBeNull();
  });

  it("finds a payment whenever one exists, on every small board (checked by brute force)", () => {
    const kinds = ["mountain", "forest", "llanowar-elves"];
    const costs: ManaCost[] = [
      [R],
      [G],
      [generic(1)],
      [generic(1), R],
      [R, G],
      [generic(2), G],
      [generic(1), R, R],
      [generic(3)],
    ];
    for (const permanents of boards(kinds, 4)) {
      const game = board(permanents);
      for (const cost of costs) {
        const possible = payable(game.state, cost);
        const result = carryOut(game, cost);
        expect(result !== null, `${permanents.join(",")} paying ${JSON.stringify(cost)}`).toBe(possible);
      }
    }
  });
});

/** Every multiset of up to `max` permanents of these kinds. */
function boards(kinds: string[], max: number): string[][] {
  const out: string[][] = [[]];
  const grow = (prefix: string[], from: number) => {
    if (prefix.length === max) return;
    for (let i = from; i < kinds.length; i++) {
      const next = [...prefix, kinds[i] as string];
      out.push(next);
      grow(next, i);
    }
  };
  grow([], 0);
  return out;
}

/** Brute force: is there any set of mana sources that covers the cost? Each permanent makes one mana of one color. */
function payable(state: GameState, cost: ManaCost): boolean {
  const colors = state.zones.battlefield.map((id) => {
    const ability = abilitiesOf(state, id, TEST_CARDS).find((a) => isManaAbility(a.def));
    const effect = ability?.def.effects.find((e) => e.op === "addMana");
    return effect?.op === "addMana" ? effect.mana : null;
  });
  const sources = colors.filter((c) => c !== null);
  for (let mask = 0; mask < 1 << sources.length; mask++) {
    const have = pool();
    sources.forEach((c, i) => {
      if (mask & (1 << i)) have[c] += 1;
    });
    const total = Object.values(have).reduce((a, b) => a + b, 0);
    const needColored = (c: "R" | "G") => cost.filter((s) => s.kind === "colored" && s.color === c).length;
    const needTotal = cost.reduce((n, s) => n + (s.kind === "generic" ? s.amount : 1), 0);
    if (have.R >= needColored("R") && have.G >= needColored("G") && total === needTotal) return true;
  }
  return false;
}
