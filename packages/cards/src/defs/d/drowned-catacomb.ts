import type { CardDef } from "@mtg/engine";

export const drownedCatacomb: CardDef = {
  name: "Drowned Catacomb",
  oracle: "This land enters tapped unless you control an Island or a Swamp.\n{T}: Add {U} or {B}.",
  // Checked against land types, not names, and only the lands already on the battlefield (its rulings, CR 614.12).
  replacements: [{ kind: "entersTapped", unless: { subtypes: ["Island", "Swamp"], controller: "you" } }],
  abilities: [
    {
      // A mana ability: the color is one of the two, chosen as it resolves (CR 605.3b, D-068).
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [],
      effects: [{ op: "addMana", mana: { oneOf: ["U", "B"] }, amount: 1 }],
    },
  ],
};
