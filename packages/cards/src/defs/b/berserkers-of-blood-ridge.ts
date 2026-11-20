import type { CardDef } from "@mtg/engine";

export const berserkersOfBloodRidge: CardDef = {
  name: "Berserkers of Blood Ridge",
  oracle: "This creature attacks each combat if able.",
  statics: [{ kind: "attacksEachCombat" }],
};
