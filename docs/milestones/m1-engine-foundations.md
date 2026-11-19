# M1 — Engine foundations

**Goal:** a pure, headless engine that plays complete two-player games with the M2 card pool,
plus the tools Claude Code needs to check its own work: the scenario runner, the CLI and the fuzzer.
No web app yet.

Do the tasks roughly in order; each should fit in one focused session. Every task ends with
`pnpm check` green and `docs/status.md` updated. The CR numbers listed are starting points. Look them up
(`node scripts/rule.mjs <n>`) and follow everything they reference.

## Scope

**In:** two-player games; turn structure; priority and the stack; playing lands; mana from basic
lands and mana abilities; casting creatures, sorceries and instants; targeting; damage; life;
drawing; state-based actions for these cards; combat with attackers, blockers and damage; summoning
sickness; flying, reach, haste; "until end of turn" effects; one non-mana activated ability (firebreathing);
London mulligan; winning and losing; rule modifiers in `GameSetup`.

**Out (later milestones):** triggered abilities on cards (the engine's trigger pipeline exists but no card
uses it yet), replacement effects on cards, layers other than 7c, counters, tokens, auras, equipment,
first strike and other keywords, multiplayer.

## Card pool (both prebuilt decks, 17 cards)

`pool.txt`:
Mountain, Forest, Raging Goblin, Gray Ogre, Furnace Whelp, Hill Giant, Fire Elemental, Shock,
Lightning Bolt, Volcanic Hammer, Llanowar Elves, Grizzly Bears, Centaur Courser, Giant Spider,
Spined Wurm, Craw Wurm, Giant Growth

Decks (40 cards each):
- **red-aggro:** 17 Mountain, 4 Raging Goblin, 4 Gray Ogre, 3 Furnace Whelp, 3 Hill Giant, 2 Fire Elemental, 3 Shock, 2 Lightning Bolt, 2 Volcanic Hammer
- **green-stompy:** 17 Forest, 4 Llanowar Elves, 4 Grizzly Bears, 4 Centaur Courser, 3 Giant Spider, 2 Spined Wurm, 2 Craw Wurm, 4 Giant Growth

The owner may swap cards. Keep the decks within M1's rules scope.

## Tasks

**M1-01 Scaffold the monorepo.** pnpm workspaces with `packages/engine`, `packages/cards`, `packages/cli`,
`packages/ai` (an empty placeholder with a README), strict TypeScript, Vitest, Biome, and the root scripts listed in
`CLAUDE.md` (`check`, `test`, `test:scenarios`, `fuzz`, `cli`). A GitHub Actions workflow runs `pnpm check`.
A README in each package. *Accept:* `pnpm check` passes on an empty test; `pnpm cli --help` runs.

**M1-02 Rules files.** Confirm `rules/` exists. If not, run `node scripts/fetch-rules.mjs` (or ask the owner
for the TXT file if the download is blocked). Spot-check `node scripts/rule.mjs 601.2` and that big sections
were split. *Accept:* `rules/VERSION.json` shows the current effective date.

**M1-03 Core types and state.** Ids, zones, objects (`ObjectId` vs `cardId`, CR 400.7), players, `GameState`,
`Action`, `PendingDecision`, `GameEvent`, `EngineResult`, `GameSetup` (with rule modifiers and non-standard starts),
and a seeded PRNG (a small, well-known algorithm such as xoshiro128** or mulberry32, written out in full with tests).
*Accept:* type-level tests; a JSON round-trip test; PRNG known-answer tests.

**M1-04 Card data pipeline.** `cards:fetch` and `cards:extract` (see `card-scripting.md`); `pool.txt` with
the 17 cards; generated `data/pool.json` and rulings. A first draft of the `CardDef` types. *Accept:* a
test that every pool card has Oracle data, and the errata check (`card-scripting.md`) fails when a definition's `oracle` text differs from `pool.json`. (If Scryfall is unreachable in the session, ask the owner to run
`pnpm cards:fetch` locally and commit the extracted files.)

**M1-05 Game start.** Create a game from a setup: shuffle (CR 103.3), choose who goes first (CR 103.1: unless the setup names
the starting player, a player picked at random from the seeded RNG chooses, as a decision; D-020), opening hands, and mulligans (CR 103.5) as decisions. (The first
player skipping their first draw, CR 103.8a, is part of the draw step, so it moved to M1-06.) *Accept:* scenarios for keep, mulligan and bottom cards; deterministic with a fixed seed.

**M1-06 Turn structure.** All steps and phases (CR 500–514): untap, upkeep, draw, main phases, combat steps,
end step, cleanup (discard to hand size; damage wears off and "until end of turn" effects end, CR 514);
mana pools empty between steps (CR 500.5; this said 500.4, fixed under D-020); skipping combat steps when there are no attackers (CR 508.8); the starting
player skipping the draw step of their first turn (CR 103.8a, moved from M1-05).
*Accept:* a scenario that walks a full turn checking each step, and one that the starting player doesn't draw on turn 1
while the other player draws on turn 2.

