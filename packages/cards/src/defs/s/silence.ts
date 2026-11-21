import type { CardDef } from "@mtg/engine";

export const silence: CardDef = {
  name: "Silence",
  oracle: "Your opponents can't cast spells this turn.",
  spell: {
    targets: [],
    // Only casting: abilities, land plays and spells already cast are untouched (its rulings).
    effects: [{ op: "cantCastSpells", who: "eachOpponent", duration: "endOfTurn" }],
  },
};
