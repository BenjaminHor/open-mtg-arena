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
| `gainKeywords` | "Target creature gains flying until end of turn", "creatures you control gain haste" | A layer 6 effect (CR 613.1f) on the objects `of` names, fixed now (CR 611.2c) |
| `gainControl` | "Gain control of target creature until end of turn" | A layer 2 effect (CR 613.1b) on the permanents fixed now, to "you"; the control change makes them summoning sick (CR 302.6, D-098) |
| `untap` | "Untap that creature" | Untaps the permanents `of` names (CR 701.26b) |
| `doesntUntap` | "Those creatures don't untap during that player's next untap step" | A continuous effect the untap step reads (CR 502.3) on the permanents "those creatures" names now (a rules effect), ending with that untap step (`game/untap-step.ts`) |
| `cantBeBlocked` | "Target Merfolk creature can't be blocked this turn" | A continuous effect `canBlock` reads (CR 509.1b) on the targets still legal; targets only |
| `cantBlock` | "can't block this turn" | Creates a continuous effect `canBlock` reads (CR 509.1b) on the targets still legal (CR 608.2b); targets only for now |
| `destroy` | "Destroy target creature" | Destroys each permanent `of` names (CR 701.8a); `noRegeneration`: "It can't be regenerated", so no shield is used (CR 701.19c) |
| `regenerate` | "Regenerate target creature" | A regeneration shield on each permanent `of` names still on the battlefield, used the next time it would be destroyed this turn (CR 701.19a; `regeneration-shield.ts`, D-086) |
| `destroyAll` | "Destroy all nonland permanents" | Destroys every permanent fitting `filter`, decided once, at the same time (CR 608.2f, 608.2h) |
| `exile` | "Exile target permanent" | Moves each object `of` names to exile (CR 701.13a) |
| `returnToHand` | "Return target creature to its owner's hand" | Moves it to its owner's hand (CR 400.3) |
| `putOnTopOfLibrary` | "Put target creature on top of its owner's library" | Moves it to the top of its owner's library |
| `tap` | "Tap target creature" | Taps each permanent `of` names; a tapped one stays as it is (CR 701.26a) |
| `counter` | "Counter target spell" | Counters each spell or ability `of` names (CR 701.6a) |
| `gainLife` | "You gain 4 life" | The players `who` names gain `amount` (CR 119.3) |
| `nameCard` | "That player chooses a card name" | The player `who` names names a card (a `chooseName` decision), kept as `Resolution.named` for a later filter's `notNamedThisWay` (CR 201.4, D-121) |
| `extraTurn` | "Target player takes an extra turn after this one" | Adds a turn for each player `who` names directly after this one (CR 500.7, `game/extra-turns.ts`) |
| `loseLife` | "Target player loses 2 life" | The players `who` names lose `amount` (CR 119.3); 0 isn't proposed |
| `draw` | "Draw two cards" | One draw at a time (CR 121.2), all of one player's before the next player's, in APNAP order (CR 121.2c) |
| `discardAtRandom` | "Discards X cards at random" | Picks with the seeded RNG, each player in APNAP order, then discards them all at once (CR 701.9b; Burning Inquiry's ruling) |
| `discard` | "Target player discards two cards" | The player chooses (CR 701.9b), or "you" with `chosenBy` and a `filter` (Duress); a smaller hand is discarded whole without asking (CR 609.3) |
| `revealHand` | "Target opponent reveals their hand" | Shows the hand's cards to everyone, by identity only (CR 701.20a, D-062) |
| `putOntoBattlefield` | "You may put a creature card from your hand onto the battlefield" | Under the controller's control (CR 110.2a), not cast; asked whenever the hand isn't empty (D-062) |
| `returnAllToBattlefield` | "Return all artifact and enchantment cards from all graveyards to the battlefield under their owners' control"; "... under your control" (`under: "you"`, Liliana Vess) | All at once; each Aura's controller-to-be chooses what it enchants, in APNAP order, without targeting; one with nothing to enchant stays (CR 303.4f-g, D-107); `from: "found"`, the cards found still in their owners' libraries (Warp World, D-130) |
| `search` | "Search your library for a basic land card" | "You" choose among the library's cards fitting `filter` (or with the name of a card exiled this way), shown the whole library by identity (CR 701.23a, D-062); finds `"found"`, moves nothing |
| `reveal` | "Reveal it" | Shows the cards to everyone, by identity (CR 701.20a) |
| `put` | "Put that card onto the battlefield tapped" | Into the owner's hand, on top of the library (`libraryTop`; a card already in that library is reordered, not moved, CR 400.7; several, on the top or bottom, are arranged by each owner in turn order, unrevealed, CR 401.4, Mirror of Fate, Warp World) or at its bottom, or onto the battlefield under the controller, `tapped` as part of the move (CR 110.2a, 110.5b); `onlyIf` puts only cards fitting a filter ("if it's a creature card"); `optional` asks first, if there's a card to put; `by`: "the player puts", who controls it (CR 110.2a; `put-effects.ts`) |
| `revealTop` | "Reveal the top card of your library" | Shows it to everyone, staying on top, as `"found"` for the effects after it (CR 701.20a, 701.20b); `who: "eachPlayer", count: "shuffledIn"`: each player that many, all found (Warp World) |
| `revealUntil` | "Reveals cards from the top of their library until they reveal a creature card" | Shows the cards down to the first that fits the filter, which is `"found"`; none leave the library (CR 701.20a) |
| `copySpell` | "Copy target instant or sorcery spell. You may choose new targets for the copy" | Puts a copy on the stack (not cast) and asks for each target: keep it or a new one (`game/copy-spell.ts`, CR 707.10, 115.7d, D-125). `by: "eachOtherPlayer"` (Hive Mind): one copy per player but the caster, in turn order; a spell gone from the stack is copied as it last existed (CR 608.2h) |
| `mayPlayWithoutPaying` | "You may play that card without paying its mana cost" | Asks only if it can be played; plays a land or casts the spell while this resolves (`game/play-during-resolution.ts`, CR 608.2g, D-124) |
| `shuffle` / `mayShuffle` | "Then shuffle" / "You may shuffle" | Shuffles (CR 701.24a); `mayShuffle` asks yes or no first |
| `lookAtTop` | "Look at the top three cards of your library, then put them back in any order" | The player is shown them and puts them back top first (CR 701.20e, 401.4) |
| `destroyOneAtRandom` | "Destroy one of them at random" | One of the permanents its subjects name, still legal and on the battlefield, picked with the seeded RNG (`destroy-at-random.ts`) |
| `ifActivatedThisTurn` | "If this ability has been activated four or more times this turn, ..." | Its `effects` happen only if the resolving activated ability has become activated `atLeast` times this turn, its own activation counted, read now (CR 608.2h, D-078); for an activated ability only |
| `createDelayedTrigger` | "Sacrifice Dragon Whelp at the beginning of the next end step" | Makes a delayed triggered ability, with this spell's or ability's source and controller (CR 603.7d, 603.7e), waiting in `GameState.delayedTriggers` (`triggers/delayed.ts`) |
| `ifNothingSacrificed` | "If you can't sacrifice a creature, tap this creature and you lose 7 life" | Its `effects` happen only if no earlier `sacrifice` of this resolution sacrificed anything (CR 608.2c) |
| `choose` | "Choose up to seven face-up exiled cards you own" | The controller chooses up to `upTo` exiled cards fitting `filter` as it resolves (CR 608.2d), kept as `found`; not asked with none (`choose-exiled.ts`) |
| `shuffleIntoLibraries` | "Each player shuffles all permanents they own into their library" | The permanents named go to their owners' libraries at once, each player shuffles, and how many each owned is kept, tokens too, which cease to exist in the same batch (`shuffle-into-libraries.ts`, D-130) |
| `exileAll` | "Exile all cards from target player's graveyard other than basic land cards", "Exile all the cards from your library" | Exiles the cards in `zone` fitting `filter` at once, kept as "exiled this way" (CR 608.2c); a library's in shown order |
| `mill` | "Target player mills five cards" | The top N of each player's library to its graveyard at once, all there are if fewer (CR 701.17a, 701.17b); `"halfTheirLibrary"` rounds down (CR 107.1a) |

Which move op to use: `returnToHand` for a target bounced to its owner's hand; `put` for cards an earlier `search`,
`revealTop` or `revealUntil` found (`"found"`), into the hand, onto the battlefield or on the bottom of the library; `putOntoBattlefield` when the player chooses a card from
their hand as the effect resolves (Elvish Piper); `exile` for either. `createTokens` makes tokens (`create-tokens.ts`,
D-101); `attachSelf` is equip's "attach this to target creature you control" (`attach-self.ts`, D-103).

Every op that acts on objects skips one that's no longer where it was when the targets were checked: it's a new object
now, and acting on it is impossible (CR 101.3, 400.7). `"you"` names the controller (CR 109.5); `"eachPlayer"` names
every player in APNAP order (CR 101.4).

`from`, `to`, `of` and `who` are `EffectSubject`s: `"self"`, `"you"`, `"eachPlayer"`, `"triggeringPlayer"` and
`"triggeringObject"` (a triggered ability's "that player" and "that creature"), `"found"` (what an earlier
`search` of this resolution found, kept in `GameState.resolution`, D-064), `{ each: filter }` (every permanent fitting
it now, CR 608.2h), `{ eachControlledBy: { target: i }, filter }` (every permanent fitting the filter that the target
player, or the targeted permanent's controller, controls now), `{ target: i }` for the still-legal targets of the i-th instance of "target", or
`{ controllerOf: { target: i } }` for that target's controller ("its controller", from last known information if it's
gone, CR 608.2h), or `"attached"` (an Aura's or Equipment's "enchanted creature", as it last was if the source is gone,
CR 303.4m, 608.2h). A subject with no
legal targets left means that part does nothing (CR 608.2b). Amounts are a number, `"X"`, `{ count: filter }`, or
`"thatMuch"` (a triggered ability's event amount: the life gained), or `"sacrificedPower"` (the power of what an earlier
`sacrifice` sacrificed, as it last was on the battlefield, CR 608.2h, never below 0, CR 107.1b).
`subjects.ts` reads both (D-067).

## Primitives

| File | What it does |
| --- | --- |
| `deal-damage.ts` | `dealDamage(state, damage[], cards)`, performing the pipeline's `dealDamage` event: every damage in the game goes through it (CR 120.4), its results included. Life loss for a player (CR 120.3a), damage marked on a creature (CR 120.3e); 0 damage is dropped before it gets here (CR 120.8); only players and creatures can be dealt damage (CR 120.1a). Emits `DAMAGE_DEALT` |
| `life.ts` | `loseLife(state, player, amount)` (CR 119.3), emitting `LIFE_LOST`. Reaching 0 life is checked later, as a state-based action (CR 704.5a) |
| `continuous-effect.ts` | `createContinuousEffect(state, effect)`: gives it a timestamp (CR 613.7b) and adds it to `GameState.effects`, emitting `EFFECT_CREATED`. The layer pass applies it (`rules/layers.ts`). `endUntilEndOfTurnEffects` ends them in cleanup (CR 514.2), emitting `EFFECT_ENDED`; "while its source remains on the battlefield" ones end in `moveCard` (D-095) |
| `becomes.ts` | `becomes`: Awakener Druid's "becomes a 4/5 green Treefolk creature", one effect in layers 4, 5 and 7b (D-095); none if a "for as long as" duration never starts (CR 611.2b). What a card "is" as it enters is `put`'s `is`, made by the move (CR 611.2e) |

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
`library-effects.test.ts`, `damage-to-many.test.ts`, and `becomes.test.ts` (control changes: `test/game/control-changes.test.ts`), and the scenarios in
`test/scenarios/effects/` and `test/scenarios/cards/`.
