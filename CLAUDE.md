# CLAUDE.md

This repo is a free, non-commercial fan project: a Magic: The Gathering rules
engine written as a pure reducer, powering a touch-first web app in the spirit
of MTG Arena. Later it will power an offline single-player RPG on the same
engine. Everything runs in the browser. There is no server.

The project owner sets requirements, playtests and judges rulings. Claude Code
does most of the design and implementation. Humans must still be able to read,
understand and change every part of the code. **Nothing here may become a
black box.**

## Read before working

1. `docs/status.md` — what's done, what's in progress, what's next. Read it first, every session.
2. The milestone spec for the current work, in `docs/milestones/`.
3. `docs/architecture.md` — the design. Don't break its invariants.
4. `docs/decisions.md` — decisions already made. Don't reverse one without asking the owner. Record new ones there.

Read these when the task touches their area:
- `docs/testing.md` — scenario tests, the headless CLI, invariant fuzzing
- `docs/card-scripting.md` — how cards are defined
- `docs/deckbuilding.md` — card browser, deck editor, collection (a full pillar of the app, not an extra)
- `docs/ui.md` — the "Feel" targets (Arena-level polish is a guiding principle, D-012), touch, folded and unfolded layouts, Safari
- `docs/data-sources.md` — the Comprehensive Rules, Scryfall, and their terms
- `docs/future-rules.md` — rules and features still to come, and what they need from today's code
- `docs/vision.md` — product goals and non-goals

## The rules are the spec

The Comprehensive Rules (CR) are in `rules/`, split into one small file per
section (see `rules/README.md`). **Never implement a rule from memory.** Look
it up, then cite it.

- `node scripts/rule.mjs 601.2` prints a rule and its subrules.
- `node scripts/rule.mjs --search "phased out"` finds rules by phrase.
- `node scripts/rule.mjs --glossary trample` prints a glossary entry.
- `grep -rn "^704.5g" rules/cr` finds the file a rule lives in.

Cite rules in code comments and in tests as `CR 601.2c`. A comment that only mentions a rule not built yet
writes `later: CR 614`, so the coverage report (D-048) doesn't count it as implemented. **The CR wins over every other spec** (D-020): if a doc
or task in this repo disagrees with the CR on rules logic, follow the CR and fix the doc. If the CR itself seems
ambiguous, stop and ask. Don't guess.

## Hard invariants (engine)

- The engine is a **pure, deterministic reducer**: `applyAction(state, action) -> { state, events }`.
  No I/O, no `Date`, no `Math.random` (use the seeded RNG in state), no globals, no UI code.
- `GameState` is **plain JSON data**: no classes, `Map`/`Set`, functions or `undefined` values.
  `JSON.parse(JSON.stringify(state))` must give an equal, working state.
- Anything that waits for a player is a `PendingDecision` stored in state. The engine never blocks or calls back.
- Card effects are **data** interpreted by the engine, not callbacks.
- Derived characteristics (power, toughness, types, abilities) are **computed** by the layer system
  (CR 613), never stored as mutable fields.
- Packages depend only in the directions shown in `docs/architecture.md`. `engine` depends on nothing in this repo.

## Readable code rules

The code must be easy for a person who knows TypeScript and Magic to follow.

- Prefer plain functions and plain data. No classes unless there's a clear reason; no decorators or metaprogramming.
- One concept per file, and keep files short (aim for under ~300 lines). Name files after what they do (`combat-damage.ts`, not `utils2.ts`).
- Names come from the CR: `stateBasedActions`, `declareBlockers`, `manaPool`. Don't invent new jargon.
- Use explicit `switch` on discriminated unions so TypeScript checks you handled every case.
- Comments explain **why** and cite the CR. Don't narrate what the code obviously does.
- Every package and every top-level engine folder has a short `README.md`: what it does, its main entry points, how to test it.
- Be stingy with dependencies. Each new runtime dependency needs a line in `docs/decisions.md`. Versions are
  pinned exactly (`.npmrc` has `save-exact`), and `pnpm-lock.yaml` is always committed. Dependabot opens weekly
  update pull requests; they merge only with CI green, and major upgrades get read, not just merged.
- No speculative abstraction. Build what the current milestone needs, in a shape that won't block the RPG (see architecture).
- Prefer a readable algorithm to a clever one. Optimize only after a benchmark shows a problem.

## Durable project memory

Session context gets compacted, and compaction loses information. **Anything important that isn't written
to a file in this repo should be treated as already lost.** The repo is the project's memory: it survives
compaction, new sessions, other machines and Claude Code on the web. Claude Code's own memory directory
is per-machine and isn't the record. Use it only as a convenience, never as the only copy of anything.

Write it down **when it happens**, not at the end of the session:

