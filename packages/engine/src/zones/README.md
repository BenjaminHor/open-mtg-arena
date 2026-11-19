# engine/src/zones

Zone primitives (CR 400). Everything that moves a card between zones uses `moveCard`, so later rules (replacement
effects, triggers, CR 614 and 603) have one place to hook in.

- `move-card.ts`: `moveCard(state, id, destination)`. The card becomes a new object with a new id (CR 400.7) and goes to
  its owner's library, hand or graveyard (CR 400.3), or a shared zone under a given controller. Emits `ZONE_CHANGED`.
- `draw.ts`: `drawCard`, `drawCards` (CR 121). Drawing from an empty library records the attempt (CR 121.4).
- `discard.ts`: `discardCards` (CR 701.9): discards them as one action, emitting `CARD_DISCARDED` for each.
- `shuffle.ts`: `shuffleLibrary`, a Fisher–Yates shuffle from the game's seeded RNG (CR 701.24).
- `zone-list.ts`: read or replace one zone's list, and find which zone an object is in.

Tests: through `test/game/start.test.ts` (draws, shuffles and moving cards to the bottom).
