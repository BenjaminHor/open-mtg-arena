// The board model (ui.md, "Board structure"): what the person's seat is shown (`SeatView`) plus the screen size, turned
// into plain data: every card it draws with its place and state, and where the DOM overlay puts life totals,
// portraits, the phase ladder and the main button. The renderer draws it and does no layout of its own, so the layout
// is tested here without drawing anything. The layout's values are data (`layout/compact.ts`).

import type { Color, ObjectId, PlayerId, SeatView } from "@mtg/engine";
import { COMPACT } from "../layout/compact.ts";
import { battlefieldCards } from "./battlefield.ts";
import { handCards } from "./hand.ts";
import { cardBacks, libraryPiles } from "./hidden-cards.ts";

export type BoardCard = {
  id: ObjectId;
  name: string;
  zone: "battlefield" | "hand";
  /** Controlled by the person whose board this is. */
  mine: boolean;
  /** The card's rectangle, in CSS pixels from the board's top left, before it's turned by `rotation`. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radians, about the card's centre: a tapped permanent's tilt, a hand card's place in the fan. */
  rotation: number;
  alpha: number;
  tapped: boolean;
  colors: readonly Color[];
  /** True for a land: drawn with a land's frame. */
  land: boolean;
  /** The art to draw, loaded at runtime (D-007); null for a token, which has none yet. */
  art: string | null;
  /** The printed mana cost's symbols, shown over a hand card (CR 107.4). Empty on the battlefield. */
  manaCost: string[];
  power: number | null;
  toughness: number | null;
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

/** Where the DOM overlay places its pieces, in the same CSS pixels as the cards. */
export type OverlayAnchors = {
  portrait: { mine: Rect; opponent: Rect };
  /** Each life crest's centre. */
  life: { mine: Point; opponent: Point };
  mainButton: Rect;
  /**
   * On the person's turn, the phase ladder's bottom centre, over the main button; on the opponent's, the centre of
   * their life crest, which the ladder sits around [R].
   */
  ladder: Point;
  ladderSide: "mine" | "opponent";
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
  overlay: OverlayAnchors;
};

export type BoardSize = { width: number; height: number };
/** The safe-area insets (`env(safe-area-inset-*)`, ui.md "Layouts"): the board is drawn full-bleed, laid out inside. */
export type Insets = { top: number; right: number; bottom: number; left: number };

/** The part of the board the layout's shares are taken of. */
export type PlayArea = { x: number; y: number; w: number; h: number };

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function boardModel(shown: SeatView, size: BoardSize, insets: Insets = NO_INSETS): BoardModel {
  const me = shown.player;
  // Two players for now (M3); a multiplayer layout would place each opponent (later: CR 800).
  const opponent = shown.view.turnOrder.find((p) => p !== me) ?? me;
  const area: PlayArea = {
    x: insets.left,
    y: insets.top,
    w: Math.max(0, size.width - insets.left - insets.right),
    h: Math.max(0, size.height - insets.top - insets.bottom),
  };
  const cards = [...battlefieldCards(shown, area, me), ...handCards(shown, area)];
  return {
    width: size.width,
    height: size.height,
    cards,
    backs: cardBacks(shown.view.zones.players[opponent]?.handSize ?? 0, area),
    libraries: libraryPiles(shown, area, opponent),
    band: {
      x: 0,
      y: area.y + (COMPACT.band.y - COMPACT.band.h / 2) * area.h,
      width: size.width,
      height: COMPACT.band.h * area.h,
    },
    overlay: overlayAnchors(area, shown.view.turn?.activePlayer === opponent),
  };
}

function overlayAnchors(area: PlayArea, opponentsTurn: boolean): OverlayAnchors {
  const { portrait, life, mainButton } = COMPACT;
  const button: Rect = {
    x: area.x + area.w - mainButton.right - mainButton.width,
    y: area.y + area.h - mainButton.bottom - mainButton.height,
    width: mainButton.width,
    height: mainButton.height,
  };
  const opponentLife = { x: area.x + area.w / 2, y: area.y + life.opponentY * area.h + life.size / 2 + 2 };
  return {
    portrait: {
      opponent: { x: area.x + portrait.inset, y: area.y + portrait.inset, width: portrait.size, height: portrait.size },
      mine: {
        x: area.x + portrait.inset,
        y: area.y + area.h - portrait.inset - portrait.size,
        width: portrait.size,
        height: portrait.size,
      },
    },
    life: {
      opponent: opponentLife,
      mine: { x: area.x + area.w / 2, y: area.y + life.mineY * area.h - life.size / 2 - 2 },
    },
    mainButton: button,
    ladder: opponentsTurn ? opponentLife : { x: button.x + button.width / 2, y: button.y - COMPACT.ladder.gap },
    ladderSide: opponentsTurn ? "opponent" : "mine",
  };
}
