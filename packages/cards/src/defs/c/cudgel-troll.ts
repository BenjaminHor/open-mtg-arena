import type { CardDef } from "@mtg/engine";

export const cudgelTroll: CardDef = {
  name: "Cudgel Troll",
  oracle:
    "{G}: Regenerate this creature. (The next time this creature would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "mana", cost: [{ kind: "colored", color: "G" }] }],
      targets: [],
      effects: [{ op: "regenerate", of: "self" }],
    },
  ],
};
