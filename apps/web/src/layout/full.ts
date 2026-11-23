// The full board layout (ui.md, "Layouts"; M3-05, D-176): the unfolded phone (7.6-inch, nearly square, either way up),
// tablets and desktop. Arena's desktop match screen [R: arena-research.md, "Desktop match screen"]: battlefield cards
// about a tenth of the height, four bands between the players, the stack at the right edge, the hand's tops along the
// bottom. The same shape as the compact layout (`BoardLayout`, D-152); where a value is ours, not Arena's, it says
// [guess].

import type { BoardLayout } from "./board-layout.ts";

export const FULL: BoardLayout = {
  name: "full",
  ratio: { battlefield: 1.2, hand: 63 / 88 },
  // The centre line between the creature rows [R], a little narrower than the phone's: the screen has more room.
  band: { y: 0.5, h: 0.08 },
  // Battlefield cards about 10-12% of the height [R]; a crowded row shrinks to 8% before it overlaps, and keeps clear
  // of the stack's column at the right edge.
  creatures: { h: 0.13, minH: 0.08, gap: 0.008, margin: 0.14 },
  // Lands hug the left of their band [R], a little smaller than creatures [guess].
  lands: {
    h: 0.11,
    minH: 0.07,
    gap: 0.01,
    left: 0.03,
    right: 0.52,
    pileStep: 0.005,
    pileLift: 0.007,
    tappedShift: 0.6,
  },
  // Other permanents at the right of the outer band [R], short of the stack's column at the right edge.
  others: { h: 0.11, gap: 0.006, left: 0.54, right: 0.8 },
  rowGap: 0.025,
  tapped: { tilt: (8 * Math.PI) / 180, dim: 0.45 },
  sick: { dim: 0.32 },
  attach: { peek: 0.42 },
  // The hand's tops along the bottom centre, 15-25% of each showing [R]; a card about 9-10% of a 16:9 width [R].
  hand: {
    h: 0.26,
    shown: 0.24,
    left: 0.3,
    right: 0.7,
    mostStep: 0.055,
    fan: (2 * Math.PI) / 180,
    arcDrop: 0.003,
    cost: 8,
    minCost: 5,
  },
  handOpen: {
    h: 0.44,
    shown: 0.75,
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
  player: { width: 172, height: 40, inset: 8, gap: 10 },
  // Bottom right [R], a little larger than the phone's [guess].
  mainButton: { width: 156, height: 52, right: 14, bottom: 12, clearance: 10 },
  ladder: { icon: 22, padding: 2, gap: 8 },
  promptHeight: 28,
  promptTop: 60,
  promptChoicesHeight: 56,
  secondary: { width: 96, height: 44, gap: 8 },
  minTap: 44,
  // The stack at the right edge, mid-height [R], its top card about 15% of a 16:9 width [R].
  stack: { x: 0.82, y: 0.22, h: 0.42, maxH: 380, maxW: 0.17, smallH: 0.26, smallY: 0.3, smallMaxH: 170, peek: 0.1 },
  lifted: { h: 0.5, top: 0.18 },
  combat: { advance: 0.03, gangOverlap: 0.25 },
};
