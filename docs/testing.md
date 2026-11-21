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
7. **Mutation testing** (from M2): proof that the tests would catch the engine being wrong.

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

The runner is `packages/scenarios` (D-033). `pnpm test:scenarios` runs every `.yaml` file under
`packages/engine/test/scenarios/`, one test each. Unknown keys, steps and expectations fail the scenario, so a typo
can't make it pass.

**Top level:** `name`, `rules` (the CR rules tested, like `[CR 103.5]`, required), `setup`, then either `steps` or
`expect setup error: <part of the message>` for a setup the engine must reject.

**setup:**
- `seed` (default 1).
- `opening: fixed` (the default) or `opening: standard`.
  - **fixed:** `turn: { active: p1, step: main1, number: 3 }`. The game starts in that step with its turn-based actions
    done and the active player holding priority. `number` defaults to 3, because turn 1 has special rules (the starting
    player skips their draw step, CR 103.8a); say `number: 1` to test them.
  - **standard:** the normal start (CR 103): shuffles, opening hands, mulligans. `first: p1` names the starting player;
    without it, a player picked at random from the seed chooses (`chooseStartingPlayer`). A standard setup takes no `turn`.
- Per player (`p1`, `p2`): `life` (default 20), `library` (top first), `hand`, `battlefield`, `graveyard`, `exile`,
  `manaPool` (like `{ R: 2 }`). Cards are named exactly as in Oracle. An unlisted library is 20 basic lands (40 in a
  standard opening): Forest for p1, Mountain for p2.
- A battlefield entry is a card name or a map: `{ card: Grizzly Bears, tapped: true, sick: true, damage: 1 }`.
  `sick: true` means it hasn't been under its controller's control continuously since their most recent turn began
  (CR 302.6). In a standard opening every permanent starts sick. `counters` is a map like `{ +1/+1: 2 }`; +X/+Y and -X/-Y counters change power and toughness (CR 122.1a).
- `rules: [...]`: rule modifiers for the whole game, like `{ kind: creaturesGetPT, controller: p2, power: 1, toughness: 1 }`
  ("creatures p2 controls get +1/+1", layer 7c).

**Step names:** `untap`, `upkeep`, `draw`, `main1`, `combat.beginning`, `combat.declareAttackers`,
`combat.declareBlockers`, `combat.damage`, `combat.end`, `main2`, `end`, `cleanup`.

**References:** `p2:Grizzly Bears` means the Grizzly Bears that p2 controls (the first, in battlefield order, if
there are several); `p2:Grizzly Bears#2` the second. `p1` and `p2` alone mean players.

**Steps** (each is one of these). Every step becomes an action found in the engine's `legalActions()`, so a step that
names an illegal action fails the scenario, unless the next step is `expect error`.
- `p1 pass: once`: p1 passes priority.
- `all pass: once`: each player passes once, in turn, starting with whoever has priority. Passing stops early if the
  game ends.
- `all pass: until <step>`: players keep passing until that step next begins and someone has priority in it, or the
  game ends in that step before anyone does (a player who loses drawing from an empty library). It fails (rather than
  hanging) if a decision other than priority comes up, the game ends before that step begins, or the step doesn't come
  with priority within 500 passes (`untap`, which gives no one priority, never does).
- `p1 choose: <answer>` for the pending decision: `keep` or `mulligan`; a player (`p2`) for who goes first; a card name
  for a card to put on the bottom or discard (with several identical cards, the first one that's still a legal answer,
  or `Forest#2` for the second Forest in hand: which copy goes to the bottom changes the next shuffle);
  a card's name for a `chooseCards` decision while a spell or ability resolves (the first option not yet chosen with
  that name, or `Shock#2` for the second option named Shock, in the decision's fixed order, D-062), or `finish` to stop
  choosing once the minimum is chosen ("you may" declined, a search that finds nothing); `yes` or `no` for a "you
  may" decision (`chooseYesNo`, Ponder's shuffle, a "you may" trigger); for ordering one's triggers as they go on the
  stack (`orderTriggers`, CR 603.3b), the source's card name of the one to put on next (`p1 choose: Soul Warden`, or
  `Soul Warden#2` for the player's second waiting trigger from a card of that name); for choosing which replacement
  effect applies first (`chooseReplacement`, CR 616.1), `regeneration` for a regeneration shield, the name of the card
  whose own replacement it is (`Guardian Seraph`), or the card whose resolution made it (`Fog`); identical effects are
  one option, and a name matching two different options is refused;
  a target in any form `targets:` takes (`p2`, `p2:Grizzly Bears`, `spell:p1:Grizzly Bears`,
  `graveyard:p1:Grizzly Bears`) or `cancel` for a target choice; a payment like `{ R: 1 }`, or `cancel`, while
  paying for a spell. Every payment the pool covers is a legal answer: which mana pays is the player's choice.
