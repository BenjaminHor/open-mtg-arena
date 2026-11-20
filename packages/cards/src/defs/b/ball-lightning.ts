import type { CardDef } from "@mtg/engine";

export const ballLightning: CardDef = {
  name: "Ball Lightning",
  oracle:
    "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nHaste (This creature can attack and {T} as soon as it comes under your control.)\nAt the beginning of the end step, sacrifice this creature.",
  keywords: ["trample", "haste"],
  triggers: [
    // "The end step": every end step, whoever's turn it is (CR 603.2b).
    { when: { kind: "beginningOfStep", step: "end" }, targets: [], effects: [{ op: "sacrificeSource" }] },
  ],
};
