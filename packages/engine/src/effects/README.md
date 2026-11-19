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

`from`, `to` and `of` are `EffectSubject`s: `"self"`, or `{ target: i }` for the still-legal targets of the i-th
instance of "target". A subject with no legal targets left means that part does nothing (CR 608.2b).

## Primitives

| File | What it does |
| --- | --- |
| `deal-damage.ts` | `dealDamage(state, damage[], cards)`: every damage in the game goes through it (CR 120.4). Life loss for a player (CR 120.3a), damage marked on a creature (CR 120.3e); 0 damage isn't dealt (CR 120.8); only players and creatures can be dealt damage (CR 120.1a). Emits `DAMAGE_DEALT` |
| `life.ts` | `loseLife(state, player, amount)` (CR 119.3), emitting `LIFE_LOST`. Reaching 0 life is checked later, as a state-based action (CR 704.5a) |
| `continuous-effect.ts` | `createContinuousEffect(state, effect)`: gives it a timestamp (CR 613.7b) and adds it to `GameState.effects`, emitting `EFFECT_CREATED`. `characteristics()` applies it (M1-11) |

Turn steps and casting use other primitives directly: `zones/draw.ts` (drawing, CR 121), `zones/move-card.ts`
(zone changes, CR 400.7), `permanents/` (tapping, marked damage) and `mana/pool.ts` (adding mana). Each becomes an
effect op when a card first needs it ("draw a card", "destroy", "exile"), so the op is one line here.

Tests: `test/effects/effects.test.ts`, and the scenarios in `test/scenarios/effects/`.
