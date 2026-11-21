import type { CardDef } from "@mtg/engine";

export const wallOfFrost: CardDef = {
  name: "Wall of Frost",
  oracle:
    "Defender\nWhenever this creature blocks a creature, that creature doesn't untap during its controller's next untap step.",
  keywords: ["defender"],
  triggers: [
    {
      when: { kind: "selfBlocks" },
      targets: [],
      // It follows the creature: whoever controls it at that untap step (its ruling).
      effects: [{ op: "doesntUntap", of: "triggeringObject", during: "itsController" }],
    },
  ],
};
