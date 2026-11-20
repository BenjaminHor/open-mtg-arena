import type { CardDef } from "@mtg/engine";

export const wallOfBone: CardDef = {
  name: "Wall of Bone",
  oracle:
    "Defender (This creature can't attack.)\n{B}: Regenerate this creature. (The next time this creature would be destroyed this turn, instead tap it, remove it from combat, and heal all damage on it.)",
  keywords: ["defender"],
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "mana", cost: [{ kind: "colored", color: "B" }] }],
      targets: [],
      effects: [{ op: "regenerate", of: "self" }],
    },
  ],
};
