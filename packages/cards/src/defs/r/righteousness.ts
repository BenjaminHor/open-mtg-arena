import type { CardDef } from "@mtg/engine";

export const righteousness: CardDef = {
  name: "Righteousness",
  oracle: "Target blocking creature gets +7/+7 until end of turn.",
  spell: {
    // A blocking creature stays one until it's removed from combat, even if what it blocked is gone (CR 509.1g).
    targets: [{ kind: "permanent", filter: { types: ["creature"], combat: "blocking" } }],
    effects: [{ op: "modifyPT", power: 7, toughness: 7, of: { target: 0 }, duration: "endOfTurn" }],
  },
};
