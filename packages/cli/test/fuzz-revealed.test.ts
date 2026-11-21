// The fuzzer's leak check meets revealed cards (D-122): Telepathy's hand and Vampire Nocturnus's library top are shown
// to every player, so the scramble keeps what they are, and still changes everything else that's hidden.

import { readFileSync } from "node:fs";
import { cardDatabase } from "@mtg/cards";
import { createGame, type GameState, type ObjectId, type OracleId } from "@mtg/engine";
import { buildSetup, parseScenario, runScenario } from "@mtg/scenarios";
import { describe, expect, it } from "vitest";
import { heldBackTopsHidden, layersMatchFreshPass, scrambleHidden, viewsLeakNothing } from "../src/fuzz/checks.ts";

const cards = cardDatabase();

/** The game a scenario's setup starts, from the players' setups written as YAML. */
function started(players: string): GameState {
  const yaml = `name: setup\nrules: [CR 401.5]\nsetup:\n  turn: { active: p1, step: main1 }\n${players}\nsteps:\n  - expect: { turn: 1 }\n`;
  const created = createGame(buildSetup(parseScenario(yaml).setup, cards), cards);
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

const oracleOf = (state: GameState, id: ObjectId | undefined): OracleId | undefined => {
  const obj = id === undefined ? undefined : state.objects[id];
  return obj?.kind === "card" ? obj.oracleId : undefined;
};

describe("the leak check with revealed cards", () => {
  const nocturnus = started(
    "  p1:\n    battlefield: [Vampire Nocturnus]\n    library: [Sign in Blood, Swamp, Island, Forest]",
  );
  const telepathy = started(
    "  p1:\n    battlefield: [Telepathy]\n    hand: [Shock, Forest]\n  p2:\n    hand: [Grizzly Bears, Lightning Bolt]",
  );

  it("finds nothing to report, and a fresh layer pass agrees with the kept one", () => {
    for (const s of [nocturnus, telepathy]) {
      expect(viewsLeakNothing(s, s, [], cards)).toStrictEqual([]);
      expect(layersMatchFreshPass(s, s, [], cards)).toStrictEqual([]);
    }
  });

  it("keeps a revealed top on top and what it is, and scrambles and reorders the cards under it", () => {
    const library = nocturnus.zones.players.p1?.library ?? [];
    const scrambled = scrambleHidden(nocturnus, "p2", cards);
    const after = scrambled.zones.players.p1?.library ?? [];
    expect(oracleOf(scrambled, after[0])).toBe(oracleOf(nocturnus, library[0]));
    const under = (s: GameState, ids: readonly ObjectId[]) => ids.slice(1).map((id) => oracleOf(s, id));
    expect(under(scrambled, after)).not.toStrictEqual(under(nocturnus, library));
    expect(after.slice(1)).not.toStrictEqual(library.slice(1));
  });

  it("keeps a revealed hand's cards, and scrambles the hand that isn't revealed", () => {
    const scrambled = scrambleHidden(telepathy, "p2", cards);
    const hand = (s: GameState, p: "p1" | "p2") => (s.zones.players[p]?.hand ?? []).map((id) => oracleOf(s, id));
    // p2's view: p1 controls Telepathy, so p1's own hand isn't revealed and is scrambled for p2.
    expect(hand(scrambled, "p1")).not.toStrictEqual(hand(telepathy, "p1"));
    const scrambledForP1 = scrambleHidden(telepathy, "p1", cards);
    expect([...hand(scrambledForP1, "p2")].sort()).toStrictEqual([...hand(telepathy, "p2")].sort());
  });
});

describe("a library's top held back while a spell is cast (CR 401.5)", () => {
  it("is checked in the middle of Djinn of Wishes casting the top card with Vampire Nocturnus out", () => {
    const yaml = readFileSync(
      new URL("../../engine/test/scenarios/cards/m2-14g/djinn-of-wishes-nocturnus.yaml", import.meta.url),
      "utf8",
    );
    const midCast: GameState[] = [];
    const result = runScenario(yaml, cards, (state) => {
      if (state.casting?.origin.kind === "resolution") midCast.push(state);
      return [];
    });
    expect(result.problems).toStrictEqual([]);
    expect(midCast.length).toBeGreaterThan(0);
    for (const s of midCast) {
      expect(s.zones.players.p1?.library[0]).not.toBe(s.casting?.libraryTops.p1);
      expect(heldBackTopsHidden(s, s, [], cards)).toStrictEqual([]);
      expect(viewsLeakNothing(s, s, [], cards)).toStrictEqual([]);
    }
  });
});
