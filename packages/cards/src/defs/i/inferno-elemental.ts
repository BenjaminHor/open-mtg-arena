import type { CardDef } from "@mtg/engine";

export const infernoElemental: CardDef = {
  name: "Inferno Elemental",
  oracle:
    "Whenever this creature blocks or becomes blocked by a creature, this creature deals 3 damage to that creature.",
  triggers: [
    {
      when: { kind: "selfBlocks", orBecomesBlocked: true },
      targets: [],
      effects: [{ op: "dealDamage", amount: 3, from: "self", to: "triggeringObject" }],
    },
  ],
};
