import type { CardDef } from "@mtg/engine";

export const stoneGiant: CardDef = {
  name: "Stone Giant",
  oracle:
    "{T}: Target creature you control with toughness less than this creature's power gains flying until end of turn. Destroy that creature at the beginning of the next end step.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "tap" }],
      // The Giant itself, once its toughness is less than its power (its ruling).
      targets: [
        { kind: "permanent", filter: { types: ["creature"], controller: "you" }, toughnessBelowSourcePower: true },
      ],
      effects: [
        { op: "gainKeywords", keywords: ["flying"], of: { target: 0 }, duration: "endOfTurn" },
        // "That creature": destroyed even if it's no longer a creature or yours, but not if it left (its rulings).
        {
          op: "createDelayedTrigger",
          about: { target: 0 },
          ability: {
            when: { kind: "beginningOfStep", step: "end", whose: "each" },
            targets: [],
            effects: [{ op: "destroy", of: "remembered" }],
          },
        },
      ],
    },
  ],
};
