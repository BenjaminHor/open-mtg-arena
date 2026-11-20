import type { CardDef } from "@mtg/engine";

export const rootboundCrag: CardDef = {
  name: "Rootbound Crag",
  oracle: "This land enters tapped unless you control a Mountain or a Forest.\n{T}: Add {R} or {G}.",
  // Checked against land types, not names, and only the lands already on the battlefield (its rulings, CR 614.12).
  replacements: [{ kind: "entersTapped", unless: { subtypes: ["Mountain", "Forest"], controller: "you" } }],
  abilities: [
    {
      // A mana ability: the color is one of the two, chosen as it resolves (CR 605.3b, D-068).
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [],
      effects: [{ op: "addMana", mana: { oneOf: ["R", "G"] }, amount: 1 }],
    },
  ],
};
