# Testing and validation

Claude Code must be able to **check its own work at every step**, without a browser and
without a person watching. These are the tools for that, from most to least specific:

1. **Scenario tests:** set up a board, take actions, check the result. These are the real spec.
   **Interaction scenarios** check how cards and mechanics combine.
2. **The headless CLI:** play or step through a game as text and inspect everything.
3. **Invariant fuzzing:** thousands of random legal games that must never break the rules of the engine itself.
4. **Replays and golden games:** recorded games (including the owner's bug reports) replayed exactly,
   with readable diffs when an engine change alters what happens.
5. **The rules coverage report:** which CR rules are implemented but not tested.
6. **Benchmarks:** the engine must not get slower without anyone noticing.
7. **Mutation testing** (from M3): proof that the tests would catch the engine being wrong.

What runs when:

| When | What runs |
| --- | --- |
| Every `pnpm check` (and CI on every push) | typecheck, lint, all scenarios, golden games, a short fuzz, the coverage report (fails on new gaps) |
| Before merging engine or card changes | a longer fuzz (`pnpm fuzz --games 2000`), `pnpm bench` against the baseline |
| Weekly, or before finishing a milestone | mutation testing on the engine, the full fuzz (10,000+ games) |

Plain unit tests are fine for small helpers, but rules behavior is tested with scenarios.

## 1. Scenario tests

Scenario files are YAML in `packages/engine/test/scenarios/<area>/*.yaml`, grouped by CR area
(`casting/`, `combat/`, `sba/`, `layers/`, ...). They must stay readable by the project owner,
who checks behavior by reading them rather than the engine code.

```yaml
name: Lightning Bolt kills a 2/2
rules: [CR 120.3, CR 704.5g]
setup:
  turn: { active: p1, step: main1 }
  p1:
    battlefield: [Mountain]
    hand: [Lightning Bolt]
  p2:
    battlefield: [Grizzly Bears]
steps:
  - p1 cast: Lightning Bolt
    targets: [p2:Grizzly Bears]
    pay: auto
  - expect:
      stack: [Lightning Bolt]
  - all pass: once           # both players pass priority once, so the top of the stack resolves
  - expect:
      p2.graveyard: [Grizzly Bears]
      p1.graveyard: [Lightning Bolt]
      p2.life: 20
      stack: []
```

### Format

- **setup**: `turn` (active player, step, optional turn number), then per player:
  `life`, `library` (top first), `hand`, `battlefield`, `graveyard`, `exile`, `manaPool`.
  A battlefield entry can be a name or a map: `{ card: Grizzly Bears, tapped: true, sick: false,
  damage: 1, counters: { +1/+1: 2 } }`. `sick: true` means it hasn't been under its controller's control continuously
  since their most recent turn began (CR 302.6), so a creature that entered on its controller's last turn is still
  sick during the opponent's turn. Unlisted libraries default to 20 basic lands, so drawing doesn't lose the game.
  `rules: [...]` lists rule modifiers (for testing RPG-style setups).
- **References**: `p2:Grizzly Bears` means the only Grizzly Bears that p2 controls. Use
  `p2:Grizzly Bears#2` when there are several (ordered as listed in setup). `p1` and `p2` alone mean players.
- **Steps** (each step is one of):
  - `p1 cast: <card>` with optional `targets`, `modes`, `x`, `pay: auto | [<mana sources>]`
  - `p1 activate: <card>` with optional `ability: <index>` and the same options
  - `p1 play: <land>`
  - `p1 pass: once`, `all pass: once`, `all pass: until <step>` (for example `until combat.declareBlockers`)
  - `p1 attack: [<creature>, ...]`, `p2 block: { <blocker>: <attacker>, ... }`
  - `p1 choose: <answer>` for any other pending decision (`yes`, `no`, a card, a list, an order)
  - `expect: { ... }` (see below). An `expect` can come after any step.
  - `expect error: <code>` asserts that the previous step was rejected as illegal (for example `notYourPriority`).
- **Expectations**: `pX.life`, `pX.<zone>` (exact list), `pX.<zone> contains: [...]`, `stack`,
  `step`, `pending: { player, kind }`, `<ref>.power`, `.toughness`, `.tapped`, `.damage`,
  `.counters`, `.abilities contains`, `winner`, `events contains: [{ type: ..., ... }]`.

The scenario runner (built in M1) converts each step into a real `Action` through the engine's
own `legalActions()`. **A step that names an illegal action fails the test** unless it's followed by
`expect error`. So scenarios also prove the legal-action list is right.

When the runner needs a new step or expectation, add it, document it here in the same commit,
and keep the vocabulary small.

### Rules for writing scenarios

- One behavior per file. The file name says what it proves: `bolt-kills-bear.yaml`, `reach-blocks-flyer.yaml`.
- Always fill in `rules:` with the CR numbers being tested.
- Include the negative case whenever there is one (a creature without reach can't block a flyer).
- Rulings from Scryfall (`packages/cards/data/rulings/`) and examples in the CR (the "Example:" lines)
  make excellent scenarios. Copy the situation, not the prose.

### Interaction scenarios

Per-card tests mostly test a card on its own. Fuzzing catches crashes and broken invariants, but not
results that are **wrong but valid**: a game that runs fine and gets an interaction wrong. So when a card or
mechanic is added, also test how it combines with what's already in the pool:

- Find what it interacts with: cards that share a rule area. For a new trample creature, that's every kind of
  blocker, damage prevention, pump spells and deathtouch. For a new removal spell, it's every kind of permanent
  it can hit, and every response to it.
- Write scenarios in `packages/engine/test/scenarios/interactions/<mechanic>/` for the combinations that the
  CR or the rulings treat specially, and for at least one ordinary case per related mechanic.
- Keep `packages/engine/test/scenarios/interactions/README.md` as a small matrix: mechanics on both axes, with
  each cell linking to the scenarios that cover the pair, or marked "not applicable" or "not yet". Claude Code
  updates it with each new mechanic, and the coverage report flags pairs marked "not yet".

## 2. The headless CLI

`packages/cli` lets Claude Code (or a person) play and inspect games as text. Claude Code's
shell runs one command at a time and can't drive an interactive prompt, so **the CLI is
stateless**: every command reads a game file, does one thing, and writes it back.

```sh
pnpm cli new --decks red-aggro,green-stompy --seed 42 --out /tmp/g.json   # start a game
pnpm cli new --scenario combat/reach-blocks-flyer --out /tmp/g.json       # start from a scenario's setup
pnpm cli show /tmp/g.json            # board, hands (debug shows both), stack, step, pending decision
pnpm cli show /tmp/g.json --as p2    # what p2 is allowed to see (playerView)
pnpm cli actions /tmp/g.json         # numbered legal actions for the pending decision
pnpm cli do /tmp/g.json 3            # take legal action #3
pnpm cli do /tmp/g.json "cast Lightning Bolt -> p2:Grizzly Bears"   # same step syntax as scenarios
pnpm cli ai /tmp/g.json --until p1   # let the AI act for the other player until p1 must decide
pnpm cli auto /tmp/g.json --ai both --max-turns 30   # AI vs AI to the end; prints a turn-by-turn log
pnpm cli log /tmp/g.json             # events so far, one per line, with CR-relevant detail
pnpm cli inspect /tmp/g.json "p2:Grizzly Bears"   # an object's computed characteristics and which effects/layers produced them
pnpm cli export /tmp/g.json --scenario > new.yaml # the game so far as a scenario (setup + steps)
pnpm cli replay bug-report.json      # replay a saved log and stop at the end (or --step N)
```

Output is plain, stable text with no colors unless `--color`, so it can be read by Claude and
compared in tests. `show` must make the full situation obvious at a glance, for example:

```
Turn 3 · p1 · main1 · p1 has priority
p2  life 17  hand 5  library 31  graveyard 1
    battlefield: Forest (T), Forest, Grizzly Bears 2/2 (sick)
stack: (empty)
p1  life 20  hand 4  library 32  graveyard 0
    battlefield: Mountain, Mountain (T), Raging Goblin 1/1
    hand: Shock, Hill Giant, Mountain, Lightning Bolt
pending: priority (p1) — 6 legal actions; run `pnpm cli actions`
```

**How Claude Code should use it**: after implementing a rule, start a game from a scenario,
step through it with `do`, and read `show`, `log` and `inspect` to confirm the behavior matches
the CR. Then make that path a scenario test with `export`, so it stays checked.

## 3. Invariant fuzzing

`pnpm fuzz --games N --seed S` plays games where every decision is a random legal action
(and some are AI-chosen), for both the M2 decks and random decks from the pool. After every
action it checks:

- the state round-trips through JSON unchanged
- every object is in exactly one zone, and every zone entry is an existing object
- `pending` is set, or `result` is set (the engine never stalls)
- every action from `legalActions()` is accepted by `applyAction()`
- replaying the action log from the setup gives an identical state (determinism)
- `playerView` and the per-player event filter never leak hidden information (opponent's hand contents, library order)
- no player has negative mana, and life totals change only through events
- the game ends within a cap (for example 200 turns), or the fuzzer flags it as a likely loop

A failure prints the seed and writes the replay log to `fuzz-failures/`, so it can be replayed in the
CLI and turned into a scenario. Run a short fuzz in `pnpm check`; run longer ones before merging engine changes.

## 4. Replays and golden games

- A replay file is `{ setup, actions, engineVersion }` (the seed is part of `setup`). The app's "Report a bug" button exports
  one, with the owner's description attached.
- `packages/engine/test/replays/` holds replays that must keep producing the same final state hash.
  When an intentional rules change alters a replay, regenerate its hash in the same commit and explain why.

### Golden games

`packages/engine/test/golden/` holds full AI-vs-AI games (several per prebuilt deck pairing, plus games
using every card in the pool), each stored as its replay **and** its readable event log, one event per line:

```
T6 p1 attack: Craw Wurm
T6 p2 block: Giant Spider -> Craw Wurm
T6 damage: Craw Wurm -> Giant Spider 6; Giant Spider -> Craw Wurm 2
T6 dies: Giant Spider (lethal damage, CR 704.5g)
```

`pnpm test` replays each golden game and compares the new log with the stored one. If anything differs,
the test fails and shows the diff, so it's obvious what an engine change did ("turn 6: Giant Spider now survives").
If the change is intended (a bug fix, a rules update), regenerate the golden file with `pnpm golden:update`
in the same commit and explain the diff in the commit message. Never regenerate golden files just to make a failure go away.

Regenerate and add new golden games when the pool grows, so every card appears in at least one.

## 5. Rules coverage report

`pnpm coverage:rules` lists, for every CR rule:
- whether code cites it (`CR 702.19c` in a comment),
- which scenarios test it (their `rules:` lists),
- and flags rules that **code cites but no scenario tests**, plus interaction matrix cells marked "not yet".

It writes `docs/coverage/rules-coverage.md` (generated; commit it so the owner can read it on GitHub) with a
summary at the top: rules cited, rules tested, gaps. `pnpm check` fails if a change adds a **new** gap compared to
the committed report. Existing gaps are allowed, but they're listed so they get closed.

## 6. Benchmarks

`pnpm bench` measures, on fixed seeds and boards:
- the time per `applyAction` across a set of typical states (an empty board, a busy combat, a deep stack),
- the time for a full random-legal game,
- the time for `legalActions` and `characteristics` on a busy board,
- and (from M2) the AI's time per decision.

Results are compared with `bench/baseline.json`. More than 20% slower on any measure fails the bench run.
If the slowdown is justified (a rule that genuinely costs time), update the baseline in the same commit and say why.
Budgets from `architecture.md` are hard limits regardless of the baseline.

## 7. Mutation testing (from M3)

Mutation testing (StrykerJS with the Vitest runner) makes small deliberate changes to the engine code, such as
flipping a comparison or deleting a line, and checks that some test fails each time. A change that no test notices
("a surviving mutant") shows exactly where the tests are too weak. Run it on the engine package before finishing
each milestone, and write tests for surviving mutants in rules code. It's slow, so it's not part of `pnpm check`.

## What "done" means

A rules or card task is done when:
- scenario tests for it exist (including negative cases) and pass,
- interaction scenarios cover how it combines with related mechanics, and the matrix is updated,
- you've checked it yourself in the CLI,
- `pnpm check` passes: scenarios, golden games, a short fuzz, and no new coverage gaps,
- any golden-game diffs are intended and explained,
- for engine changes, `pnpm bench` shows no unexplained slowdown,
- the `rules-judge` agent found no conflict with the cited CR rules.
