// The removal effects and payment details (M2-05a) that the YAML scenarios can't reach: a permanent controlled by
// someone other than its owner, a target that changes between the start of resolution and an effect, gaining 0 life,
// and the {T} source tapped for mana while its own cost is being paid.

import { describe, expect, it } from "vitest";
import { runEffect } from "../../src/effects/run-effect.ts";
import { type Action, applyAction, autoPay, type CardDatabase, type GameState, legalActions } from "../../src/index.ts";
import { happen } from "../../src/pipeline/happen.ts";
import { legalTargets } from "../../src/rules/targets.ts";
import { putAbilityOnStack } from "../../src/zones/stack-abilities.ts";
import { BEARS, ENCHANTMENT, HASTY_ELF, PINGER, TEST_CARDS } from "../support/cards.ts";
import { type Game, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function board(p1: string[], p2: string[] = []): GameState {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest"], battlefield: p1.map(permanent) }),
      playerSetup("p2", { library: ["forest"], battlefield: p2.map(permanent) }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
}

const context = (self: string, targets: string[][] = []) => ({
  self: self as `o${number}`,
  controller: "p1" as const,
  targets: targets.map((g) => g.map((object) => ({ kind: "object" as const, object: object as `o${number}` }))),
  division: [],
  x: null,
});

describe("removal goes to its owner's zones (CR 400.3)", () => {
  it("returns, puts on the library and destroys into the owner's zones, whoever controls the permanent", () => {
    // p2's Grizzly Bears, controlled by p1.
    let state = board([], [BEARS]);
    const bears = state.zones.battlefield[0] as string;
    const obj = state.objects[bears as `o${number}`];
    if (obj?.kind !== "card") throw new Error("no Bears");
    state = { ...state, objects: { ...state.objects, [bears]: { ...obj, baseController: "p1" } } };
    for (const [op, zone] of [
      ["returnToHand", "hand"],
      ["putOnTopOfLibrary", "library"],
      ["destroy", "graveyard"],
    ] as const) {
      const after = runEffect(state, { op, of: { target: 0 } }, context(bears, [[bears]]), TEST_CARDS).state;
      expect(after.zones.players.p2?.[zone]).toHaveLength(zone === "library" ? 2 : 1);
      expect(after.zones.players.p1?.[zone]).toHaveLength(zone === "library" ? 1 : 0);
    }
  });
});

describe("an object gone since resolution began is left alone (CR 101.3, 400.7)", () => {
  it("destroy, tap and exile do nothing to an id that's no longer on the battlefield", () => {
    const state = board([BEARS]);
    const bears = state.zones.battlefield[0] as string;
    const gone = happen(state, { kind: "destroy", object: bears as `o${number}` }, TEST_CARDS).state;
    for (const op of ["destroy", "tap", "exile", "returnToHand", "putOnTopOfLibrary"] as const) {
      const result = runEffect(gone, { op, of: { target: 0 } }, context(bears, [[bears]]), TEST_CARDS);
      expect(result.events).toStrictEqual([]);
    }
  });
});

describe("enchantments, until the pool has one", () => {
  it("'target artifact or enchantment' can choose an enchantment, and 'destroy all enchantments' destroys it", () => {
    const state = board([ENCHANTMENT, BEARS]);
    const [enchantment] = state.zones.battlefield;
    const targets = legalTargets(
      state,
      { kind: "permanent", filter: { types: ["artifact", "enchantment"] } },
      { object: "o999", controller: "p1" },
      TEST_CARDS,
    );
    expect(targets).toStrictEqual([{ kind: "object", object: enchantment }]);
    const after = runEffect(
      state,
      { op: "destroyAll", filter: { types: ["enchantment"] } },
      context("o999"),
      TEST_CARDS,
    );
    expect(after.state.zones.players.p1?.graveyard).toHaveLength(1);
    expect(after.state.zones.battlefield).toHaveLength(1);
  });
});

describe("a target checked again as the ability resolves (CR 608.2b)", () => {
  it("Royal Assassin's ability doesn't resolve if its target is no longer tapped (its ruling)", () => {
    // "{T}: Destroy target tapped creature" on a Bears whose ability is on the stack, then the Bears untaps.
    const pump = TEST_CARDS[PINGER];
    if (pump === undefined) throw new Error("no Pinger");
    const cards: CardDatabase = {
      ...TEST_CARDS,
      [PINGER]: {
        ...pump,
        def: {
          ...pump.def,
          abilities: [
            {
              kind: "activated",
              cost: [{ kind: "tap" }],
              targets: [{ kind: "permanent", filter: { types: ["creature"], tapped: true } }],
              effects: [{ op: "destroy", of: { target: 0 } }],
            },
          ],
        },
      },
    };
    const tappedBears = { ...permanent(BEARS), tapped: true };
    let g: Game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"], battlefield: [permanent(PINGER)] }),
        playerSetup("p2", { library: ["forest"], battlefield: [tappedBears] }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
      ruleModifiers: [],
    });
    const step = (match: (a: Action) => boolean) => {
      const action = legalActions(g.state, g.state.pending?.player ?? "p1", cards).find(match);
      if (action === undefined) throw new Error("no such action");
      const r = applyAction(g.state, action, cards);
      if (!r.ok) throw new Error(r.error.message);
      g = { state: r.state, events: r.events };
    };
    step((a) => a.type === "ACTIVATE_ABILITY");
    step((a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget");
    const bears = g.state.zones.battlefield[1] as `o${number}`;
    g = { ...g, state: happen(g.state, { kind: "untap", object: bears }, cards).state };
    step((a) => a.type === "PASS_PRIORITY");
    step((a) => a.type === "PASS_PRIORITY");
    expect(g.events.some((e) => e.type === "ABILITY_DID_NOT_RESOLVE")).toBe(true);
    expect(g.state.zones.battlefield).toContain(bears);
  });
});

describe("countering (CR 701.6a)", () => {
  it("a countered ability is removed from the stack and ceases to exist; nothing goes to a graveyard", () => {
    let state = board([PINGER]);
    const pinger = state.zones.battlefield[0] as `o${number}`;
    state = putAbilityOnStack(state, pinger, PINGER, { kind: "printed", index: 0 }, "p1").state;
    const ability = state.zones.stack[0] as `o${number}`;
    const result = happen(state, { kind: "counterObject", object: ability }, TEST_CARDS);
    expect(result.state.zones.stack).toStrictEqual([]);
    expect(result.state.objects[ability]).toBeUndefined();
    expect(result.state.zones.players.p1?.graveyard).toStrictEqual([]);
    expect(result.events).toStrictEqual([{ type: "ABILITY_COUNTERED", object: ability, source: pinger }]);
  });
});

describe("gaining life (CR 119.3)", () => {
  it("gains the amount, and gaining 0 isn't an event at all (CR 119.9, 119.10)", () => {
    const state = board([]);
    const gained = happen(state, { kind: "gainLife", player: "p1", amount: 3 }, TEST_CARDS);
    expect(gained.state.players.p1?.life).toBe(23);
    expect(gained.events).toStrictEqual([{ type: "LIFE_GAINED", player: "p1", amount: 3 }]);
    expect(happen(state, { kind: "gainLife", player: "p1", amount: 0 }, TEST_CARDS).events).toStrictEqual([]);
  });

  it("losing 0 life, unlike gaining 0, is an event (D-065, the owner's ruling)", () => {
    const state = board([]);
    const lost = runEffect(state, { op: "loseLife", who: "you", amount: 0 }, context("o999"), TEST_CARDS);
    expect(lost.events).toStrictEqual([{ type: "LIFE_LOST", player: "p1", amount: 0 }]);
    expect(lost.state.players.p1?.life).toBe(20);
  });
});

describe("{T} in the cost of an ability whose source also makes mana (CR 107.5, 601.2h)", () => {
  // A hasty elf with "{T}: Add {G}" and a second ability, "{1}, {T}: You gain 1 life".
  const elf = TEST_CARDS[HASTY_ELF];
  if (elf === undefined) throw new Error("no hasty elf");
  const cards: CardDatabase = {
    ...TEST_CARDS,
    [HASTY_ELF]: {
      ...elf,
      def: {
        ...elf.def,
        abilities: [
          ...(elf.def.abilities ?? []),
          {
            kind: "activated",
            cost: [{ kind: "mana", cost: [{ kind: "generic", amount: 1 }] }, { kind: "tap" }],
            targets: [],
            effects: [{ op: "gainLife", who: "you", amount: 1 }],
          },
        ],
      },
    },
  };

  it("lets the source tap for mana while its own cost is paid, and then lists no payment, only cancel", () => {
    let g: Game = { state: board([HASTY_ELF, "forest"]), events: [] };
    const elfId = g.state.zones.battlefield[0];
    const act = (match: (a: Action) => boolean) => {
      const action = legalActions(g.state, "p1", cards).find(match);
      if (action === undefined) throw new Error("no such action");
      const r = applyAction(g.state, action, cards);
      if (!r.ok) throw new Error(r.error.message);
      g = { state: r.state, events: r.events };
    };
    act(
      (a) =>
        a.type === "ACTIVATE_ABILITY" && a.object === elfId && a.ability.kind === "printed" && a.ability.index === 1,
    );
    expect(g.state.pending?.kind).toBe("payMana");
    // Tapping it for mana is legal (CR 605.3a), but leaves a cost that can't be paid (CR 107.5): only cancel works.
    const tapForMana = {
      type: "ACTIVATE_ABILITY",
      decisionId: g.state.pending?.id ?? "d0",
      player: "p1",
      object: elfId,
      ability: { kind: "printed", index: 0 },
    } as Action;
    const tapped = applyAction(g.state, tapForMana, cards);
    if (!tapped.ok) throw new Error(tapped.error.message);
    g = { state: tapped.state, events: tapped.events };
    expect(legalActions(g.state, "p1", cards).some((a) => a.type === "ANSWER" && a.answer.kind === "payMana")).toBe(
      false,
    );
    const payment = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 };
    const pay = {
      type: "ANSWER",
      decisionId: g.state.pending?.id ?? "d0",
      player: "p1",
      answer: { kind: "payMana", payment },
    };
    expect(applyAction(g.state, pay as Action, cards).ok).toBe(false);
    act((a) => a.type === "ANSWER" && a.answer.kind === "cancelCast");
    expect(g.state.objects[elfId as `o${number}`]).toMatchObject({ tapped: false });
  });

  it("autoPay doesn't propose tapping the source for mana for its own cost (CR 107.5)", () => {
    let g: Game = { state: board([HASTY_ELF, "forest"]), events: [] };
    const elfId = g.state.zones.battlefield[0];
    const action = legalActions(g.state, "p1", cards).find(
      (a) =>
        a.type === "ACTIVATE_ABILITY" && a.object === elfId && a.ability.kind === "printed" && a.ability.index === 1,
    );
    if (action === undefined) throw new Error("can't activate");
    const r = applyAction(g.state, action, cards);
    if (!r.ok) throw new Error(r.error.message);
    g = { state: r.state, events: r.events };
    const plan = autoPay(g.state, "p1", [{ kind: "generic", amount: 1 }], cards);
    expect(plan?.activations.map((a) => a.object)).toStrictEqual([g.state.zones.battlefield[1]]);
  });
});
