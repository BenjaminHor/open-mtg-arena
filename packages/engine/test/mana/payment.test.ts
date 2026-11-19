// Paying mana costs (CR 601.2h, 107.4) and the autoPay helper (D-034).

import { describe, expect, it } from "vitest";
import {
  allPayments,
  autoPay,
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
    expect(payFromPool(pool({ R: 1, G: 1 }), [generic(1)], pool({ R: 0.5, G: 0.5 }))).toBeNull(); // whole mana only
  });
});

describe("allPayments (CR 601.2h)", () => {
  it("lists every way the pool can pay, since the player chooses", () => {
    expect(allPayments(pool({ R: 2, G: 1 }), [generic(1), R])).toStrictEqual([pool({ R: 1, G: 1 }), pool({ R: 2 })]);
    expect(allPayments(pool({ G: 1 }), [R])).toStrictEqual([]);
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

type Permanent = string | { oracleId: string; tapped?: boolean; sick?: boolean };

/** p1 in their precombat main phase with these permanents (untapped and not sick unless said), p2 with theirs. */
function board(permanents: Permanent[], manaPool: ManaPool = pool(), theirs: string[] = []): Game {
  const setup = (p: Permanent) =>
    typeof p === "string"
      ? { oracleId: p, tapped: false, summoningSick: false, damage: 0, counters: {} }
      : { oracleId: p.oracleId, tapped: p.tapped ?? false, summoningSick: p.sick ?? false, damage: 0, counters: {} };
  return start({
    seed: 1,
    players: [
      playerSetup("p1", {
        library: ["forest", "forest"],
        manaPool,
        battlefield: permanents.map(setup),
      }),
      playerSetup("p2", { library: ["mountain", "mountain"], battlefield: theirs.map(setup) }),
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

  it("never uses a tapped source, a summoning-sick creature, or another player's permanent", () => {
    expect(autoPay(board([{ oracleId: "forest", tapped: true }]).state, "p1", [G], TEST_CARDS)).toBeNull();
    expect(autoPay(board([{ oracleId: "llanowar-elves", sick: true }]).state, "p1", [G], TEST_CARDS)).toBeNull();
    expect(autoPay(board([], pool(), ["forest"]).state, "p1", [G], TEST_CARDS)).toBeNull();
    // A summoning-sick land is fine: the rule is only about creatures (CR 602.5a).
    expect(autoPay(board([{ oracleId: "forest", sick: true }]).state, "p1", [G], TEST_CARDS)).not.toBeNull();
  });

  it("combines mana already in the pool with mana it makes", () => {
    const game = board(["mountain"], pool({ G: 1 }));
    const plan = autoPay(game.state, "p1", [generic(1), R], TEST_CARDS);
    expect(plan?.activations).toHaveLength(1);
    expect(plan?.payment).toStrictEqual(pool({ R: 1, G: 1 }));
    expect(carryOut(game, [generic(1), R])).toStrictEqual(pool());
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
    const pools = [pool(), pool({ R: 1 }), pool({ G: 1, C: 1 })];
    for (const permanents of boards(kinds, 4)) {
      for (const start of pools) {
        const game = board(permanents, start);
        for (const cost of costs) {
          const possible = payable(permanents, start, cost);
          const result = carryOut(game, cost);
          expect(
            result !== null,
            `${permanents.join(",")} + ${JSON.stringify(start)} paying ${JSON.stringify(cost)}`,
          ).toBe(possible);
        }
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

/**
 * Brute force, independent of the engine: is there any subset of the board's mana, plus the pool, that pays the cost
 * exactly? Each of these permanents makes one mana: Mountain R, Forest G, Llanowar Elves G.
 */
function payable(permanents: string[], start: ManaPool, cost: ManaCost): boolean {
  const COLOR: Record<string, "R" | "G"> = { mountain: "R", forest: "G", "llanowar-elves": "G" };
  const sources = permanents.map((p) => COLOR[p] as "R" | "G");
  const poolMana = (Object.entries(start) as [keyof ManaPool, number][]).flatMap(([t, n]) =>
    Array.from({ length: n }, () => t),
  );
  const all = [...sources, ...poolMana];
  const needTotal = cost.reduce((n, s) => n + (s.kind === "generic" ? s.amount : 1), 0);
  for (let mask = 0; mask < 1 << all.length; mask++) {
    const have = pool();
    all.forEach((c, i) => {
      if (mask & (1 << i)) have[c] += 1;
    });
    const total = Object.values(have).reduce((a, b) => a + b, 0);
    const needColored = (c: "R" | "G") => cost.filter((s) => s.kind === "colored" && s.color === c).length;
    if (have.R >= needColored("R") && have.G >= needColored("G") && total === needTotal) return true;
  }
  return false;
}
