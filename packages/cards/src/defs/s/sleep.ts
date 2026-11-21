import type { CardDef } from "@mtg/engine";

export const sleep: CardDef = {
  name: "Sleep",
  oracle: "Tap all creatures target player controls. Those creatures don't untap during that player's next untap step.",
  spell: {
    targets: [{ kind: "player" }],
    effects: [
      { op: "tap", of: { eachControlledBy: { target: 0 }, filter: { types: ["creature"] } } },
      // "Those creatures": all of them as it resolves, tapped by it or not (its ruling).
      {
        op: "doesntUntap",
        of: { eachControlledBy: { target: 0 }, filter: { types: ["creature"] } },
        during: { target: 0 },
      },
    ],
  },
};
