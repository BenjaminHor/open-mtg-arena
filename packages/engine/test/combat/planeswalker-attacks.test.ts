// Attacking a planeswalker (CR 506.3, 508.1b), before the pool has one: a test planeswalker with no abilities, its
// loyalty set up as counters. Damage to it removes loyalty (CR 120.3c); once it's removed from combat, a creature
// attacking it attacks nothing and, unblocked, deals no combat damage (CR 506.4c, 510.1b).

import { describe, expect, it } from "vitest";
import { removedFromCombat, removeTypeChangesFromCombat } from "../../src/combat/removed-from-combat.ts";
import { type Action, attackedNow, type GameState, legalActions, type ObjectId } from "../../src/index.ts";
import { moveCard } from "../../src/zones/move-card.ts";
import { BEARS, DEATHTOUCH_TRAMPLER, HILL_GIANT, TEST_CARDS, TEST_WALKER } from "../support/cards.ts";
import { answer, type Game, passBoth, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string, counters: Record<string, number> = {}) => ({
  oracleId,
  tapped: false,
  summoningSick: false,
  damage: 0,
  counters,
});

/** p1's creatures against p2's Test Walker with 5 loyalty and p2's other permanents, at p1's declare attackers step. */
function atDeclareAttackers(mine: string[], theirs: string[] = []): { game: Game; walker: ObjectId; ids: ObjectId[] } {
  const game = start({
    seed: 1,
    players: [
      playerSetup("p1", { library: ["forest", "forest"], battlefield: mine.map((c) => permanent(c)) }),
      playerSetup("p2", {
        library: ["forest", "forest"],
        battlefield: [permanent(TEST_WALKER, { loyalty: 5 }), ...theirs.map((c) => permanent(c))],
      }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
  const ids = game.state.zones.battlefield as ObjectId[];
  const walker = ids[mine.length] as ObjectId;
  return { game: passBoth(passBoth(game)), walker, ids };
}

const loyalty = (state: GameState, id: ObjectId) => {
  const obj = state.objects[id];
  return obj?.kind === "card" ? (obj.counters.loyalty ?? 0) : null;
};

const attacks = (state: GameState) =>
  legalActions(state, "p1", TEST_CARDS).flatMap((a: Action) =>
    a.type === "ANSWER" && a.answer.kind === "declareAttacker" ? [a.answer.attack] : [],
  );

describe("attacking a planeswalker (CR 506.3, 508.1b)", () => {
  it("offers each creature the defending player and each planeswalker they control, the player still defending", () => {
    const { game, walker, ids } = atDeclareAttackers([BEARS]);
    const bears = ids[0] as ObjectId;
    // The defending player is the planeswalker's controller (CR 506.2, 508.5).
    expect(attacks(game.state)).toStrictEqual([
      { attacker: bears, defender: "p2" },
      { attacker: bears, defender: "p2", planeswalker: walker },
    ]);
  });

  it("removes loyalty counters for the damage an unblocked attacker deals it, not life (CR 510.1b, 120.3c)", () => {
    const { game: start, walker, ids } = atDeclareAttackers([BEARS]);
    const attacker = ids[0] as ObjectId;
    let game = answer(start, { kind: "declareAttacker", attack: { attacker, defender: "p2", planeswalker: walker } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game); // past declare blockers: p2 has no creature, so isn't asked
    const before = game.events.length;
    game = passBoth(game); // combat damage
    expect(loyalty(game.state, walker)).toBe(3);
    expect(game.state.players.p2?.life).toBe(20);
    const dealt = game.events.slice(before).filter((e) => e.type === "DAMAGE_DEALT");
    expect(dealt).toStrictEqual([
      { type: "DAMAGE_DEALT", source: attacker, to: { kind: "object", object: walker }, amount: 2, combat: true },
    ]);
  });

  it("lets the defending player block a creature attacking their planeswalker (CR 509.1a)", () => {
    const { game: start, walker, ids } = atDeclareAttackers([BEARS], [HILL_GIANT]);
    const [attacker, , giant] = ids as [ObjectId, ObjectId, ObjectId];
    let game = answer(start, { kind: "declareAttacker", attack: { attacker, defender: "p2", planeswalker: walker } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game);
    game = answer(game, { kind: "declareBlocker", block: { blocker: giant, attacker } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game);
    expect(loyalty(game.state, walker)).toBe(5);
  });
});

describe("a planeswalker removed from combat (CR 506.4)", () => {
  /** Declares the attack on the walker, then takes the walker off the battlefield, as a removal spell would. */
  function attackThenRemoveWalker(attackerCard: string, blockers: string[] = []) {
    const { game: start, walker, ids } = atDeclareAttackers([attackerCard], blockers);
    const attacker = ids[0] as ObjectId;
    let game = answer(start, { kind: "declareAttacker", attack: { attacker, defender: "p2", planeswalker: walker } });
    game = answer(game, { kind: "finishDeclaring" });
    const moved = moveCard(game.state, walker, { zone: "graveyard" });
    return { game: { ...game, state: moved.state }, attacker, walker, ids };
  }

  it("leaves the creature attacking nothing: unblocked, it deals no combat damage (CR 506.4c, 510.1b)", () => {
    const { game: declared, attacker } = attackThenRemoveWalker(BEARS);
    const attack = declared.state.combat?.attacks[0];
    expect(attack !== undefined && attackedNow(declared.state, attack, TEST_CARDS)).toBeNull();
    let game = passBoth(declared); // past declare blockers: p2 has no creature
    const before = game.events.length;
    game = passBoth(game);
    expect(game.events.slice(before).filter((e) => e.type === "DAMAGE_DEALT")).toStrictEqual([]);
    expect(game.state.players.p2?.life).toBe(20);
    // Still an attacking creature (CR 506.4c).
    expect(game.state.combat?.attacks.map((a) => a.attacker)).toStrictEqual([attacker]);
  });

  it("gives a blocked trampler no one to trample over: nothing goes to the defending player (CR 702.19f)", () => {
    const { game: declared, ids } = attackThenRemoveWalker(DEATHTOUCH_TRAMPLER, [BEARS]);
    const [attacker, , bears] = ids as [ObjectId, ObjectId, ObjectId];
    let game = passBoth(declared);
    game = answer(game, { kind: "declareBlocker", block: { blocker: bears, attacker } });
    game = answer(game, { kind: "finishDeclaring" });
    const before = game.events.length;
    game = passBoth(game);
    const dealt = game.events.slice(before).filter((e) => e.type === "DAMAGE_DEALT");
    expect(dealt.map((e) => e.type === "DAMAGE_DEALT" && [e.to, e.amount])).toStrictEqual([
      [{ kind: "object", object: bears }, 5],
      [{ kind: "object", object: attacker }, 2],
    ]);
    expect(game.state.players.p2?.life).toBe(20);
  });

  it("lets a blocked trampler whose blocker is gone deal all its damage to the planeswalker (CR 702.19d)", () => {
    const { game: start, walker, ids } = atDeclareAttackers([DEATHTOUCH_TRAMPLER], [BEARS]);
    const [attacker, , bears] = ids as [ObjectId, ObjectId, ObjectId];
    let game = answer(start, { kind: "declareAttacker", attack: { attacker, defender: "p2", planeswalker: walker } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game);
    game = answer(game, { kind: "declareBlocker", block: { blocker: bears, attacker } });
    game = answer(game, { kind: "finishDeclaring" });
    game = { ...game, state: moveCard(game.state, bears, { zone: "graveyard" }).state };
    game = passBoth(game);
    expect(loyalty(game.state, walker)).toBe(0);
    expect(game.state.players.p2?.life).toBe(20);
  });

  it("is recorded for good when it changes controller or stops being a planeswalker, role by role (CR 506.4)", () => {
    const { game, walker, ids } = attackThenRemoveWalker(BEARS);
    const attacker = ids[0] as ObjectId;
    // A control change removes it from every role it has: here only the attacked one.
    const stolen = removedFromCombat(game.state, walker);
    expect(stolen?.removed).toStrictEqual({ attackers: [], blockers: [], planeswalkers: [walker] });
    // An attacked "planeswalker" that isn't one (here a creature stands in for it) is removed as attacked only; the
    // attacker isn't touched.
    const combat = game.state.combat;
    if (combat === null) throw new Error("no combat");
    const state = {
      ...game.state,
      combat: { ...combat, attacks: [{ attacker, defender: "p2" as const, planeswalker: attacker }] },
    };
    expect(removeTypeChangesFromCombat(state, TEST_CARDS).combat?.removed).toStrictEqual({
      attackers: [],
      blockers: [],
      planeswalkers: [attacker],
    });
  });
});
