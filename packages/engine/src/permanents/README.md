# engine/src/permanents

Changes to permanents' status and marked damage, each through one function so later rules (effects that stop
untapping, CR 502.3; triggers on tapping or untapping) plug in once.

- `untap.ts`: `untapPermanents(state, ids)`: untaps them all as one action (CR 502.3), emitting `PERMANENT_UNTAPPED` for each.
- `damage.ts`: `removeAllDamage(state)` for the cleanup step (CR 514.2), emitting `DAMAGE_REMOVED`.

Tests: `test/game/turn.test.ts`.
