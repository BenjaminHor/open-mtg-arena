// The stack at the right [R: arena-research.md §5, "The stack sits on the right, mid-height, as a large readable card
// for the top item"]: the top object large, so the person sees the spell they're choosing targets for or the one the
// opponent cast, and the objects under it peeking out above it by a name strip each, the deepest highest, each still
// reachable for the card view; a "Stack n" button lists them all in the zone browser.
// A spell is its card; an ability is a card-shaped panel with its source's name and art, its kind and its own text [R:
// "drawn as card-shaped panels with the source's art, an 'Ability' type line, the ability text"], drawn from its
// source's printed card when the source has left (a "dies" trigger).

import type { ObjectId, SeatView, SeenAbility } from "@mtg/engine";
import type { BoardLayout } from "../layout/board-layout.ts";
import { abilityKind, abilityText } from "./ability-text.ts";
import { NO_BADGES } from "./badges.ts";
import { boardCard } from "./board-card.ts";
import type { BoardCard, Rect } from "./board-model.ts";
import { cardInfo } from "./card-info.ts";

/**
 * How many objects under the top peek out above it: each shows its name strip, so a deeper stack shrinks the top. More
 * are counted on the "Stack n" button and listed in the zone browser.
 */
export const MOST_UNDER = 3;

/**
 * Every object on the stack the board draws, the deepest first (drawn first, so each covers the one under it). They
 * share one block, the top's old place: the deeper ones peek out above the top by a name strip each [R: names read
 * down the stack], so the stack never covers more of the board than its top alone did (UX review).
 */
export function stackCards(shown: SeatView, area: Rect, layout: BoardLayout): BoardCard[] {
  const stack = shown.view.zones.stack;
  if (stack.length === 0) return [];
  const block = stackBlock(shown, area, layout);
  const under = Math.min(stack.length - 1, MOST_UNDER);
  // The card's height, and the strip each one under it shows (at least a readable name, 14 px).
  const first = block.height / (1 + layout.stack.peek * under);
  const peek = Math.max(14, layout.stack.peek * first);
  const height = block.height - under * peek;
  const width = height * layout.ratio.hand;
  const x = Math.min(block.x, area.x + area.width - 8 - width);
  // Top first, then down the stack, as far as is drawn.
  const drawn = [...stack]
    .reverse()
    .slice(0, under + 1)
    .flatMap((id, depth) => {
      const card = stackObject(shown, id, { x, y: block.y + (under - depth) * peek, width, height });
      return card === null ? [] : [card];
    });
  return drawn.reverse();
}

/**
 * A button above the stack once two or more objects are on it, saying how many and listing them all top first in the
 * zone browser: the strips are a name's height, smaller than a finger, so this is the sure way to each (UX review).
 */
export function stackMore(shown: SeatView, drawn: readonly BoardCard[]): Rect | null {
  const deepest = drawn[0];
  const top = drawn.at(-1);
  if (deepest === undefined || top === undefined || shown.view.zones.stack.length < 2) return null;
  return { x: top.x, y: deepest.y - 34, width: Math.min(top.width, 96), height: 28 };
}

/**
 * The stack's place: large right of centre (at most `maxH` px tall: on a near-square screen a share of the height is
 * far too large), or small at the right edge while the person chooses for it [R].
 */
function stackBlock(shown: SeatView, area: Rect, layout: BoardLayout): Rect {
  const choosing = shown.view.casting !== null && shown.view.casting.player === shown.player;
  // Small means a fixed size at most (in CSS pixels): on a tall screen a share of the height would reach over the rows.
  const height = choosing
    ? Math.min(layout.stack.smallH * area.height, layout.stack.smallMaxH)
    : Math.min(layout.stack.h * area.height, layout.stack.maxH);
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
