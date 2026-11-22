# M3 — First playable

**Goal:** the owner plays full games against the AI in a browser, on the iPhone Duo (folded and
unfolded) and on desktop, and the match already **feels smooth**. The rules are those of M2 (rules depth), which
comes first since the owner's decision D-051; this spec was written for M1's 17 cards and needs a review for M2's
bigger pool before it starts.
This milestone is about the app, the AI and the match host. The card pool is small and the menus are basic,
but the core match should meet the "Feel" targets in `ui.md` from the start (D-012). Polish isn't saved for later.

Review this spec with the owner before starting. It's expected to change based on what M1 teaches us.

## Tasks

**M3-01 Match host.** `packages/match`: holds state, routes decisions to a human or an AI, smart auto-pass
with per-step stops and a full-control toggle, auto-tap mana with manual override, instant answers where
there's no real choice, and replay log recording. *Accept:* AI-vs-AI matches run through the
match host in tests, and their replay logs reproduce the final state.

**M3-02 Heuristic AI v0.** `packages/ai`, working from `PlayerView` only: mulligan by land count, play a land,
cast the best affordable spell, burn the best target (lethal on a creature that matters, or face when lethal
is near), simple attack/block math, use Giant Growth and firebreathing in combat. Deterministic given a seed.
*Accept:* it beats the random agent at least 95% of 500 games with each deck; no illegal actions; at most
50 ms per decision on a laptop.

**M3-02b LLM opponent (owner, D-136).** An optional AI player powered by a model the player picks, through their own
OpenRouter API key (kept on the device, sent only to OpenRouter; check first that it accepts calls straight from a
browser, as there's no server of ours). It works from the player view only, as `brief` builds it (D-135), plus what a
player knows of their deck: their decklist, what's left in their library (counts, never the order), the cards the
opponent has shown this game, and the deck's game plan. It asks the model only for real decisions (the match host
auto-passes the rest) and answers with the number of a legal action; an invalid reply is retried once, then the
heuristic AI decides. Prove it in the CLI first (a script that plays `brief --json` games against the built-in agents)
before the UI. Settings: key, model, a "thinking" indicator while it decides. The heuristic AI stays the default and
the only one offline. *Accept:* in CLI games against the random agent it never makes an illegal move and wins most
games; in the app the owner can enter a key, pick a model and play a full game against it.

**M3-03 Web app scaffold.** `apps/web`: Vite + React + TypeScript, a PixiJS board canvas under the React UI
layer, GSAP, the `board-model` / `director` / `renderer` / `effects` structure and the `window.__board` test hook
(`ui.md`); the match host in a Web Worker; a
typed message protocol (plain JSON); a PWA manifest and service worker so the app works offline after the
first load; a Playwright test that loads the app. *Accept:* `pnpm dev` runs; an offline reload still works.

**M3-04 Board, compact layout.** For the folded phone and other small portrait screens (see `ui.md`): both
battlefields, life totals, hand fan, stack panel, phase and priority indicator, the pass button, and
decision prompts. *Accept:* a full game is playable at 5.4-inch portrait size in the browser's device emulation.

**M3-05 Board, full layout, and live switching.** The Arena-like layout for the unfolded phone and desktop,
switching live on resize with no loss of state or in-progress selection. *Accept:* a Playwright test resizes
mid-selection and the selection survives.

**M3-06 Touch interactions.** Tap to select and confirm, drag to play, long-press for card details, target
selection, attack and block assignment by tapping, and the damage assignment prompt. *Accept:* every M1
decision kind can be answered by touch; Playwright tests with touch emulation for each.

**M3-07 Animations from events.** The director: GSAP timelines built from engine events for zone moves (using
`cardId`), damage, life changes, tapping and combat; a first set of effects (spell impact, damage burst, glow on
playable cards, creature death); the dev effects gallery; speed setting including "instant". *Accept:* tests run at instant speed; animations don't block input.

**M3-08 Card art.** First-run download of the pool's images from Scryfall's image hosts into the Cache API,
with a progress screen; `navigator.storage.persist()`; a fallback text-only card frame when an image is
missing; artist credit in the long-press view. Follow `data-sources.md`. *Accept:* works offline after the
download; deleting the cache triggers a clean re-download.

**M3-09 Menus.** Title screen, deck choice (the two prebuilt decks), play vs AI, hotseat, settings (animation
speed, stops), About (with the fan-content notice). *Accept:* the owner can start each mode from the title screen.

**M3-10 Saves and bug reports.** Autosave the current match (snapshot + replay log) in IndexedDB and resume it on
reload. A "Report a bug" button exports the replay log plus a short description as a file. *Accept:* killing the
tab mid-game and reopening resumes exactly; an exported report replays in `pnpm cli replay`.

**M3-12 Feel pass.** Go through every item in the "Feel" section of `ui.md` and make it true: shared motion
tokens (durations and easing), opponent-action pacing, the thinking indicator, playable glow and target
highlighting, contextual primary-button labels, one-tap shortcuts, life-total animation, sound effects with
settings, and reduced motion. Add the performance-trace test (input feedback under 100 ms, no dropped frames,
with CPU throttling). *Accept:* the trace test passes; the `ux-reviewer` agent finds no unmet "Feel" items;
the owner plays on the phone and signs off on the feel, or lists what's off.

**M3-11 Deploy.** A static build deployed to Cloudflare Pages (D-015) on merge to `main`. *Accept:* the owner opens the URL on the iPhone Duo, adds it to the Home Screen, and plays offline.

## Exit criteria

- The owner has played at least five complete games on the iPhone Duo (folded and unfolded) and on desktop.
- Every bug the owner reported is a scenario or Playwright test, and fixed (or listed in Known issues with the owner's agreement).
- The owner says the match feels smooth on the phone, and the performance-trace test passes.
- `pnpm check` is green, including Playwright tests.
- The M3 spec is drafted and reviewed with the owner.
