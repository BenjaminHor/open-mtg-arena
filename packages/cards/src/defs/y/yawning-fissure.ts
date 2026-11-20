import type { CardDef } from "@mtg/engine";

export const yawningFissure: CardDef = {
  name: "Yawning Fissure",
  oracle: "Each opponent sacrifices a land of their choice.",
  spell: {
    targets: [],
    // Each opponent chooses one of their own lands (CR 701.21a); with two players, one opponent (later: CR 101.4).
    effects: [{ op: "sacrifice", who: "eachOpponent", filter: { types: ["land"] } }],
  },
};
