import type { CardDef } from "@mtg/engine";

export const guardianSeraph: CardDef = {
  name: "Guardian Seraph",
  oracle: "Flying\nIf a source an opponent controls would deal damage to you, prevent 1 of that damage.",
  keywords: ["flying"],
  // Each such source's damage to you, each time; several Seraphs add up (its rulings, CR 615.10).
  replacements: [{ kind: "preventDamageToYou", amount: 1 }],
};
