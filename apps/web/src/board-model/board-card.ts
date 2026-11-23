// One seen card as the board draws it, at a given rectangle. Shared by the battlefield and the hand.

import type { Color, SeenCard } from "@mtg/engine";
import type { BoardCard, Rect } from "./board-model.ts";
import { cardInfo, manaSymbols } from "./card-info.ts";

export function boardCard(
  card: SeenCard,
  zone: BoardCard["zone"],
  mine: boolean,
  rect: Rect,
  look: { rotation: number; dim: number; pileCount?: number | null; behind?: boolean; costRadius?: number },
): BoardCard {
  const c = card.characteristics;
  const info = cardInfo(card.oracleId);
  return {
    id: card.id,
    name: c.name,
    zone,
    mine,
    ...rect,
    rotation: look.rotation,
    dim: look.dim,
    behind: look.behind ?? false,
    costRadius: look.costRadius ?? 0,
    tapped: card.tapped,
    colors: c.colors,
    frameColors: c.colors.length > 0 || !c.types.includes("land") ? c.colors : basicLandColors(c.subtypes),
    land: c.types.includes("land"),
    art: info?.artCrop ?? null,
    // The cost floats over a hand card [R]; a permanent's isn't shown.
    manaCost: zone === "hand" ? manaSymbols(info?.manaCost ?? "") : [],
    power: c.power,
    toughness: c.toughness,
    printed: { power: info?.power ?? null, toughness: info?.toughness ?? null },
    damage: card.damage,
    pileCount: look.pileCount ?? null,
  };
}

/** The basic land types and the mana each makes (CR 305.6). */
const BASIC_LAND_COLORS: Record<string, Color> = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G" };

function basicLandColors(subtypes: readonly string[]): Color[] {
  return subtypes.flatMap((t) => (Object.hasOwn(BASIC_LAND_COLORS, t) ? [BASIC_LAND_COLORS[t] as Color] : []));
}
