// A spell's delayed triggered ability (CR 603.7d): no Magic 2010 card makes one, so it's tested with a test-only
// instant. Dragon Whelp's, an ability's (CR 603.7e), are its scenarios.

import { describe, expect, it } from "vitest";
import type { GameState, ObjectId } from "../../src/index.ts";
import { LATE_GIFT, MOUNTAIN } from "../support/cards.ts";
import { type Game, playerSetup, start, take } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function game(): Game {
  return start({
    seed: 2,
    players: [
      playerSetup("p1", { library: Array.from({ length: 10 }, () => MOUNTAIN) }),
      playerSetup("p2", {
        library: Array.from({ length: 10 }, () => MOUNTAIN),
        hand: [LATE_GIFT],
        battlefield: [permanent(MOUNTAIN)],
      }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

const life = (s: GameState, player: string) => s.players[player as "p1"]?.life;

/** Passes, declares nothing and pays from a tapped land, until `done`. */
function until(g: Game, done: (s: GameState) => boolean): Game {
  let next = g;
  while (!done(next.state)) {
    const paying = next.state.pending?.kind === "payMana";
    next = take(
      next,
      (a) =>
        (paying && a.type === "ACTIVATE_ABILITY") || // tapping the Mountain for mana
        a.type === "PASS_PRIORITY" ||
        (a.type === "ANSWER" && (a.answer.kind === "finishDeclaring" || a.answer.kind === "payMana")),
    );
  }
  return next;
}

describe("a spell's delayed triggered ability (CR 603.7d)", () => {
  it("has that spell as its source and the spell's controller as its controller, after the spell is gone", () => {
    // p1 passes in their main phase; p2 casts the instant, and it resolves.
    let g = take(game(), (a) => a.type === "PASS_PRIORITY");
    g = take(g, (a) => a.type === "CAST_SPELL" && a.player === "p2");
    const spell = g.state.zones.stack.at(-1) as ObjectId;
    g = until(g, (s) => s.zones.stack.length === 0);
    expect(g.state.delayedTriggers).toMatchObject([{ source: spell, controller: "p2", sourceOracleId: LATE_GIFT }]);
    expect(g.state.objects[spell]).toBeUndefined(); // the spell is now a new object in the graveyard (CR 400.7)
    // At p1's end step it triggers once, controlled by p2: p2 gains the life, not p1, the active player.
    g = until(g, (s) => s.turn?.step === "end" && s.zones.stack.length === 1);
    expect(g.state.delayedTriggers).toStrictEqual([]);
    g = until(g, (s) => s.zones.stack.length === 0);
    expect(life(g.state, "p2")).toBe(21);
    expect(life(g.state, "p1")).toBe(20);
  });
});
