# Open MTG Arena

A free, open-source Magic: The Gathering rules engine, written in TypeScript as a pure, deterministic reducer. It
will power a touch-first web app in the spirit of MTG Arena, and later an offline single-player RPG. Everything runs
locally: there is no server.

> Open MTG Arena is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards.
> Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.

## Status

- **Engine (M1, M2):** the rules of Magic for the whole Magic 2010 core set (240 cards, two set aside), checked
  against the Comprehensive Rules: priority and the stack, combat with every keyword in the set, triggered and
  activated abilities, replacement and prevention effects, the layer system, counters, tokens, Auras and Equipment,
  planeswalkers, copies, and hidden information.
- **Command-line client:** play and inspect games as text, against another person or a built-in agent.
- **Next (M3):** the web app. See [`docs/roadmap.md`](docs/roadmap.md).

## Getting started

You need [Node.js](https://nodejs.org) 26 or later and pnpm (`corepack enable` sets it up from `package.json`).

```sh
git clone https://github.com/BenjaminHor/open-mtg-arena.git
cd open-mtg-arena
corepack enable
pnpm install
pnpm check   # typecheck, lint and every test
```

There is no build step: Node runs the TypeScript source directly.

## Playing a game in the terminal

The CLI is stateless: each command reads a game file, does one thing, and writes it back. So you play one command at
a time, and the file is also a complete replay of the game.

**1. Start a game** between two prebuilt decks (`white-soldiers`, `red-green-beats`, `blue-black-control`, and the
simpler `red-aggro` and `green-stompy`):

```sh
pnpm cli new --decks white-soldiers,red-green-beats --seed 1 --out game.json
```

The seed fixes the shuffles, so the same seed gives the same game. `--first p1` skips choosing who goes first.

**2. See where things stand.** You are `p1`; `--as p1` shows only what p1 may see (without it, both hands are shown):

```sh
pnpm cli show game.json --as p1
```

```
Turn 1 · p1 · main1 · p1 has priority
p2  life 20  hand 7  library 33  graveyard 0
    battlefield: (none)
stack: (empty)
p1  life 20  hand 7  library 33  graveyard 0
    battlefield: (none)
    hand: Plains, Pacifism, Holy Strength, Soul Warden, Plains, Palace Guard, Plains
pending: priority (p1) — 6 legal actions; run `pnpm cli actions`
```

The last line says who must decide what: here p1 has priority.

**3. List your options and take one.** Every decision (who goes first, mulligans, priority, targets, paying mana,
attackers, blockers) works the same way:

```sh
pnpm cli actions game.json   # numbered legal actions
pnpm cli do game.json 2      # take action 2
```

```
p1 — priority:
  1. pass
  2. play Plains
  3. play Plains
  4. play Plains
  5. cast Soul Warden
  6. cast Palace Guard
```

You can also say what you want in words, the way the test scenarios do:

```sh
pnpm cli do game.json "play: Plains"
pnpm cli do game.json "cast: Soul Warden, pay: auto"
pnpm cli do game.json "cast: Lightning Bolt, targets: [p2], pay: auto"
pnpm cli do game.json "all pass: once"                    # both players pass: the spell on top resolves
pnpm cli do game.json "all pass: until combat.declareAttackers"
pnpm cli do game.json "p1 attack: [Soul Warden]"
pnpm cli do game.json "p1 concede: now"
```

**4. Let the computer play your opponent.** `ai` makes the other player's decisions until it's your turn to decide
again:

```sh
pnpm cli ai game.json --until p1
```

The built-in agents (`--agent random`, the default, `by-kind` or `first-legal`) only pick among legal actions; they
test the rules, they don't play well. A real AI opponent comes later.

**5. Read what happened.**

```sh
pnpm cli log game.json --brief          # every event so far, by turn (without --brief, every priority pass too)
pnpm cli inspect game.json "p1:Soul Warden"   # a permanent's characteristics and what changed them
```

To watch a whole game between two agents: `pnpm cli auto game.json --ai both --max-turns 30`. `pnpm cli --help`
lists every command; [`docs/testing.md`](docs/testing.md) (section 2) has the details.

## Development

| Command | What it does |
| --- | --- |
| `pnpm check` | Typecheck, lint and all tests: the definition of "green" |
| `pnpm test` / `pnpm test:scenarios` | All tests / the rules scenarios only |
| `pnpm fuzz --games 500` | Random legal games, checking the engine's invariants after every action |
| `pnpm coverage:rules` | Which Comprehensive Rules the code implements and which test proves each |
| `pnpm bench` | Engine benchmarks against `bench/baseline.json` |
| `pnpm cli <command>` | The command-line client above |
| `node scripts/rule.mjs 601.2` | Print a Comprehensive Rules section (`--search "phased out"`, `--glossary trample`) |

The code is in `packages/`: `engine` (the rules, depending on nothing else), `cards` (card definitions as data, and
the prebuilt decks), `scenarios` (rules tests written in YAML), `cli`, and `ai` (to come). Each package and engine
folder has its own README.

Documentation is in [`docs/`](docs): the [architecture](docs/architecture.md) and its invariants, the
[decisions](docs/decisions.md) so far, [card scripting](docs/card-scripting.md), [testing](docs/testing.md), the
[roadmap](docs/roadmap.md) and the current [status](docs/status.md). Every rule the engine implements cites the
Comprehensive Rules (in [`rules/`](rules)) and is backed by a test. `CLAUDE.md` holds the conventions for working on
the code with Claude Code, which builds most of it.

## License

The code and documentation in this repository are released under the [MIT License](LICENSE).

That license covers only this project's own work. Magic: The Gathering card names, text, symbols, mana symbols, rules
text (including the Comprehensive Rules in `rules/`) and art are the property of Wizards of the Coast. Card data comes
from [Scryfall](https://scryfall.com) under its API terms; card images are never bundled with the project. This
project is free and non-commercial.
