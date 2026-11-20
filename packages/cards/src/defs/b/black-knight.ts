import type { CardDef } from "@mtg/engine";

export const blackKnight: CardDef = {
  name: "Black Knight",
  oracle:
    "First strike (This creature deals combat damage before creatures without first strike.)\nProtection from white (This creature can't be blocked, targeted, dealt damage, or enchanted by anything white.)",
  keywords: ["first strike"],
  protections: [{ kind: "color", color: "W" }],
};
