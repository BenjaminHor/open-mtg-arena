---
name: fix-bug
description: Fix a bug the owner reports, in plain language or as an exported bug-report replay file. Always reproduces the bug as a failing test first.
---

# Fixing a reported bug

The owner describes what happened, usually in plain language, sometimes with a bug-report file
exported from the app (a replay log). The fix isn't done until a test would catch the bug coming back.

## Steps

1. **Understand the expected behavior.** Use the `rules-lookup` skill to find what the CR says should
   happen. If the owner's expectation and the CR disagree, explain the rule (cite it) and ask before changing anything.
2. **Reproduce it.**
   - With a replay file: `pnpm cli replay <file>`, step to the problem (`--step N`), and inspect with `show`,
     `log` and `inspect`.
   - From a description: build the situation with `pnpm cli new --scenario ...` or a new scenario file,
     and step through it.
3. **Write a failing test.** A scenario in the right `packages/engine/test/scenarios/<area>/` folder named for the
   behavior (`giant-growth-after-blockers.yaml`), or a Playwright test if it's a UI bug. For replays, also add
   the replay to `packages/engine/test/replays/` if it covers more than the scenario does. Run it and confirm it fails
   for the reason you expect.
4. **Fix the cause, not the symptom.** Search for other places with the same mistake.
5. Run `pnpm check` and a fuzz run. If golden games change, check that every diff is explained by the fix.
   Ask `rules-judge` to review rules fixes.
6. Tell the owner in plain language: what was wrong, the rule involved, and what the test now checks.
   Update `docs/status.md`.
