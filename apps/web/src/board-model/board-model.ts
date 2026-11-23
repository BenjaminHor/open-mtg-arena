// The board model (ui.md, "Board structure"): what the person's seat is shown (`SeatView`) plus the screen size, turned
// into plain data: every card it draws with its place and state, and where the DOM overlay puts life totals,
// portraits, the phase ladder and the main button. The renderer draws it and does no layout of its own, so the layout
// is tested here without drawing anything. The layout's values are data (`BoardLayout`; the compact one by default).

import type { Color, ObjectId, PlayerId, SeatView } from "@mtg/engine";
import type { BoardLayout } from "../layout/board-layout.ts";
import { COMPACT } from "../layout/compact.ts";
import { battlefieldCards } from "./battlefield.ts";
import { withCombat } from "./combat.ts";
import { handCards } from "./hand.ts";
import { cardBacks, libraryPiles } from "./hidden-cards.ts";

export type BoardCard = {
  id: ObjectId;
  name: string;
  zone: "battlefield" | "hand";
  /** Which row of the board it's in. */
  row: "creatures" | "lands" | "others" | "hand";
  /** The front card of the pile it's in (its own id when it stands alone): a pile moves as one. */
  pileOf: ObjectId;
  /** An attacking creature (CR 508.1). */
  attacking: boolean;
  /** The planeswalker it attacks, when it attacks one (CR 508.1b); null otherwise. */
  attacks: ObjectId | null;
  /** The attackers it blocks (CR 509.1), empty when it isn't blocking. */
  blocking: ObjectId[];
  /** Controlled by the person whose board this is. */
  mine: boolean;
  /** The card's rectangle, in CSS pixels from the board's top left, before it's turned by `rotation`. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radians, about the card's centre: a tapped permanent's tilt, a hand card's place in the fan. */
  rotation: number;
  /** How dark the card is shaded, 0 to 1: a tapped permanent is dimmed [R]. */
  dim: number;
  /** A card behind the front of a land pile: drawn as a plain edge, no name or badges, so the pile reads as one. */
  behind: boolean;
  /** The radius, in px, of the mana symbols floating over a hand card: smaller when its strip is narrow. */
  costRadius: number;
  tapped: boolean;
  colors: readonly Color[];
  /**
   * The colours its frame is drawn in: its own colours (CR 105.2), or for a colourless land the colours of the mana its
   * basic land types make (CR 305.6), as Arena frames a Forest green. Empty for a grey frame.
   */
  frameColors: readonly Color[];
  /** True for a land: drawn with a land's frame. */
  land: boolean;
  /** The art to draw, loaded at runtime (D-007); null for a token, which has none yet. */
  art: string | null;
  /** The printed mana cost's symbols, shown over a hand card (CR 107.4). Empty on the battlefield. */
  manaCost: string[];
  power: number | null;
  toughness: number | null;
  /** The printed power and toughness, so a changed one can be told apart; null for a token or a "*" value. */
  printed: { power: number | null; toughness: number | null };
  damage: number;
  /** On the front card of a pile of lands with the same name, how many it holds; null elsewhere. */
  pileCount: number | null;
};

/** A face-down card the person can't see: one of the opponent's hand (CR 402.3). */
export type CardBack = { key: string; x: number; y: number; width: number; height: number; rotation: number };

/** A library, face down, with how many cards it holds (CR 401.3: anyone may count it). */
export type LibraryPile = {
  player: PlayerId;
  mine: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
};

export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };

/** Where the DOM overlay places its pieces, in the same CSS pixels as the cards: the HUD does no layout of its own. */
export type OverlayAnchors = {
  portrait: { mine: Rect; opponent: Rect };
  life: { mine: Rect; opponent: Rect };
  mainButton: Rect;
  /**
   * The phase ladder [R]: over the main button on the person's turn, parted around the opponent's life crest on
   * theirs. One rectangle per phase icon, in turn order, and the pills drawn behind them (one, or one each side).
   */
  ladder: { side: "mine" | "opponent"; icons: Rect[]; pills: Rect[] };
};

export type BoardModel = {
  width: number;
  height: number;
  /** In drawing order, back to front. */
  cards: BoardCard[];
  backs: CardBack[];
  libraries: LibraryPile[];
  /** The band across the middle that splits the two battlefields [R], the board's whole width. */
  band: Rect;
  /** Combat's pairings: each blocker to the attacker it blocks, each attacker to the planeswalker it attacks. */
  links: CombatLink[];
  overlay: OverlayAnchors;
};

/** A line from one card's band-side edge to another's: a block (blocker to attacker) or an attack on a planeswalker. */
export type CombatLink = { kind: "block" | "attack"; from: Point; to: Point };

