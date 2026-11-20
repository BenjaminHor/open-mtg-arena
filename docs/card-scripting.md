# Card scripting

Cards are **typed data**. A person should be able to put a card definition next to its Oracle text
and check that they say the same thing.

## Where things live

```
packages/cards/
  pool.txt                   the card pool: one card name per line (the source of truth for what's supported)
  data/pool.json             generated: Oracle data for pool cards (name, cost, types, text, oracle_id, image URIs, artist)
                             plus when Scryfall last updated it
  data/rulings/<slug>.json   generated: Scryfall rulings for each pool card
  src/defs/<first-letter>/<slug>.ts   one hand-written definition per card
  src/keywords/              shared definitions for keyword abilities (flying, haste, ...), from M1-13
  src/decks/                 prebuilt decks: red-aggro, green-stompy (M1 spec)
  scripts/                   fetch.ts and extract.ts (Node only; src/ must also run in the browser)
  test/                      pool and parser tests; per-card scenarios live with the engine scenarios
```

`pnpm cards:fetch` downloads Scryfall bulk data (`oracle-cards`, `default-cards` and `rulings`, gzipped JSON Lines) into
`data/scryfall/` (gitignored, about 110 MB). Rules data comes from Oracle Cards; the printing whose art is shown is pinned
in `pool.txt` (`Lightning Bolt [m10]`) or picked by a fixed rule from Default Cards (D-029). `pnpm cards:extract` reads `pool.txt` and writes `data/pool.json` and `data/rulings/`.
Commit those small generated files. Follow Scryfall's request rate guidance (see `data-sources.md`):
bulk files are downloaded once, and the API isn't called per card.

## Shape of a definition

The types are in `engine/src/cards/types.ts` (a first draft, D-026). A definition is only what the card *does*;
printed values (mana cost, types, power/toughness) come from `pool.json`. For example:

```ts
// src/defs/l/lightning-bolt.ts
export const lightningBolt: CardDef = {
  name: "Lightning Bolt",            // must match pool.json exactly
  oracle: "Lightning Bolt deals 3 damage to any target.",   // the exact Oracle text it was written against
  spell: {
    targets: [{ kind: "anyTarget" }],                       // one entry per instance of "target" (CR 115.4, 601.2c)
    effects: [{ op: "dealDamage", amount: 3, from: "self", to: { target: 0 } }],
  },
};

// src/defs/l/llanowar-elves.ts
export const llanowarElves: CardDef = {
  name: "Llanowar Elves",
  oracle: "{T}: Add {G}.",
  abilities: [
    { kind: "activated", cost: [{ kind: "tap" }], targets: [],
      effects: [{ op: "addMana", mana: "G", amount: 1 }] },   // a mana ability: the engine works that out (CR 605.1a)
  ],
};

// src/defs/f/furnace-whelp.ts
export const furnaceWhelp: CardDef = {
  name: "Furnace Whelp",
  oracle: "Flying\n{R}: This creature gets +1/+0 until end of turn.",
  keywords: ["flying"],
  abilities: [
    { kind: "activated", cost: [{ kind: "mana", cost: [{ kind: "colored", color: "R" }] }], targets: [],
      effects: [{ op: "modifyPT", power: 1, toughness: 0, of: "self", duration: "endOfTurn" }] },  // layer 7c
  ],
};
```

