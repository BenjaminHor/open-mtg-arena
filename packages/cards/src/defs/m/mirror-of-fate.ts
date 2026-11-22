import type { CardDef } from "@mtg/engine";

export const mirrorOfFate: CardDef = {
  name: "Mirror of Fate",
  oracle:
    "{T}, Sacrifice this artifact: Choose up to seven face-up exiled cards you own. Exile all the cards from your library, then put the chosen cards on top of your library.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "tap" }, { kind: "sacrificeSelf" }],
      targets: [],
      effects: [
        // Chosen as it resolves, before the library is exiled, so none of those can be chosen (its rulings).
        { op: "choose", from: "exile", filter: { owner: "you" }, upTo: 7, purpose: "choose" },
        { op: "exileAll", zone: "library", of: "you" },
        // In the order its owner chooses, not revealed (CR 401.4).
        { op: "put", of: "found", into: "libraryTop" },
      ],
    },
  ],
};
