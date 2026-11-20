# engine/src/permanents

Changes to permanents' status and marked damage. Apart from `removeAllDamage`, these perform the event pipeline's
events (`pipeline/`, D-056) and are called only by it; everything else proposes the event with `happen`.

- `tap.ts`: `tapPermanent(state, id)`, emitting `PERMANENT_TAPPED`.
- `untap.ts`: `untapPermanent(state, id)`, emitting `PERMANENT_UNTAPPED`. The untap step untaps them all as one
  `simultaneous` event (CR 502.3).
- `destroy.ts`: `destroy(state, id)` (CR 701.8): the move to the graveyard, emitting `PERMANENT_DESTROYED` first.
- `regenerate.ts`: `regenerate(state, id)` (CR 701.19a), in place of a destroy: a regeneration shield used up, all
  damage removed, tapped, removed from combat (`Combat.removed`), emitting `PERMANENT_REGENERATED` first (D-086).
- `sacrifice.ts`: `sacrifice(state, id)` (CR 701.21a): the move to its owner's graveyard, not a destruction, emitting
  `PERMANENT_SACRIFICED` (with who sacrificed it) first.
- `damage.ts`: `markDamage(state, id, amount)` (CR 120.3e), called only by `effects/deal-damage.ts`, which emits
  `DAMAGE_DEALT`; `removeAllDamage(state)` for the cleanup step (CR 514.2), emitting `DAMAGE_REMOVED`.

Tests: `test/game/turn.test.ts`, `test/permanents/regeneration.test.ts`.
