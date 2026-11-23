// What a screen needs to draw a card that the seat view doesn't carry: its printed mana cost and type line, its art and
// the artist (always credited, docs/data-sources.md). Read from the committed pool data by oracle id. A token has no
// oracle id (its characteristics come from the effect that made it), so it has no art or printed cost.

import { POOL } from "@mtg/cards/pool";
import type { OracleId } from "@mtg/engine";

export type CardInfo = {
  /** For example "{1}{R}"; empty for a land. A copy shows what it copied (its oracle id is the copied card's). */
  manaCost: string;
  typeLine: string;
  /** The Oracle rules text, lines split by "\n". */
  oracleText: string;
  /** Scryfall's art crop, loaded at runtime and never bundled (D-007). */
  artCrop: string;
  /** Scryfall's full card image, for a card in hand (ui.md, "Hand cards are the real card image"). */
  image: string;
  artist: string;
  /** Printed power and toughness as numbers; null for none or a "*" value (CR 208.2). */
  power: number | null;
  toughness: number | null;
};

const number = (printed: string | null) => (printed !== null && /^\d+$/.test(printed) ? Number(printed) : null);

const BY_ORACLE_ID = new Map<OracleId, CardInfo>(
  POOL.cards.map((c) => [
    c.oracleId,
    {
      manaCost: c.manaCost,
      typeLine: c.typeLine,
      oracleText: c.oracleText,
      artCrop: c.images.artCrop,
      image: c.images.normal,
      artist: c.artist,
      power: number(c.power),
      toughness: number(c.toughness),
    },
  ]),
);

export function cardInfo(oracleId: OracleId | null): CardInfo | null {
  return oracleId === null ? null : (BY_ORACLE_ID.get(oracleId) ?? null);
}

/** A mana cost's symbols, in order: "{2}{W}{W}" is ["2", "W", "W"] (CR 107.4). */
export function manaSymbols(manaCost: string): string[] {
  return [...manaCost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? "");
}
