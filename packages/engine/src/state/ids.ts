// Identifiers. Each kind of id has its own string shape, so TypeScript won't let one be
// used where another is expected, and ids stay readable in state dumps and CLI output.

/** A player, for example `p1`. Players are listed in turn order in `GameState.turnOrder`. */
export type PlayerId = `p${number}`;

/**
 * One game object (CR 109.1): a card in a zone, a spell, a permanent, or an ability on the stack.
 * When a card changes zones it becomes a new object with a new `ObjectId` (CR 400.7).
 * Rules logic always works with `ObjectId`s.
 */
export type ObjectId = `o${number}`;

/**
 * One physical card from a deck (later, also a token that was created). It stays the same as the card moves between
 * zones, so the UI can follow it, except that a card coming out of a hand or library into a public zone gets a new one
 * (D-054). Rules logic never uses it (CR 400.7).
 */
export type CardId = `c${number}`;

/** A pending decision. An answer must echo it, so a stale answer is rejected. */
export type DecisionId = `d${number}`;

/** Scryfall's `oracle_id`: which card this is, independent of printing. Keys the `CardDatabase`. */
export type OracleId = string;
