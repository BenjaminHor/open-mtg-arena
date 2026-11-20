import type { CardDef } from "@mtg/engine";

export const darksteelColossus: CardDef = {
  name: "Darksteel Colossus",
  oracle:
    "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nIndestructible (Damage and effects that say \"destroy\" don't destroy this creature.)\nIf Darksteel Colossus would be put into a graveyard from anywhere, reveal Darksteel Colossus and shuffle it into its owner's library instead.",
  keywords: ["trample", "indestructible"],
  // Works in every zone, as it says (CR 113.6b): discarded, milled, countered or sacrificed, it goes to the library.
  replacements: [{ kind: "graveyardToLibrary" }],
};
