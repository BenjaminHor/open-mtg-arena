---
name: add-cards
description: Add one or more Magic cards to the supported card pool, with definitions and scenario tests. Use when the owner asks to support new cards, a set, or a deck.
---

# Adding cards to the pool

Read `docs/card-scripting.md` first. A card is added only when it works completely. Never add a card
that depends on rules the engine doesn't support yet.

## Steps

1. **Triage the batch.** For each requested card, read its Oracle text in `packages/cards/data/pool.json`
   (run `pnpm cards:extract` after adding names to a scratch list, or look it up in `data/scryfall/` if
   present). Sort cards into:
   - ready: everything it needs already exists in the engine;
   - needs engine work: list the missing rule or effect op with its CR number;
   - out of scope for the current milestone.
   Report this triage to the owner before doing engine work beyond small, obvious additions.
2. **For each ready card:**
   - Read its rulings file and the CR rules for each keyword and ability (use the `rules-lookup` skill).
   - Write `packages/cards/src/defs/<first-letter>/<slug>.ts`. Reuse shared keywords and existing effect ops. If the card
     needs something like an existing one-off block (D-134 lists them), generalize that block now, with both cards as
     its tests, instead of adding a second one-off (D-126).
   - Write scenarios under `packages/engine/test/scenarios/cards/<slug>/`: the basic use, each relevant ruling,
     and at least one negative case (an illegal target, wrong timing, or the interaction it doesn't have).
   - Add the name to `pool.txt`.
3. **Test interactions.** For each new mechanic or rule area in the batch, write interaction scenarios against the
   existing pool cards that share it (see "Interaction scenarios" in `docs/testing.md`), and update the
   interaction matrix in `packages/engine/test/scenarios/interactions/README.md`.
4. Run `pnpm cards:extract` and `pnpm check`. The definition-vs-Oracle test must pass, and the rules coverage
   report must show no new gaps.
5. Play each new card at least once in the CLI (`pnpm cli new --scenario cards/<slug>/<file>` then `do`/`show`).
6. Run `pnpm fuzz --games 300` with a random deck containing the new cards.
7. **Golden games.** If any existing golden game changed, read the diff. Changes are expected only where the old
   games couldn't have involved the new cards, so any change to an old game is a red flag: investigate before
   regenerating. Then run `pnpm golden:cover`, which adds, greedily, the games running the most new mechanics per action
   (D-082); the golden test fails until every mechanic in the pool runs. A card with no new mechanic adds no game: its
   scenarios cover it (a test checks every pool card is in a scenario).
8. For anything beyond vanilla effects, ask the `rules-judge` agent to review the batch.
9. Update `docs/status.md` with the cards added, any that were deferred (and why), and any new coverage gaps.

Work in batches of about 10–20 cards per session so each batch is reviewable.
