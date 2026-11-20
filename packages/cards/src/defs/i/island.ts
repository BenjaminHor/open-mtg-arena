import type { CardDef } from "@mtg/engine";

// The mana ability isn't written here: a land with a basic land type has it intrinsically (CR 305.6),
// so the engine derives it from the Island subtype. The Oracle text is only reminder text.
export const island: CardDef = { name: "Island", oracle: "({T}: Add {U}.)" };
