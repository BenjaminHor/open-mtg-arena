# engine/src/effects

The effects interpreter: what the effect data in card definitions (`Effect` in `cards/types.ts`) does when a spell or
ability resolves (CR 608.2c), and the primitives it's built from. Card definitions never contain code; this folder is
the one place their effects become changes to the game.

## How an effect runs

1. As a spell starts to resolve, `resolveTopOfStack` (`game/resolve.ts`) checks its targets once (CR 608.2b) and
   queues one `runEffect` work item per effect, in the order written (CR 608.2c). Each carries an `EffectContext`:
   the object "this" refers to, the controller ("you"), and the targets still legal, one group per instance of
   "target". Illegal targets aren't affected.
2. `runEffect(state, effect, context, cards, chosen)` (`run-effect.ts`) switches on the effect's `op`. `chosen` is
   null, except when an effect that waited for a `chooseCards` decision runs again with the cards chosen.
3. Mana abilities don't use the stack (CR 605.3b), so `mana/activate.ts` calls `runEffect` directly, with no targets.

## Effect ops

| `op` | Card text | What it does |
| --- | --- | --- |
| `dealDamage` | "[from] deals N damage to [to]" | `from` (one object) deals `amount` to each player or creature `to` names, through `dealDamage`; `and` adds recipients of the same action with their own amounts, all one damage event (CR 608.2f) |
| `addMana` | "Add {G}." | Adds `amount` of `mana` to the controller's pool (CR 106.4, 109.5), naming `self` as its source; `"anyColor"` is replaced by the color the activation chose (D-068) |
| `sacrifice` | "Each opponent sacrifices a land of their choice" | The player chooses one permanent they control that fits, then sacrifices it (CR 701.21a, D-068) |
| `modifyPT` | "gets +N/+N until end of turn" | Creates a layer 7c continuous effect (CR 613.4c) on the objects `of` names, fixed now (CR 611.2c) |
| `mustAttack` | "attacks you this turn if able" | Creates a continuous effect `declaration-rules.ts` reads as a requirement (CR 508.1d) on the targets still legal; targets only for now |
| `cantBlock` | "can't block this turn" | Creates a continuous effect `canBlock` reads (CR 509.1b) on the targets still legal (CR 608.2b); targets only for now |
| `destroy` | "Destroy target creature" | Destroys each permanent `of` names (CR 701.8a) |
| `destroyAll` | "Destroy all nonland permanents" | Destroys every permanent fitting `filter`, decided once, at the same time (CR 608.2f, 608.2h) |
| `exile` | "Exile target permanent" | Moves each object `of` names to exile (CR 701.13a) |
| `returnToHand` | "Return target creature to its owner's hand" | Moves it to its owner's hand (CR 400.3) |
| `putOnTopOfLibrary` | "Put target creature on top of its owner's library" | Moves it to the top of its owner's library |
| `tap` | "Tap target creature" | Taps each permanent `of` names; a tapped one stays as it is (CR 701.26a) |
| `counter` | "Counter target spell" | Counters each spell or ability `of` names (CR 701.6a) |
| `gainLife` | "You gain 4 life" | The players `who` names gain `amount` (CR 119.3) |
| `loseLife` | "Target player loses 2 life" | The players `who` names lose `amount` (CR 119.3); 0 isn't proposed |
| `draw` | "Draw two cards" | One draw at a time (CR 121.2), all of one player's before the next player's, in APNAP order (CR 121.2c) |
| `discardAtRandom` | "Discards X cards at random" | Picks with the seeded RNG, each player in APNAP order, then discards them all at once (CR 701.9b; Burning Inquiry's ruling) |
| `discard` | "Target player discards two cards" | The player chooses (CR 701.9b), or "you" with `chosenBy` and a `filter` (Duress); a smaller hand is discarded whole without asking (CR 609.3) |
| `revealHand` | "Target opponent reveals their hand" | Shows the hand's cards to everyone, by identity only (CR 701.20a, D-062) |
| `putOntoBattlefield` | "You may put a creature card from your hand onto the battlefield" | Under the controller's control (CR 110.2a), not cast; asked whenever the hand isn't empty (D-062) |
| `search` | "Search your library for a basic land card" | "You" choose among the library's cards fitting `filter` (or with the name of a card exiled this way), shown the whole library by identity (CR 701.23a, D-062); finds `"found"`, moves nothing |
| `reveal` | "Reveal it" | Shows the cards to everyone, by identity (CR 701.20a) |
| `put` | "Put that card onto the battlefield tapped" | Into the owner's hand, or onto the battlefield under the controller, `tapped` as part of the move (CR 110.2a, 110.5b) |
| `shuffle` / `mayShuffle` | "Then shuffle" / "You may shuffle" | Shuffles (CR 701.24a); `mayShuffle` asks yes or no first |
| `lookAtTop` | "Look at the top three cards of your library, then put them back in any order" | The player is shown them and puts them back top first (CR 701.20e, 401.4) |
| `exileGraveyard` | "Exile all cards from target player's graveyard other than basic land cards" | Exiles the cards fitting `filter` at once, kept as "exiled this way" (CR 608.2c) |
| `mill` | "Target player mills five cards" | The top N of each player's library to its graveyard at once, all there are if fewer (CR 701.17a, 701.17b); `"halfTheirLibrary"` rounds down (CR 107.1a) |

Which move op to use: `returnToHand` for a target bounced to its owner's hand; `put` for cards an earlier `search`
found (`"found"`), into the hand or onto the battlefield; `putOntoBattlefield` when the player chooses a card from
their hand as the effect resolves (Elvish Piper); `exile` for either.

Every op that acts on objects skips one that's no longer where it was when the targets were checked: it's a new object
now, and acting on it is impossible (CR 101.3, 400.7). `"you"` names the controller (CR 109.5); `"eachPlayer"` names
every player in APNAP order (CR 101.4).

`from`, `to`, `of` and `who` are `EffectSubject`s: `"self"`, `"you"`, `"eachPlayer"`, `"found"` (what an earlier
`search` of this resolution found, kept in `GameState.resolution`, D-064), `{ each: filter }` (every permanent fitting
it now, CR 608.2h), or `{ target: i }` for the still-legal targets of the i-th instance of "target". A subject with no
legal targets left means that part does nothing (CR 608.2b). Amounts are a number, `"X"`, or `{ count: filter }`.
`subjects.ts` reads both (D-067).

## Primitives

| File | What it does |
| --- | --- |
| `deal-damage.ts` | `dealDamage(state, damage[], cards)`, performing the pipeline's `dealDamage` event: every damage in the game goes through it (CR 120.4), its results included. Life loss for a player (CR 120.3a), damage marked on a creature (CR 120.3e); 0 damage is dropped before it gets here (CR 120.8); only players and creatures can be dealt damage (CR 120.1a). Emits `DAMAGE_DEALT` |
| `life.ts` | `loseLife(state, player, amount)` (CR 119.3), emitting `LIFE_LOST`. Reaching 0 life is checked later, as a state-based action (CR 704.5a) |
| `continuous-effect.ts` | `createContinuousEffect(state, effect)`: gives it a timestamp (CR 613.7b) and adds it to `GameState.effects`, emitting `EFFECT_CREATED`. `characteristics()` applies it (`rules/power-toughness.ts`). `endUntilEndOfTurnEffects` ends them in cleanup (CR 514.2), emitting `EFFECT_ENDED` |

`dealDamage` and `loseLife` are called only by the event pipeline (`pipeline/`, D-056); `runEffect` proposes its
events to it with `happen`, as do turn steps and casting.

## Helpers for ops

`choose-cards.ts` is how an effect waits for cards to be chosen (CR 608.2d): `askToChoose` sets a `chooseCards`
decision; each answer either waits for the next card or queues the effect again with `chosen`, ahead of the rest of
the resolution, so nothing happens until all are in (D-062). `hand-effects.ts` and `library-effects.ts` have the ops
that use it.

`player-effects.ts` isn't a primitive: `drawEach`, `discardAtRandom` and `mill` propose several events for the players
an effect names (one draw at a time; random picks, then one simultaneous discard; one simultaneous mill).

Tests: `test/effects/effects.test.ts`, `removal.test.ts`, `player-effects.test.ts`, `choose-cards.test.ts`,
`library-effects.test.ts` and `damage-to-many.test.ts`, and the scenarios in
`test/scenarios/effects/` and `test/scenarios/cards/`.
