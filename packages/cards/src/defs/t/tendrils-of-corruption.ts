import type { CardDef } from "@mtg/engine";

/** "Where X is the number of Swamps you control": X the text defines, never announced (CR 107.3c). */
const swamps = { count: { subtypes: ["Swamp"], controller: "you" as const } };

export const tendrilsOfCorruption: CardDef = {
  name: "Tendrils of Corruption",
  oracle:
    "Tendrils of Corruption deals X damage to target creature and you gain X life, where X is the number of Swamps you control.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    effects: [
      { op: "dealDamage", amount: swamps, from: "self", to: { target: 0 } },
      { op: "gainLife", who: "you", amount: swamps },
    ],
  },
};
