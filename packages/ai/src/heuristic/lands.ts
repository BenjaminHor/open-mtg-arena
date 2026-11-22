// Which land to play (CR 305.1): one a turn, the one making the colors the hand's spells need that its lands don't
// make yet. Only in its own main phase with an empty stack, where it's legal anyway; elsewhere a land waits.

import type { Action, CardDatabase, Color, ManaType, SeatView, SeenCard } from "@mtg/engine";
import { cardData, controlledBy, hand, isLand, seenCard } from "./board.ts";

const BASIC_COLOR: Readonly<Record<string, Color>> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

export function bestLand(shown: SeatView, cards: CardDatabase): Action | null {
  const plays = shown.options.filter((o) => o.action.type === "PLAY_LAND");
  if (plays.length === 0) return null;
  const have = controlledBy(shown, shown.player)
    .filter(isLand)
    .flatMap((l) => landColors(l, cards));
  const wanted = hand(shown)
    .filter((c) => !isLand(c))
    .flatMap((c) => c.characteristics.colors)
    .filter((c) => !have.includes(c));
  let best: { action: Action; score: number } | null = null;
  for (const play of plays) {
    if (play.action.type !== "PLAY_LAND") continue;
    const land = seenCard(shown, play.action.object);
    const makes = land === null ? [] : landColors(land, cards);
    const score = wanted.filter((c) => makes.includes(c)).length;
    if (best === null || score > best.score) best = { action: play.action, score };
  }
  return best?.action ?? null;
}

/** The colors a land can make: its basic land types' (CR 305.6), and its own mana abilities'. */
function landColors(land: SeenCard, cards: CardDatabase): Color[] {
  const basic = land.characteristics.subtypes.flatMap((t) => BASIC_COLOR[t] ?? []);
  const written = (cardData(land, cards)?.def.abilities ?? []).flatMap((a) =>
    a.effects.flatMap((e) => (e.op === "addMana" ? manaColors(e.mana) : [])),
  );
  return [...basic, ...written];
}

function manaColors(mana: ManaType | "anyColor" | { oneOf: Color[] }): Color[] {
  if (mana === "anyColor") return ["W", "U", "B", "R", "G"];
  if (typeof mana === "object") return mana.oneOf;
  return mana === "C" ? [] : [mana];
}
