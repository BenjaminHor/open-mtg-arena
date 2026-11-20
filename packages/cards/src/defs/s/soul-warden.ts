import type { CardDef } from "@mtg/engine";

export const soulWarden: CardDef = {
  name: "Soul Warden",
  oracle: "Whenever another creature enters, you gain 1 life.",
  triggers: [
    {
      when: { kind: "anotherEnters", filter: { types: ["creature"] } },
      targets: [],
      effects: [{ op: "gainLife", who: "you", amount: 1 }],
    },
  ],
};
