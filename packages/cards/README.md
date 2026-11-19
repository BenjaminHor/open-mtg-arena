# @mtg/cards

Card definitions (typed data the engine interprets, never functions) and the extracted Scryfall card pool.
Depends only on `@mtg/engine`, and only for its types.

How cards are written and checked against their Oracle text: [`docs/card-scripting.md`](../../docs/card-scripting.md).
Where the data comes from and its terms: [`docs/data-sources.md`](../../docs/data-sources.md).

## Entry points

- `src/index.ts`: empty for now. The card data pipeline (`pnpm cards:fetch`, `pnpm cards:extract`), `pool.txt` and the
  first `CardDef` types arrive in M1-04.

## Tests

`pnpm test` runs this package's tests along with the rest.
