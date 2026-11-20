import type { CardDef } from "@mtg/engine";

export const borderlandRanger: CardDef = {
  name: "Borderland Ranger",
  oracle:
    "When this creature enters, you may search your library for a basic land card, reveal it, put it into your hand, then shuffle.",
  triggers: [
    {
      when: { kind: "selfEnters" },
      optional: true,
      targets: [],
      effects: [
        { op: "search", library: "you", filter: { supertypes: ["basic"], types: ["land"] }, count: "one" },
        { op: "reveal", of: "found" },
        { op: "put", of: "found", into: "hand" },
        { op: "shuffle", who: "you" },
      ],
    },
  ],
};
