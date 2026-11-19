# Deckbuilding and collection

The app is a **one-stop shop**: playing matches, browsing cards, building and managing decks, and managing
a collection, all in one place and all offline. The bar is the best of today's tools: the Arena deckbuilder's
speed and touch feel, Moxfield's search and stats, and Archidekt's visual, category-based editing. The
"Feel" principles in `ui.md` apply here as much as in a match.

Features are tagged **[core]** (needed for M4 to be done), **[next]** (soon after) and **[later]**.

## Two kinds of card

- **Playable cards** are in the engine's pool (`packages/cards/pool.txt`), fully scripted and tested.
- **Every other Magic card** can be browsed, searched and put in decks, but those decks can't be played yet.
  A clear badge marks which cards are playable, and a deck shows exactly which cards block it from being played.
  As the pool grows, more saved decks become playable automatically.

## Card browser and search

- **[core]** Instant search as you type over a local index of every card. Results update within 100 ms on the phone.
- **[core]** Scryfall-style query syntax for power users (`c:r t:creature mv<=3`, `o:"draw a card"`, `r:rare`,
  `is:playable`) **and** touch-friendly filter chips for color, mana value, type, rarity, set and playability.
  The chips and the query box are two views of the same filter, so changing one updates the other.
- **[core]** Views: card image grid, compact list, text-only. Sort by name, mana value, color, type, rarity or set.
- **[core]** Card detail: full image, Oracle text, rulings, format legality, artist, playable badge, and
  "add to deck" with quantity.
- **[next]** Printings: choose which printing (art) a deck uses.
- **[later]** Saved searches.

## Deck editor

- **[core]** Add a card with one tap; long-press for details; swipe or tap minus to remove. Quantities shown on the card.
- **[core]** Main deck, sideboard and a **maybeboard** for cards being considered.
- **[core]** Grouping: by type, by mana value, by color, or by **custom categories** (such as "Removal" or
  "Ramp"), shown as visual stacks or as a list. Drag cards between categories.
- **[core]** Live stats: mana curve, color pips needed vs. color sources provided by lands, type breakdown,
  average mana value, land count.
- **[core]** "Add lands" helper that suggests a basic land split from the deck's color pips.
- **[core]** Validation for each format: 60-card constructed (Standard, Pioneer, Modern, Legacy, Vintage, Pauper,
  using Scryfall legality data), 40-card limited, and casual. Problems are listed in plain words ("4 copies max:
  you have 5 Lightning Bolt"). It also checks playability in the engine.
- **[core]** Undo and redo for every edit.
- **[core]** Import and export as text (`4 Lightning Bolt`, plus Arena-style lines with set and collector number),
  through paste, the clipboard or a file. Importing reports unknown card names instead of silently dropping them.
- **[core]** Deck name, cover card, notes, tags, and folders; duplicate, rename, delete (with undo); search the deck list.
- **[next]** Sample hand: draw 7, mulligan, draw the next card.
- **[next]** **Goldfish**: play the deck solo against no opponent using the real engine, to test how it runs.
- **[next]** Probability helper: the chance of drawing at least N copies of a card (or a category) by turn T.
- **[next]** Version history: snapshots on save, a list of changes between versions, restore any version.
- **[later]** Deck primer/description page, and a comparison of two decks side by side.

## Collection

The collection is the player's **in-game** collection only. Tracking real paper cards is a non-goal.

- **[core]** Two modes, switchable per deck or globally:
  - **Sandbox**: every playable card is available in unlimited numbers (as in Forge's constructed mode).
  - **Collection**: you can only use what you own. Missing cards are highlighted, with "build with what I own" filtering.
- **[core]** Owned counts per card, filters shared with the browser, duplicates, and set completion progress.
- **[core]** Earning cards: packs from M4's pack opening; later, rewards and shops in the RPG (M5).
- **[later]** Limited: sealed decks from opened packs, and drafting against AI bots.

## Touch layout

- **Unfolded and desktop**: two panes, with the browser on one side and the deck on the other. Drag cards across.
- **Folded**: one pane at a time, with the deck as a bottom sheet that's always one swipe away, showing the card
  count and curve at a glance.
- Everything in this document works with touch alone. Keyboard shortcuts on desktop are a bonus.

## Architecture

- `packages/library` (pure TypeScript): the card database format, the search index, and the query parser for
  the Scryfall-style syntax (with the chips mapping to the same filter data). Tested headlessly with many
  query examples.
- `packages/decks` (pure TypeScript): the deck model, validation, stats, the land helper, probabilities,
  import/export parsing, and version diffs. Tested headlessly. The CLI gets `deck` commands (`validate`,
  `stats`, `import`, `export`) so Claude Code can check this work without a browser.
- The full card database for browsing is a trimmed, compressed data file built at build time from Scryfall's
  `oracle-cards` bulk data (only the fields the app uses). It's downloaded on first run and stored in IndexedDB.
  Measure its size and keep it as small as reasonably possible.
- Card images for browsing are fetched from Scryfall on demand when online and cached. Offline, uncached cards
  show a clean text frame. Playable cards' images are downloaded up front (M2-08).
- Searching runs in a Web Worker so typing never stutters.
- Decks and collection live in IndexedDB and are included in save export/import.
