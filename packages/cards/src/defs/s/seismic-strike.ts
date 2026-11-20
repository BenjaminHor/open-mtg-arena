import type { CardDef } from "@mtg/engine";

export const seismicStrike: CardDef = {
  name: "Seismic Strike",
  oracle: "Seismic Strike deals damage to target creature equal to the number of Mountains you control.",
  spell: {
    targets: [{ kind: "permanent", filter: { types: ["creature"] } }],
    // Mountains are a land type, counted as it resolves (CR 205.3i, 608.2h).
    effects: [
      {
        op: "dealDamage",
        amount: { count: { subtypes: ["Mountain"], controller: "you" } },
        from: "self",
        to: { target: 0 },
      },
    ],
  },
};
