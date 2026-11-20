import type { CardDef } from "@mtg/engine";

export const greatSableStag: CardDef = {
  name: "Great Sable Stag",
  oracle:
    "This spell can't be countered.\nProtection from blue and from black (This creature can't be blocked, targeted, dealt damage, or enchanted by anything blue or black.)",
  statics: [{ kind: "cantBeCountered" }],
  protections: [
    { kind: "color", color: "U" },
    { kind: "color", color: "B" },
  ],
};
