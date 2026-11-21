# engine/src/rules

Answers to rules questions that many parts of the engine ask, each in one place so later rules change it once.

- `controller.ts`: `controllerOf(state, id)`: who controls an object (CR 110.2, 112.2, 113.8; a card in another zone
  has no controller and the owner answers for it, CR 108.4a). Control-changing effects (layer 2) will be added here.

- `layers.ts`: the layer pass (CR 613, D-092): `layeredOf`, `layered`, every object's characteristics computed once
  per state for the battlefield and the stack, kept per its inputs; `layeredFresh` and `layeredOfFresh`, computed
  afresh, for the fuzzer's check that the kept pass is right. Every reader below reads it.
- `static-effects.ts`: static abilities that change other objects (anthems, D-093): their sets (CR 611.3a), the
  keywords they grant in layer 6 and what they add in 7c.
- `filter-fit.ts`: `fits`, the pure check of an `ObjectFilter` against given characteristics, shared by
  `matchesFilter` and the pass.
- `abilities.ts`: `keywordsOf` and `staticAbilitiesOf` (layer 6: printed and granted); `findAbility` (by its ref); `stackAbilityDef` (an ability on the stack, from its source's
  card, CR 113.7a); `abilitiesOf(state, id, cards)`: an object's activated abilities with their refs (printed, then a basic
  land type's intrinsic mana ability, CR 305.6); `isManaAbility` (CR 605.1a).
- `summoning-sickness.ts`: `canUseTapAbilities` (CR 602.5a, 302.6, haste 702.10c), only for creatures.
- `targets.ts`: `legalTargets` (permanents, spells, graveyard cards and players, CR 115.2, 115.4, 115.5),
  `isLegalTarget`, `targetsProblem` (enough legal choices for each instance, CR 601.2c, 115.6), `stillLegalTargets`
  (CR 608.2b); `targetSpecsOf` and `effectsOf`, the one place a spell's or ability's targets and effects are read from
  its definition.
- `object-filter.ts`: `matchesFilter`: whether an object fits an `ObjectFilter` ("nonblack", "tapped", "an opponent
  controls", "blocking"), from the object's characteristics now, through `fits`.
- `colors.ts`: `colorsOf`, an object's colors (layer 5; printed for now).
- `combat.ts`: `canAttack` (with defender, CR 702.3b), `canAttackPlayer` ("can't attack unless defending player
  controls ...", CR 508.1c), `canBlock` (flying and reach, landwalk, "can't be blocked (except
  by ...)", "can't block": CR 702.9b, 702.17b, 702.14c, 509.1b), `canBlockAnyNumber`, `attacksInCombat`,
  `blocksInCombat`, `isBlocked` (CR 506.4, 508.1a, 509.1a, 509.1h), `isAttacking` and `isBlocking` (CR 508.1k,
  509.1g: a blocker stays one after its attacker is gone).
- `costs.ts`: `costOf` (what to pay to put a spell or ability on the stack), from `totalCost` (a spell, CR 601.2f: X as
  announced, plus Fireball's per-target increase) and `activationManaCost` (an ability, CR 602.2b); `announcesX`,
  `withX` (CR 107.3a).
- `amount.ts`: `amountOf`, the number a fixed amount stands for (a number, or X as announced). A counted amount
  (`{ count }`) is worked out only as an effect applies, by `amountNow` in `effects/subjects.ts` (D-067).
- `state-based-actions.ts`: `stateBasedActions(state, cards)`: the SBAs that apply now, as data (CR 704.5a/b/f/g).
- `damage-recipients.ts`: `canBeDealtDamage`, who can be dealt damage now (CR 120.1a).
- `timing.ts`: `castTimingProblem`, `landPlayProblem` (CR 117.1a, 305.1–2, 302.1, 304.1, 307.1).
- `protection.ts`: `protectionsOf`, `isProtectedFrom`: protection (CR 702.16) and whether a source has the quality,
  as it is or as it last existed (D-091).
- `card-types.ts`: `supertypesOf`, `cardTypesOf`, `subtypesOf`: an object's types (layer 4; printed, as nothing changes
  types yet).
- `characteristics.ts`: `characteristics(state, id, cards)`, an object's characteristics through the layers (CR 613),
  composing the readers above. `power-toughness.ts`: `powerAndToughness`, layer 7 (CR 613.4): the base from 7a's
  characteristic-defining abilities, else printed, then 7c effects, static abilities, counters and rule modifiers. Read power and toughness only through these.

Tests: `test/mana/` and the scenarios in `test/scenarios/mana/` (abilities, summoning sickness),
`test/rules/characteristics.test.ts` and `test/scenarios/characteristics/` (layers), and the game tests.
