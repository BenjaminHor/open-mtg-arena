import type { CardDef } from "@mtg/engine";

export const howlingMine: CardDef = {
  name: "Howling Mine",
  oracle:
    "At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card.",
  triggers: [
    {
      when: { kind: "beginningOfStep", step: "draw", whose: "each" },
      // An "intervening if": no trigger while it's tapped, and none on resolving if it's tapped by then (CR 603.4).
      onlyIf: { kind: "sourceUntapped" },
      targets: [],
      effects: [{ op: "draw", who: "triggeringPlayer", amount: 1 }],
    },
  ],
};
