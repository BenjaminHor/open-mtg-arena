import type { CardDef } from "@mtg/engine";

export const sunpetalGrove: CardDef = {
  name: "Sunpetal Grove",
  oracle: "This land enters tapped unless you control a Forest or a Plains.\n{T}: Add {G} or {W}.",
  // Checked against land types, not names, and only the lands already on the battlefield (its rulings, CR 614.12).
  replacements: [{ kind: "entersTapped", unless: { subtypes: ["Forest", "Plains"], controller: "you" } }],
  abilities: [
    {
      // A mana ability: the color is one of the two, chosen as it resolves (CR 605.3b, D-068).
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [],
      effects: [{ op: "addMana", mana: { oneOf: ["G", "W"] }, amount: 1 }],
    },
  ],
};
