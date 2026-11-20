import type { CardDef } from "@mtg/engine";

export const gravedigger: CardDef = {
  name: "Gravedigger",
  oracle: "When this creature enters, you may return target creature card from your graveyard to your hand.",
  triggers: [
    {
      when: { kind: "selfEnters" },
      optional: true,
      targets: [{ kind: "cardInGraveyard", graveyard: "yours", filter: { types: ["creature"] } }],
      effects: [{ op: "returnToHand", of: { target: 0 } }],
    },
  ],
};
