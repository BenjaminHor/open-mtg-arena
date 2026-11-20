import type { CardDef } from "@mtg/engine";

export const vampireAristocrat: CardDef = {
  name: "Vampire Aristocrat",
  oracle: "Sacrifice a creature: This creature gets +2/+2 until end of turn.",
  abilities: [
    {
      kind: "activated",
      // Any creature its controller controls, itself included (CR 701.21a); sacrificing itself leaves nothing to
      // pump (its ruling).
      cost: [{ kind: "sacrifice", filter: { types: ["creature"] } }],
      targets: [],
      effects: [{ op: "modifyPT", power: 2, toughness: 2, of: "self", duration: "endOfTurn" }],
    },
  ],
};
