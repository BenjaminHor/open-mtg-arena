import type { CardDef } from "@mtg/engine";

export const platinumAngel: CardDef = {
  name: "Platinum Angel",
  oracle: "Flying\nYou can't lose the game and your opponents can't win the game.",
  keywords: ["flying"],
  statics: [{ kind: "cantLoseOpponentsCantWin" }],
};
