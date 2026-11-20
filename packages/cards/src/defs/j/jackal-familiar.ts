import type { CardDef } from "@mtg/engine";

export const jackalFamiliar: CardDef = {
  name: "Jackal Familiar",
  oracle: "This creature can't attack or block alone.",
  statics: [{ kind: "cantAttackOrBlockAlone" }],
};
