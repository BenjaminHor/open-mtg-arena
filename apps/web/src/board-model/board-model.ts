// The board model (ui.md, "Board structure"): what the person's seat is shown (`SeatView`) plus the screen size, turned
// into plain data: every card it draws with its place and state, and where the DOM overlay puts life totals,
// portraits, the phase ladder and the main button. The renderer draws it and does no layout of its own, so the layout
// is tested here without drawing anything. The layout's values are data (`BoardLayout`; the compact one by default).

import type { Color, ObjectId, PlayerId, SeatView, Step } from "@mtg/engine";
import type { BoardLayout } from "../layout/board-layout.ts";
import { COMPACT } from "../layout/compact.ts";
import { battlefieldCards } from "./battlefield.ts";
import { withCombat } from "./combat.ts";
import { handCards } from "./hand.ts";
import { cardBacks, libraryPiles } from "./hidden-cards.ts";
import { inCombat, type Ladder, ladderAroundCrest, ladderOver } from "./ladder.ts";
import { withPicks } from "./picks.ts";
import { playableIds } from "./playable.ts";
import { tapRegions } from "./regions.ts";
import { stackTop } from "./stack.ts";

export type BoardCard = {
  id: ObjectId;
  name: string;
  zone: "battlefield" | "hand" | "stack";
  /** Which row of the board it's in. */
  row: "creatures" | "lands" | "others" | "hand" | "stack";
  /** The front card of the pile it's in (its own id when it stands alone): a pile moves as one. */
  pileOf: ObjectId;
  /** Something the person can act with now: play, cast, activate, attack or block with (`playable.ts`). */
  playable: boolean;
  /**
   * Picked in the declaration under way, not yet declared: drawn as attacking or blocking already, with the
   * yellow-orange outline of a pick [R].
   */
  picked: boolean;
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
  /** A card behind the front of a pile: drawn as a plain edge, no name or badges, so the pile reads as one. */
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
  /** True for an artifact: a colourless one has a steel frame. */
  artifact: boolean;
  /** A token (CR 111.1): drawn with an arched top and no name strip, so it reads as one at a glance [R]. */
  token: boolean;
  /**
   * The image to draw, loaded at runtime (D-007): a permanent's art crop, a hand card's full card image. Null for a
   * token, which has none yet.
   */
  art: string | null;
  /** A hand card's type line and rules text, drawn whole as a printed card is (ui.md); empty on the battlefield. */
  typeLine: string;
  text: string;
  /** The printed mana cost's symbols, shown over a hand card (CR 107.4). Empty on the battlefield. */
  manaCost: string[];
  power: number | null;
  toughness: number | null;
  /** The printed power and toughness, so a changed one can be told apart; null for a token or a "*" value. */
  printed: { power: number | null; toughness: number | null };
  damage: number;
  /** On the front card of a pile (lands or creatures that look the same, piles.ts), how many it holds; null elsewhere. */
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
  /** The current turn's phase ladder, over the main button [R]. */
  ladder: Ladder;
  /** On the opponent's turn, their ladder around their life crest [R]; null on the person's turn. */
  opponentLadder: Ladder | null;
  /** The opponent's crest takes their ladder's combat slot, and glows while they're in combat [R]. */
  opponentInCombat: boolean;
  /** Where the hand shows on screen, its mana costs included: a tap there opens or closes it. Null with no hand. */
  hand: Rect | null;
  /** The small buttons beside the main one ("Undo", "Cancel"), right to left from the main button. */
  secondary: Rect[];
  /** The centre of what the game is waiting for, in words, between the battlefields [R]. */
  prompt: Point;
};

export type BoardModel = {
  width: number;
  height: number;
  /** In drawing order, back to front. */
  cards: BoardCard[];
  backs: CardBack[];
  libraries: LibraryPile[];
  /** The open table between the two creature rows [R], the board's whole width: drawn as nothing, kept for layout. */
  band: Rect;
  /**
   * Combat's links, where position can't show a pairing: a lone blocker pushed out from under the attacker it blocks,
   * an attacker to the planeswalker it attacks (D-154).
   */
  links: CombatLink[];
  overlay: OverlayAnchors;
  /**
   * Where a tap lands on what, topmost last: a pile is one region (its front card's), an open hand card its visible
   * strip, the lifted card all of it. The collapsed hand is `overlay.hand`, one region that opens it.
   */
  regions: { id: ObjectId; rect: Rect; members: ObjectId[] }[];
};

/** A line from one card's band-side edge to another's: a block (blocker to attacker) or an attack on a planeswalker. */
export type CombatLink = { kind: "block" | "attack"; from: Point; to: Point };