- Vanilla creatures are just `{ name, oracle: "" }`.
- Targets (`TargetSpec` in `engine/src/cards/types.ts`): one entry per instance of the word "target". "Target creature"
  is `{ kind: "permanent", filter: { types: ["creature"] } }`; the filter adds restrictions as they're printed
  ("nonblack": `notColors: ["B"]`, "white and/or blue": `colors: ["W", "U"]`, "blocking": `combat: "blocking"`, "an
  opponent controls": `controller: "opponent"`). Other kinds: `anyTarget`, `playerOrPlaneswalker`, `spell`,
  `cardInGraveyard` (yours or any). "One, two, or three target ..." adds `count: { min: 1, max: 3 }`; "up to three" is
  `{ min: 0, max: 3 }`; "any number" is `max: "any"`. Damage "divided as you choose" is `divided: "asYouChoose"` on the
  effect (Ignite Disorder); "divided evenly, rounded down" is `divided: "evenly"` (Fireball).
- X: `{X}` in the mana cost comes from the card data; an effect's amount of X is `amount: "X"`. "This spell costs {1}
  more to cast for each target beyond the first" is `costIncrease: { perTargetBeyondFirst: [...] }` on the spell.
- Costs of activated abilities are a list of parts: `{ kind: "mana", cost }`, `{ kind: "tap" }`, and "Sacrifice a
  creature" as `{ kind: "sacrifice", filter: { types: ["creature"] } }` (a permanent its controller controls).
- Effects name what they act on with a subject: `{ target: 0 }`, `"self"` (the spell, or the ability's source), or
  `"you"` (the controller: "you gain 4 life" is `{ op: "gainLife", who: "you", amount: 4 }`), or `"eachPlayer"` (in
  APNAP order: Burning Inquiry). "Target player" is the target kind `player`; "target opponent" is `opponent`. `"found"` names
  what an earlier `search` in the same text found ("put that card into your hand").
- Amounts: a number, `"X"`, or `{ count: { subtypes: ["Swamp"], controller: "you" } }` ("the number of Swamps you
  control"). "Each creature without flying" is the subject `{ each: { types: ["creature"], notKeywords: ["flying"] } }`;
  "...and 3 damage to you" is `and: [{ to: "you", amount: 3 }]` on `dealDamage`. "Spend only black mana on X" is
  `xPaidWith: "B"` on the spell. "Add one mana of any color" is `{ op: "addMana", mana: "anyColor", amount: 1 }`, and
  "Add {G} or {W}" is `mana: { oneOf: ["G", "W"] }` (the color comes with the activation, D-068);
  "each opponent sacrifices a land of their choice" is `{ op: "sacrifice", who: "eachOpponent", filter: { types:
  ["land"] } }`.
- Filters: "basic land card" is `{ supertypes: ["basic"], types: ["land"] }`; "other than basic land cards" is
  `{ not: { supertypes: ["basic"], types: ["land"] } }`. "Sacrifice this land" is the cost part `{ kind: "sacrificeSelf" }`. The ops are listed in
  `engine/src/effects/README.md`.
- Keyword actions (CR 701) Scryfall lists among the keywords, such as Mill, go in `KEYWORD_ACTIONS` in
  `definition-problems.ts` as the first card using each arrives, not in the definition's `keywords`; so do generic terms
  it lists beside a keyword ("Landwalk" beside "Swampwalk", `GENERIC_TERMS`).
- Static abilities that aren't keywords go in `statics` (D-071): "This creature can't be blocked" is
  `{ kind: "cantBeBlocked" }`, "can't be blocked except by black creatures" adds `except: { types: ["creature"],
  colors: ["B"] }`, "can block any number of creatures" is `{ kind: "canBlockAnyNumber" }`, "can't attack or block
  alone" is `{ kind: "cantAttackOrBlockAlone" }`, "attacks each combat if able" is `{ kind: "attacksEachCombat" }`, "all
  creatures able to block this creature do so" is `{ kind: "mustBeBlockedByAllAble" }`. The engine reads them only
  through `staticAbilitiesOf`.
- Triggered abilities go in `triggers` (D-076), each `{ when, onlyIf?, optional?, targets, effects }`. `when` is the
  trigger condition: "when this creature enters" is `{ kind: "selfEnters" }`, "whenever another creature enters" is
  `{ kind: "anotherEnters", filter: { types: ["creature"] } }` (a filter's `controller` is relative to the trigger's
  controller), "at the beginning of each player's draw step" is `{ kind: "beginningOfStep", step: "draw", whose:
  "each" }` ("the end step" likewise, `step: "end"`; "your upkeep" is `step: "upkeep", whose: "yours"`), "whenever this creature attacks" is `{ kind: "selfAttacks" }`. "Whenever a
  player casts a green spell" is `{ kind: "spellCast", filter: { colors: ["G"] } }` ("you cast" adds `controller:
  "you"`, the caster); "whenever an opponent draws / discards a card" is `{ kind: "playerDraws" / "playerDiscards",
  player: "opponent" }` (`"anyPlayer"`, `"you"`); "whenever a player taps a land for mana" is `{ kind:
  "landTappedForMana" }`; "whenever this creature deals [combat] damage to [an opponent / a player]" is `{ kind:
  "selfDealsDamageToPlayer", player, combatOnly }`; "whenever you gain life" is `{ kind: "playerGainsLife", player:
  "you" }`, with "that much" the amount `"thatMuch"`. "Whenever this creature blocks or becomes blocked by a creature"
  is `{ kind: "selfBlocksOrBlocked" }`, "that creature" being the subject `"triggeringObject"`. "When this creature
  becomes the target of a spell or ability" is `{ kind: "selfBecomesTarget" }`. "At the beginning of the next end step,
  [effects]" is `{ op: "createDelayedTrigger", ability: { when: { kind: "beginningOfStep", step: "end", whose: "each"
  }, targets: [], effects } }` (CR 603.7; only the next beginning of anyone's step, with no targets, for now); "if this
  ability has been activated four or more times this turn, [effects]" is `{ op: "ifActivatedThisTurn", atLeast: 4,
  effects }`, for an activated ability only (D-078). "Sacrifice a creature
  other than this creature" is `{ op: "sacrifice", ..., otherThanSelf: true }`, "equal to the sacrificed creature's
  power" the amount `"sacrificedPower"`, "if you can't sacrifice a creature, ..." `{ op: "ifNothingSacrificed",
  effects }`; "destroy one of them at random" is `{ op: "destroyOneAtRandom", among: [{ target: 0 }, { target: 1 }] }`. "Target permanent that player controls" is a target filter with
  `controller: "triggeringPlayer"` (targets only). "If this artifact
  is untapped" right after the condition is an intervening if, `onlyIf: { kind: "sourceUntapped" }` (CR 603.4). "You
  may" is `optional: true` (asked as it resolves). "That player" is the subject `"triggeringPlayer"`; "sacrifice it"
  (the source) is `{ op: "sacrificeSource" }`. The engine reads them only through `triggersOf`.
- Replacement effects in a card's own text are `def.replacements` (CR 614.1, D-085), read only through
  `replacementsOf`: "This land enters tapped unless you control a Forest or a Plains" is `{ kind: "entersTapped",
  unless: { subtypes: ["Forest", "Plains"], controller: "you" } }` (land types, not names; "you" is the player it
  enters under); "If this would be put into a graveyard from anywhere, reveal it and shuffle it into its owner's
  library instead" is `{ kind: "graveyardToLibrary" }`. Indestructible is a keyword (CR 702.12).
- Basic lands have no abilities in their definition: a land with a basic land type has its mana ability intrinsically
  (CR 305.6), so the engine derives it from its land types as computed in layer 4. That keeps working when effects change
  a land's type (CR 305.7). It's referred to as `{ kind: "basicLandType", landType }` (D-028).
- `src/defs/index.ts` lists every definition. `cardDatabase()` joins them with `pool.json` (by name) into the engine's
  `CardDatabase`, keyed by `oracleId`.

Tests (`packages/cards/test/pool.test.ts`) check that `pool.txt`, `pool.json` and the definitions name exactly the same
cards, that each definition's `oracle` equals the current Oracle text, and that its `keywords` match Scryfall's.

## Principles

- **Keywords are shared.** `keywords: ['flying', 'haste']` refers to `src/keywords/`, each citing its CR 702 rule.
- **Prefer a general effect to a card-specific one.** Add a new effect op only when existing ops
  can't express the card, and document each op in `engine/src/effects/README.md` with its CR basis.
- **No functions in definitions.** If a card truly can't be expressed, extend the effect language
  in the engine (with tests). Never add an escape hatch.
- **Oracle text is the reference, not the printed text.** Errata and modern wording win.
- **A card is supported only when complete.** No partially working cards in `pool.txt`.
- **Errata are caught automatically.** Each definition's `oracle` field is the exact Oracle text it was written
  against. A test compares it with `data/pool.json`. When Wizards changes a card's official text and `cards:extract`
  picks it up, the test fails for that card. Then re-read the new text, update the definition and its scenarios if
  the behavior changed, and update the `oracle` field. Never update only the string to make the test pass.
  Refresh card data at least whenever the rules are refreshed.

## Per-card checklist (the `add-cards` skill follows this)

1. Read the Oracle text and the card's rulings file.
2. Look up the CR rules for every keyword and ability involved.
3. Write the definition.
4. Write scenarios: the basic behavior, every ruling that applies to supported rules, and at least one negative case.
5. Add the name to `pool.txt` and run `pnpm cards:extract`.
6. `pnpm check`, then play it once in the CLI.

## Scaling to every card

The owner asked how 30,000+ definitions would be stored (2026-11-20). Measured then, Scryfall's Oracle Cards held 39,356
entries; their rules data (name, cost, types, text, power and toughness, faces) is about 25 MB of JSON, **under 5 MB
gzipped**. Definitions are small too: the M1 ones average about 230 bytes, and a long card might reach 2 KB, so 30,000
would be roughly 20–30 MB of source and a few MB compressed. Art is never part of this; it's downloaded and cached at
runtime (D-007).

Measured again at 158 cards (2026-11-20, M2-08a, the owner asking again): per card, the pool data is about 1.1 KB
(170 bytes gzipped), the definition about 440 bytes (80 gzipped), the rulings about 410 bytes (80 gzipped). At 30,000
cards that's roughly 34 MB, 13 MB and 12 MB raw, about 10 MB gzipped all together: too much to ship on a phone's first
load, but no game, deck or search needs it all at once (below), and rulings are only read in a card's details.

So size isn't the hard part. The plan as the pool grows, none of it needed yet:
- **Keep one file per card** (`src/defs/<letter>/<slug>.ts`): readable, reviewable, merges cleanly; git handles tens of
  thousands of small files. Generate `defs/index.ts` (and the pool files) instead of keeping them by hand, once that
  list gets long.
- **Load only what a game needs.** The engine already takes the `CardDatabase` as a parameter, not a global, so a match
  can hand it just the cards in its two decks. Split the definitions into chunks (by set) that the app loads on demand
  and caches offline; the deckbuilder searches a slim index (name, cost, types, text) and loads a card's definition only
  when it's added to a deck or played.
- **The real cost is writing and checking the definitions.** Each card must be scripted and tested before it joins the
  pool (D-051, D-052). Most cards reuse a small set of patterns, so a later tool can draft a definition from templated
  Oracle text for a person (or the `add-cards` skill) to check against the card and test; it never adds a card
  untested.
