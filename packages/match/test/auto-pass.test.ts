// Smart auto-pass (M3-01): the host passes for a player with nothing worth doing, and stops at their stops when they
// have something. Games set up by hand: p1 with or without a spell they can cast, p2 with nothing.

import { cardDatabase } from "@mtg/cards";
import type { GameSetup, OracleId, Step } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { advance, DEFAULT_SETTINGS, startMatch, waitingOn } from "../src/index.ts";

const cards = cardDatabase();
const id = (name: string) => (Object.values(cards).find((c) => c.printed.name === name)?.oracleId ?? name) as OracleId;
const permanent = (name: string) => ({
  oracleId: id(name),
  tapped: false,
  summoningSick: false,
  damage: 0,
  counters: {},
});

function setup(p1: { hand: string[]; battlefield: string[] }, step: Step, library = "Plains"): GameSetup {
  const player = (pid: "p1" | "p2", hand: string[], battlefield: string[]) => ({
    id: pid,
    life: 20,
    library: Array.from({ length: 5 }, () => id(library)),
    hand: hand.map(id),
    battlefield: battlefield.map(permanent),
    graveyard: [],
    exile: [],
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  });
  return {
    seed: 1,
    players: [player("p1", p1.hand, p1.battlefield), player("p2", [], [])],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step } },
    ruleModifiers: [],
  };
}

const human = { kind: "human" } as const;

describe("auto-pass", () => {
  it("passes the upkeep, not a stop, and stops in the main phase, a stop, where the player can cast something", () => {
    const match = advance(
      startMatch(
        setup({ hand: ["Lightning Bolt"], battlefield: ["Mountain"] }, "upkeep"),
        { p1: human, p2: human },
        cards,
      ),
      cards,
    );
    expect(waitingOn(match, cards)).toBe("p1");
    expect(match.state.turn?.step).toBe("precombatMain");
  });

  it("with auto-pass off, stops at every priority", () => {
    const off = { ...DEFAULT_SETTINGS, autoPass: false };
    const match = advance(
      startMatch(
        setup({ hand: ["Lightning Bolt"], battlefield: ["Mountain"] }, "upkeep"),
        { p1: human, p2: human },
        cards,
        { p1: off },
      ),
      cards,
    );
    expect(waitingOn(match, cards)).toBe("p1");
    expect(match.state.turn?.step).toBe("upkeep");
  });

  it("never stops a player who can't pay for anything, even at their stops", () => {
    // Libraries of Lightning Bolts: no land is ever drawn, so nothing can be paid for.
    const unpayable = setup({ hand: ["Lightning Bolt"], battlefield: [] }, "upkeep", "Lightning Bolt");
    const match = advance(startMatch(unpayable, { p1: human, p2: human }, cards), cards);
    // Nobody had anything to do, so the game went on until a library ran out (CR 704.5b).
    expect(match.state.result).not.toBeNull();
    expect(match.actions.every((a) => a.type === "PASS_PRIORITY" || a.type === "ANSWER")).toBe(true);
  });
});
