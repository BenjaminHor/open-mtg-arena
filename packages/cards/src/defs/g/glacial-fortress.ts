import type { CardDef } from "@mtg/engine";

export const glacialFortress: CardDef = {
  name: "Glacial Fortress",
  oracle: "This land enters tapped unless you control a Plains or an Island.\n{T}: Add {W} or {U}.",
  // Checked against land types, not names, and only the lands already on the battlefield (its rulings, CR 614.12).
  replacements: [{ kind: "entersTapped", unless: { subtypes: ["Plains", "Island"], controller: "you" } }],
  abilities: [
    {
      // A mana ability: the color is one of the two, chosen as it resolves (CR 605.3b, D-068).
      kind: "activated",
      cost: [{ kind: "tap" }],
      targets: [],
      effects: [{ op: "addMana", mana: { oneOf: ["W", "U"] }, amount: 1 }],
    },
  ],
};
