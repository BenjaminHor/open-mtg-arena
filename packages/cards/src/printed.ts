// Turns the Oracle strings in data/pool.json into the engine's printed characteristics.
// Anything the engine doesn't support yet is an error here, so an unsupported card can't slip into the pool.

import type { CardType, Color, ManaCost, ManaSymbol, PrintedCard, Supertype } from "@mtg/engine";
import type { PoolCard } from "./pool-data.ts";

const COLORS: readonly string[] = ["W", "U", "B", "R", "G"];
const SUPERTYPES: readonly string[] = ["basic", "legendary", "snow", "world"];
const CARD_TYPES: readonly string[] = [
  "artifact",
  "creature",
  "enchantment",
  "instant",
  "kindred",
  "land",
  "planeswalker",
  "sorcery",
];
// Battles (defense, later: CR 310) need a printed value the engine doesn't model yet.

/** Creature types that are two words (CR 205.3b: creature subtypes are "one or two words"; the list is CR 205.3m). */
const TWO_WORD_SUBTYPES: readonly string[] = ["Time Lord"];

export function printedCard(card: PoolCard): PrintedCard {
  const { supertypes, types, subtypes } = parseTypeLine(card.typeLine);
  const manaCost = card.manaCost === "" ? null : parseManaCost(card.manaCost);
  const colorIndicator = card.colorIndicator.map(parseColor);
  const power = parsePT(card.power, card.name);
  const toughness = parsePT(card.toughness, card.name);
  // Only creature cards have printed power and toughness in the current pool (Vehicles come later, CR 208.3).
  if (types.includes("creature") !== (power !== null && toughness !== null)) {
    throw new Error(`${card.name}: power/toughness don't fit its type line "${card.typeLine}"`);
  }
  // A planeswalker card, and only one, has a printed loyalty (CR 209.1, 306.5a).
  const loyalty = card.loyalty === null ? null : parseLoyalty(card.loyalty, card.name);
  if (types.includes("planeswalker") !== (loyalty !== null)) {
    throw new Error(`${card.name}: loyalty doesn't fit its type line "${card.typeLine}"`);
  }
  return {
    ...(loyalty === null ? {} : { loyalty }),
    name: card.name,
    manaCost,
    colors: colorsOf(manaCost, colorIndicator),
    colorIndicator,
    supertypes,
    types,
    subtypes,
    power,
    toughness,
  };
}

/** The colors of the mana symbols in its cost (CR 202.2) plus its color indicator (CR 204.2), in WUBRG order. */
export function colorsOf(manaCost: ManaCost | null, colorIndicator: readonly Color[]): Color[] {
  const found = new Set<Color>(colorIndicator);
  for (const symbol of manaCost ?? []) if (symbol.kind === "colored") found.add(symbol.color);
  return (COLORS as readonly Color[]).filter((c) => found.has(c));
}

/** "{2}{R}{R}" -> generic 2, red, red (CR 107.4). */
export function parseManaCost(text: string): ManaCost {
  const symbols = text.match(/\{[^}]*\}/g) ?? [];
  if (symbols.join("") !== text) throw new Error(`Not a mana cost: "${text}"`);
  return symbols.map((s): ManaSymbol => {
    const inner = s.slice(1, -1);
    if (/^\d+$/.test(inner)) return { kind: "generic", amount: Number(inner) };
    if (inner === "X") return { kind: "x" };
    if (COLORS.includes(inner)) return { kind: "colored", color: inner as Color };
    throw new Error(`Mana symbol ${s} isn't supported yet`);
  });
}

/** "Basic Land — Mountain" -> supertypes [basic], types [land], subtypes [Mountain] (CR 205.1, 205.3b). */
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
  return { supertypes, types, subtypes: right === undefined ? [] : splitSubtypes(right) };
}

/** Each word after the dash is a subtype, except the two-word creature types (CR 205.3b). */
function splitSubtypes(text: string): string[] {
  const subtypes: string[] = [];
  let rest = text;
  while (rest !== "") {
    const twoWord = TWO_WORD_SUBTYPES.find((t) => rest === t || rest.startsWith(`${t} `));
    const next = twoWord ?? rest.split(" ")[0] ?? "";
    subtypes.push(next);
    rest = rest.slice(next.length).trimStart();
  }
  return subtypes;
}

function parseColor(color: string): Color {
  if (!COLORS.includes(color)) throw new Error(`Unknown color "${color}"`);
  return color as Color;
}

/** Printed loyalty: a number ("X" loyalty, later: CR 306.5b's X). */
function parseLoyalty(value: string, name: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name}: loyalty "${value}" isn't supported yet`);
  return Number(value);
}

/** Power or toughness: a number, or "*", which a characteristic-defining ability sets (CR 208.2a). "1+*" isn't yet. */
function parsePT(value: string | null, name: string): number | "*" | null {
  if (value === null) return null;
  if (value === "*") return "*";
  if (!/^\d+$/.test(value)) throw new Error(`${name}: power/toughness "${value}" isn't supported yet`);
  return Number(value);
}
