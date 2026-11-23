// The compact board layout (ui.md, "Layouts"; D-141): a phone in landscape, about 812×375 CSS px folded. Every
// position and size is here, so the look can be changed in one place (ui.md, "Feel"; D-012); the shape is
// `BoardLayout`. Where a value comes from the owner's phone screenshots (arena-research.md, "The owner's phone
// screenshots") it says [R]; where the screenshots don't show it and it's our guess, it says [guess].

import type { BoardLayout } from "./board-layout.ts";

export const COMPACT: BoardLayout = {
  // A battlefield card is a wide "art card", its art under a name strip (ui.md, "The cards"); a hand card is a whole
  // card, 63 by 88 mm.
  ratio: { battlefield: 1.2, hand: 63 / 88 },
  // The open table between the two creature rows, about 9% of the height in the owner's screenshots [R]; nothing is
  // drawn in it (ui.md, "Room between the battlefields").
  band: { y: 0.5, h: 0.1 },
  // Creatures, either side of the gap and centred [R], about 13% of the height in Arena [R]; a little more here, where
  // the screen is wider for its height.
  creatures: { h: 0.16, minH: 0.12, gap: 0.008, margin: 0.09 },
  // Lands at the outer left [R], piled by name [R]; smaller than creatures [guess].
  lands: { h: 0.12, gap: 0.014, left: 0.075, right: 0.54, pileStep: 0.007, pileLift: 0.008, tappedShift: 0.6 },
  // Other non-creature permanents at the outer right, planeswalkers at the right edge [guess, from the desktop map].
  others: { h: 0.14, gap: 0.006, left: 0.55, right: 0.985 },
  // Close enough that the person's outer row ends above the hand's floating mana costs.
  rowGap: 0.035,
  // A small tilt, dimmed, with a tap mark [R].
  tapped: { tilt: (8 * Math.PI) / 180, dim: 0.45 },
  // Summoning sick: dimmed less than tapped, as Arena shows it (the owner).
  sick: { dim: 0.32 },
  // Enough of an attached card to show its art and the start of its name [R: the owner's screenshot].
  attach: { peek: 0.42 },
  // Overlapped across the bottom centre (about 35–65% W [R], a little wider here so each card shows more), only the
  // top fifth showing [R].
  hand: {
    h: 0.34,
    shown: 0.2,
    left: 0.27,
    right: 0.73,
    mostStep: 0.07,
    fan: (2.5 * Math.PI) / 180,
    arcDrop: 0.004,
    cost: 7,
    minCost: 4.5,
  },
  // Opened by a tap [R]: the cards fan up across the width short of the main button, enough of each showing to read
  // its type line and the start of its text.
  handOpen: {
    h: 0.58,
    shown: 0.72,
    left: 0.06,
    right: 0.82,
    mostStep: 0.16,
    fan: (3.5 * Math.PI) / 180,
    arcDrop: 0.006,
    cost: 9,
    minCost: 6,
  },
  // Backs along the top edge, mostly off screen [R]; right of the opponent's ladder at the top centre and left of the
  // settings cog, their info block having the top left.
  opponentHand: { h: 0.2, shown: 0.42, centre: 0.72, step: 0.022 },
  // The opponent's at the top left, the person's at the bottom left, as the reference app (the owner): a label and the
  // life on one line, the counts under it, small (the owner: "too large"). Wide enough for
  // "52 Library  0 Graveyard  0 Exile" at 10 px.
  player: { width: 172, height: 40, inset: 6, gap: 8 },
  // Bottom right [R].
  mainButton: { width: 140, height: 48, right: 10, bottom: 8, clearance: 8 },
  // Over the main button, or at the top centre on the opponent's turn.
  ladder: { icon: 20, padding: 2, gap: 6 },
  promptHeight: 26,
  promptTop: 52,
  promptChoicesHeight: 56, // a 44 px button, its panel's padding and the gap above [guess]
  // "Undo", "Cancel" left of the main button, as Arena's "Cancel Blocks" sits by it [R].
  secondary: { width: 88, height: 44, gap: 6 },
  // A spell being cast, or an ability, large at the right of centre [R] (smaller than Arena's, the phone's board is full).
  // While choosing targets it shrinks to the right edge above the ladder, as Arena collapses it off the targets [R].
  stack: { x: 0.78, y: 0.16, h: 0.52, smallH: 0.3, smallY: 0.36, smallMaxH: 112, peek: 0.16 },
  // A lifted hand card rises large at the centre [R] (about 70% of the height).
  lifted: { h: 0.62, top: 0.15 },
  // An attacker steps forward into the open table [guess: Arena keeps attackers in their row, marked by a chevron;
  // a step reads at a glance on a small screen].
  combat: { advance: 0.035, gangOverlap: 0.25 },
};
