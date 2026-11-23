# Data sources and their terms

## Comprehensive Rules

- Official source: https://magic.wizards.com/en/rules (TXT, PDF and DOCX downloads). Updated with most new sets.
- `node scripts/fetch-rules.mjs` finds the latest TXT link on that page, downloads it and writes `rules/`.
  If the download is blocked (for example in a sandboxed environment), download the TXT by hand and run
  `node scripts/fetch-rules.mjs path/to/MagicCompRules.txt`.
- Behind an HTTPS proxy (as in Claude Code on the web), Node's `fetch` ignores `HTTPS_PROXY` unless
  `NODE_USE_ENV_PROXY=1` is set: `NODE_USE_ENV_PROXY=1 node scripts/fetch-rules.mjs`.
- The generated files are committed (D-008). `rules/VERSION.json` records the effective date.
- After a refresh, run `git diff --stat rules/` and check whether any changed rules are cited in the code
  (`grep -rn "CR <number>"`). Note relevant changes in `docs/status.md`.

## Scryfall (card data, rulings, images)

API docs: https://scryfall.com/docs/api. Key points to follow:
- Don't simply repackage or republish Scryfall data. Our app adds value (a game), and we extract only the pool's cards.
- Use the **bulk data** files (`oracle-cards`, `default-cards`, `rulings`) for card data instead of calling the API per card.
  The browsable card database (`deckbuilding.md`) is a trimmed subset built from `oracle-cards` at build time
  and used inside the game and deckbuilder. It's never offered as a standalone data download.
- Images for browsing are fetched on demand, one card at a time as it scrolls into view, then cached.
- When the API is called, keep at least 50–100 ms between requests and send a descriptive `User-Agent`
  and an `Accept` header.
- Image files on `*.scryfall.io` aren't rate-limited, but the app still downloads them gently: in batches,
  only for cards in the pool, and only once (cached).
- Don't crop out, cover or alter the artist name and copyright on images. When showing an art crop,
  show the artist credit elsewhere in the same view. The long-press card view always shows the full card image.
  On the board, permanents show art crops without a credit (as Arena does): the owner ruled (2026-11-23, D-155) that
  the long-press view, with the full card image and its artist credit, is enough.
- Don't use the Scryfall name or logo in a way that implies endorsement.
- Which cards come after M2 (D-089): Scryfall's `in:arena in:paper -is:alchemy` (the owner's filter, and the
  definition). Offline, the bulk `default-cards` file approximates it with no API calls: a card with some printing whose
  `games` includes `"arena"` and some printing whose `games` includes `"paper"`, and which isn't Alchemy (names
  starting "A-", or only in sets whose `set_type` is `"alchemy"`). Skip the few digital designs printed on paper
  (Mystery Booster's Oracle of the Alpha and the like): conjure, seek and perpetually aren't in the CR.

## Wizards of the Coast

Magic card names, text, symbols and art are Wizards of the Coast's property. This project stays free and
non-commercial, doesn't bundle card images, and says clearly that it's an unofficial fan project not
approved or endorsed by Wizards of the Coast. Before the first public deploy, the owner reads Wizards'
current Fan Content Policy and uses the exact notice wording it asks for, in the app's About screen and the README.
