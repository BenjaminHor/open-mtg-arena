// Counting activations (D-078): an ability counts as activated once it becomes activated, so one removed from the stack
// without resolving (countered: no Magic 2010 card counters an ability) still counts; the count starts again each turn.

import { describe, expect, it } from "vitest";
import { activationsThisTurn } from "../../src/game/activation-count.ts";
import type { GameState, ObjectId } from "../../src/index.ts";
import { removeAbilityFromStack } from "../../src/zones/stack-abilities.ts";
import { MOUNTAIN, WHELP } from "../support/cards.ts";
import { type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function game(): Game {
  return start({
    seed: 2,
    players: [
      playerSetup("p1", {
        library: Array.from({ length: 10 }, () => MOUNTAIN),
        battlefield: [permanent(WHELP), permanent(MOUNTAIN), permanent(MOUNTAIN)],
      }),
      playerSetup("p2", { library: Array.from({ length: 10 }, () => MOUNTAIN) }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

const whelpOf = (s: GameState) =>
  s.zones.battlefield.find((id) => {
    const obj = s.objects[id];
    return obj?.kind === "card" && obj.oracleId === WHELP;
  }) as ObjectId;

/** Activates the Whelp's firebreathing and pays for it, so it becomes activated. */
function activate(g: Game): Game {
  let next = take(g, (a) => a.type === "ACTIVATE_ABILITY" && a.object === whelpOf(g.state));
  while (next.state.pending?.kind === "payMana" || next.state.casting !== null)
    next = take(next, (a) => a.type === "ACTIVATE_ABILITY" || (a.type === "ANSWER" && a.answer.kind === "payMana"));
  return next;
}

describe("counting activations (D-078)", () => {
  it("counts an activation as it becomes activated, even if it's then removed without resolving", () => {
    let g = activate(game());
    const whelp = whelpOf(g.state);
    expect(activationsThisTurn(g.state, whelp, 0)).toBe(1);
    // As if countered: removed from the stack, never resolving.
    const ability = g.state.zones.stack.at(-1) as ObjectId;
    g = { ...g, state: removeAbilityFromStack(g.state, ability) };
    expect(g.state.zones.stack).toStrictEqual([]);
    expect(activationsThisTurn(g.state, whelp, 0)).toBe(1);
  });

  it("starts again as a turn begins", () => {
    let g = activate(game());
    g = passBoth(g); // the ability resolves
    const whelp = whelpOf(g.state);
    expect(activationsThisTurn(g.state, whelp, 0)).toBe(1);
    // Pass each priority and declare no attackers, until p2's turn begins.
    while (g.state.turn?.activePlayer === "p1")
      g = take(g, (a) => a.type === "PASS_PRIORITY" || (a.type === "ANSWER" && a.answer.kind === "finishDeclaring"));
    expect(activationsThisTurn(g.state, whelp, 0)).toBe(0);
  });
});
