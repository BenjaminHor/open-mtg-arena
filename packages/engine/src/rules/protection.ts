// Protection (CR 702.16): what a permanent's "protection from [quality]" stops (targeting, blocking, damage; being
// enchanted or equipped comes with Auras and Equipment, later: CR 702.16c-d), and whether a source has the quality.

import type { CardDatabase, Color, ProtectionQuality } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { subtypesOf } from "./card-types.ts";
import { colorsOf } from "./colors.ts";
import { layeredOf } from "./layers.ts";

/**
 * An object's protection abilities (CR 702.16), in any zone, like `keywordsOf`: layer 6 of the layer pass (`layers.ts`),
 * printed until an effect grants or removes one (later: CR 613.1f). Where they work is the rule's to say
 * (`isProtectedFrom`).
 */
export function protectionsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly ProtectionQuality[] {
  return layeredOf(state, id, cards)?.protections ?? [];
}

/**
 * Whether this permanent has protection from this source: from some quality the source has (CR 702.16a). A
 * permanent's abilities work only on the battlefield (CR 113.6), so a card elsewhere has none that count.
 */
export function isProtectedFrom(state: GameState, permanent: ObjectId, source: ObjectId, cards: CardDatabase): boolean {
  if (!state.zones.battlefield.includes(permanent)) return false;
  return protectionsOf(state, permanent, cards).some((quality) => hasQuality(state, source, quality, cards));
}

/**
 * Whether a source has the quality. An ability has no colors or types of its own: its source's count (CR 702.16b,
 * "abilities from a source with the stated quality"), as it is now, or as it last existed if it left (CR 113.7a).
 */
function hasQuality(state: GameState, source: ObjectId, quality: ProtectionQuality, cards: CardDatabase): boolean {
  const obj = state.objects[source];
  const object = obj?.kind === "ability" ? obj.source : source;
  const { colors, subtypes } = qualitiesOf(state, object, cards);
  switch (quality.kind) {
    case "color":
      return colors.includes(quality.color);
    case "subtype":
      // A subtype counts for permanents with it and for sources not on the battlefield with it (CR 702.16a).
      return subtypes.includes(quality.subtype);
  }
}

/**
 * A source's colors and subtypes: computed (layers 4 and 5) while it exists; as it last existed if it left the
 * battlefield, from the snapshot taken as it left (CR 608.2h): a black Zombie from Rise from the Grave stays black. A
 * source with no snapshot (a spell gone from the stack: none is kept yet, later: CR 608.2h) has none.
 */
function qualitiesOf(
  state: GameState,
  id: ObjectId,
  cards: CardDatabase,
): { colors: readonly Color[]; subtypes: readonly string[] } {
  if (state.objects[id]?.kind === "card")
    return { colors: colorsOf(state, id, cards), subtypes: subtypesOf(state, id, cards) };
  const known = state.lastKnownCharacteristics[id];
  return { colors: known?.colors ?? [], subtypes: known?.subtypes ?? [] };
}
