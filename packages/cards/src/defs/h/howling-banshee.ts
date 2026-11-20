import type { CardDef } from "@mtg/engine";

export const howlingBanshee: CardDef = {
  name: "Howling Banshee",
  oracle: "Flying\nWhen this creature enters, each player loses 3 life.",
  keywords: ["flying"],
  triggers: [
    { when: { kind: "selfEnters" }, targets: [], effects: [{ op: "loseLife", who: "eachPlayer", amount: 3 }] },
  ],
};
