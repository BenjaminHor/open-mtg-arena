// Protection (CR 702.16): what a permanent's "protection from [quality]" stops (targeting, blocking, damage; being
// enchanted or equipped comes with Auras and Equipment, later: CR 702.16c-d), and whether a source has the quality.

import type { CardDatabase, ProtectionQuality } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";

/**
 * A permanent's protection abilities (CR 702.16): layer 6 of `characteristics()`, printed until effects grant or remove
 * them (later: CR 613.1f). Abilities of a permanent work only on the battlefield (CR 113.6): a card elsewhere has none
 * that count.
 */
export function protectionsOf(state: GameState, id: ObjectId, cards: CardDatabase): readonly ProtectionQuality[] {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || !state.zones.battlefield.includes(id)) return [];
  return cards[obj.oracleId]?.def.protections ?? [];
}

/** Whether this permanent has protection from this source: from some quality the source has (CR 702.16a). */
export function isProtectedFrom(state: GameState, permanent: ObjectId, source: ObjectId, cards: CardDatabase): boolean {
  const protections = protectionsOf(state, permanent, cards);
  return protections.length > 0 && protections.some((quality) => hasQuality(state, source, quality, cards));
}

/**
 * Whether a source has the quality: as it is now, or as it last existed if it's gone (an ability's source that left,
 * CR 113.7a). An ability itself has no color or types; its source's are what count (CR 702.16b: "abilities from a
 * source with the stated quality"). Nothing changes colors or types yet, so these are printed values; once effects can
 * (later: CR 613.1d-e), this reads the source's characteristics, or a snapshot of them for a gone source.
 */
function hasQuality(state: GameState, source: ObjectId, quality: ProtectionQuality, cards: CardDatabase): boolean {
  const obj = state.objects[source] ?? state.lastKnown[source];
  if (obj === undefined) return false;
  const oracleId = obj.kind === "card" ? obj.oracleId : obj.sourceOracleId;
  const printed = cards[oracleId]?.printed;
  if (printed === undefined) return false;
  switch (quality.kind) {
    case "color":
      return printed.colors.includes(quality.color);
    case "subtype":
      // A subtype counts for permanents with it and for sources not on the battlefield with it (CR 702.16a).
      return printed.subtypes.includes(quality.subtype);
  }
}
