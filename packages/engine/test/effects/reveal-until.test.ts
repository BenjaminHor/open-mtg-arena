// "Reveals cards from the top of their library until they reveal a creature card" (Polymorph): which cards are shown.

import { describe, expect, it } from "vitest";
import { revealUntil } from "../../src/effects/library-effects.ts";
import type { GameState } from "../../src/index.ts";
import { BEARS, FOREST, MOUNTAIN, TEST_CARDS } from "../support/cards.ts";
import { playerSetup, start } from "../support/game.ts";

/** p1 with this library, as some spell resolves (the cards found are "this way" results, CR 608.2c). */
function withLibrary(library: string[]): GameState {
  const state = start({
    seed: 1,
    players: [playerSetup("p1", { library }), playerSetup("p2", { library: [] })],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  }).state;
  return {
    ...state,
    resolution: { object: "o999", found: [], exiled: [], sacrificed: [], auraHosts: [], named: null, shuffledIn: [] },
  };
}

const revealed = (state: GameState) => {
  const result = revealUntil(state, "p1", { types: ["creature"] }, TEST_CARDS);
  const event = result.events.find((e) => e.type === "CARDS_REVEALED");
  return { cards: event?.type === "CARDS_REVEALED" ? event.cards : [], found: result.state.resolution?.found };
};

describe("revealing until a creature card (CR 701.20a)", () => {
  it("shows every card from the top down to the first creature card, which is found; none move", () => {
    // A second creature card below the first is neither shown nor found.
    const state = withLibrary([FOREST, MOUNTAIN, BEARS, FOREST, BEARS]);
    const { cards, found } = revealed(state);
    expect([...cards].sort()).toStrictEqual([BEARS, FOREST, MOUNTAIN].sort());
    expect(found).toStrictEqual([state.zones.players.p1?.library[2]]);
  });

  it("shows the whole library when no card fits, and finds nothing", () => {
    const { cards, found } = revealed(withLibrary([FOREST, MOUNTAIN]));
    expect(cards).toHaveLength(2);
    expect(found).toStrictEqual([]);
  });
});
