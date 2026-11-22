# Vision

## What we're building

1. **A Magic: The Gathering rules engine**, built from scratch as a pure reducer and conceptually
   similar to Forge: a complete, correct implementation of the Comprehensive Rules for the cards we support. This is
   the end goal (owner, D-051): an accurate engine defined by the CR, growing toward every rule two-player games use,
   each built and tested with the cards that use it.
2. **An Arena-style web app** on top of it, and a **one-stop shop** for the game: play matches against
   the AI, browse and search every Magic card, build and manage decks with the features of the best
   deckbuilding tools, open packs, and manage a collection. Touch first. See `deckbuilding.md`.
3. **Later, an offline single-player RPG** on the same engine, in the spirit of Shandalar:
   explore a world, visit areas, fight enemies in card battles, find and buy cards, open packs.

The order matters. Rules depth comes first, then the Arena-style app (D-051). The RPG starts only once the
engine, the architecture and the app foundations are settled and working.

## Who it's for

The project owner first: a single player, mainly on an iPhone Duo (a foldable with a 5.4-inch
outer screen and a 7.6-inch inner screen), and also desktop browsers.

## Product requirements

- **Pure web app.** Nothing to install except optional "Add to Home Screen". It works offline
  after the first load. The only big download is card art, fetched on first run and cached.
- **No server, no accounts.** Everything runs in the browser and is saved on the device, with export/import of saves.
- **A polished, smooth match experience is a guiding principle**, with MTG Arena as the bar. Playing a
  match should feel fluid: instant response to every touch, clear and readable animations, smart
  auto-pass and auto-tapping so the player only makes meaningful decisions, and never a moment of
  "what is the game waiting for?" When polish and a new feature compete, polish of the core match wins.
  See the "Feel" section of `ui.md`.
- **Touch first**, with live switching between the folded and unfolded layouts. Mouse works too.
- **Single player against the AI.** A hotseat mode (two humans on one device) exists for testing.
- **Optional LLM opponents (owner wish, 2026-11-22).** A player may add their own OpenRouter API key and pick a model
  to play the AI opponent. The browser calls OpenRouter directly with the player's key (no server of ours); the
  built-in AI stays the default and the only one offline. The model sees only the player view (as `brief` builds it,
  D-135) and picks among the legal actions. It's in M3 (M3-02b, D-136). The owner isn't
  concerned about cost or speed (fast, capable models exist), so one call per real decision with the whole view is fine.
  It needs to know its deck as a player does: its own decklist and what's left in its library (counts, never the
  order), the cards the opponent has shown this game, and the deck's game plan.
- **Correct rules.** When in doubt, the Comprehensive Rules win, not convenience.
- **Readable, maintainable code** that a person can work on. AI writes most of it, but nothing is a black box.

## Non-goals (for now)

- Online multiplayer or any backend.
- Tracking real paper card collections. The collection is the player's in-game collection only; this is a standalone game.
- Selling it, ads, or any monetization. This is a free fan project.
- Supporting every Magic card at once. The goal is every two-player rule eventually, but the pool grows by sets or
  themes, each card fully supported before it's added (D-051).
- Formats other than two-player games (no Commander multiplayer, Planechase, etc.) until much later.

## Card pool strategy

Start with 17 simple cards (M1), then about 200 (M2, rules depth), then grow by sets or themes. A card is in the pool only when
it's fully scripted and has tests. Cards with unsupported rules are left out rather than half-working.

After M2, cards and mechanics come from what MTG Arena has (the owner, D-089): Scryfall's `in:arena in:paper
-is:alchemy`, a card printed on paper that's on Arena in some printing, never Alchemy and never digital-only designs
(their mechanics aren't in the Comprehensive Rules). A mechanic is built only when such a card needs it. Whether
Modern-only mechanics come later is an open question (`docs/status.md`).
