// Attacking a planeswalker (CR 506.3, 508.1b), before the pool has one: a test planeswalker with no abilities, its
// loyalty set up as counters. Damage to it removes loyalty (CR 120.3c); once it's removed from combat, a creature
// attacking it attacks nothing and, unblocked, deals no combat damage (CR 506.4c, 510.1b).

import { describe, expect, it } from "vitest";
import { attackDeclarationProblem } from "../../src/combat/declaration-rules.ts";
import { removeTypeChangesFromCombat } from "../../src/combat/removed-from-combat.ts";
import { recordControlChanges } from "../../src/game/control-changes.ts";
import {
  type Action,
  applyAction,
  attackedNow,
  type GameState,
  isAttacking,
  legalActions,
  type ObjectId,
} from "../../src/index.ts";
import { regenerate } from "../../src/permanents/regenerate.ts";
import { newCombat } from "../../src/state/combat.ts";
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
      { attacker: bears, defender: "p2", attacked: walker },
    ]);
  });

  it("removes loyalty counters for the damage an unblocked attacker deals it, not life (CR 510.1b, 120.3c)", () => {
    const { game: start, walker, ids } = atDeclareAttackers([BEARS]);
    const attacker = ids[0] as ObjectId;
    let game = answer(start, { kind: "declareAttacker", attack: { attacker, defender: "p2", attacked: walker } });
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

  it("lets a blocked trampler assign its excess to the planeswalker it attacks, none to the player (CR 702.19b)", () => {
    const { game: start, walker, ids } = atDeclareAttackers([DEATHTOUCH_TRAMPLER], [BEARS]);
    const [attacker, , bears] = ids as [ObjectId, ObjectId, ObjectId];
    let game = answer(start, { kind: "declareAttacker", attack: { attacker, defender: "p2", attacked: walker } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game);
    game = answer(game, { kind: "declareBlocker", block: { blocker: bears, attacker } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game);
    // Deathtouch makes 1 lethal for the Bears (CR 702.2c); the rest may go to the walker.
    const pending = game.state.pending;
    expect(pending?.kind === "assignDamage" && pending.recipients).toStrictEqual([
      { kind: "object", object: bears },
      { kind: "object", object: walker },
    ]);
    game = answer(game, { kind: "assignDamage", amount: 1 });
    expect(loyalty(game.state, walker)).toBe(1);
    expect(game.state.players.p2?.life).toBe(20);
  });

  it("lets the defending player block a creature attacking their planeswalker (CR 509.1a)", () => {
    const { game: start, walker, ids } = atDeclareAttackers([BEARS], [HILL_GIANT]);
    const [attacker, , giant] = ids as [ObjectId, ObjectId, ObjectId];
    let game = answer(start, { kind: "declareAttacker", attack: { attacker, defender: "p2", attacked: walker } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game);
    game = answer(game, { kind: "declareBlocker", block: { blocker: giant, attacker } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game);
    expect(loyalty(game.state, walker)).toBe(5);
  });
});

describe("which attacks are allowed (CR 508.1b, 508.1d)", () => {
  it("never offers the attacking player's own planeswalker, and refuses one or a creature named as attacked", () => {
    const { game, walker, ids } = atDeclareAttackers([BEARS, TEST_WALKER]);
    const [bears, mine] = ids as [ObjectId, ObjectId];
    expect(attacks(game.state).map((a) => a.attacked)).toStrictEqual([undefined, walker]);
    const decisionId = game.state.pending?.id ?? "d0";
    for (const attacked of [mine, bears]) {
      const attack = { attacker: bears, defender: "p2" as const, attacked };
      const result = applyAction(
        game.state,
        { type: "ANSWER", decisionId, player: "p1", answer: { kind: "declareAttacker", attack } },
        TEST_CARDS,
      );
      expect(result.ok).toBe(false);
    }
  });

  it("stores the engine's own attack, so an answer can't bring in an undefined (plain JSON)", () => {
    const { game, ids } = atDeclareAttackers([BEARS]);
    const attack = { attacker: ids[0] as ObjectId, defender: "p2" as const, attacked: undefined };
    const decisionId = game.state.pending?.id ?? "d0";
    // An untyped caller (a worker's message) could send this; TypeScript alone doesn't stop it.
    const answer = { kind: "declareAttacker", attack } as unknown as Action extends { answer: infer A } ? A : never;
    const result = applyAction(game.state, { type: "ANSWER", decisionId, player: "p1", answer }, TEST_CARDS);
    expect(result.ok && result.state.pending?.kind === "declareAttackers" && result.state.pending.chosen).toStrictEqual(
      [{ attacker: ids[0], defender: "p2" }],
    );
  });

  it("doesn't count attacking a player's planeswalker as attacking that player, for \"attacks [player] if able\" (CR 508.1d)", () => {
    // Alluring Siren's ruling: the creature must attack its controller, not a planeswalker they control.
    const { game, walker, ids } = atDeclareAttackers([BEARS]);
    const bears = ids[0] as ObjectId;
    const lure = {
      source: bears,
      controller: "p2" as const,
      timestamp: 999,
      duration: "endOfTurn" as const,
      affected: [bears],
      change: { kind: "mustAttack" as const, player: "p2" as const },
    };
    const state = { ...game.state, effects: [...game.state.effects, lure] };
    expect(
      attackDeclarationProblem(state, [{ attacker: bears, defender: "p2", attacked: walker }], TEST_CARDS),
    ).toMatch(/requirement/);
    expect(attackDeclarationProblem(state, [{ attacker: bears, defender: "p2" }], TEST_CARDS)).toBeNull();
  });
});

describe("a planeswalker removed from combat (CR 506.4)", () => {
  /** Declares the attack on the walker, then takes the walker off the battlefield, as a removal spell would. */
  function attackThenRemoveWalker(attackerCard: string, blockers: string[] = []) {
    const { game: start, walker, ids } = atDeclareAttackers([attackerCard], blockers);
    const attacker = ids[0] as ObjectId;
    let game = answer(start, { kind: "declareAttacker", attack: { attacker, defender: "p2", attacked: walker } });
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
    expect(isAttacking(game.state, attacker, TEST_CARDS)).toBe(true);
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
    let game = answer(start, { kind: "declareAttacker", attack: { attacker, defender: "p2", attacked: walker } });
    game = answer(game, { kind: "finishDeclaring" });
    game = passBoth(game);
    game = answer(game, { kind: "declareBlocker", block: { blocker: bears, attacker } });
    game = answer(game, { kind: "finishDeclaring" });
    game = { ...game, state: moveCard(game.state, bears, { zone: "graveyard" }).state };
    game = passBoth(game);
    expect(loyalty(game.state, walker)).toBe(0);
    expect(game.state.players.p2?.life).toBe(20);
  });

  it("is recorded for good when its controller changes, so it stays unattacked when control comes back (CR 506.4)", () => {
    const { game: start, walker, ids } = atDeclareAttackers([BEARS]);
    const attacker = ids[0] as ObjectId;
    let game = answer(start, { kind: "declareAttacker", attack: { attacker, defender: "p2", attacked: walker } });
    game = answer(game, { kind: "finishDeclaring" });
    // p1 gains control of the walker, as a resolved control effect would do, and the central check records it.
    const steal = {
      source: attacker,
      controller: "p1" as const,
      timestamp: 999,
      duration: "endOfTurn" as const,
      affected: [walker],
      change: { kind: "gainControl" as const, player: "p1" as const },
    };
    const stolen = recordControlChanges(
      game.state,
      { ...game.state, effects: [...game.state.effects, steal] },
      TEST_CARDS,
    );
    expect(stolen.combat?.removed).toStrictEqual({ attackers: [], blockers: [], attacked: [walker] });
    // Control comes back, and the walker still isn't attacked: the creature attacks nothing (CR 506.4c).
    const back = { ...stolen, effects: game.state.effects };
    const attack = back.combat?.attacks[0];
    expect(attack !== undefined && attackedNow(back, attack, TEST_CARDS)).toBeNull();
    game = passBoth({ ...game, state: back }); // past declare blockers: p2 has no creature
    expect(loyalty(game.state, walker)).toBe(5);
    expect(game.state.players.p2?.life).toBe(20);
  });

  it("removes an attacked permanent that stops being a planeswalker, as attacked only (CR 506.4)", () => {
    const { game, ids } = atDeclareAttackers([BEARS]);
    const attacker = ids[0] as ObjectId;
    const combat = { ...newCombat(), attacks: [{ attacker, defender: "p2" as const, attacked: attacker }] };
    // A creature stands in for a planeswalker that stopped being one: the attacker role isn't touched.
    expect(removeTypeChangesFromCombat({ ...game.state, combat }, TEST_CARDS).combat?.removed).toStrictEqual({
      attackers: [],
      blockers: [],
      attacked: [attacker],
    });
  });

  it("keeps a regenerated planeswalker attacked: regenerating removes only attacking and blocking creatures (CR 701.19a)", () => {
    const { game: start, walker, ids } = atDeclareAttackers([BEARS]);
    const attacker = ids[0] as ObjectId;
    let game = answer(start, { kind: "declareAttacker", attack: { attacker, defender: "p2", attacked: walker } });
    game = answer(game, { kind: "finishDeclaring" });
    const shielded = { ...game.state, replacements: [{ kind: "regenerationShield" as const, object: walker }] };
    const regenerated = regenerate(shielded, walker).state;
    expect(regenerated.combat?.removed).toStrictEqual({ attackers: [], blockers: [] });
    const attack = regenerated.combat?.attacks[0];
    expect(attack !== undefined && attackedNow(regenerated, attack, TEST_CARDS)).toStrictEqual({
      kind: "object",
      object: walker,
    });
  });
});