export type BoardSize = { width: number; height: number };
/** The safe-area insets (`env(safe-area-inset-*)`, ui.md "Layouts"): the board is drawn full-bleed, laid out inside. */
export type Insets = { top: number; right: number; bottom: number; left: number };

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * What the person has opened or chosen on screen, apart from the game: the hand open or not, and the card lifted
 * from it or the blocker picked (interaction/controls.ts), which the board lays out differently.
 */
export type BoardUi = { handOpen: boolean; selected?: ObjectId | null; highlight?: readonly ObjectId[] };

export function boardModel(
  shown: SeatView,
  size: BoardSize,
  insets: Insets = NO_INSETS,
  ui: BoardUi = { handOpen: false },
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
  const turn = shown.view.turn;
  const overlay = overlayAnchors(area, layout, turn?.step ?? null, turn?.activePlayer === opponent);
  const field = withCombat(withPicks(shown, battlefieldCards(shown, area, me, layout, overlay)), area, layout);
  const playable = playableIds(shown);
  const hand = handCards(shown, area, layout, ui.handOpen, ui.selected ?? null);
  const stack = stackTop(shown, area, layout);
  const cards = [...field.cards, ...stack, ...hand].map((c) => ({
    ...c,
    playable: playable.has(c.id) || (ui.highlight ?? []).includes(c.id),
    picked: c.picked || c.id === ui.selected,
  }));
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
    overlay: {
      ...overlay,
      hand: handArea(hand, area),
      prompt: promptPlace(shown, ui.handOpen, field.cards, overlay, area, layout),
    },
    regions: tapRegions(field.cards, hand, ui.handOpen, ui.selected ?? null),
  };
}

function overlayAnchors(area: Rect, layout: BoardLayout, step: Step | null, opponentsTurn: boolean): OverlayAnchors {
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
    ladder: ladderOver(button, step, layout),
    opponentLadder: opponentsTurn ? ladderAroundCrest(opponentCrest, step, layout) : null,
    opponentInCombat: opponentsTurn && step !== null && inCombat(step),
    hand: null,
    secondary: [0, 1].map((i) => ({
      x: button.x - (i + 1) * (layout.secondary.width + layout.secondary.gap),
      y: button.y + button.height - layout.secondary.height,
      width: layout.secondary.width,
      height: layout.secondary.height,
    })),
    prompt: { x: area.x + area.width / 2, y: area.y + layout.band.y * area.height },
  };
}

/**
 * Where the words of what the game waits for go: in the open table between the two creature rows, where nothing is
 * drawn; or, when combat has filled that gap (attackers step into it), under the opponent's life crest, so the banner
 * never covers a card's power/toughness.
 */
function promptPlace(
  shown: SeatView,
  handOpen: boolean,
  field: readonly BoardCard[],
  overlay: OverlayAnchors,
  area: Rect,
  layout: BoardLayout,
): Point {
  const crest = overlay.life.opponent;
  const underCrest = { x: area.x + area.width / 2, y: crest.y + crest.height + layout.promptHeight / 2 + 4 };
  // While attackers or blockers are declared, creatures step into the gap as they're picked: the prompt stays put
  // under the crest rather than jump when the first one moves.
  const kind = shown.view.decision?.kind;
  if (kind === "declareAttackers" || kind === "declareBlockers") return underCrest;
  // Naming a card is a long list with a filter box: it starts high, so the list has the screen's height to use. An
  // open hand rises over the lower half (a mulligan, a discard): the prompt goes high, clear of the cards' names.
  if (kind === "chooseName" || handOpen) return underCrest;
  const creatures = field.filter((c) => c.row === "creatures");
  const theirs = creatures.filter((c) => !c.mine).map((c) => c.y + c.height);
  const mine = creatures.filter((c) => c.mine).map((c) => c.y);
  const top = theirs.length === 0 ? area.y + layout.band.y * area.height - 30 : Math.max(...theirs);
  const bottom = mine.length === 0 ? area.y + layout.band.y * area.height + 30 : Math.min(...mine);
  if (bottom - top >= layout.promptHeight) return { x: area.x + area.width / 2, y: (top + bottom) / 2 };
  return underCrest;
}

/** The part of the screen the hand covers: from its leftmost card to its rightmost, its costs to the bottom edge. */
function handArea(hand: readonly BoardCard[], area: Rect): Rect | null {
  if (hand.length === 0) return null;
  const left = Math.min(...hand.map((c) => c.x));
  const right = Math.max(...hand.map((c) => c.x + c.width));
  const top = Math.min(...hand.map((c) => c.y - 2 * c.costRadius));
  return { x: left, y: top, width: right - left, height: area.y + area.height - top };
}
