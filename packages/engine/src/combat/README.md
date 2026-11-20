# engine/src/combat

Combat's turn-based actions (CR 506–511, D-040). The rules questions they ask (who can attack, who can block what,
who's still in combat) are in `rules/combat.ts`; the state is `GameState.combat` (`state/combat.ts`).

| File | What it does |
| --- | --- |
| `attackers.ts` | `anyAttackers()`: whether any creature was declared as an attacker, so the blockers and damage steps happen (CR 508.8) |
| `declare-attackers.ts` | The declare attackers step (CR 508.1): `possibleAttacks`, one decision per attacker, then `finishAttackers` taps them (but not those with vigilance, CR 702.20b) |
| `declare-blockers.ts` | The declare blockers step (CR 509.1): `possibleBlocks` (one attacker per blocker, any number for Palace Guard), one decision per block, then `finishBlockers` |
| `combat-damage.ts` | The combat damage step (CR 510): an `assignDamage` decision per attacker with a choice, then per blocker of several attackers (CR 510.1d), then all of the step's damage at once (`combatDamage`) |
| `damage-assignment.ts` | Dividing a creature's damage among its recipients (CR 510.1c), trample's lethal damage first (CR 702.19b): `recipientsOf`, `hasChoice`, `assignProblem`, `assignToNextRecipient` |
| `first-strike.ts` | First and double strike's two damage steps (CR 510.4): `beginCombatDamageStep`, `secondDamageStepFollows`, `assignsDamageNow` |

Lifelink and deathtouch are results of the damage event, in `effects/deal-damage.ts`.

Tests: `test/combat/combat.test.ts`, `test/combat/strikes-and-trample.test.ts`, and the scenarios in
`test/scenarios/combat/`, `test/scenarios/cards/m2-06a/` and `test/scenarios/interactions/`.
