# engine/src/cards

The types for the card data the engine is given (`CardDatabase`). The engine never loads cards itself:
`packages/cards` builds the database from Scryfall's Oracle data and the hand-written definitions.

- `types.ts`: `CardData` (`oracleId`, `printed`, `def`), `PrintedCard` (rules-relevant printed characteristics),
  `CardDef` (what the card does: spell effects, activated abilities, keywords) and their parts. A first draft (D-026).
- `triggers.ts`: `TriggeredAbilityDef` (CR 603, D-076): a trigger condition, an "intervening if", "you may", targets
  and effects.

How to write a definition: [`docs/card-scripting.md`](../../../../docs/card-scripting.md). The definitions are tested
in `packages/cards/test/`; there's no logic here to test yet.
