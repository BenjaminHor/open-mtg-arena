# packages/cards/data

**Generated. Don't edit by hand.** `pnpm cards:extract` writes these files from Scryfall's bulk data
(downloaded by `pnpm cards:fetch` into `scryfall/`, which is gitignored).

- `pool.json`: Oracle data for every card in `../pool.txt`, sorted by name, plus when Scryfall last updated it.
- `rulings/<slug>.json`: Scryfall's rulings for each pool card.

To refresh: `pnpm cards:fetch && pnpm cards:extract`, then read the diff. A changed `oracleText` makes the errata
test fail for that card (docs/card-scripting.md).
