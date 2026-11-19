# Decision log

Short records of decisions, newest last. Don't reverse a decision without asking the owner.
To change one, add a new entry that supersedes it and say why.

Format: **D-number: title** · date · status. Then context, decision, consequences in a few lines.

---

**D-001: Free, non-commercial fan project** · 2026-11-19 · accepted
It uses real Magic card names, Oracle text and Scryfall images under Wizards of the Coast's fan content
expectations and Scryfall's API terms. No monetization of any kind. Card images are never bundled; they
download at runtime (D-007).

**D-002: Pure reducer engine with decisions stored in state** · 2026-11-19 · accepted
The engine is `applyAction(state, action) -> { state, events }`. Choices in the middle of resolution
are `PendingDecision`s in state, and in-progress work is a queue in state (see architecture).
This gives saves anywhere, replays, determinism, AI simulation and easy testing.

**D-003: Card effects are data, not functions** · 2026-11-19 · accepted
Card definitions are typed TypeScript objects made of effect nodes, interpreted by the engine.
State stays serializable, and a person can read a card definition and check it against the Oracle text.

**D-004: TypeScript monorepo with pnpm workspaces** · 2026-11-19 · accepted
One language for engine, AI, CLI and UI. Strict TypeScript. Tooling: pnpm, Vitest, Biome (lint and
format), Vite (web app), Playwright (end-to-end, from M2). Node: current LTS.
Port hot paths (AI search) to something faster only if benchmarks demand it.

**D-005: No server; static PWA** · 2026-11-19 · accepted
The app is a static site (hosting: see D-015) with a service worker for offline play.
Saves, collection and art cache live in IndexedDB and the Cache API. There are no accounts and no backend.

**D-006: Engine and AI run in a Web Worker** · 2026-11-19 · accepted
Keeps the UI smooth while the AI thinks. The worker protocol is plain JSON messages.

**D-007: Card data from Scryfall at build time, art at runtime** · 2026-11-19 · accepted
A build script extracts Oracle text and rulings for the card pool from Scryfall bulk data and commits
only that small subset. On first run, the app downloads images for the pool directly from Scryfall's
image hosts and caches them. Artist credit is always visible with full-card images.

**D-008: Comprehensive Rules stored in the repo, split per section** · 2026-11-19 · accepted
`scripts/fetch-rules.mjs` downloads the official TXT and writes `rules/`. The generated files are
committed, so every session (including Claude Code on the web, which may not reach wizards.com) can search them.

**D-009: DOM-based board UI (React), not canvas, to start** · 2026-11-19 · superseded by D-013
DOM elements are easier to test (Playwright can find them), handle touch and accessibility, and
are easier for people to read and change. Animations use CSS transforms. Revisit only if profiling
on the phone shows the DOM can't hold 60 fps.

**D-010: Touch-first, two live layouts** · 2026-11-19 · accepted
Layouts are chosen by viewport size and aspect ratio (not device detection), and switch live when
the phone folds or unfolds. See `ui.md`.

**D-011: Arena-style app first, RPG later** · 2026-11-19 · accepted
The RPG starts after the engine and app foundations are done (M5). Engine features the RPG will need
(custom setups, rule modifiers, save anywhere, `GameResult`) are built from M1.

**D-012: Arena-level polish is a guiding principle** · 2026-11-19 · accepted
The match experience must feel as polished and smooth as MTG Arena: instant touch feedback, readable
animations and pacing, smart auto-pass and auto-tap, clear affordances. The targets are in the "Feel" section
of `ui.md` and are checked with screenshots, interaction tests and performance traces. When polish of the core
match competes with a new feature, polish wins. The board renderer choice follows from this (D-013).

**D-013: Board rendered with PixiJS (WebGL/WebGPU); React for everything else; GSAP for choreography** · 2026-11-19 · accepted
Supersedes D-009. Arena-style effects (glows, particles, spell impacts, card dissolves, foil shimmer,
perspective tilt, many cards moving at once) need GPU rendering with shaders; layered DOM elements with
filters stutter on mobile Safari long before that. So:
- **PixiJS v8** draws the match board: battlefields, hand, stack, cards, arrows and effects. It's a renderer,
  not a game framework, so it fits our own engine and state model.
- **React (DOM)** draws everything that is UI rather than the play area: menus, prompts, buttons, life and
  phase HUD, settings, deckbuilder, collection. DOM text is crisp, accessible and easy to lay out.
- **GSAP** builds animation timelines from engine events (sequencing, easing, interruption), for both Pixi
  objects and DOM elements.
Considered: keeping the DOM board (simplest and most testable, but can't reach the effects bar), Phaser (a full
game framework that wants to own scenes, input and the loop), and Three.js (true 3D, which is far more complexity
than Arena's mostly 2.5D look needs). Testability is kept with a pure board model and a test hook (see `ui.md`).

**D-014: Deckbuilding and collection are a full pillar of the app** · 2026-11-19 · accepted
The app is a one-stop shop: play, browse every card, build and manage decks, manage a collection. The bar is
the Arena deckbuilder, Moxfield and Archidekt. Spec in `deckbuilding.md`. Every Magic card is browsable and
can go in a deck; only cards in the engine's pool are playable, and the UI always says which.
Deck logic and search live in pure packages (`library`, `decks`) so they're tested headlessly like the engine.

**D-015: Private repo, no open-source license; Cloudflare Pages for hosting** · 2026-11-19 · accepted
The repository is private and has no license file (all rights reserved). Card names, Oracle text, rules text and
images belong to Wizards of the Coast; card data comes from Scryfall under its terms. GitHub's free plan doesn't
offer GitHub Pages or protected branches for private repos, so the app is hosted on **Cloudflare Pages**
(which deploys from private repos), and `main` is protected by convention (CLAUDE.md), Claude Code's
permission settings, and CI, unless the owner's GitHub plan adds branch protection.

**D-016: Pinned dependencies with weekly Dependabot updates** · 2026-11-19 · accepted
Exact versions, a committed lockfile, and Dependabot pull requests that must pass CI. Fewer surprises, and
upgrades happen deliberately.
