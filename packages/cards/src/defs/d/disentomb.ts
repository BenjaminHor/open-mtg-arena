import type { CardDef } from "@mtg/engine";

export const disentomb: CardDef = {
  name: "Disentomb",
  oracle: "Return target creature card from your graveyard to your hand.",
  spell: {
    targets: [{ kind: "cardInGraveyard", graveyard: "yours", filter: { types: ["creature"] } }],
    effects: [{ op: "returnToHand", of: { target: 0 } }],
  },
};