export type BoardSize = { width: number; height: number };
/** The safe-area insets (`env(safe-area-inset-*)`, ui.md "Layouts"): the board is drawn full-bleed, laid out inside. */
export type Insets = { top: number; right: number; bottom: number; left: number };

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The turn's phases (CR 500.1), one ladder icon each. */
const PHASE_COUNT = 5;

export function boardModel(
  shown: SeatView,
  size: BoardSize,
  insets: Insets = NO_INSETS,
  layout: BoardLayout = COMPACT,
): BoardModel {
  const me = shown.player;
  // Two players for now (M3); a multiplayer layout would place each opponent (later: CR 800).
  const opponent = shown.view.turnOrder.find((p) => p !== me) ?? me;
  // The play area: the board inside its safe-area insets, which the layout's shares are taken of.
  const area: Rect = {
    x: insets.left,
    y: insets.top,
    width: Math.max(0, size.width - insets.left - insets.right),
    height: Math.max(0, size.height - insets.top - insets.bottom),
  };
  const overlay = overlayAnchors(area, layout, shown.view.turn?.activePlayer === opponent);
  const field = withCombat(battlefieldCards(shown, area, me, layout, overlay), area, layout);
  const cards = [...field.cards, ...handCards(shown, area, layout)];
  return {
    width: size.width,
    height: size.height,
    cards,
    backs: cardBacks(shown.view.zones.players[opponent]?.handSize ?? 0, area, layout),
    libraries: libraryPiles(shown, area, opponent, layout),
    band: {
      x: 0,
      y: area.y + (layout.band.y - layout.band.h / 2) * area.height,
      width: size.width,
      height: layout.band.h * area.height,
    },
    links: field.links,
    overlay,
  };
}

function overlayAnchors(area: Rect, layout: BoardLayout, opponentsTurn: boolean): OverlayAnchors {
  const { portrait, life, mainButton } = layout;
  const button: Rect = {
    x: area.x + area.width - mainButton.right - mainButton.width,
    y: area.y + area.height - mainButton.bottom - mainButton.height,
    width: mainButton.width,
    height: mainButton.height,
  };
  const crestX = area.x + area.width / 2 - life.size / 2;
  const opponentCrest = { x: crestX, y: area.y + life.edge, width: life.size, height: life.size };
  const myCrest = { x: crestX, y: area.y + area.height - life.edge - life.size, width: life.size, height: life.size };
  return {
    portrait: {
      opponent: { x: area.x + portrait.inset, y: area.y + portrait.inset, width: portrait.size, height: portrait.size },
      mine: {
        x: area.x + portrait.inset,
        y: area.y + area.height - portrait.inset - portrait.size,
        width: portrait.size,
        height: portrait.size,
      },
    },
    life: { opponent: opponentCrest, mine: myCrest },
    mainButton: button,
    ladder: opponentsTurn ? ladderAroundCrest(opponentCrest, layout) : ladderOver(button, layout),
  };
}

/** The ladder in one pill, centred over the main button. */
function ladderOver(button: Rect, layout: BoardLayout): OverlayAnchors["ladder"] {
  const { icon, padding, gap } = layout.ladder;
  const width = PHASE_COUNT * icon + 2 * padding;
  const pill = {
    x: button.x + button.width / 2 - width / 2,
    y: button.y - gap - icon - 2 * padding,
    width,
    height: icon + 2 * padding,
  };
  const icons = Array.from({ length: PHASE_COUNT }, (_, i) => ({
    x: pill.x + padding + i * icon,
    y: pill.y + padding,
    width: icon,
    height: icon,
  }));
  return { side: "mine", icons, pills: [pill] };
}

/** The ladder parted around the opponent's crest [R]: the beginning and first main phase left of it, the rest right. */
function ladderAroundCrest(crest: Rect, layout: BoardLayout): OverlayAnchors["ladder"] {
  const { icon, padding, gap } = layout.ladder;
  const y = crest.y + crest.height / 2 - icon / 2;
  const leftCount = 2;
  const rightCount = PHASE_COUNT - leftCount;
  const leftPill = {
    x: crest.x - gap - leftCount * icon - 2 * padding,
    y: y - padding,
    width: leftCount * icon + 2 * padding,
    height: icon + 2 * padding,
  };
  const rightPill = {
    x: crest.x + crest.width + gap,
    y: y - padding,
    width: rightCount * icon + 2 * padding,
    height: icon + 2 * padding,
  };
  const icons = [
    ...Array.from({ length: leftCount }, (_, i) => ({
      x: leftPill.x + padding + i * icon,
      y,
      width: icon,
      height: icon,
    })),
    ...Array.from({ length: rightCount }, (_, i) => ({
      x: rightPill.x + padding + i * icon,
      y,
      width: icon,
      height: icon,
    })),
  ];
  return { side: "opponent", icons, pills: [leftPill, rightPill] };
}
