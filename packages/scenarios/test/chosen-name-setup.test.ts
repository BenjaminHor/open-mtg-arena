// A setup's `chosenName` (Pithing Needle, CR 614.12a) and `chosenLandType` (Convincing Mirage): only for a permanent
// that makes that choice as it enters, and only a card's name (CR 201.4) or a basic land type (CR 205.3i). The engine's
// setup validation refuses the others.

import { cardDatabase } from "@mtg/cards";
import { createGame } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { buildSetup } from "../src/setup.ts";

const cards = cardDatabase();

function problem(entry: Record<string, unknown>): string | null {
  const setup = buildSetup({ turn: { active: "p1", step: "main1" }, p1: { battlefield: [entry] } }, cards);
  const created = createGame(setup, cards);
  return created.ok ? null : created.error.message;
}

describe("a set-up chosen name", () => {
  it("is kept on a Pithing Needle", () => {
    expect(problem({ card: "Pithing Needle", chosenName: "Gorgon Flail" })).toBeNull();
  });

  it("is refused on a permanent that names nothing as it enters", () => {
    expect(problem({ card: "Grizzly Bears", chosenName: "Island" })).toMatch(
      /only a permanent that chooses a card name/,
    );
  });

  it("is refused when no card has that name, a token's included (CR 201.4)", () => {
    expect(problem({ card: "Pithing Needle", chosenName: "Beast Token" })).toMatch(/no card is named Beast Token/);
  });
});

describe("a set-up chosen land type", () => {
  it("is kept on a Convincing Mirage", () => {
    expect(problem({ card: "Convincing Mirage", chosenLandType: "Island" })).toBeNull();
  });

  it("is refused on a permanent that chooses no land type as it enters", () => {
    expect(problem({ card: "Grizzly Bears", chosenLandType: "Island" })).toMatch(
      /only a permanent that chooses a land type/,
    );
  });

  it("is refused when it isn't a basic land type (CR 205.3i)", () => {
    expect(problem({ card: "Convincing Mirage", chosenLandType: "Desert" })).toMatch(/Desert isn't a basic land type/);
  });
});
