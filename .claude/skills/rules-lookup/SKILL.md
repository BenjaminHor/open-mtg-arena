---
name: rules-lookup
description: How to find and cite Magic Comprehensive Rules in this repo. Use whenever implementing, testing or explaining any game rule, keyword or card interaction.
---

# Looking up the Comprehensive Rules

The full Comprehensive Rules are in `rules/`, one small file per section. Never implement or explain
a rule from memory: look it up, read its subrules and cross-references, then cite it.

## Commands

```sh
node scripts/rule.mjs 702.19          # trample and all its subrules
node scripts/rule.mjs 510.1c 702.19c  # several specific rules
node scripts/rule.mjs 613             # a whole section (long; prefer specific rules)
node scripts/rule.mjs --search "can't be blocked"
node scripts/rule.mjs --glossary "first strike"
grep -rn "^704.5" rules/cr            # list all state-based action rules with their files
```

`rules/cr/INDEX.md` lists every section and its file. Keyword abilities are in
`rules/cr/702-keyword-abilities/` and keyword actions in `rules/cr/701-*/`, one file each.

## Process

1. Find the section for the topic (INDEX.md, or `--search`).
2. Read the whole top-level rule, including every lettered subrule and "Example:" line.
3. Follow each "see rule ..." reference that could affect the case.
4. Check the glossary entry for any term you're unsure of.
5. For a specific card, also read `packages/cards/data/rulings/<slug>.json`.

## Citing

- In code comments: `// CR 601.2c: the player announces targets before paying costs.` Cite the most
  specific rule, and paraphrase it briefly.
- In scenarios: `rules: [CR 601.2c, CR 608.2b]`.
- If two rules seem to conflict, the more specific one usually wins (and CR 101 has the golden rules).
  If it's still unclear, stop and ask the owner rather than choosing.
