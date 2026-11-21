import type { CardDef } from "@mtg/engine";

export const awakenerDruid: CardDef = {
  name: "Awakener Druid",
  oracle:
    "When this creature enters, target Forest becomes a 4/5 green Treefolk creature for as long as this creature remains on the battlefield. It's still a land.",
  triggers: [
    {
      when: { kind: "selfEnters" },
      // Any land with the Forest type, whoever controls it; it must be targeted if there is one (its rulings).
      targets: [{ kind: "permanent", filter: { subtypes: ["Forest"] } }],
      effects: [
        {
          op: "becomes",
          of: { target: 0 },
          addTypes: ["creature"],
          addSubtypes: ["Treefolk"],
          colors: { set: ["G"] },
          setPT: { power: 4, toughness: 5 },
          duration: "whileSourceOnBattlefield",
        },
      ],
    },
  ],
};
