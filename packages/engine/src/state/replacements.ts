// Replacement effects made by resolving spells and abilities (CR 614.1), kept until used or until they end. A card's own
// replacements are in its text instead (`CardDef.replacements`).

import type { ObjectId } from "./ids.ts";

export type ReplacementEffect =
  /**
   * A regeneration shield on `object`: the next time it would be destroyed this turn, it's regenerated instead
   * (CR 701.19a, 614.8). Ends in the cleanup step if unused (CR 514.2).
   */
  { kind: "regenerationShield"; object: ObjectId };
