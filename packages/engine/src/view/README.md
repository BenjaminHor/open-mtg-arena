# engine/src/view

What one player may know of the game (CR 400.2: libraries and hands are hidden zones). The UI and the AI get views,
never the state (docs/architecture.md, "Hidden information").

- `player-view.ts`: `playerView(state, viewer)`: objects in public zones and the viewer's own hand; other hands and
  every library only as counts; no random generator state, setup, work queue or id counters.
- `events-for.ts`: `eventsFor(events, viewer)`: events that would reveal a hidden card (another player's draw, a card
  moving between hidden zones) lose the card's identity.

A view must not change when only hidden information changes. `test/view/player-view.test.ts` checks that by scrambling
what the viewer can't see; the fuzzer (M1-18) checks it on every state of every game.
