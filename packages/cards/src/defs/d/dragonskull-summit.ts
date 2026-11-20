import type { CardDef } from "@mtg/engine";

export const dragonskullSummit: CardDef = {
  name: "Dragonskull Summit",
  oracle: "This land enters tapped unless you control a Swamp or a Mountain.\n{T}: Add {B} or {R}.",
  // Checked against land types, not names, and only the lands already on the battlefield (its rulings, CR 614.12).
  replacements: [{ kind: "entersTapped", unless: { subtypes: ["Swamp", "Mountain"], controller: "you" } }],
  abilities: [
    {
      // A mana ability: the color is one of the two, chosen as it resolves (CR 605.3b, D-068).
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [],
      effects: [{ op: "addMana", mana: { oneOf: ["B", "R"] }, amount: 1 }],
    },
  ],
};
