// Turns the Oracle strings in data/pool.json into the engine's printed characteristics.
// Anything the engine doesn't support yet is an error here, so an unsupported card can't slip into the pool.

import type { CardType, Color, ManaCost, ManaSymbol, PrintedCard, Supertype } from "@mtg/engine";
import type { PoolCard } from "./pool-data.ts";

const COLORS: readonly string[] = ["W", "U", "B", "R", "G"];
const SUPERTYPES: readonly string[] = ["basic", "legendary", "ongoing", "snow", "world"];
const CARD_TYPES: readonly string[] = [
  "artifact",
  "battle",
  "creature",
  "enchantment",
  "instant",
  "kindred",
  "land",
  "planeswalker",
  "sorcery",
];

export function printedCard(card: PoolCard): PrintedCard {
  const { supertypes, types, subtypes } = parseTypeLine(card.typeLine);
  return {
    name: card.name,
    manaCost: card.manaCost === "" ? null : parseManaCost(card.manaCost),
    colors: card.colors.map(parseColor),
    supertypes,
    types,
    subtypes,
    power: parsePT(card.power, card.name),
    toughness: parsePT(card.toughness, card.name),
  };
}

/** "{2}{R}{R}" -> generic 2, red, red (CR 107.4). */
export function parseManaCost(text: string): ManaCost {
  const symbols = text.match(/\{[^}]*\}/g) ?? [];
  if (symbols.join("") !== text) throw new Error(`Not a mana cost: "${text}"`);
  return symbols.map((s): ManaSymbol => {
    const inner = s.slice(1, -1);
    if (/^\d+$/.test(inner)) return { kind: "generic", amount: Number(inner) };
    if (COLORS.includes(inner)) return { kind: "colored", color: inner as Color };
    throw new Error(`Mana symbol ${s} isn't supported yet`);
  });
}

/** "Basic Land — Mountain" -> supertypes [basic], types [land], subtypes [Mountain] (CR 205.1). */
export function parseTypeLine(text: string): { supertypes: Supertype[]; types: CardType[]; subtypes: string[] } {
  const [left = "", right, extra] = text.split(" — ");
  if (extra !== undefined || text.includes("//")) throw new Error(`Type line not supported yet: "${text}"`);
  const supertypes: Supertype[] = [];
  const types: CardType[] = [];
  for (const word of left.split(" ")) {
    const lower = word.toLowerCase();
    if (SUPERTYPES.includes(lower)) supertypes.push(lower as Supertype);
    else if (CARD_TYPES.includes(lower)) types.push(lower as CardType);
    else throw new Error(`Unknown supertype or card type "${word}" in "${text}"`);
  }
  if (types.length === 0) throw new Error(`No card type in "${text}"`);
  return { supertypes, types, subtypes: right === undefined ? [] : right.split(" ") };
}

function parseColor(color: string): Color {
  if (!COLORS.includes(color)) throw new Error(`Unknown color "${color}"`);
  return color as Color;
}

/** Power or toughness. Values like "*" (CR 208.2) aren't supported yet. */
function parsePT(value: string | null, name: string): number | null {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new Error(`${name}: power/toughness "${value}" isn't supported yet`);
  return Number(value);
}
