import type { CardDef } from "@mtg/engine";

export const bogardanHellkite: CardDef = {
  name: "Bogardan Hellkite",
  oracle:
    "Flash\nFlying\nWhen this creature enters, it deals 5 damage divided as you choose among any number of targets.",
  keywords: ["flash", "flying"],
  triggers: [
    {
      when: { kind: "selfEnters" },
      // "Any number": as many as 5, since each target is dealt at least 1 (CR 601.2d).
      targets: [{ kind: "anyTarget", count: { min: 0, max: 5 } }],
      effects: [{ op: "dealDamage", amount: 5, from: "self", to: { target: 0 }, divided: "asYouChoose" }],
    },
  ],
};