| What | Where |
| --- | --- |
| A decision (technical or product), and why | `docs/decisions.md` |
| A requirement or preference the owner states | the relevant spec (`vision.md`, `ui.md`, `deckbuilding.md`, a milestone), with a decision entry if it changes direction |
| Task progress, what's next, handoff notes | `docs/status.md` |
| A question waiting on the owner | `docs/status.md` → Open questions |
| A rules interpretation or CR edge case we settled | a scenario test, plus a comment citing the CR |
| A future rule or feature today's code must allow for | `docs/future-rules.md` |
| A bug or "this feels off" from the owner | `docs/status.md` → Known issues, then a test |

Rules:
- If the owner says something that matters to the project, record it before replying with anything else.
- Commit docs changes with the work, at least at the end of every task. Don't leave decisions only in an uncommitted working tree.
- Before a long task, write the plan into `docs/status.md`, so a compaction in the middle doesn't lose it.
- After a compaction (a hook reminds you), re-read `CLAUDE.md`, `docs/status.md` and the current spec, and
  trust them over the conversation summary.
- If a doc and the code disagree, stop and find out which is right. Then fix the other one.

## Design for what's coming

Most of Magic's rules aren't built yet, and the code written now must make room for them. Before
designing any task, check `docs/future-rules.md` and the roadmap. Ask:

- Which upcoming rules or features will touch this code? (Layers, replacement effects and triggers touch almost everything.)
- Does my design make any of them harder? Common traps: reading a characteristic without `characteristics()`,
  changing state outside the event pipeline, assuming two players, assuming the controller is the owner,
  assuming a stack object is a card, hard-coding the turn sequence.
- Is there a cheap choice now (a data shape, a separate named function, an extra field on an event) that keeps a future rule easy?

Then **build only what the current task needs**, in a shape that won't block those rules. Making room for the
future isn't the same as building it early: no speculative frameworks, no unused options. If a future need would
change today's design in a big way, write it in the plan and ask the owner.

Include a short "Future impact" note in every plan, and record any design choice made for a future rule in `docs/decisions.md`.

## How to work

1. Pick a task from `docs/status.md` (or the owner's request). Work on one task at a time.
2. Plan briefly first: which CR sections apply, which files change, which tests prove it works, and the "Future impact" note.
3. **Write or update the scenario tests first**, then implement until they pass.
4. Check the behavior yourself in the headless CLI (`docs/testing.md`), not only through unit tests.
5. Run `pnpm check` (typecheck, lint, all tests). Everything must pass before you call a task done.
6. For engine or rules changes, ask the `rules-judge` agent to check them against the CR.
   For any non-trivial change, ask the `code-reviewer` agent to review the diff.
   For match UI changes, ask the `ux-reviewer` agent, and look at the screenshots yourself.
7. Update `docs/status.md`. If you made a design choice, add it to `docs/decisions.md`. Keep docs accurate:
   a stale doc misleads the next session.
8. Commit with a clear message on a feature branch (one branch per task), push it, and open a pull request.
   Changes reach `main` only through a pull request with CI green. Never push to `main` directly, never force-push
   shared branches. Claude Code may merge its own PR once it checks out (D-027); otherwise the owner merges.
9. When a milestone's exit criteria are met, the owner tags `main` (`m1`, `m2`, ...) as a known-good point to roll back to.

When the owner reports a bug in plain language, use the `fix-bug` skill: reproduce it as a failing
scenario first, then fix it. When adding cards, use the `add-cards` skill.

## Commands

The M1 scaffolding task creates these scripts. Keep these names stable.

- `pnpm check` — typecheck + lint + all tests (the definition of "green")
- `pnpm typecheck`, `pnpm lint` — the first two parts of `check` on their own; `pnpm format` — apply Biome's fixes
- `pnpm test` — unit and scenario tests (Vitest)
- `pnpm test:scenarios` — scenario tests only
- `pnpm fuzz --games 500` — random legal games checking invariants
- `pnpm replays:update` — rewrite the saved replays' final-state hashes (only with an explained diff)
- `pnpm golden:update` / `pnpm golden:add` — regenerate or add golden games (only with an explained diff)
- `pnpm coverage:rules` — which CR rules are cited by code but not tested
- `pnpm bench` — engine benchmarks against `bench/baseline.json`
- `pnpm cli <command>` — the headless game CLI (see `docs/testing.md`)
- `pnpm cards:fetch` / `pnpm cards:extract` — download Scryfall bulk data / extract the card pool (see `docs/card-scripting.md`)
- `pnpm dev` — the web app (from M2)
- `node scripts/fetch-rules.mjs` — refresh `rules/` when Wizards publishes a new CR

## Don'ts

- Don't edit generated files: `rules/**` (except `rules/README.md`) and anything marked generated.
- Don't commit Scryfall bulk downloads (`data/scryfall/` is gitignored); commit only the small extracted card-pool files.
- Don't bundle card images in the repo or the app. Art is downloaded at runtime (see `docs/data-sources.md`).
- Don't weaken a test to make it pass. If a test is wrong, explain why in the commit.
- Don't add features outside the current milestone without asking.
