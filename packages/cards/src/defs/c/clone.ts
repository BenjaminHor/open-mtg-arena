import type { CardDef } from "@mtg/engine";

export const clone: CardDef = {
  name: "Clone",
  oracle: "You may have this creature enter as a copy of any creature on the battlefield.",
  // Doesn't target, and may copy nothing: a 0/0 (its rulings).
  replacements: [{ kind: "entersAsCopy", of: { types: ["creature"] } }],
};
