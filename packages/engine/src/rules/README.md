# engine/src/rules

Answers to rules questions that many parts of the engine ask, each in one place so later rules change it once.

- `controller.ts`: `controllerOf(state, id)`: who controls an object (CR 110.2, 112.2, 113.8; a card in another zone
  has no controller and the owner answers for it, CR 108.4a). Control-changing effects (layer 2) will be added here.

- `abilities.ts`: `keywordsOf` (layer 6, printed for now); `findAbility` (by its ref); `stackAbilityDef` (an ability on the stack, from its source's
  card, CR 113.7a); `abilitiesOf(state, id, cards)`: an object's activated abilities with their refs (printed, then a basic
  land type's intrinsic mana ability, CR 305.6); `isManaAbility` (CR 605.1a).
- `summoning-sickness.ts`: `canUseTapAbilities` (CR 602.5a, 302.6, haste 702.10c), only for creatures.
- `targets.ts`: `legalTargets`, `isLegalTarget`, `stillLegalTargets` (CR 115, 115.4, 109.2, 608.2b); `targetSpecsOf`
  and `effectsOf`, the one place a spell's or ability's targets and effects are read from its definition.
- `combat.ts`: `canAttack`, `canBlock` (with flying and reach, CR 702.9b, 702.17b), `attacksInCombat`,
  `blocksInCombat`, `isBlocked` (CR 506.4, 508.1a, 509.1a, 509.1h).
- `costs.ts`: `costOf` (what to pay to put a spell or ability on the stack), from `totalCost` (a spell, CR 601.2f) and
  `activationManaCost` (an ability, CR 602.2b).
- `state-based-actions.ts`: `stateBasedActions(state, cards)`: the SBAs that apply now, as data (CR 704.5a/b/f/g).
- `timing.ts`: `castTimingProblem`, `landPlayProblem` (CR 117.1a, 305.1–2, 302.1, 304.1, 307.1).
- `card-types.ts`: `supertypesOf`, `cardTypesOf`, `subtypesOf`: an object's types (layer 4; printed, as nothing changes
  types yet).
- `characteristics.ts`: `characteristics(state, id, cards)`, an object's characteristics through the layers (CR 613),
  composing the readers above. `power-toughness.ts`: `powerAndToughness`, layer 7 (CR 613.4): printed values, then
  7c effects, counters and rule modifiers. Read power and toughness only through these.

Tests: `test/mana/` and the scenarios in `test/scenarios/mana/` (abilities, summoning sickness),
`test/rules/characteristics.test.ts` and `test/scenarios/characteristics/` (layers), and the game tests.
