# engine/src/zones

Zone primitives (CR 400). `moveCard`, `drawCard`, `discardCard` and `shuffleLibrary` perform the event pipeline's
events (`pipeline/`, D-056) and are called only by it: code that moves a card proposes a `moveCard` event with
`happen`, so replacement effects and triggers (CR 614, 603) see every move.

- `move-card.ts`: `moveCard(state, id, destination)`. The card becomes a new object with a new id (CR 400.7) and goes to
  its owner's library, hand or graveyard (CR 400.3), or a shared zone under a given controller. Emits `ZONE_CHANGED`.
  It also ends the effects lasting "for as long as [it] remains on the battlefield" as a permanent leaves (CR 611.2b), and
  makes the effect a permanent "is" as it enters (`Destination.is`, CR 611.2e), emitting `EFFECT_ENDED` and
  `EFFECT_CREATED` (D-095).
- `draw.ts`: `drawCard` (CR 121): one card. Drawing from an empty library records the attempt (CR 121.4).
- `discard.ts`: `discardCard` (CR 701.9), emitting `CARD_DISCARDED`. Several cards discarded together are one
  `simultaneous` event.
- `reveal.ts`: `reveal` (CR 701.20a), emitting `CARDS_REVEALED` with the cards' identities only; nothing moves
  (CR 701.20b). `shown-order.ts`: `inShownOrder`, the fixed order (oracle id, then object id) cards are shown in
  outside their own zone's order, which would tell how they got there (D-062).
- `reorder-library.ts`: `reorderLibraryTop`, putting a library's top cards back in a chosen order (CR 401.4); nothing
  leaves the library.
- `shuffle.ts`: `shuffleLibrary`, a Fisher–Yates shuffle from the game's seeded RNG (CR 701.24).
- `counter.ts`: `counterObject` (CR 701.6a): a countered spell goes to its owner's graveyard, an ability ceases to
  exist; performs the pipeline's `counterObject` event.
- `stack-abilities.ts`: `putAbilityOnStack` (CR 602.2a) and `removeAbilityFromStack`: an ability isn't a card, so it
  doesn't change zones; it's created on the stack and ceases to exist (CR 608.2n, 608.2b).
- `zone-list.ts`: read or replace one zone's list, and find which zone an object is in.

Tests: through `test/game/start.test.ts` (draws, shuffles and moving cards to the bottom).
