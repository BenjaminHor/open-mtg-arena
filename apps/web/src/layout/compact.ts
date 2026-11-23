// The compact board layout (ui.md, "Layouts"; D-141): a phone in landscape, about 812×375 CSS px folded. Every
// position and size is here, so the look can be changed in one place (ui.md, "Feel"; D-012); the shape is
// `BoardLayout`. Where a value comes from the owner's phone screenshots (arena-research.md, "The owner's phone
// screenshots") it says [R]; where the screenshots don't show it and it's our guess, it says [guess].

import type { BoardLayout } from "./board-layout.ts";

export const COMPACT: BoardLayout = {
  // A battlefield card is a wide "art card", its art under a name strip (ui.md, "The cards"); a hand card is a whole
  // card, 63 by 88 mm.
  ratio: { battlefield: 1.15, hand: 63 / 88 },
  // The band across the middle [R].
  band: { y: 0.5, h: 0.03 },
  // Creatures, close to the band and centred [R].
  creatures: { h: 0.2, minH: 0.15, gap: 0.008, margin: 0.09 },
  // Lands at the outer left [R], piled by name [R]; smaller than creatures [guess].
  lands: { h: 0.13, gap: 0.008, left: 0.075, right: 0.5, pileStep: 0.007, pileLift: 0.008, tappedShift: 0.45 },
  // Other non-creature permanents at the outer right, planeswalkers at the right edge [guess, from the desktop map].
  others: { h: 0.13, gap: 0.006, left: 0.55, right: 0.985 },
  // Close enough that the person's outer row ends above the hand's floating mana costs.
  rowGap: 0.01,
  // A small tilt, dimmed, with a tap mark [R].
  tapped: { tilt: (8 * Math.PI) / 180, dim: 0.45 },
  // Overlapped across the bottom centre (about 35–65% W [R], a little wider here so each card shows more), only the
  // top fifth showing [R], parted around the life crest that sits over it [R].
  hand: {
    h: 0.34,
    shown: 0.2,
    left: 0.27,
    right: 0.73,
    mostStep: 0.07,
    fan: (2.5 * Math.PI) / 180,
    arcDrop: 0.004,
    crestGap: 58,
    cost: 7,
    minCost: 4.5,
  },
  // Backs along the top edge, left of centre, mostly off screen [R]; clear of the ladder on the opponent's turn.
  opponentHand: { h: 0.2, shown: 0.42, centre: 0.3, step: 0.022 },
  // The opponent's library at the top edge near 67% W, the person's near 24% W [R].
  library: { h: 0.17, opponent: { x: 0.67, shown: 0.5 }, mine: { x: 0.24, shown: 0.5 } },
  // Small squares, the opponent's top left, the person's bottom left [R].
  portrait: { size: 46, inset: 6 },
  // Round crests at top centre and bottom centre, the person's over the hand [R].
  life: { size: 50, edge: 0 },
  // Bottom right [R].
  mainButton: { width: 140, height: 48, right: 10, bottom: 8, clearance: 8 },
  // Over the main button, or around the opponent's crest on their turn [R].
  ladder: { icon: 20, padding: 2, gap: 6 },
  crestClearance: 6,
};
