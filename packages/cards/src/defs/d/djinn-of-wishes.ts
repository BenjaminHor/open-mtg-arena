import type { CardDef } from "@mtg/engine";

export const djinnOfWishes: CardDef = {
  name: "Djinn of Wishes",
  oracle:
    "Flying\nThis creature enters with three wish counters on it.\n{2}{U}{U}, Remove a wish counter from this creature: Reveal the top card of your library. You may play that card without paying its mana cost. If you don't, exile it.",
  keywords: ["flying"],
  replacements: [{ kind: "entersWithCounters", counter: "wish", amount: 3 }],
  abilities: [
    {
      kind: "activated",
      cost: [
        {
          kind: "mana",
          cost: [
            { kind: "generic", amount: 2 },
            { kind: "colored", color: "U" },
            { kind: "colored", color: "U" },
          ],
        },
        { kind: "removeCounters", counter: "wish", amount: 1 },
      ],
      targets: [],
      // "If you don't, exile it": a card played is a new object, which `exile` of "found" no longer finds (CR 400.7).
      effects: [
        { op: "revealTop", who: "you" },
        { op: "mayPlay", of: "found", withoutPayingManaCost: true },
        { op: "exile", of: "found" },
      ],
    },
  ],
};