- `p1 play: <land>`: play a land from hand. `play`, `cast` and `choose` take `Forest#2` for the second Forest in hand,
  when which copy matters (an exact replay: it changes the hand's order, and a mulligan's shuffle with it).
- `p1 concede: now`: p1 concedes and loses (CR 104.3a). A player may concede at any time, even without priority, so
  conceding is never listed by `legalActions()`; this step sends the action directly.
- `p1 cast: <card>` with `targets: [...]`, `divide: [...]` and `pay:`: cast a spell from hand. `targets` lists one entry
  per instance of "target", in order: a player (`p2`), a permanent reference (`p2:Grizzly Bears`) or a spell on the stack named the
  same way (`p1:Lightning Bolt`; `spell:p1:Grizzly Bears` when a permanent has the same name), a card in a graveyard
  (`graveyard:p1:Grizzly Bears`), or a list of them
  when that instance has several (`targets: [[p2:Elite Vanguard, p2:Coral Merfolk]]`). For an instance whose number of
  targets varies, the number announced (CR 601.2c) is the list's length (one for a single entry). `divide` gives each
  target's share of a divided effect, in the order the targets were listed (`divide: [2, 1]`, CR 601.2d): one share per
  target, adding up to the whole, or the step fails (the last share isn't asked for: it gets the rest); without it,
  the cast stops at the division, where `choose` gives one share at a time. `choose` also answers a number of targets.
  `x: 3` announces X first, for a spell or ability with X in its cost (CR 107.3a), at most what `legalActions` lists
  (larger values are legal, D-058, and covered by unit tests). `sacrifice: Grizzly Bears` (or a
  list) names what to sacrifice for the cost, a permanent the player controls or a reference like `p2:Grizzly Bears`
  (CR 701.21a). Listing a target, share, X or sacrifice the spell never takes fails the step. `pay: auto` pays with
  `autoPay` (activating mana
  abilities as needed); `pay: { R: 1 }` pays that from mana already in the pool; `pay: cancel` cancels
  the cast. Without `pay`, the cast stops at the payment decision, where the player can `activate` mana abilities and
  then `choose` a payment or `cancel`; without `targets`, it stops at the first target choice (`choose` a target or
  `cancel`). Listing some targets but too few, or giving `pay` when the cast isn't waiting for a payment, fails the step. A cast is several actions; followed by `expect error`, they're sent in order and
  the first one rejected must have the code (the step fails if all are accepted).
- `expect: { ... }`, see below.
- `expect error: <code>`: the step before it must be rejected with this error code (for example `notYourPriority`). The
  runner then sends the action directly, without looking it up in `legalActions()`.
- `p1 activate: <card>`: activate an ability of a permanent. A plain name means one the acting player controls (the
  first, in battlefield order, whose ability can be activated now; before an `expect error`, simply the first); a reference like `p2:Mountain` names exactly one, for
  example to show p1 can't activate p2's land. Add `ability: <n>`, counting from 1 in the order `abilitiesOf` lists
  them (printed abilities, then a basic land's mana ability), when the permanent has more than one. A mana ability
  resolves at once. Any other ability goes on the stack and takes `targets` and `pay` exactly as `cast` does (without
  `pay`, it stops at the payment decision). On the stack it's named after its source: `stack: [Furnace Whelp ability]`. For a mana ability that adds "one mana of any color", `color: U` names the color, part of
  the activation (D-068).
- `p1 attack: [Grizzly Bears, Hill Giant]`: declare attackers (CR 508.1), each creature by name or reference among
  p1's (`Grizzly Bears#2` for the second), each attacking the other player; `[]` declares none. It answers one
  `declareAttackers` decision per creature, then finishes.
- `p2 block: { Giant Spider: Craw Wurm }`: declare blockers (CR 509.1), blocker (p2's) to attacker (p1's); `{}` declares
  none. A creature that can block several attackers names them in a list: `{ Palace Guard: [Grizzly Bears, Hill Giant] }`;
  its controller then divides its damage with `p2 assign: { Grizzly Bears: 1, Hill Giant: 0 }` (CR 510.1d). A
  declaration can also be answered one pick at a time with `choose:` (`p1 choose: Grizzly Bears`, `p2 choose: Giant
  Spider blocks Craw Wurm`, `choose: take back`, `choose: done`); the exporter writes a declaration that way when a
  pick was taken back. A rejected step is rolled back whole, so after `expect error` declare the full set again.
- `p1 assign: { Grizzly Bears: 2, Giant Spider: 4 }`: divide an attacker's combat damage among its blockers (CR 510.1c),
  when an `assignDamage` decision is pending, naming each blocker once in any order; a trampler names the player it
  attacks too, by id (`{ Grizzly Bears: 2, p2: 2 }`, CR 702.19b). Any division that adds up to its power is legal,
  including 0 to one, except that a trampler's player gets damage only once every blocker has lethal damage. The engine
  asks one recipient at a time (the last gets the rest); the step answers all of them. With first strike there are two
  combat damage steps (CR 510.4); `all pass: until combat.damage` stops in the first, and `all pass: once` from there
  goes on to the second.
- Passing through combat (`all pass`) declares no attackers and no blockers when asked, the "do nothing" answer;
  `all pass: until combat.declareAttackers` (or `.declareBlockers`, `.damage`) stops there when that step's own decision
  is pending. A division of damage has no "do nothing", so it stops `all pass` with an error.
- `cast` and `activate` gain `modes` with the first card that has them.

**Expectations** (all keys in one `expect` must hold):
- `p1.life`, `p1.manaPool` (only the mana present, `{}` for empty).
- `p1.library`, `p1.hand`, `p1.graveyard`, `p1.battlefield`: the exact list of card names, in zone order (library top
  first; graveyard oldest first, so the top is last; battlefield is the permanents p1 controls). Add ` contains` for a
  subset (`p1.hand contains: [Shock]`) or ` count` for the size (`p1.hand count: 7`).
- `stack` (bottom first, so the top is last; an ability shows as "<card> ability"), `exile`.
- `step`, `turn` (the turn number), `active` (the active player).
- `pending: { player: p1, kind: priority }`: every key given must match (`remaining`, `mulligansTaken`, ...);
  `pending: null` for nothing pending.
- `p1:Grizzly Bears.tapped`, `.damage`, `.sick`; `.power` and `.toughness` as computed by `characteristics()` (`null`
  for a noncreature permanent); `.abilities contains: [reach]` checks its keyword abilities (CR 702), by their lowercase
  names. `.colors: [B, G]`, `.types: [land, creature]` (supertypes first) and `.subtypes: [Forest, Treefolk]`, as
  computed. `hand:p1:Nightmare.power`, `graveyard:p1:Nightmare.power` and `stack:p1:Nightmare.power` (a spell p1 controls) ask
  about a card in that zone (`#2` for the
  second with that name), for what works outside the battlefield (CR 604.3).
- `events contains: [{ type: CARD_DRAWN, player: p2 }]`: each listed event, matched on the keys given, happened during
  the last step that changed the game. Nested maps match on their keys given too: `{ type: EFFECT_CREATED, effect:
  { controller: p1 } }`. `pending:` matches the same way.
- `events lacks: [{ type: DAMAGE_DEALT }]`: no event matching any listed one happened during that step.
- `winner: p1` once the game is over; `winner: draw` when it ended in a draw (CR 104.4a); `winner: (game not over)`
  while it's still going.
- `p1:Grizzly Bears.counters: { +1/+1: 2 }`: the kinds of counters it has, `{}` for none.

Every state the runner sees is also checked against the engine's invariants (`invariantProblems`): plain JSON, every
object in exactly one zone, casting choices only on the stack, nothing stalled, a pending decision always has a legal
action (a trigger's targeting can't be cancelled), every listed legal action accepted.

When the runner needs a new step or expectation, add it, document it here in the same commit (a test checks every word
the runner knows appears here), and keep the vocabulary small.

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
  each cell linking to the scenarios that cover the pair, or marked "n/a" or "not yet". Claude Code
  updates it with each new mechanic, and the coverage report flags pairs marked "not yet".

## 2. The headless CLI

`packages/cli` lets Claude Code (or a person) play and inspect games as text. Claude Code's
shell runs one command at a time and can't drive an interactive prompt, so **the CLI is
stateless**: every command reads a game file, does one thing, and writes it back.

```sh
pnpm cli new --decks red-aggro,green-stompy --seed 42 --out /tmp/g.json   # start a game (--first p1 to skip the choice)
pnpm cli new --scenario combat/reach-blocks-flyer --out /tmp/g.json       # start from a scenario's setup
pnpm cli show /tmp/g.json            # board, hands (debug shows both), stack, step, pending decision
pnpm cli show /tmp/g.json --as p2    # what p2 is allowed to see (hides p1's hand; D-043)
pnpm cli actions /tmp/g.json         # numbered legal actions for the pending decision
pnpm cli do /tmp/g.json 3            # take legal action #3
pnpm cli do /tmp/g.json "cast: Lightning Bolt, targets: [p2:Grizzly Bears], pay: auto"   # a scenario step, as YAML
pnpm cli do /tmp/g.json "all pass: until combat.declareAttackers"   # any step a scenario can take
pnpm cli do /tmp/g.json "p2 concede: now"   # not in `actions`: always allowed (D-042)
pnpm cli ai /tmp/g.json --until p1   # an agent acts for the other player until p1 must decide (--agent, --seed)
pnpm cli auto /tmp/g.json --ai both --max-turns 30   # agents play everyone to the end; prints the game's log
pnpm cli log /tmp/g.json             # events so far, one per line, by turn (--brief leaves out passes and steps)
pnpm cli inspect /tmp/g.json "p2:Grizzly Bears"   # an object's computed characteristics and which effects/layers produced them
pnpm cli export /tmp/g.json --scenario --rules "CR 510.1c" > new.yaml # the game so far as a scenario (setup + steps + expect)
pnpm cli replay bug-report.json      # replay a saved log and stop at the end (or --step N)
```

`do` takes a step exactly as a scenario writes it (YAML, braces optional), so a step can be pasted from a scenario and
back. Without a player (`cast: Shock, ...`), the pending player takes it. A step is all or nothing: if any of its
actions is refused, the file is left as it was.

The game file holds the setup and the actions taken; replaying them reproduces the game. It also caches the current
state so commands don't replay a long game each time. The same file is the replay log and the bug-report format.

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

The agents (`--agent random`, the default, `first-legal` or `by-kind`) choose only among `legalActions()`, from their own
seed, so the same seed plays the same game. `first-legal` passes whenever it can, so its games end by a library running
out. `by-kind` picks a kind of action, then one of that kind (the fuzzer's picker, D-061), so it casts more.
`ai` and `auto` stop at `--max-actions` (default 10,000) or `--max-turns` (default 200) and say so. `export` names each
permanent exactly (`p1:Mountain#2`) and each card in hand when it matters (`Forest#2`), writes each payment and
division in full, and ends with an `expect` of where the game ended up; it checks the scenario passes before printing it; it can't write a game that stops part way through declaring attackers or blockers or dividing damage.
`--rules` lists what the scenario proves (without it, `CR 100.1` stands in: replace it).

**How Claude Code should use it**: after implementing a rule, start a game from a scenario,
step through it with `do`, and read `show`, `log` and `inspect` to confirm the behavior matches
the CR. Then make that path a scenario test with `export`, so it stays checked.

## 3. Invariant fuzzing

`pnpm fuzz --games N --seed S` plays one game per seed from `S` (D-046): even seeds the prebuilt deck pairs in turn
(Magic 2010's pair in both seats, then M1's, D-069), odd
seeds two random decks from the pool, with basic lands of their cards' colors. Every decision is a random legal
action, picked by kind first (pass, cast, activate an ability, play a land, an answer of each kind; cancelling a tenth
as often), then one of that kind (D-061); one in ten is the first legal one, which passes or declines where it can
(while paying, it's a payment, or cancel when nothing can be paid). (The `random` agent of `ai` and `auto` still
picks uniformly; the `by-kind` agent picks the fuzzer's way. Stored golden games replay their actions, so a change to
what an agent sees only shows as "the recipe now plays differently" on `golden:update`; the bench plays `random` live, so
it needs a new baseline then, explained in its commit.) About one game in ten ends in a concession. Without `--seed`, each run starts from a new seed and prints
it. After every action it checks (`packages/cli/src/fuzz/checks.ts`):

- the state round-trips through JSON unchanged
- every object is in exactly one zone, and every zone entry is an existing object
- `pending` is set, or `result` is set (the engine never stalls)
- every action from `legalActions()` is accepted by `applyAction()`, and no engine call throws
- `playerView` and `eventsFor` never leak hidden information: scrambling what a player can't see leaves their view
  unchanged, and the events they're shown name no object or card id hidden from them before or after the action,
  unless they could see it then too (D-044, D-054)
- no player has negative mana, and life totals change only through events
- the layer pass kept for the state is what a fresh pass gives (D-092): the kept result can't go stale

At the end of each game, replaying the action log from the setup must give an identical state (determinism), and a
game past 200 turns (`--turn-cap`) is flagged as a likely loop.

A failure prints the seed and how to rerun it, exits 1, and writes `fuzz-failures/seed-<n>.json` (`--out` to change
the folder): the game file up to the failing action, plus that action and the problem. Open it with
`pnpm cli replay`, step it with `do`, and turn it into a failing scenario with `export` (the `fix-bug` skill).

`pnpm test` runs a short fuzz (seeds 1 to 6, in `packages/cli/test/fuzz.test.ts`). Run longer ones before merging
engine changes. A game takes one to one and a half seconds, so `pnpm fuzz --games 1000` takes 15 to 25 minutes: run it in the
background.

## 4. Replays and golden games

- A replay file is the CLI's game file, `{ format, version, setup, actions, state? }` (the seed is part of `setup`;
  `state` is only a cache, D-043). The app's "Report a bug" button exports
  one, with the owner's description attached.
- `packages/engine/test/replays/` holds replays that must keep producing the same final state hash (D-046): game
  files with a `description` and `finalStateHash`, one action per line. `packages/cli/test/replays.test.ts` plays each.
  When an intentional rules change alters a replay, run `pnpm replays:update` in the same commit and explain why. To
  add one, copy its game file there and run the same command, which fills in the hash and drops the cached state.

### Golden games

`packages/engine/test/golden/` holds agent-vs-agent games (D-047), M1's four whole games between its prebuilt decks
(the benchmark's) and games chosen by `pnpm golden:cover` (D-082), so that between them every mechanic the pool's
cards have runs (each keyword, static, effect op, trigger condition, cost and target kind) and every kind of decision
is answered. Each card is covered by its own scenarios instead (a test checks each pool card is in one). Each game is
stored as its replay **and** its readable event log, one event per line (the CLI's brief log). The replay is compact
(`"encoding": "lines"`, D-082, D-083): the setup names cards, and each action is one line starting with the player who
acted, `p1 land o85`, `p2 cast o12`, `p1 activate o5 printed 0 for G`, `p2 chooseTarget p1`, `p2 declareBlocker o7 o5`,
with a run of passes as one line naming who passed, `pass p1 p2 p1 p2`. Only decision ids are left out: they follow
from the pending decision as the lines are read back (`cli/src/action-lines.ts`), and the engine refuses a line whose
player isn't the one being asked, so a change in who gets priority shows. Lines left after the game ended are
counted, and `pnpm golden:update` says the game now ends sooner. Until the AI exists (M3) the players are the `random` and `by-kind` agents:

```
T36 p1 attack: p1:Hill Giant -> p2
T36 p2 block: p2:Grizzly Bears#2 -> p1:Hill Giant
T36 combat damage: p1:Hill Giant -> p2:Grizzly Bears#2 3
T36 combat damage: p2:Grizzly Bears#2 -> p1:Hill Giant 2
T36 state-based actions: p2:Grizzly Bears#2 lethalDamage
T36 destroyed: p2:Grizzly Bears#2
```

`pnpm test` replays each golden game and compares the new log with the stored one. If anything differs,
the test fails and shows the diff, so it's obvious what an engine change did ("turn 36: the Bears now survive").
If an action is no longer accepted, the new log stops there with a `!! action N is rejected` line, so the diff still
shows where the game went differently.
If the change is intended (a bug fix, a rules update), regenerate the golden file with `pnpm golden:update`
in the same commit and explain the diff in the commit message. It keeps a game's actions when they still play out,
and otherwise plays the game again from its recipe (setup, agent and seeds). For each game it says what changed and
why: "log changed", "played again from its recipe (action N is rejected: ...)", "actions kept; the recipe now plays
differently", or "file rewritten (version or layout)".
`pnpm golden:add --decks red-aggro,green-stompy --seed N [--agent by-kind]` adds a game. Never regenerate golden files
just to make a failure go away.

When the pool grows, `pnpm golden:cover [--from 1] [--to 800]` adds games until every mechanic runs (a test checks). It
plays the fuzzer's decks for each seed (its prebuilt pairs and random pool decks) with `by-kind` agents,
counts what the folder's games already run, and keeps, greedily, the game adding the most new mechanics per action, cut
off at the turn its last new one appears. It also covers three choices the export tests read: a spell on the stack
targeted, a card in a graveyard targeted, cards chosen as a spell or ability resolves. It only adds games, never changes one, and skips seeds whose game
is already there; it lists what's still not covered and fails if anything is.
Keep the folder under 16 MB through M2 (D-081, was 8 MB in D-073).

## 5. Rules coverage report

`pnpm coverage:rules` lists, for every CR rule the rules code cites (`CR 702.19c` in a comment):
- which scenarios test it (their `rules:` lists), or else which unit tests cite it,
- and flags rules that **code cites but nothing tests**, plus interaction matrix cells marked "not yet".

It writes `docs/coverage/rules-coverage.md` (generated; commit it so the owner can read it on GitHub) with a
summary at the top: rules cited, rules tested by scenarios, rules tested only by unit tests, gaps. There are no gaps,
and none are allowed (D-052): every rule the code cites must have a scenario or a
unit test (an owner requirement), so `pnpm check` fails on any gap and `pnpm coverage:rules` won't write a report
with one. A rule losing its last scenario while a unit test still covers it needs `--accept-scenario-loss` (say why in
the commit). D-048 has the details: which code counts, how citations match, and why a mention of a rule that isn't built
yet is written `later: CR 614`.

## 6. Benchmarks

`pnpm bench` measures, on fixed seeds and boards (states taken from the golden games; D-049):
- the time per `applyAction` across sets of typical states (an empty board, a busy combat, a deep stack),
- the time for a full random-legal game,
- the time for `legalActions` and `characteristics` on a busy board,
- and (from M3) the AI's time per decision.

Times are compared as multiples of a reference loop timed in the same run, so the baseline holds across machines.

Results are compared with `bench/baseline.json`. More than 20% slower on any measure fails the bench run.
If the slowdown is justified (a rule that genuinely costs time), update the baseline with `pnpm bench --update` in the
same commit and say why. It isn't part of `pnpm check`: timings on a shared CI runner would be flaky.
Budgets from `architecture.md` are hard limits regardless of the baseline.

## 7. Mutation testing (from M2)

Mutation testing (StrykerJS with the Vitest runner) makes small deliberate changes to the engine code, such as
flipping a comparison or deleting a line, and checks that some test fails each time. A change that no test notices
("a surviving mutant") shows exactly where the tests are too weak. Run it on the engine package before finishing
each milestone, and write tests for surviving mutants in rules code. It's slow, so it's not part of `pnpm check`.

## What "done" means

A rules or card task is done when:
- scenario tests for it exist (including negative cases) and pass,
- interaction scenarios cover how it combines with related mechanics, and the matrix is updated,
- you've checked it yourself in the CLI,
- every rule it implements is cited where it's implemented and tested by a scenario or a unit test (D-052),
- `pnpm check` passes: scenarios, golden games, a short fuzz, and no coverage gaps,
- any golden-game diffs are intended and explained,
- for engine changes, `pnpm bench` shows no unexplained slowdown,
- the `rules-judge` agent found no conflict with the cited CR rules.
