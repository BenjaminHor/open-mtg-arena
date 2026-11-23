// The shape of a board layout (D-152): every position and size the board model uses, as data. Shares are of the play
// area (the board inside its safe-area insets): `x`, `w`, `left`, `right` of its width; `y`, `h` of its height. Values
// marked px are CSS pixels. The compact layout (`compact.ts`) is the first; the full layout (M3-05) is a second value
// of this type, and the board model takes either.

export type BoardLayout = {
  /** Width-to-height ratios: a battlefield card (mostly art) and a whole card (hand, backs, libraries). */
  ratio: { battlefield: number; hand: number };
  /** The band across the middle that splits the two battlefields: its centre line and height. */
  band: { y: number; h: number };
  /**
   * The creature row by the band, centred, kept `margin` from each side. A row too wide for its space first shrinks
   * its cards, down to `minH`, and only then overlaps them.
   */
  creatures: { h: number; minH: number; gap: number; margin: number };
  /**
   * Lands in the outer row, from `left` up to `right` (and never under a life crest), one slot per name: a pile of the
   * untapped ones, and the tapped ones in a second pile `tappedShift` of a card's width to the right, so tapping a
   * land doesn't move the slots after it. Cards behind a pile's front show `pileStep` (of W) right and `pileLift` (of
   * H) up, as a library does.
   */
  lands: {
    h: number;
    gap: number;
    left: number;
    right: number;
    pileStep: number;
    pileLift: number;
    tappedShift: number;
  };
  /** Other non-creature permanents in the outer row, packed towards `right`, planeswalkers last. */
  others: { h: number; gap: number; left: number; right: number };
  /** Between a half's creature row and its outer row. */
  rowGap: number;
  /** A tapped permanent's tilt (radians) and how dark it's shaded (0 to 1). */
  tapped: { tilt: number; dim: number };
  /**
   * The person's hand, collapsed: `shown` of each card's height on screen, between `left` and `right`, parted
   * `crestGap` px around the person's life crest. Each card's mana cost floats above it, symbols of radius `cost` px,
   * smaller (to `minCost`) when its strip of the hand is narrow.
   */
  hand: {
    h: number;
    shown: number;
    left: number;
    right: number;
    mostStep: number;
    fan: number;
    arcDrop: number;
    crestGap: number;
    cost: number;
    minCost: number;
  };
  /** The opponent's hand as backs along the top edge, `shown` of their height on screen, centred at `centre`. */
  opponentHand: { h: number; shown: number; centre: number; step: number };
  /** Each library pile: its centre `x` and how much of it is on screen. */
  library: { h: number; opponent: { x: number; shown: number }; mine: { x: number; shown: number } };
  /** px: the portraits in the corners. */
  portrait: { size: number; inset: number };
  /** px: the life crests on the centre line, `edge` from the top and bottom edges. */
  life: { size: number; edge: number };
  /** px: the main button at the bottom right; rows on the person's side stop `clearance` short of it. */
  mainButton: { width: number; height: number; right: number; bottom: number; clearance: number };
  /** px: the phase ladder's icons, the padding of its pill, and its gap to the button or crest. */
  ladder: { icon: number; padding: number; gap: number };
  /** px: the space kept between the outer rows and the life crests. */
  crestClearance: number;
};
