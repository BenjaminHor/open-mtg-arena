import type { CardDef } from "@mtg/engine";

export const nightmare: CardDef = {
  name: "Nightmare",
  oracle:
    "Flying (This creature can't be blocked except by creatures with flying or reach.)\nNightmare's power and toughness are each equal to the number of Swamps you control.",
  keywords: ["flying"],
  // A characteristic-defining ability (CR 604.3): it works in every zone. Any land with the subtype Swamp counts, not
  // only ones named Swamp (its ruling).
  statics: [{ kind: "powerToughnessEachEqual", to: { count: { subtypes: ["Swamp"], controller: "you" } } }],
};
