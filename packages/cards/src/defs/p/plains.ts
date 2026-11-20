import type { CardDef } from "@mtg/engine";

// The mana ability isn't written here: a land with a basic land type has it intrinsically (CR 305.6),
// so the engine derives it from the Plains subtype. The Oracle text is only reminder text.
export const plains: CardDef = { name: "Plains", oracle: "({T}: Add {W}.)" };
