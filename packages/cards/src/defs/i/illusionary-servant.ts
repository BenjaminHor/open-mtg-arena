import type { CardDef } from "@mtg/engine";

export const illusionaryServant: CardDef = {
  name: "Illusionary Servant",
  oracle: "Flying\nWhen this creature becomes the target of a spell or ability, sacrifice it.",
  keywords: ["flying"],
  triggers: [{ when: { kind: "becomesTarget", of: "self" }, targets: [], effects: [{ op: "sacrificeSource" }] }],
};
