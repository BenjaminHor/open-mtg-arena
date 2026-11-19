# engine/src/combat

Combat (CR 506–511). So far only the question the turn structure needs: `anyAttackers()` in `attackers.ts`, which is
always false until declaring attackers arrives in M1-13, so the declare blockers and combat damage steps are skipped
(CR 508.8).

Tests: `test/game/turn.test.ts` (the skipped steps).
