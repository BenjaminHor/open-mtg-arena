# Card scripting

Cards are **typed data**. A person should be able to put a card definition next to its Oracle text
and check that they say the same thing.

## Where things live

```
packages/cards/
  pool.txt                   the card pool: one card name per line (the source of truth for what's supported)
  data/pool.json             generated: Oracle data for pool cards (name, cost, types, text, oracle_id, image URIs, artist)
  data/rulings/<slug>.json   generated: Scryfall rulings for each pool card
  src/defs/<first-letter>/<slug>.ts   one hand-written definition per card
  src/keywords/              shared definitions for keyword abilities (flying, haste, ...)
  src/decks/                 prebuilt decks (M2: red-aggro, green-stompy)
  test/                      per-card scenario tests live with the engine scenarios, tagged by card
```

`pnpm cards:fetch` downloads Scryfall bulk data (`oracle-cards` and `rulings`) into `data/scryfall/`
(gitignored, large). `pnpm cards:extract` reads `pool.txt` and writes `data/pool.json` and `data/rulings/`.
Commit those small generated files. Follow Scryfall's request rate guidance (see `data-sources.md`):
bulk files are downloaded once, and the API isn't called per card.

## Shape of a definition

The exact types are designed in M1 (`engine/src/cards/types.ts`). They should come out roughly like this:

```ts
// src/defs/l/lightning-bolt.ts
export const lightningBolt: CardDef = {
  name: 'Lightning Bolt',            // must match pool.json exactly; printed data is checked against it
  oracle: 'Lightning Bolt deals 3 damage to any target.',
  spell: {
    targets: [{ kind: 'anyTarget' }],                           // CR 115.4
    effects: [{ op: 'dealDamage', amount: 3, source: 'self', to: { target: 0 } }],
  },
};

// src/defs/l/llanowar-elves.ts
export const llanowarElves: CardDef = {
  name: 'Llanowar Elves',
  oracle: '{T}: Add {G}.',
  abilities: [
    { kind: 'activated', cost: [{ tap: 'self' }], manaAbility: true,   // CR 605.1a
      effects: [{ op: 'addMana', mana: 'G' }] },
  ],
};

// src/defs/g/giant-growth.ts
export const giantGrowth: CardDef = {
  name: 'Giant Growth',
  oracle: 'Target creature gets +3/+3 until end of turn.',
  spell: {
    targets: [{ kind: 'creature' }],
    effects: [{ op: 'modifyPT', power: 3, toughness: 3, of: { target: 0 }, duration: 'endOfTurn' }], // layer 7c
  },
  aiHints: { role: 'combatTrick' },
};
```

Printed characteristics (mana cost, types, power/toughness) come from `pool.json`, not the
definition. A test checks every definition against `pool.json`, and that every card in `pool.txt`
has a definition.

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
