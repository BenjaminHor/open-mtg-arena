import type { CardDef } from "@mtg/engine";

export const polymorph: CardDef = {
  name: "Polymorph",
  oracle:
    "Destroy target creature. It can't be regenerated. Its controller reveals cards from the top of their library until they reveal a creature card. The player puts that card onto the battlefield, then shuffles all other cards revealed this way into their library.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    effects: [
      { op: "destroy", of: { target: 0 }, noRegeneration: true },
      // "Its controller": as it was on the battlefield, if just destroyed (CR 608.2h). The rest happens even if the
      // creature wasn't destroyed (its ruling: an indestructible target).
      { op: "revealUntil", who: { controllerOf: { target: 0 } }, filter: { types: ["creature"] } },
      { op: "put", of: "found", into: "battlefield", by: { controllerOf: { target: 0 } } },
      // The revealed cards never left the library: shuffling it shuffles them in (CR 701.24a).
      { op: "shuffle", who: { controllerOf: { target: 0 } } },
    ],
  },
};
