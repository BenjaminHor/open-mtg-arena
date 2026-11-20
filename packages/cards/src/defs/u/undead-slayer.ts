import type { CardDef } from "@mtg/engine";

export const undeadSlayer: CardDef = {
  name: "Undead Slayer",
  oracle: "{W}, {T}: Exile target Skeleton, Vampire, or Zombie.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "mana", cost: [{ kind: "colored", color: "W" }] }, { kind: "tap" }],
      targets: [{ kind: "permanent", filter: { subtypes: ["Skeleton", "Vampire", "Zombie"] } }],
      effects: [{ op: "exile", of: { target: 0 } }],
    },
  ],
};
