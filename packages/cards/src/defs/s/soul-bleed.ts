import type { CardDef } from "@mtg/engine";

export const soulBleed: CardDef = {
  name: "Soul Bleed",
  oracle:
    "Enchant creature\nAt the beginning of the upkeep of enchanted creature's controller, that player loses 1 life.",
  enchant: { types: ["creature"] },
  triggers: [
    {
      // Whoever controls the creature as that upkeep begins (CR 303.4m); the Aura's controller controls the trigger.
      when: { kind: "beginningOfStep", step: "upkeep", whose: "attachedController" },
      targets: [],
      effects: [{ op: "loseLife", who: "triggeringPlayer", amount: 1 }],
    },
  ],
};
