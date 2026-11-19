# rules/

The Magic: The Gathering Comprehensive Rules (CR), split into small files so they're quick to
search and read. **Everything here except this README is generated** by `scripts/fetch-rules.mjs`.
Don't edit it by hand.

## Layout

| Path | What it is |
| --- | --- |
| `VERSION.json` | Effective date and where the rules came from |
| `cr/INDEX.md` | Every chapter and section, with the file it's in. Start here when browsing. |
| `cr/601-casting-spells.md` | One file per section (100–905) |
| `cr/702-keyword-abilities/702.9-flying.md` | Big sections (such as 701 and 702) are folders with one file per top-level rule |
| `glossary/t.md` | Glossary terms, one file per first letter |
| `raw/MagicCompRules.txt` | The original text (UTF-8), used by `scripts/rule.mjs` |

Every rule is on its own line and starts with its number, followed by any "Example:" lines.
That makes the number the search key.

## Looking things up

```sh
node scripts/rule.mjs 704.5g             # one rule
node scripts/rule.mjs 601.2              # a rule and all its subrules
node scripts/rule.mjs 613                # a whole section
node scripts/rule.mjs --search "phased out"
node scripts/rule.mjs --glossary "first strike"
grep -rn "^510.1c" rules/cr              # which file a rule is in
grep -rln "deathtouch" rules/cr          # every file that mentions a word
```

## Refreshing

When Wizards publishes a new version (usually with each major set):

```sh
node scripts/fetch-rules.mjs                         # downloads the latest TXT from magic.wizards.com
node scripts/fetch-rules.mjs ~/Downloads/MagicCompRules.txt   # or use a file you downloaded yourself
git diff --stat rules/
```

Then check whether any changed rules are cited in the code (`grep -rn "CR 7"`, and so on) and note it in `docs/status.md`.
