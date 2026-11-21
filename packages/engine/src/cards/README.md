# engine/src/cards

The types for the card data the engine is given (`CardDatabase`). The engine never loads cards itself:
`packages/cards` builds the database from Scryfall's Oracle data and the hand-written definitions.

- `types.ts`: `CardData` (`oracleId`, `printed`, `def`), `PrintedCard` (rules-relevant printed characteristics),
  `CardDef` (what the card does: spell effects, activated abilities, keywords) and their parts. A first draft (D-026).
- `triggers.ts`: `TriggeredAbilityDef` (CR 603, D-076): a trigger condition, an "intervening if", "you may", targets
  and effects.

- `card-data.ts`: `cardDataOf(obj, cards)`, the one way to read an object's card data: a token's own (CR 111.3) or its
  card's from the database (D-101). `card-data-lookups.test.ts` checks nothing indexes the database directly.
- `token-data.ts`: `tokenData`, a token's `CardData` from the `TokenDef` the creating effect gives (CR 111.3, 111.4).

How to write a definition: [`docs/card-scripting.md`](../../../../docs/card-scripting.md). The definitions are tested
in `packages/cards/test/`; the two helpers in `test/cards/` and `test/zones/tokens.test.ts`.
