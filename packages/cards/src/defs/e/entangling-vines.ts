import type { CardDef } from "@mtg/engine";

export const entanglingVines: CardDef = {
  name: "Entangling Vines",
  oracle: "Enchant tapped creature\nEnchanted creature doesn't untap during its controller's untap step.",
  enchant: { types: ["creature"], tapped: true },
  statics: [{ kind: "attachedDoesntUntap" }],
};
