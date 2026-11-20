import type { CardDef } from "@mtg/engine";

export const angelsMercy: CardDef = {
  name: "Angel's Mercy",
  oracle: "You gain 7 life.",
  spell: { targets: [], effects: [{ op: "gainLife", who: "you", amount: 7 }] },
};
