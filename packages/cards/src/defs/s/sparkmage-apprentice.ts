import type { CardDef } from "@mtg/engine";

export const sparkmageApprentice: CardDef = {
  name: "Sparkmage Apprentice",
  oracle: "When this creature enters, it deals 1 damage to any target.",
  triggers: [
    {
      when: { kind: "selfEnters" },
      targets: [{ kind: "anyTarget" }], // CR 115.4
      // "It" is the creature, even if it's gone by then (CR 113.7a).
      effects: [{ op: "dealDamage", amount: 1, from: "self", to: { target: 0 } }],
    },
  ],
};
