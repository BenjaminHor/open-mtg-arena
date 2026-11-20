# engine/src/effects

The effects interpreter: what the effect data in card definitions (`Effect` in `cards/types.ts`) does when a spell or
ability resolves (CR 608.2c), and the primitives it's built from. Card definitions never contain code; this folder is
the one place their effects become changes to the game.

## How an effect runs

1. As a spell starts to resolve, `resolveTopOfStack` (`game/resolve.ts`) checks its targets once (CR 608.2b) and
   queues one `runEffect` work item per effect, in the order written (CR 608.2c). Each carries an `EffectContext`:
   the object "this" refers to, the controller ("you"), and the targets still legal, one group per instance of
   "target". Illegal targets aren't affected.
2. `runEffect(state, effect, context, cards)` (`run-effect.ts`) switches on the effect's `op`.
3. Mana abilities don't use the stack (CR 605.3b), so `mana/activate.ts` calls `runEffect` directly, with no targets.

## Effect ops

| `op` | Card text | What it does |
| --- | --- | --- |
| `dealDamage` | "[from] deals N damage to [to]" | `from` (one object) deals `amount` to each player or creature `to` names, through `dealDamage` |
| `addMana` | "Add {G}." | Adds `amount` of `mana` to the controller's pool (CR 106.4, 109.5), naming `self` as its source |
| `modifyPT` | "gets +N/+N until end of turn" | Creates a layer 7c continuous effect (CR 613.4c) on the objects `of` names, fixed now (CR 611.2c) |
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
| `mill` | "Target player mills five cards" | The top N of each player's library to its graveyard at once, all there are if fewer (CR 701.17a); `"halfTheirLibrary"` rounds down (CR 107.1a) |

Every op that acts on objects skips one that's no longer where it was when the targets were checked: it's a new object
now, and acting on it is impossible (CR 101.3, 400.7). `"you"` names the controller (CR 109.5); `"eachPlayer"` names
every player in APNAP order (CR 101.4).

`from`, `to` and `of` are `EffectSubject`s: `"self"`, or `{ target: i }` for the still-legal targets of the i-th
instance of "target". A subject with no legal targets left means that part does nothing (CR 608.2b).

## Primitives

| File | What it does |
| --- | --- |
| `deal-damage.ts` | `dealDamage(state, damage[], cards)`, performing the pipeline's `dealDamage` event: every damage in the game goes through it (CR 120.4), its results included. Life loss for a player (CR 120.3a), damage marked on a creature (CR 120.3e); 0 damage is dropped before it gets here (CR 120.8); only players and creatures can be dealt damage (CR 120.1a). Emits `DAMAGE_DEALT` |
| `life.ts` | `loseLife(state, player, amount)` (CR 119.3), emitting `LIFE_LOST`. Reaching 0 life is checked later, as a state-based action (CR 704.5a) |
| `player-effects.ts` | `drawEach`, `discardAtRandom` and `mill`: several events for the players an effect names, and `apnapOrder` (CR 101.4) |
| `continuous-effect.ts` | `createContinuousEffect(state, effect)`: gives it a timestamp (CR 613.7b) and adds it to `GameState.effects`, emitting `EFFECT_CREATED`. `characteristics()` applies it (`rules/power-toughness.ts`). `endUntilEndOfTurnEffects` ends them in cleanup (CR 514.2), emitting `EFFECT_ENDED` |

`dealDamage` and `loseLife` are called only by the event pipeline (`pipeline/`, D-056); `runEffect` proposes
its events to it with `happen`. Turn steps and casting propose the other events (draw, zone
changes, tapping). Each becomes an effect op when a card first needs it ("draw a card", "destroy", "exile"), so the op
is one line here.

Tests: `test/effects/effects.test.ts`, and the scenarios in `test/scenarios/effects/`.
