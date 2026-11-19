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
  src/decks/                 prebuilt decks (M2: red-aggro, green-stompy)
  scripts/                   fetch.ts and extract.ts (Node only; src/ must also run in the browser)
  test/                      pool and parser tests; per-card scenarios live with the engine scenarios
```

`pnpm cards:fetch` downloads Scryfall bulk data (`oracle-cards` and `rulings`, gzipped JSON Lines) into `data/scryfall/`
(gitignored, about 30 MB). `pnpm cards:extract` reads `pool.txt` and writes `data/pool.json` and `data/rulings/`.
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
