import type { CardDef } from "@mtg/engine";

export const hauntingEchoes: CardDef = {
  name: "Haunting Echoes",
  oracle:
    "Exile all cards from target player's graveyard other than basic land cards. For each card exiled this way, search that player's library for all cards with the same name as that card and exile them. Then that player shuffles.",
  spell: {
    targets: [{ kind: "player" }],
    effects: [
      // "Other than basic land cards": not (basic and land), so a nonbasic land is exiled too.
      { op: "exileGraveyard", of: { target: 0 }, filter: { not: { supertypes: ["basic"], types: ["land"] } } },
      // One search for all the names (CR 701.23h); none if nothing was exiled (D-063); any number found (its ruling).
      { op: "search", library: { target: 0 }, count: "anyNumber", sameNameAsExiled: true },
      { op: "exile", of: "found" },
      { op: "shuffle", who: { target: 0 } },
    ],
  },
};
