import type { CardDef } from "@mtg/engine";

export const phantomWarrior: CardDef = {
  name: "Phantom Warrior",
  oracle: "This creature can't be blocked.",
  statics: [{ kind: "cantBeBlocked" }],
};
