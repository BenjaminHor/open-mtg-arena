import type { CardDef } from "@mtg/engine";

export const alluringSiren: CardDef = {
  name: "Alluring Siren",
  oracle: "{T}: Target creature an opponent controls attacks you this turn if able.",
  abilities: [
    {
      kind: "activated", // CR 602
      cost: [{ kind: "tap" }],
      targets: [{ kind: "permanent", filter: { types: ["creature"], controller: "opponent" } }],
      effects: [{ op: "mustAttack", of: { target: 0 }, duration: "endOfTurn" }],
    },
  ],
};
