// The stack at the right [R: arena-research.md §5, "The stack sits on the right, mid-height, as a large readable card
// for the top item"]: the top object large, so the person sees the spell they're choosing targets for or the one the
// opponent cast, and the objects under it peeking out to its left in a cascade, the deepest furthest, each still
// reachable for the card view. Past `MOST_UNDER` the rest are counted (the top's count) and listed in the zone browser.
// A spell is its card; an ability is a card-shaped panel with its source's name and art, its kind and its own text [R:
// "drawn as card-shaped panels with the source's art, an 'Ability' type line, the ability text"], drawn from its
// source's printed card when the source has left (a "dies" trigger).

import type { ObjectId, SeatView, SeenAbility } from "@mtg/engine";
import type { BoardLayout } from "../layout/board-layout.ts";
import { abilityText } from "./ability-text.ts";
import { NO_BADGES } from "./badges.ts";
import { boardCard } from "./board-card.ts";
import type { BoardCard, Rect } from "./board-model.ts";
import { cardInfo } from "./card-info.ts";

/** How many objects under the top peek out: more would reach far over the board on a phone. */
export const MOST_UNDER = 4;

/** Every object on the stack the board draws, the deepest first (drawn first, so each covers the one under it). */
export function stackCards(shown: SeatView, area: Rect, layout: BoardLayout): BoardCard[] {
  const stack = shown.view.zones.stack;
  const topId = stack[stack.length - 1];
  if (topId === undefined) return [];
  const top = topRect(shown, area, layout);
  const peek = layout.stack.peek * top.width;
  // Top first, then down the stack, as far as is drawn.
  const shownIds = [...stack].reverse().slice(0, MOST_UNDER + 1);
  const drawn = shownIds.flatMap((id, depth) => {
    const rect = { ...top, x: top.x - depth * peek };
    const card = stackObject(shown, id, rect);
    if (card === null) return [];
    // The count rides on the top, as a pile's does.
    return [depth === 0 && stack.length > 1 ? { ...card, pileCount: stack.length } : card];
  });
  return drawn.reverse();
}

/** A button under the top object listing the whole stack, when more is on it than is drawn; else null. */
export function stackMore(shown: SeatView, drawn: readonly BoardCard[]): Rect | null {
  const top = drawn.at(-1);
  if (top === undefined || shown.view.zones.stack.length <= drawn.length) return null;
  return { x: top.x, y: top.y + top.height + 6, width: top.width, height: 30 };
}

/** The top object's place: large right of centre, or small at the right edge while the person chooses for it [R]. */
function topRect(shown: SeatView, area: Rect, layout: BoardLayout): Rect {
  const choosing = shown.view.casting !== null && shown.view.casting.player === shown.player;
  // Small means a fixed size at most (in CSS pixels): on a tall screen a share of the height would reach over the rows.
  const height = choosing
    ? Math.min(layout.stack.smallH * area.height, layout.stack.smallMaxH)
    : layout.stack.h * area.height;
  const width = height * layout.ratio.hand;
  const right = area.x + area.width - 8;
  const x = choosing ? right - width : Math.min(area.x + layout.stack.x * area.width, right - width);
  const y = area.y + (choosing ? layout.stack.smallY : layout.stack.y) * area.height;
  return { x, y, width, height };
}

function stackObject(shown: SeatView, id: ObjectId, rect: Rect): BoardCard | null {
  const object = shown.seen[id];
  if (object === undefined) return null;
  const look = { rotation: 0, dim: 0, row: "stack" as const };
  if (object.kind === "card") {
    return boardCard(object, "stack", object.characteristics.controller === shown.player, rect, look);
  }
  return abilityPanel(shown, object, rect);
}

/** An ability as a card-shaped panel: its source's name and art, its kind, its own text. */
function abilityPanel(shown: SeatView, ability: SeenAbility, rect: Rect): BoardCard {
  const info = cardInfo(ability.sourceOracleId);
  const source = shown.seen[ability.source];
  // The source's colours while it's still seen; once it has left, a plain panel.
  const colors = source?.kind === "card" ? source.characteristics.colors : [];
  return {
    id: ability.id,
    name: info?.name ?? "Ability",
    zone: "stack",
    row: "stack",
    pileOf: ability.id,
    playable: false,
    targetable: false,
    picked: false,
    attacking: false,
    attacks: null,
    blocking: [],
    mine: ability.controller === shown.player,
    ...rect,
    rotation: 0,
    dim: 0,
    behind: false,
    costRadius: 0,
    tapped: false,
    colors,
    frameColors: colors,
    land: false,
    artifact: false,
    token: false,
    ability: true,
    art: info?.artCrop ?? null,
    typeLine: abilityKind(ability),
    text: abilityText(info?.oracleText ?? "", ability.ability) ?? info?.oracleText ?? "",
    manaCost: [],
    power: null,
    toughness: null,
    printed: { power: null, toughness: null },
    damage: 0,
    pileCount: null,
    badges: NO_BADGES,
    attachments: 0,
  };
}

/** What kind of ability it is, as the panel's type line says: activated (CR 602) or triggered (CR 603). */
export function abilityKind(ability: SeenAbility): string {
  switch (ability.ability.kind) {
    case "printed":
    case "basicLandType":
      return "Activated ability";
    case "triggered":
      return "Triggered ability";
    case "delayed":
      return "Delayed triggered ability";
  }
}
