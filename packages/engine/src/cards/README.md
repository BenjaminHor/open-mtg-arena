# engine/src/cards

The types for the card data the engine is given (`CardDatabase`). The engine never loads cards itself:
`packages/cards` builds the database from Scryfall's Oracle data and the hand-written definitions.

- `types.ts`: `CardData` (`oracleId`, `printed`, `def`), `PrintedCard` (rules-relevant printed characteristics),
  `CardDef` (what the card does: spell effects, activated abilities, keywords) and their parts. A first draft (D-026).
- `triggers.ts`: `TriggeredAbilityDef` (CR 603, D-076): a trigger condition, an "intervening if", "you may", targets
  and effects.
- `card-data.ts`: `cardDataOf(obj, cards)`, the one way to read an object's card data: its copiable values', a copy
  effect's (`copied`, layer 1, D-127) or its own, a token's own (CR 111.3) or its card's from the database (D-101);
  `copiableValues` (what a copy of it copies), `textOracleId` (the card whose text it has, which its abilities name);
  `isToken`, for "card" filters (CR 111.6). The source scan
  `test/cards/card-data-lookups.test.ts` checks nothing else indexes the database.
- `token-data.ts`: `tokenData`, a token's `CardData` from the `TokenDef` the creating effect gives (CR 111.3, 111.4).

How to write a definition: [`docs/card-scripting.md`](../../../../docs/card-scripting.md). The definitions are tested
in `packages/cards/test/`. `card-data.ts` and `token-data.ts` are tested in `test/zones/tokens.test.ts`.
