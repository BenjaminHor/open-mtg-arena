# engine/src/rules

Answers to rules questions that many parts of the engine ask, each in one place so later rules change it once.

- `controller.ts`: `controllerOf(state, id)`: who controls an object (CR 110.2, 112.2, 113.8; a card in another zone
  has no controller and the owner answers for it, CR 108.4a). Control-changing effects (layer 2) will be added here.

- `abilities.ts`: `keywordsOf` (layer 6, printed for now); `abilitiesOf(state, id, cards)`: an object's activated abilities with their refs (printed, then a basic
  land type's intrinsic mana ability, CR 305.6); `isManaAbility` (CR 605.1a).
- `summoning-sickness.ts`: `canUseTapAbilities` (CR 602.5a, 302.6), only for creatures.
- `targets.ts`: `legalTargets`, `isLegalTarget`, `stillLegalTargets` (CR 115, 115.4, 109.2, 608.2b); `targetSpecsOf`
  and `spellEffectsOf`, the one place a spell's targets and effects are read from its definition.
- `timing.ts`: `castTimingProblem`, `landPlayProblem` (CR 117.1a, 305.1–2, 302.1, 304.1, 307.1).
- `card-types.ts`: `supertypesOf`, `cardTypesOf`, `subtypesOf`: an object's types (layer 4; printed, as nothing changes
  types yet).
- `characteristics.ts`: `characteristics(state, id, cards)`, an object's characteristics through the layers (CR 613),
  composing the readers above. `power-toughness.ts`: `powerAndToughness`, layer 7 (CR 613.4): printed values, then
  7c effects, counters and rule modifiers. Read power and toughness only through these.

Tests: `test/mana/` and the scenarios in `test/scenarios/mana/` (abilities, summoning sickness),
`test/rules/characteristics.test.ts` and `test/scenarios/characteristics/` (layers), and the game tests.
