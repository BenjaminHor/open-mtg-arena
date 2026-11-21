// Djinn of Wishes's cost removes a wish counter (CR 118.3): the ability isn't offered without one, only refused when
// tried. `legalActions` is what the UI and the AI choose from.

import { cardDatabase } from "@mtg/cards";
import { createGame, type GameState, legalActions } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { parseScenario } from "../src/format.ts";
import { buildSetup } from "../src/setup.ts";

const cards = cardDatabase();

function withWishes(wishes: number): GameState {
  const djinn = `{ card: Djinn of Wishes, counters: { wish: ${wishes} } }`;
  const yaml = `name: setup\nrules: [CR 118.3]\nsetup:\n  turn: { active: p1, step: main1 }\n  p1:\n    battlefield: [${djinn}, Island, Island, Island, Island]\nsteps:\n  - expect: { turn: 1 }\n`;
  const created = createGame(buildSetup(parseScenario(yaml).setup, cards), cards);
  if (!created.ok) throw new Error(created.error.message);
  return created.state;
}

const activatesDjinn = (state: GameState) =>
  legalActions(state, "p1", cards).some(
    (a) => a.type === "ACTIVATE_ABILITY" && state.zones.battlefield[0] === a.object && a.ability.kind === "printed",
  );

describe("Djinn of Wishes's wish counters", () => {
  it("offer its ability with one left, and not with none (CR 118.3)", () => {
    expect(activatesDjinn(withWishes(1))).toBe(true);
    expect(activatesDjinn(withWishes(0))).toBe(false);
  });
});
