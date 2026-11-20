# engine/src/permanents

Changes to permanents' status and marked damage. Apart from `removeAllDamage`, these perform the event pipeline's
events (`pipeline/`, D-056) and are called only by it; everything else proposes the event with `happen`.

- `tap.ts`: `tapPermanent(state, id)`, emitting `PERMANENT_TAPPED`.
- `untap.ts`: `untapPermanents(state, ids)`: untaps them all as one action (CR 502.3), emitting `PERMANENT_UNTAPPED` for each.
- `destroy.ts`: `destroy(state, id, next)` (CR 701.8), emitting `PERMANENT_DESTROYED` and proposing the move to the
  graveyard through `next`.
- `damage.ts`: `markDamage(state, id, amount)` (CR 120.3e), proposed by `effects/deal-damage.ts`, which emits
  `DAMAGE_DEALT`; `removeAllDamage(state)` for the cleanup step (CR 514.2), emitting `DAMAGE_REMOVED`.

Tests: `test/game/turn.test.ts`.
