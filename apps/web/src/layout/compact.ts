// The compact board layout (ui.md, "Layouts"; D-141): a phone in landscape, about 812×375 CSS px folded. Every
// position and size is here, as a share of the play area's width (W) or height (H), so the look can be changed in one
// place (ui.md, "Feel"; D-012). Where a value comes from the owner's phone screenshots (arena-research.md, "The owner's
// phone screenshots") it says [R]; where the screenshots don't show it and it's our guess, it says [guess].
// The full layout (M3-05) will be a second object of this same shape.

/** A share of the play area: `x` and `w` of its width, `y` and `h` of its height. */
export type Share = { x: number; y: number; w: number; h: number };

export const COMPACT = {
  /** Cards are drawn with these width-to-height ratios: a battlefield card shows mostly art [R]; a hand card is a whole card. */
  ratio: { battlefield: 0.78, hand: 63 / 88 },

  /** The band across the middle that splits the two battlefields [R]. */
  band: { y: 0.5, h: 0.03 },

  /** Creatures, close to the band and centred [R]. Height as a share of H. */
  creatures: { h: 0.22, gap: 0.006, margin: 0.1 },
  /** Lands, further out at the left of each half [R], piled by name [R]. Smaller than creatures [guess]. */
  lands: { h: 0.15, gap: 0.006, left: 0.075, right: 0.5, pileStep: 0.012 },
  /** Other non-creature permanents at the outer right, planeswalkers at the right edge [guess, from the desktop map]. */
  others: { h: 0.15, gap: 0.006, left: 0.55, right: 0.985 },
  /** Between a half's creature row and its outer row. */
  rowGap: 0.015,

  /** A tapped permanent tilts a little and dims, with a tap mark over it [R]. */
  tapped: { tilt: (8 * Math.PI) / 180, alpha: 0.55 },

  /** The person's hand, collapsed: overlapped across the bottom centre, only its top showing [R]. */
  hand: { h: 0.42, shown: 0.2, left: 0.33, right: 0.67, mostStep: 0.07, fan: (2.5 * Math.PI) / 180, arcDrop: 0.004 },
  /** The opponent's hand: card backs along the top edge, left of centre, mostly off screen [R]. */
  opponentHand: { h: 0.2, shown: 0.42, centre: 0.33, step: 0.022 },

  /** Each library is a face-down pile: the opponent's at the top edge near 67% W, the person's near 24% W [R]. */
  library: { h: 0.17, opponent: { x: 0.67, shown: 0.5 }, mine: { x: 0.24, shown: 0.5 } },

  /** Small squares in the corners: the opponent's top left, the person's bottom left [R]. In px, not shares. */
  portrait: { size: 46, inset: 6 },
  /** Life totals, round crests on the centre line: top centre and bottom centre, the person's over the hand [R]. */
  life: { size: 50, opponentY: 0.0, mineY: 1.0 },

  /** The phase ladder over the main button at the bottom right on the person's turn [R]. In px from the edges. */
  mainButton: { width: 120, height: 40, right: 10, bottom: 10, clearance: 8 },
  ladder: { gap: 6 },
} as const;

export type CompactLayout = typeof COMPACT;
