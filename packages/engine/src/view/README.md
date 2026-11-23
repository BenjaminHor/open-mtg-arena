# engine/src/view

What one player may know of the game (CR 400.2: libraries and hands are hidden zones). The UI and the AI get views,
never the state (docs/architecture.md, "Hidden information"; D-044).

- `player-view.ts`: `playerView(state, viewer, cards)`: objects in public zones and the viewer's own hand; other hands
  and every library only as counts, but for what an ability reveals to everyone (`revealedHand`, `revealedTop`, by
  identity only, `rules/revealed.ts`); the viewer's own pending `decision`, and `waitingFor` for anyone's; no random
  generator state, setup, work queue or id counters. A view shares structure with the state: never change it.
- `seen-objects.ts`: `seenObjects(state, view, cards)`: what the viewer sees of each object in their view, with the
  values the layer system derives (characteristics, summoning sickness, combat roles, regeneration shields, a spell's
  choices), keyed by id.
  The host sends it beside the view (D-135), so the UI, the heuristic AI and the LLM opponent read one source (D-137).
  Kept out of `playerView`, which stays a plain filter of the state.
- `seat-view.ts`: `seatView(state, player, cards)`: what a seat is shown when it decides (D-144): the view, the seen
  objects, and the legal actions as options with their mana cost, whether they can be paid now, their legal targets,
  an activation's ability, and whether a declaration could finish after a pick. What the heuristic AI reads, and what
  the app's Worker will post to the UI.
- `events-for.ts`: `eventsFor(events, viewer)`: events that would reveal a hidden card (another player's draw, a card
  moving between hidden zones) lose the card's identity, and a card moving between a zone the viewer sees and one
  they don't shows only the side they see (`CARD_CAME_INTO_VIEW`, `CARD_LEFT_VIEW`, D-054).
- `view-decision.ts`: `viewDecision`: a `chooseCards` decision's options are shown by what each card is, with its
  object id only when the viewer sees the card anyway (their own hand), and without the effect it resumes (D-062).
  `CARDS_REVEALED` events carry identities only, so `eventsFor` passes them to everyone.
- `visibility.ts`: `canSee(zone, viewer)`, the one rule both use.

Tests: `test/view/player-view.test.ts` checks the shapes and each kind of move; `test/effects/choose-cards.test.ts`
plays two games that differ only in what one player can't see and checks that player sees the same (D-062). That a view doesn't change when only
hidden information changes is checked as a property after every action of every fuzzed game, by `viewsLeakNothing` in
`packages/cli/src/fuzz/checks.ts` (D-046).
