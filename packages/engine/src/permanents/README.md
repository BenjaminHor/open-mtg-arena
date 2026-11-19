# engine/src/permanents

Changes to permanents' status and marked damage, each through one function so later rules (effects that stop
untapping, CR 502.3; triggers on tapping or untapping) plug in once.

- `tap.ts`: `tapPermanent(state, id)`, emitting `PERMANENT_TAPPED`.
- `untap.ts`: `untapPermanents(state, ids)`: untaps them all as one action (CR 502.3), emitting `PERMANENT_UNTAPPED` for each.
- `damage.ts`: `markDamage(state, id, amount)` (CR 120.3e), called only by `effects/deal-damage.ts`, which emits
  `DAMAGE_DEALT`; `removeAllDamage(state)` for the cleanup step (CR 514.2), emitting `DAMAGE_REMOVED`.

Tests: `test/game/turn.test.ts`.
