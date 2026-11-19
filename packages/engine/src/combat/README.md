# engine/src/combat

Combat's turn-based actions (CR 506–511, D-040). The rules questions they ask (who can attack, who can block what,
who's still in combat) are in `rules/combat.ts`; the state is `GameState.combat` (`state/combat.ts`).

| File | What it does |
| --- | --- |
| `attackers.ts` | `anyAttackers()`: whether any creature was declared as an attacker, so the blockers and damage steps happen (CR 508.8) |
| `declare-attackers.ts` | The declare attackers step (CR 508.1): `possibleAttacks`, one decision per attacker, then `finishAttackers` taps them |
| `declare-blockers.ts` | The declare blockers step (CR 509.1): `possibleBlocks`, one decision per block, then `finishBlockers` |
| `combat-damage.ts` | The combat damage step (CR 510): an `assignDamage` decision per attacker with several blockers (`allDivisions`, `divisionProblem`), then all damage at once |

Tests: `test/combat/combat.test.ts` and the scenarios in `test/scenarios/combat/`.
