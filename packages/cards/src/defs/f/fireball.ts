import type { CardDef } from "@mtg/engine";

export const fireball: CardDef = {
  name: "Fireball",
  oracle:
    "This spell costs {1} more to cast for each target beyond the first.\nFireball deals X damage divided evenly, rounded down, among any number of targets.",
  spell: {
    // "Any number of targets" includes none (CR 115.6; its rulings): then it deals no damage.
    targets: [{ kind: "anyTarget", count: { min: 0, max: "any" } }],
    // Divided as it resolves, among the targets still legal then; nothing is announced (its rulings).
    effects: [{ op: "dealDamage", amount: "X", from: "self", to: { target: 0 }, divided: "evenly" }],
    costIncrease: { perTargetBeyondFirst: [{ kind: "generic", amount: 1 }] },
  },
};
