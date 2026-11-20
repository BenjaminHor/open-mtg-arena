import type { CardDef } from "@mtg/engine";

export const lurkingPredators: CardDef = {
  name: "Lurking Predators",
  oracle:
    "Whenever an opponent casts a spell, reveal the top card of your library. If it's a creature card, put it onto the battlefield. Otherwise, you may put that card on the bottom of your library.",
  triggers: [
    {
      when: { kind: "spellCast", filter: { controller: "opponent" } },
      targets: [],
      effects: [
        { op: "revealTop", who: "you" },
        { op: "put", of: "found", into: "battlefield", onlyIf: { types: ["creature"] } },
        // "Otherwise": a creature card has left the library by now, so only another card is left to put.
        { op: "put", of: "found", into: "libraryBottom", optional: true },
      ],
    },
  ],
};
