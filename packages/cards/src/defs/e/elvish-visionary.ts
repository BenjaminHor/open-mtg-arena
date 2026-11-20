import type { CardDef } from "@mtg/engine";

export const elvishVisionary: CardDef = {
  name: "Elvish Visionary",
  oracle: "When this creature enters, draw a card.",
  triggers: [{ when: { kind: "selfEnters" }, targets: [], effects: [{ op: "draw", who: "you", amount: 1 }] }],
};
