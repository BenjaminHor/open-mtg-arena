import type { CardDef } from "@mtg/engine";

export const elvishPiper: CardDef = {
  name: "Elvish Piper",
  oracle: "{G}, {T}: You may put a creature card from your hand onto the battlefield.",
  abilities: [
    {
      kind: "activated",
      cost: [{ kind: "mana", cost: [{ kind: "colored", color: "G" }] }, { kind: "tap" }],
      targets: [],
      effects: [{ op: "putOntoBattlefield", from: "yourHand", filter: { types: ["creature"] }, optional: true }],
    },
  ],
};
