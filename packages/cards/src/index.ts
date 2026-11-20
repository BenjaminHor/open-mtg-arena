// Card definitions (data) and the extracted card pool. See README.md and docs/card-scripting.md.

export { cardDatabase, POOL } from "./database.ts";
export { DECKS, type DeckList, deckLibrary } from "./decks/index.ts";
export { definitionProblems } from "./definition-problems.ts";
export { CARD_DEFS } from "./defs/index.ts";
export { conditionalEffects, delayedAbilities } from "./flat-effects.ts";
export type { PoolCard, PoolFile, RulingsFile } from "./pool-data.ts";
export { slugify } from "./pool-data.ts";
