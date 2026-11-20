import type { CardDef } from "@mtg/engine";

export const terramorphicExpanse: CardDef = {
  name: "Terramorphic Expanse",
  oracle:
    "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.",
  abilities: [
    {
      // Not a mana ability: it doesn't add mana, and it moves a card from a library (CR 605.1a), so it uses the stack.
      kind: "activated",
      cost: [{ kind: "tap" }, { kind: "sacrificeSelf" }],
      targets: [],
      effects: [
        { op: "search", library: "you", filter: { supertypes: ["basic"], types: ["land"] }, count: "one" },
        { op: "put", of: "found", into: "battlefield", tapped: true },
        { op: "shuffle", who: "you" },
      ],
    },
  ],
};
