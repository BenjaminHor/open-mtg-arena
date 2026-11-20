import type { CardDef } from "@mtg/engine";

export const whiteKnight: CardDef = {
  name: "White Knight",
  oracle:
    "First strike (This creature deals combat damage before creatures without first strike.)\nProtection from black (This creature can't be blocked, targeted, dealt damage, or enchanted by anything black.)",
  keywords: ["first strike"],
  protections: [{ kind: "color", color: "B" }],
};
