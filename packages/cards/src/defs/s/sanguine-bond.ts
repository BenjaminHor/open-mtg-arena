import type { CardDef } from "@mtg/engine";

export const sanguineBond: CardDef = {
  name: "Sanguine Bond",
  oracle: "Whenever you gain life, target opponent loses that much life.",
  triggers: [
    {
      when: { kind: "playerGainsLife", player: "you" },
      targets: [{ kind: "opponent" }],
      effects: [{ op: "loseLife", who: { target: 0 }, amount: "thatMuch" }],
    },
  ],
};
