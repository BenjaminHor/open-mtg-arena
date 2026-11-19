// Combat details the scenarios don't show directly: every division of damage is listed and checked (CR 510.1c,
// 510.1e), a trade is one state-based action event (CR 704.3), and haste lets a creature use {T} abilities (CR 702.10c).

import { describe, expect, it } from "vitest";
import { allDivisions, divisionProblem } from "../../src/combat/combat-damage.ts";
import { legalActions, type ObjectId } from "../../src/index.ts";
import { BEARS, ELVES, HASTY_ELF, TEST_CARDS } from "../support/cards.ts";
import { answer, type Game, passBoth, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string, sick = false) => ({
  oracleId,
  tapped: false,
  summoningSick: sick,
  damage: 0,
  counters: {},
});

describe("dividing combat damage (CR 510.1c)", () => {
  it("lists every division that adds up to the damage, including 0 to a blocker", () => {
    expect(allDivisions(2, ["o1", "o2"])).toStrictEqual([
      [
        { blocker: "o1", amount: 2 },
        { blocker: "o2", amount: 0 },
      ],
      [
        { blocker: "o1", amount: 1 },
        { blocker: "o2", amount: 1 },
      ],
      [
        { blocker: "o1", amount: 0 },
        { blocker: "o2", amount: 2 },
      ],
    ]);
    expect(allDivisions(4, ["o1", "o2", "o3"])).toHaveLength(15);
  });

  it("checks the whole division (CR 510.1e)", () => {
    const blockers: ObjectId[] = ["o1", "o2"];
    const ok = [
      { blocker: "o1", amount: 1 },
      { blocker: "o2", amount: 2 },
    ] as const;
    expect(divisionProblem(blockers, 3, [...ok])).toBeNull();
    expect(divisionProblem(blockers, 4, [...ok])).toMatch(/add up to 4/);
    expect(divisionProblem(blockers, 3, [{ blocker: "o1", amount: 3 }])).toMatch(/each blocking creature exactly once/);
    expect(
      divisionProblem(blockers, 3, [
        { blocker: "o1", amount: 4 },
        { blocker: "o2", amount: -1 },
      ]),
    ).toMatch(/0 or more/);
    expect(
      divisionProblem(blockers, 2, [
        { blocker: "o1", amount: 1 },
        { blocker: "o1", amount: 1 },
      ]),
    ).toMatch(/exactly once/);
  });
});

/** p1 in their precombat main phase with these permanents, p2 with theirs. */
function board(mine: ReturnType<typeof permanent>[], theirs: ReturnType<typeof permanent>[]): Game {
  return start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest", "forest"], battlefield: mine }),
      playerSetup("p2", { library: ["forest", "forest"], battlefield: theirs }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

describe("combat damage is dealt at once (CR 510.2)", () => {
  it("makes two creatures that trade die in one state-based action event", () => {
    let game = board([permanent(BEARS)], [permanent(BEARS)]);
    const [attacker, blocker] = game.state.zones.battlefield as [ObjectId, ObjectId];
    game = passBoth(passBoth(game)); // to declare attackers
    game = answer(game, { kind: "declareAttacker", attack: { attacker, defender: "p2" } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game); // to declare blockers
    game = answer(game, { kind: "declareBlocker", block: { blocker, attacker } });
    game = answer(game, { kind: "finishDeclaring" });
    const before = game.events.length;
    game = passBoth(game); // combat damage
    const damage = game.events.slice(before).filter((e) => e.type === "DAMAGE_DEALT");
    expect(damage.map((e) => e.type === "DAMAGE_DEALT" && e.combat)).toStrictEqual([true, true]);
    const checks = game.events.slice(before).filter((e) => e.type === "STATE_BASED_ACTIONS");
    expect(checks).toHaveLength(1);
    expect(checks[0]?.type === "STATE_BASED_ACTIONS" && checks[0].actions).toHaveLength(2);
  });
});

describe("haste (CR 702.10c)", () => {
  it("lets a creature use its {T} abilities the turn it comes under its controller's control", () => {
    const game = board([permanent(HASTY_ELF, true), permanent(ELVES, true)], []);
    const [hasty, elves] = game.state.zones.battlefield as [ObjectId, ObjectId];
    const activatable = legalActions(game.state, "p1", TEST_CARDS).flatMap((a) =>
      a.type === "ACTIVATE_ABILITY" ? [a.object] : [],
    );
    expect(activatable).toContain(hasty);
    expect(activatable).not.toContain(elves);
  });
});
