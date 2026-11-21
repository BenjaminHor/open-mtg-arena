// "Enchanted land is the chosen type" (Convincing Mirage, CR 305.7): the land loses the abilities from its rules text,
// which a scenario can't show directly (a spell's payment only shows a mana ability that's there).

import { cardDatabase } from "@mtg/cards";
import { abilitiesOf, createGame, type ObjectId } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { buildSetup } from "../src/setup.ts";

const cards = cardDatabase();

function landWithMirage(land: string, landType: string) {
  const setup = buildSetup(
    {
      turn: { active: "p1", step: "main1" },
      p1: { battlefield: [land, { card: "Convincing Mirage", attachedTo: `p1:${land}`, chosenLandType: landType }] },
    },
    cards,
  );
  const created = createGame(setup, cards);
  if (!created.ok) throw new Error(created.error.message);
  return { state: created.state, land: created.state.zones.battlefield[0] as ObjectId };
}

describe("a land whose subtype Convincing Mirage set (CR 305.7)", () => {
  it("has only the chosen type's mana ability: Gargoyle Castle's two printed abilities are gone", () => {
    const { state, land } = landWithMirage("Gargoyle Castle", "Mountain");
    expect(abilitiesOf(state, land, cards).map((a) => a.ref)).toStrictEqual([
      { kind: "basicLandType", landType: "Mountain" },
    ]);
  });

  it("loses a checkland's printed mana ability", () => {
    const { state, land } = landWithMirage("Glacial Fortress", "Swamp");
    expect(abilitiesOf(state, land, cards).map((a) => a.ref)).toStrictEqual([
      { kind: "basicLandType", landType: "Swamp" },
    ]);
  });
});
