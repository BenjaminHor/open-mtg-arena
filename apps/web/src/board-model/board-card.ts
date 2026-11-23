// One seen card as the board draws it, at a given rectangle. Shared by the battlefield and the hand.

import type { SeenCard } from "@mtg/engine";
import type { BoardCard, Rect } from "./board-model.ts";
import { cardInfo, manaSymbols } from "./card-info.ts";

export function boardCard(
  card: SeenCard,
  zone: BoardCard["zone"],
  mine: boolean,
  rect: Rect,
  look: { rotation: number; alpha: number; pileCount?: number | null },
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
    alpha: look.alpha,
    tapped: card.tapped,
    colors: c.colors,
    land: c.types.includes("land"),
    art: info?.artCrop ?? null,
    // The cost floats over a hand card [R]; a permanent's isn't shown.
    manaCost: zone === "hand" ? manaSymbols(info?.manaCost ?? "") : [],
    power: c.power,
    toughness: c.toughness,
    damage: card.damage,
    pileCount: look.pileCount ?? null,
  };
}
