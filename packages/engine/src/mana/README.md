# engine/src/mana

Mana and paying for things (CR 106, 605, 601.2g–h). D-034.

- `activate.ts`: `activateManaAbility` and `manaAbilityProblem`: activating a mana ability with priority (CR 605.3a);
  it resolves at once (CR 605.3b).
- `pool.ts`: `addMana` (CR 106.4).
- `payment.ts`: `payFromPool(pool, cost, payment)`: checks and spends a payment, all or nothing (CR 601.2h); `manaValue`.
- `auto-pay.ts`: `autoPay`: a deterministic way to pay a cost, for scenarios, the CLI and the AI.

Tests: `test/mana/payment.test.ts` (including a brute-force check that `autoPay` always finds a payment when one
exists) and the scenarios in `test/scenarios/mana/`.
