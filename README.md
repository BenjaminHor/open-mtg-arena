# MTG Engine (working title)

An unofficial, free fan project: a Magic: The Gathering rules engine built as a pure reducer,
powering a touch-first web app in the spirit of MTG Arena, and later an offline single-player RPG.
It is not approved or endorsed by Wizards of the Coast. (Before the first public deploy, replace this
line with the exact notice from Wizards' current Fan Content Policy.)

This repository is private and unlicensed (all rights reserved). Magic: The Gathering card names, text, symbols,
rules text and art are the property of Wizards of the Coast. Card data comes from Scryfall under its API terms.

## What's in this starter

| Path | Purpose |
| --- | --- |
| `CLAUDE.md` | Instructions Claude Code reads at the start of every session |
| `docs/vision.md` | What we're building and why |
| `docs/architecture.md` | The technical design and its invariants |
| `docs/decisions.md` | Decisions made so far |
| `docs/roadmap.md` | Milestones M1–M5 |
| `docs/milestones/` | Detailed task lists for M1 and M2 |
| `docs/testing.md` | Scenario tests, the headless CLI, fuzzing, replays |
| `docs/deckbuilding.md` | Card browser, deck editor and collection spec |
| `docs/future-rules.md` | Rules and features still to come, and what today's code must not block |
| `docs/card-scripting.md`, `docs/ui.md`, `docs/data-sources.md` | Guides for those areas |
| `docs/status.md` | The living progress log |
| `rules/` | The Comprehensive Rules, split into searchable files (generated) |
| `scripts/fetch-rules.mjs`, `scripts/rule.mjs` | Download/split the rules; look up a rule |
| `.claude/agents/` | `rules-judge`, `code-reviewer` and `ux-reviewer` subagents |
| `.claude/skills/` | `rules-lookup`, `add-cards`, `fix-bug` workflows |
| `.claude/settings.json` | Commands Claude Code may run without asking, and the after-compaction hook |
| `.github/dependabot.yml` | Weekly dependency update pull requests |
| `.claude/hooks/after-compact.md` | The reminder Claude Code gets right after its context is compacted |

## Setup (once)

1. Create a new **private** GitHub repo and copy these files into it (including the hidden `.claude/`, `.github/`,
   `.gitignore` and `.npmrc`).
2. Get the rules. On any computer with Node.js installed, from the repo folder:
   ```sh
   node scripts/fetch-rules.mjs
   ```
   If the download is blocked, open https://magic.wizards.com/en/rules, download the **TXT** version, and run
   `node scripts/fetch-rules.mjs path/to/the-file.txt`. You can also just ask Claude Code to do this step.
3. Commit everything, including the generated `rules/` folder, so every session has the rules without a download.
   Push this first commit to `main`. From then on, all changes go through pull requests.
   (GitHub's free plan has no branch protection for private repos, so this is enforced by `CLAUDE.md`, Claude Code's
   permissions and CI. If you have GitHub Pro, also add a branch protection rule on `main` requiring the CI check.)
4. Before M2 (the web app), install PixiJS's official skills for Claude Code from the repo folder:
   `npx skills add https://github.com/pixijs/pixijs-skills`. They keep Claude Code on current PixiJS v8 APIs.

## Working with Claude Code

Start the first session with something like:

> Read CLAUDE.md, docs/status.md and docs/milestones/m1-engine-foundations.md. Then do task M1-01.
> Plan it first and show me the plan.

After that, a good rhythm:
- Everything important lives in the repo's files, not in the chat. If you tell Claude Code something that matters, check it
  landed in the docs (`docs/decisions.md`, `docs/status.md` or a spec). After a compaction, a hook makes it re-read them.
- One task per session. Start a fresh session (or `/clear`) between tasks so each one begins from the docs.
- Ask for a plan before code on anything big.
- When a task is done, ask: "What should I check?" Claude can show a CLI game or the scenarios it added.
- Report bugs in plain language, or attach the app's bug-report file from M2 on. Say "use the fix-bug skill".
- Add cards with "use the add-cards skill for: <card names>".
- Every so often: "Review the repo against CLAUDE.md and the architecture doc, and tell me what's drifting."
