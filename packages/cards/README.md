# @mtg/cards

Card definitions (typed data the engine interprets, never functions) and the extracted Scryfall card pool.
Depends only on `@mtg/engine`, and only for its types.

How cards are written and checked against their Oracle text: [`docs/card-scripting.md`](../../docs/card-scripting.md).
Where the data comes from and its terms: [`docs/data-sources.md`](../../docs/data-sources.md).

## Entry points

- `pool.txt`: the cards the engine supports, one name per line.
- `src/index.ts`:
  - `cardDatabase()`: the engine's `CardDatabase`, built from `data/pool.json` and the definitions.
  - `CARD_DEFS`: every definition (`src/defs/<letter>/<slug>.ts`).
  - `definitionProblems()`: the errata and completeness check.
  - `POOL`: the extracted Oracle data, including image URIs and artist for the UI.
  - `DECKS`, `deckLibrary()`: the prebuilt decks, red-aggro and green-stompy (`src/decks/`), by name and count. M4's
    deck model (`packages/decks`) will absorb this shape.
- `scripts/fetch.ts` (`pnpm cards:fetch`) and `scripts/extract.ts` (`pnpm cards:extract`): the data pipeline. These
  are the only Node-only code here; `src/` also runs in the browser.

## Tests

`pnpm test` runs `test/pool.test.ts` (pool, definitions and errata check) and `test/printed.test.ts` (parsing
mana costs and type lines). They read only committed files, so they don't need the Scryfall download.
