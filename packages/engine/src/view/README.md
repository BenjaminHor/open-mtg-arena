# engine/src/view

What one player may know of the game (CR 400.2: libraries and hands are hidden zones). The UI and the AI get views,
never the state (docs/architecture.md, "Hidden information"; D-044).

- `player-view.ts`: `playerView(state, viewer)`: objects in public zones and the viewer's own hand; other hands and
  every library only as counts; the viewer's own pending `decision`, and `waitingFor` for anyone's; no random
  generator state, setup, work queue or id counters. A view shares structure with the state: never change it.
- `events-for.ts`: `eventsFor(events, viewer)`: events that would reveal a hidden card (another player's draw, a card
  moving between hidden zones) lose the card's identity, and a card moving between a zone the viewer sees and one
  they don't shows only the side they see (`CARD_CAME_INTO_VIEW`, `CARD_LEFT_VIEW`, D-054).
- `visibility.ts`: `canSee(zone, viewer)`, the one rule both use.

Tests: `test/view/player-view.test.ts` checks the shapes and each kind of move. That a view doesn't change when only
hidden information changes is checked as a property after every action of every fuzzed game, by `viewsLeakNothing` in
`packages/cli/src/fuzz/checks.ts` (D-046).
