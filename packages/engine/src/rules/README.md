# engine/src/rules

Answers to rules questions that many parts of the engine ask, each in one place so later rules change it once.

- `controller.ts`: `controllerOf(state, id)`: who controls an object (CR 110.2, 112.2, 113.8; a card in another zone
  has no controller and the owner answers for it, CR 108.4a). Control-changing effects (layer 2) will be added here.

- `abilities.ts`: `abilitiesOf(state, id, cards)`: an object's activated abilities with their refs (printed, then a basic
  land type's intrinsic mana ability, CR 305.6); `isManaAbility` (CR 605.1a).
- `summoning-sickness.ts`: `canUseTapAbilities` (CR 602.5a, 302.6), only for creatures.
- `targets.ts`: `legalTargets`, `isLegalTarget` (CR 115, 115.4, 109.2, 608.2b).
- `timing.ts`: `castTimingProblem`, `landPlayProblem` (CR 117.1a, 305.1–2, 302.1, 304.1, 307.1).
- `card-types.ts`: `cardTypesOf(state, id, cards)`: an object's card types (printed until the layer system, M1-11).

Tests: `test/mana/` and the scenarios in `test/scenarios/mana/` (abilities, summoning sickness), and the game tests.
