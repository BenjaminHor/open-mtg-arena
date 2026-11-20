// Costs (CR 601.2b, 601.2f–h, 107.3, 701.21a) where the YAML scenarios can't look: values of X that `legalActions`
// doesn't list, and the order of the events a payment makes.

import { describe, expect, it } from "vitest";
import {
  type Action,
  applyAction,
  type CardData,
  type CardDatabase,
  type GameState,
  legalActions,
} from "../../src/index.ts";
import { BEARS, SAC_PUMP, TEST_CARDS, X_BOLT } from "../support/cards.ts";
import { type Game, playerSetup, start, take } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function game(hand: string[], battlefield: string[]): Game {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest"], hand, battlefield: battlefield.map(permanent) }),
      playerSetup("p2", { library: ["forest"] }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

const answer = (g: Game, value: number) => {
  const pending = g.state.pending;
  if (pending === null) throw new Error("nothing pending");
  return applyAction(
    g.state,
    { type: "ANSWER", decisionId: pending.id, player: "p1", answer: { kind: "announceX", value } },
    TEST_CARDS,
  );
};

describe("announcing X (CR 107.3a)", () => {
  const casting = () => take(game([X_BOLT], ["mountain", "mountain"]), (a) => a.type === "CAST_SPELL");

  it("lists the values the player could pay for, from 0", () => {
    expect(casting().state.pending).toMatchObject({ kind: "announceX", upTo: 1 });
  });

  it("refuses a negative (CR 107.1b) or fractional (CR 107.1a) X", () => {
    expect(answer(casting(), -1).ok).toBe(false);
    expect(answer(casting(), 1.5).ok).toBe(false);
  });

  it("accepts an X too big to pay for: the cost can't be paid, and the player cancels (D-035)", () => {
    const result = answer(casting(), 5);
    if (!result.ok) throw new Error(result.error.message);
    let g: Game = { state: result.state, events: result.events };
    g = take(g, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget");
    expect(g.state.pending).toMatchObject({
      kind: "payMana",
      cost: [
        { kind: "generic", amount: 5 },
        { kind: "colored", color: "R" },
      ],
    });
    const before: GameState = game([X_BOLT], ["mountain", "mountain"]).state;
    g = take(g, (a) => a.type === "ANSWER" && a.answer.kind === "cancelCast");
    expect(g.state.zones).toStrictEqual(before.zones);
  });
});

describe("sacrificing as a cost (CR 601.2h, 701.21a)", () => {
  it("reports the sacrifice before the ability becomes activated (CR 601.2h before 602.2b)", () => {
    let g = game([], [SAC_PUMP, BEARS]);
    g = take(g, (a) => a.type === "ACTIVATE_ABILITY");
    expect(g.state.pending?.kind).toBe("chooseSacrifice");
    const bears = g.state.zones.battlefield[1];
    g = take(g, (a) => a.type === "ANSWER" && a.answer.kind === "chooseSacrifice" && a.answer.object === bears);
    const types = g.events.map((e) => e.type);
    expect(types.indexOf("PERMANENT_SACRIFICED")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("PERMANENT_SACRIFICED")).toBeLessThan(types.indexOf("ABILITY_ACTIVATED"));
  });

  it("a creature chosen as a target can still be sacrificed for the cost; it's then an illegal target (CR 601.5, 608.2b)", () => {
    const pump = TEST_CARDS[SAC_PUMP];
    if (pump === undefined) throw new Error("no Sac Pump");
    // "Sacrifice a creature: Target creature gets +1/+1 until end of turn."
    const cards = {
      ...TEST_CARDS,
      [SAC_PUMP]: {
        ...pump,
        def: {
          ...pump.def,
          abilities: [
            {
              kind: "activated",
              cost: [{ kind: "sacrifice", filter: { types: ["creature"] } }],
              targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
              effects: [{ op: "modifyPT", power: 1, toughness: 1, of: { target: 0 }, duration: "endOfTurn" }],
            },
          ],
        },
      },
    } as typeof TEST_CARDS;
    let g = game([], [SAC_PUMP, BEARS]);
    const bears = g.state.zones.battlefield[1];
    const step = (match: (a: Action) => boolean) => {
      const action = legalActions(g.state, g.state.pending?.player ?? "p1", cards).find(match);
      if (action === undefined) throw new Error(`no such legal action; pending ${JSON.stringify(g.state.pending)}`);
      const result = applyAction(g.state, action, cards);
      if (!result.ok) throw new Error(result.error.message);
      g = { state: result.state, events: result.events };
    };
    step((a) => a.type === "ACTIVATE_ABILITY");
    step(
      (a) =>
        a.type === "ANSWER" &&
        a.answer.kind === "chooseTarget" &&
        a.answer.target.kind === "object" &&
        a.answer.target.object === bears,
    );
    step((a) => a.type === "ANSWER" && a.answer.kind === "chooseSacrifice" && a.answer.object === bears);
    expect(g.state.zones.players.p1?.graveyard).toHaveLength(1);
    step((a) => a.type === "PASS_PRIORITY");
    step((a) => a.type === "PASS_PRIORITY");
    expect(g.events.some((e) => e.type === "ABILITY_DID_NOT_RESOLVE")).toBe(true);
  });
});

/** Test cards with a different ability on Sac Pump. */
function withPumpAbility(ability: NonNullable<CardData["def"]["abilities"]>[number]): CardDatabase {
  const pump = TEST_CARDS[SAC_PUMP];
  if (pump === undefined) throw new Error("no Sac Pump");
  return { ...TEST_CARDS, [SAC_PUMP]: { ...pump, def: { ...pump.def, abilities: [ability] } } };
}

/** Plays `match`, the legal action of whoever is to act, with these cards. */
function play(g: Game, cards: CardDatabase, match: (a: Action) => boolean): Game {
  const action = legalActions(g.state, g.state.pending?.player ?? "p1", cards).find(match);
  if (action === undefined) throw new Error(`no such legal action; pending ${JSON.stringify(g.state.pending)}`);
  const result = applyAction(g.state, action, cards);
  if (!result.ok) throw new Error(result.error.message);
  return { state: result.state, events: result.events };
}

describe("a cost of mana and a sacrifice (CR 601.2g–h)", () => {
  // "{1}, Sacrifice a creature: This creature gets +1/+1 until end of turn."
  const cards = withPumpAbility({
    kind: "activated",
    cost: [
      { kind: "mana", cost: [{ kind: "generic", amount: 1 }] },
      { kind: "sacrifice", filter: { types: ["creature"] } },
    ],
    targets: [],
    effects: [{ op: "modifyPT", power: 1, toughness: 1, of: "self", duration: "endOfTurn" }],
  });

  function chooseBears(): { g: Game; bears: string; before: GameState } {
    let g = game([], [SAC_PUMP, BEARS, "forest"]);
    const before = g.state;
    const bears = g.state.zones.battlefield[1] as string;
    g = play(g, cards, (a) => a.type === "ACTIVATE_ABILITY" && a.object === g.state.zones.battlefield[0]);
    g = play(g, cards, (a) => a.type === "ANSWER" && a.answer.kind === "chooseSacrifice" && a.answer.object === bears);
    return { g, bears, before };
  }

  it("doesn't sacrifice the chosen creature until the mana is paid too", () => {
    const { g, bears } = chooseBears();
    expect(g.state.pending?.kind).toBe("payMana");
    expect(g.state.zones.battlefield).toContain(bears);
  });

  it("puts everything back when cancelled while paying, after a mana ability: nothing was sacrificed (CR 734.1)", () => {
    const { g, before } = chooseBears();
    const forest = g.state.zones.battlefield[2];
    let next = play(g, cards, (a) => a.type === "ACTIVATE_ABILITY" && a.object === forest);
    next = play(next, cards, (a) => a.type === "ANSWER" && a.answer.kind === "cancelCast");
    expect(next.state.zones).toStrictEqual(before.zones);
    expect(next.state.objects).toStrictEqual(before.objects);
  });

  it("sacrifices when the mana is paid, before the ability becomes activated", () => {
    const { g } = chooseBears();
    const forest = g.state.zones.battlefield[2];
    let next = play(g, cards, (a) => a.type === "ACTIVATE_ABILITY" && a.object === forest);
    next = play(next, cards, (a) => a.type === "ANSWER" && a.answer.kind === "payMana");
    const types = next.events.map((e) => e.type);
    expect(types).toStrictEqual(["PERMANENT_SACRIFICED", "ZONE_CHANGED", "ABILITY_ACTIVATED"]);
  });
});

describe("X in an activation cost (CR 107.3a, 602.2b)", () => {
  // "{X}: This creature deals X damage to any target."
  const cards = withPumpAbility({
    kind: "activated",
    cost: [{ kind: "mana", cost: [{ kind: "x" }] }],
    targets: [{ kind: "anyTarget" }],
    effects: [{ op: "dealDamage", amount: "X", from: "self", to: { target: 0 } }],
  });

  it("is announced first, paid as generic mana, and read by the effect", () => {
    let g = game([], [SAC_PUMP, "forest", "forest"]);
    g = play(g, cards, (a) => a.type === "ACTIVATE_ABILITY" && a.object === g.state.zones.battlefield[0]);
    expect(g.state.pending).toMatchObject({ kind: "announceX", upTo: 2 });
    g = play(g, cards, (a) => a.type === "ANSWER" && a.answer.kind === "announceX" && a.answer.value === 2);
    g = play(
      g,
      cards,
      (a) =>
        a.type === "ANSWER" &&
        a.answer.kind === "chooseTarget" &&
        a.answer.target.kind === "player" &&
        a.answer.target.player === "p2",
    );
    expect(g.state.pending).toMatchObject({ kind: "payMana", cost: [{ kind: "generic", amount: 2 }] });
    for (const forest of g.state.zones.battlefield.slice(1)) {
      g = play(g, cards, (a) => a.type === "ACTIVATE_ABILITY" && a.object === forest);
    }
    g = play(g, cards, (a) => a.type === "ANSWER" && a.answer.kind === "payMana");
    g = play(g, cards, (a) => a.type === "PASS_PRIORITY");
    g = play(g, cards, (a) => a.type === "PASS_PRIORITY");
    expect(g.state.players.p2?.life).toBe(18);
  });
});
