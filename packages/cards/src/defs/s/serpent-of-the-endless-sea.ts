import type { CardDef } from "@mtg/engine";

export const serpentOfTheEndlessSea: CardDef = {
  name: "Serpent of the Endless Sea",
  oracle:
    "Serpent of the Endless Sea's power and toughness are each equal to the number of Islands you control.\nThis creature can't attack unless defending player controls an Island.",
  statics: [
    { kind: "powerToughnessEachEqual", to: { count: { subtypes: ["Island"], controller: "you" } } },
    { kind: "cantAttackUnlessDefenderControls", filter: { subtypes: ["Island"] } },
  ],
};