**M1-07 Priority and the stack.** CR 117 and 405: who gets priority when, passing in succession, resolving
the top object (CR 608), and advancing when the stack is empty. The work queue and `advance()` loop from the
architecture doc. *Accept:* scenarios for pass/pass resolution, and (once casting exists, M1-09) for responding to a spell with an instant.

**M1-08 Mana and costs.** Mana pools and mana types (CR 106), basic land mana abilities (CR 305.6, 605),
Llanowar Elves, paying costs (CR 601.2g–h), and a deterministic `pay: auto` helper used by scenarios, the
CLI and the AI. *Accept:* scenarios for paying exact costs, failing to pay, and leftover mana emptying.

**M1-09 Playing lands and casting spells.** One land per turn (CR 305.2), sorcery-speed timing (CR 307.1),
instants (CR 304), the casting procedure as decisions (CR 601.2), and targets: legal choices and the check
on resolution (CR 115, 608.2b). *Accept:* scenarios for each timing rule (including negative cases) and a spell
whose only target became illegal. Also a scenario of responding to a spell with an instant (moved here from M1-07, which has no casting). And scenarios for paying exact costs and failing to pay (moved here from M1-08, D-034).

**M1-10 Effects interpreter v0.** Effect ops: `dealDamage`, `addMana`, `modifyPT` (until end of turn), and
the zone-change and draw primitives that turn steps need. Each op documented in `engine/src/effects/README.md`.
*Accept:* scenarios for Shock, Lightning Bolt, Volcanic Hammer and Giant Growth, including on a player.

**M1-11 Characteristics and layer 7c.** `characteristics()` computing power and toughness from printed values
plus `modifyPT` effects in timestamp order (CR 613.4c, 613.7), built so the other layers can be added later
without a rewrite. *Accept:* scenarios for stacking two pumps, and a pump wearing off in cleanup.

**M1-12 State-based actions.** CR 704: at least 704.5a (0 life), 704.5b (drawing from an empty library),
704.5f (0 toughness) and 704.5g (lethal damage), checked repeatedly before priority (CR 704.3). *Accept:* a
scenario per SBA, plus one where two SBAs happen at once.

**M1-13 Combat.** Declare attackers (CR 508) and blockers (CR 509) as decisions, summoning sickness (CR 302.6),
haste (CR 702.10), flying and reach (CR 702.9, 702.17), combat damage (CR 510), including an attacker blocked by several
creatures dividing its damage among them as its controller chooses (CR 510.1c; the CR no longer has damage assignment order, D-020), and unblocked damage to the player. *Accept:* scenarios for each
keyword interaction (and its negatives), multiple blockers, and a lethal attack ending the game.

**M1-14 Activated abilities.** CR 602: Furnace Whelp's firebreathing, activated at instant speed, as a
non-mana ability on the stack. *Accept:* scenarios for activating it several times and in response to a block.

**M1-15 Game end.** CR 104: losing from life, drawing from an empty library, conceding; `GameResult`.
*Accept:* scenarios for each, and a result reporting winner, reason and turn.

**M1-16 Scenario runner.** The YAML format in `testing.md`, converting steps through `legalActions()`. Build it
early (right after M1-07) and extend it with each task. *Accept:* the format documented in `testing.md` matches the implementation exactly.

**M1-17 Headless CLI.** All commands in `testing.md`, stateless with a game file, including `export --scenario`
and `inspect`. Simple `random` and `first-legal` agents for `auto` (the real AI arrives in M2). *Accept:* a full
game can be played from the shell using only `new`, `show`, `actions` and `do`.

**M1-18 Fuzzer and replays.** `pnpm fuzz` with every invariant in `testing.md`, failure logs in `fuzz-failures/`,
and a replay test folder with a few saved games. *Accept:* 1,000 seeds clean; a deliberately broken invariant is caught.

**M1-19 Golden games, coverage report and benchmarks.** Golden games with readable event logs and diffs
(`golden:update`, `golden:add`); the rules coverage report and its check in `pnpm check`; the interaction matrix
README; `pnpm bench` with a committed baseline. *Accept:* a deliberate rules change shows up as a readable golden diff;
removing a scenario makes the coverage check fail; a deliberate slowdown fails the bench.

## Exit criteria

- All tasks accepted, and `pnpm check` is green.
- `pnpm fuzz --games 1000` is clean with both prebuilt decks.
- The rules coverage report shows no rule cited in code without a scenario.
- The owner can follow a CLI game log (`pnpm cli auto ... --max-turns 30`) and spot-check a few scenarios for correctness.
- `rules-judge` has reviewed the casting, priority, SBA and combat code against the CR.
- `docs/status.md` is up to date, and the M2 spec has been reviewed with the owner.
