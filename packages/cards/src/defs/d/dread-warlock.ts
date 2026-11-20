import type { CardDef } from "@mtg/engine";

export const dreadWarlock: CardDef = {
  name: "Dread Warlock",
  oracle: "This creature can't be blocked except by black creatures.",
  statics: [{ kind: "cantBeBlocked", except: { types: ["creature"], colors: ["B"] } }],
};
