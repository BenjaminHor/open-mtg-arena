// Combat details the scenarios don't show directly: dividing damage one blocker at a time (CR 510.1c, 510.1e), several
// attackers each divided, who may attack or block at all (CR 506.3, 508.1a, 509.1a), a trade as one state-based action
// event (CR 704.3), and haste letting a creature use {T} abilities (CR 702.10c).

import { describe, expect, it } from "vitest";
import { applyAction, type GameState, legalActions, type ObjectId } from "../../src/index.ts";
import { BEARS, ELVES, HASTY_ELF, HILL_GIANT, STATUE, TEST_CARDS } from "../support/cards.ts";
import { answer, type Game, passBoth, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string, sick = false) => ({
  oracleId,
  tapped: false,
  summoningSick: sick,
  damage: 0,
  counters: {},
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

/** Passes to the declare attackers step and declares these attacks on p2, then passes to declare blockers. */
function attackWith(game: Game, attackers: ObjectId[]): Game {
  let g = passBoth(passBoth(game));
  for (const attacker of attackers) g = answer(g, { kind: "declareAttacker", attack: { attacker, defender: "p2" } });
  return passBoth(answer(g, { kind: "finishDeclaring" }));
}

function blockWith(game: Game, blocks: [ObjectId, ObjectId][]): Game {
  let g = game;
  for (const [blocker, attacker] of blocks) g = answer(g, { kind: "declareBlocker", block: { blocker, attacker } });
  return answer(g, { kind: "finishDeclaring" });
}

const amounts = (state: GameState) =>
  legalActions(state, "p1", TEST_CARDS).flatMap((a) =>
    a.type === "ANSWER" && a.answer.kind === "assignDamage" ? [a.answer.amount] : [],
  );

describe("dividing combat damage, one blocker at a time (CR 510.1c, 510.1e)", () => {
  it("offers 0 up to what's left for each blocker but the last, which gets the rest", () => {
    let game = board([permanent(HILL_GIANT)], [permanent(BEARS), permanent(BEARS), permanent(BEARS)]);
    const [giant, b1, b2, b3] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId, ObjectId];
    game = blockWith(attackWith(game, [giant]), [
      [b1, giant],
      [b2, giant],
      [b3, giant],
    ]);
    game = passBoth(game);
    expect(game.state.pending).toMatchObject({ kind: "assignDamage", blockers: [b1, b2, b3], amount: 3 });
    expect(amounts(game.state)).toStrictEqual([0, 1, 2, 3]);
    const pending = game.state.pending;
    if (pending === null) throw new Error("nothing pending");
    const tooMuch = applyAction(
      game.state,
      { type: "ANSWER", decisionId: pending.id, player: "p1", answer: { kind: "assignDamage", amount: 4 } },
      TEST_CARDS,
    );
    expect(tooMuch.ok).toBe(false);
    game = answer(game, { kind: "assignDamage", amount: 1 });
    expect(amounts(game.state)).toStrictEqual([0, 1, 2]);
    game = answer(game, { kind: "assignDamage", amount: 0 });
    // 1, 0, and the last Bears gets the remaining 2, which is lethal.
    expect(game.state.objects[b1]).toMatchObject({ damage: 1 });
    expect(game.state.objects[b2]).toMatchObject({ damage: 0 });
    expect(game.state.zones.battlefield).not.toContain(b3);
  });

  it("asks for each attacker blocked by several creatures, and deals all the damage together", () => {
    let game = board(
      [permanent(HILL_GIANT), permanent(HILL_GIANT)],
      [permanent(BEARS), permanent(BEARS), permanent(BEARS), permanent(BEARS)],
    );
    const [g1, g2, b1, b2, b3, b4] = game.state.zones.battlefield as ObjectId[] as [
      ObjectId,
      ObjectId,
      ObjectId,
      ObjectId,
      ObjectId,
      ObjectId,
    ];
    game = blockWith(attackWith(game, [g1, g2]), [
      [b1, g1],
      [b2, g1],
      [b3, g2],
      [b4, g2],
    ]);
    game = passBoth(game);
    expect(game.state.pending).toMatchObject({ kind: "assignDamage", attacker: g1 });
    game = answer(game, { kind: "assignDamage", amount: 3 });
    expect(game.state.pending).toMatchObject({ kind: "assignDamage", attacker: g2, divided: [{ attacker: g1 }] });
    expect(game.events.some((e) => e.type === "DAMAGE_DEALT")).toBe(false);
    game = answer(game, { kind: "assignDamage", amount: 0 });
    const dealt = game.events.filter((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toHaveLength(6); // b1 and b4 from the Giants, and each Bears back at its Giant
    expect(game.state.zones.players.p2?.graveyard).toHaveLength(2);
  });
});

describe("who can attack and block (CR 506.3, 508.1a, 509.1a)", () => {
  it("never offers a noncreature, the other player's creature, or one creature twice", () => {
    let game = board([permanent(BEARS), permanent(STATUE)], [permanent(BEARS)]);
    const [mine, statue, theirs] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    game = passBoth(passBoth(game));
    const attackers = () =>
      legalActions(game.state, "p1", TEST_CARDS).flatMap((a) =>
        a.type === "ANSWER" && a.answer.kind === "declareAttacker" ? [a.answer.attack.attacker] : [],
      );
    expect(attackers()).toStrictEqual([mine]);
    expect(attackers()).not.toContain(statue);
    expect(attackers()).not.toContain(theirs);
    game = answer(game, { kind: "declareAttacker", attack: { attacker: mine, defender: "p2" } });
    expect(attackers()).toStrictEqual([]);
  });

  it("lets a creature block only one attacker, and only the defending player's creatures block", () => {
    let game = board([permanent(BEARS), permanent(BEARS)], [permanent(HILL_GIANT)]);
    const [a1, a2, giant] = game.state.zones.battlefield as [ObjectId, ObjectId, ObjectId];
    game = attackWith(game, [a1, a2]);
    const blocks = () =>
      legalActions(game.state, "p2", TEST_CARDS).flatMap((a) =>
        a.type === "ANSWER" && a.answer.kind === "declareBlocker" ? [a.answer.block] : [],
      );
    expect(blocks()).toStrictEqual([
      { blocker: giant, attacker: a1 },
      { blocker: giant, attacker: a2 },
    ]);
    game = answer(game, { kind: "declareBlocker", block: { blocker: giant, attacker: a1 } });
    expect(blocks()).toStrictEqual([]);
  });
});
