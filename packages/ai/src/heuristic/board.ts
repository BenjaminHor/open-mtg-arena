// What the heuristic reads of the table, all from what its seat is shown (`SeatView`, D-137): the objects it can see,
// who controls them, life totals, and a rough worth for each permanent. The worths are guesses tuned by `eval`, not
// rules: a bigger, evasive creature is worth more; a land is worth a little.

import {
  type CardData,
  type CardDatabase,
  cardDataByOracleId,
  type Keyword,
  manaValue,
  type ObjectId,
  type PlayerId,
  type SeatView,
  type SeenCard,
} from "@mtg/engine";

/** What winning (or losing) the game is worth, against which everything else is small. */
export const LETHAL = 100;

export function seenCard(shown: SeatView, id: ObjectId): SeenCard | null {
  const seen = shown.seen[id];
  return seen?.kind === "card" ? seen : null;
}

export function opponents(shown: SeatView): PlayerId[] {
  return shown.view.turnOrder.filter((p) => p !== shown.player);
}

export function lifeOf(shown: SeatView, player: PlayerId): number {
  return shown.view.players[player]?.life ?? 0;
}

export function permanents(shown: SeatView): SeenCard[] {
  return shown.view.zones.battlefield.flatMap((id) => seenCard(shown, id) ?? []);
}

export function controlledBy(shown: SeatView, player: PlayerId): SeenCard[] {
  return permanents(shown).filter((c) => c.characteristics.controller === player);
}

export function creaturesOf(shown: SeatView, player: PlayerId): SeenCard[] {
  return controlledBy(shown, player).filter(isCreature);
}

export function hand(shown: SeatView): SeenCard[] {
  const ids = shown.view.zones.players[shown.player]?.hand ?? [];
  return ids.flatMap((id) => seenCard(shown, id) ?? []);
}

export function isCreature(card: SeenCard): boolean {
  return card.characteristics.types.includes("creature");
}

export function isLand(card: SeenCard): boolean {
  return card.characteristics.types.includes("land");
}

export function has(card: SeenCard, keyword: Keyword): boolean {
  return card.characteristics.keywords.includes(keyword);
}

/** A card's data, for its definition and printed cost; null for a token, which has neither. */
export function cardData(card: SeenCard, cards: CardDatabase): CardData | null {
  return card.oracleId === null ? null : (cardDataByOracleId(card.oracleId, cards) ?? null);
}

export function manaValueOf(card: SeenCard, cards: CardDatabase): number {
  const cost = cardData(card, cards)?.printed.manaCost ?? null;
  return cost === null ? 0 : manaValue(cost);
}

export function power(card: SeenCard): number {
  return card.characteristics.power ?? 0;
}

/** Damage it can still take before it's destroyed (CR 704.5g): its toughness less the damage already marked. */
export function toughnessLeft(card: SeenCard): number {
  return (card.characteristics.toughness ?? 0) - card.damage;
}

/** Keywords that make a creature hit harder or harder to deal with, each worth about one more point of size. */
const STRONG_KEYWORDS: readonly Keyword[] = [
  "flying",
  "first strike",
  "double strike",
  "deathtouch",
  "lifelink",
  "trample",
  "vigilance",
  "indestructible",
  "shroud",
];

export function creatureValue(card: SeenCard): number {
  const strong = card.characteristics.keywords.filter((k) => STRONG_KEYWORDS.includes(k)).length;
  const walls = has(card, "defender") ? -power(card) : 0;
  return (
    1.5 * power(card) + (card.characteristics.toughness ?? 0) + strong + card.characteristics.protections.length + walls
  );
}

/** How much a permanent is worth to whoever controls it: a creature by size, a planeswalker by loyalty, a land a little. */
export function permanentValue(card: SeenCard, cards: CardDatabase): number {
  const types = card.characteristics.types;
  if (types.includes("creature")) return creatureValue(card);
  if (types.includes("planeswalker")) return 4 + (card.counters.loyalty ?? 0);
  if (types.includes("land")) return 1;
  return 1 + manaValueOf(card, cards);
}
