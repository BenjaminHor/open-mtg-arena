import type { CardDef } from "@mtg/engine";

export const fog: CardDef = {
  name: "Fog",
  oracle: "Prevent all combat damage that would be dealt this turn.",
  spell: { targets: [], effects: [{ op: "preventAllDamage", combatOnly: true, protects: "everyone" }] },
};
