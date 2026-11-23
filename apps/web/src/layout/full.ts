// The full board layout (ui.md, "Layouts"; M3-05, D-176): the unfolded phone (7.6-inch, nearly square, either way up),
// tablets and desktop. Arena's desktop match screen [R: arena-research.md, "Desktop match screen"]: battlefield cards
// about a tenth of the height, four bands between the players, the stack at the right edge, the hand's tops along the
// bottom. The same shape as the compact layout (`BoardLayout`, D-152); where a value is ours, not Arena's, it says
// [guess], and the UX review's tested values say so.

import type { BoardLayout } from "./board-layout.ts";

export const FULL: BoardLayout = {
  name: "full",
  // On a screen tall for its width (the unfolded phone upright), cards are shares of 0.86 of the width instead, so the
  // rows don't crowd [UX review].
  cardBasis: 0.86,
  ratio: { battlefield: 1.2, hand: 63 / 88 },
  // The centre line between the creature rows [R], tall enough for a prompt with a row of choices between them [UX
  // review].
  band: { y: 0.5, h: 0.1 },
  // Battlefield cards about 10-13% of the height [R]; a crowded row shrinks to 6% before it overlaps, and moves left
  // to end clear of the stack's column at the right edge [UX review].
  creatures: { h: 0.13, minH: 0.06, gap: 0.008, margin: 0.06, right: 0.8 },
  // Lands hug the left of their band, other permanents its right [R], a little smaller than creatures [UX review].
  lands: {
    h: 0.09,
    minH: 0.06,
    gap: 0.01,
    left: 0.03,
    right: 0.4,
    pileStep: 0.005,
    pileLift: 0.007,
    tappedShift: 0.6,
  },
  others: { h: 0.09, gap: 0.006, left: 0.42, right: 0.8 },
  rowGap: 0.025,
  tapped: { tilt: (8 * Math.PI) / 180, dim: 0.45 },
  sick: { dim: 0.32 },
  attach: { peek: 0.42 },
  // The hand's tops along the bottom centre, a quarter of each showing [R]; wide enough that each card's name reads
  // in its strip [UX review] (centred, so `left` and `right` mirror each other).
  hand: {
    h: 0.26,
    shown: 0.24,
    left: 0.24,
    right: 0.76,
    mostStep: 0.055,
    fan: (2 * Math.PI) / 180,
    arcDrop: 0.003,
    cost: 8,
    minCost: 5,
  },
  // Opened, smaller than the phone's: on a large screen the cards read well at a third of the height, and the
  // battlefield stays in sight [UX review].
  handOpen: {
    h: 0.34,
    shown: 0.9,
    left: 0.12,
    right: 0.8,
    mostStep: 0.11,
    fan: (3 * Math.PI) / 180,
    arcDrop: 0.004,
    cost: 10,
    minCost: 6,
  },
  // Backs along the top edge, mostly off screen [R].
  opponentHand: { h: 0.15, shown: 0.4, centre: 0.66, step: 0.014 },
  // The controls a size up from the phone's, for a mouse and a larger screen [UX review]; their text sizes follow in
  // app.css (`.hud[data-layout="full"]`).
  player: { width: 210, height: 50, inset: 8, gap: 10 },
  mainButton: { width: 176, height: 58, right: 14, bottom: 12, clearance: 10 },
  ladder: { icon: 26, padding: 2, gap: 8 },
  promptHeight: 28,
  promptTop: 64, // under the opponent's ladder [guess]
  promptChoicesHeight: 56, // a 44 px button, its panel's padding and the gap above [guess]
  secondary: { width: 120, height: 44, gap: 8 },
  minTap: 44,
  // The stack at the right edge, mid-height [R], its top card about 15% of a 16:9 width [R].
  stack: { x: 0.82, y: 0.22, h: 0.42, maxH: 380, maxW: 0.17, smallH: 0.26, smallY: 0.3, smallMaxH: 170, peek: 0.1 },
  // A lifted card large at the centre [R], half the height on a large screen [guess].
  lifted: { h: 0.5, top: 0.18 },
  combat: { advance: 0.03, gangOverlap: 0.25 },
};
