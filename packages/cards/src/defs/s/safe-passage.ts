import type { CardDef } from "@mtg/engine";

export const safePassage: CardDef = {
  name: "Safe Passage",
  oracle: "Prevent all damage that would be dealt to you and creatures you control this turn.",
  // Checked as each damage event happens: creatures arriving later are protected too (its ruling).
  spell: { targets: [], effects: [{ op: "preventAllDamage", combatOnly: false, protects: "youAndYourCreatures" }] },
};
