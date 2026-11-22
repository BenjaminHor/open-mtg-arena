# M3 — First playable

**Goal:** the owner plays full games against the AI in a browser, on the iPhone Duo (folded and
unfolded) and on desktop, and the match already **feels smooth**, and as much as possible **like playing MTG Arena**
(D-140: Arena's layout, flow and interactions, with art and visuals of our own; the research is in `arena-research.md`). The rules are those of M2: the Magic 2010 pool of 240 cards and its five prebuilt decks. This spec was
reviewed for M2's pool on 2026-11-22.

**Order (owner, 2026-11-22):** a playable game in the browser first, then the rest. Phase 1 is M3-01, M3-02, M3-03
and M3-04: the owner plays the built-in AI on the folded phone. Phase 2 is M3-05 to M3-12 and M3-02b.
This milestone is about the app, the AI and the match host. The card pool is small and the menus are basic,
but the core match should meet the "Feel" targets in `ui.md` from the start (D-012). Polish isn't saved for later.

Review this spec with the owner before starting. It's expected to change based on what M1 teaches us.

## Tasks

**M3-01 Match host.** `packages/match`: holds state, routes decisions to a human or an AI, smart auto-pass
that stops whenever you could act, with a full-control toggle (D-143), auto-tap mana with manual override, instant answers where
there's no real choice, and replay log recording. The per-player data the UI and every AI read is the engine's
`playerView` with `seenObjects` beside it (D-135), so the app's screen, the heuristic AI and the LLM opponent see the same
information (D-137); `brief`'s builder stays in the CLI, built on the same two. *Accept:* AI-vs-AI matches run through the
match host in tests, and their replay logs reproduce the final state.

**M3-02 Heuristic AI v0.** `packages/ai`, working from the player's view only: mulligan by land count, play a land,
cast the best affordable spell, burn the best target (lethal on a creature that matters, or face when lethal
is near), simple attack/block math, use pump spells and firebreathing in combat. It answers every kind of decision the
engine has (mulligan and bottom, X, targets, divided damage, planeswalker abilities, choosing cards from a zone, naming a
card, ordering replacement effects, "may" choices), sensibly where it matters and legally always. Deterministic given a
seed. *Accept:* it beats the random agent at least 95% of 500 games with each of the five prebuilt decks; no illegal
actions; at most 50 ms per decision on a laptop.

**M3-02b LLM opponent (owner, D-136).** Spec: `docs/llm-opponent.md`, a harness with tools over the player's view.
An optional AI player powered by a model the player picks, through their own
OpenRouter API key (kept on the device, sent only to OpenRouter; check first that it accepts calls straight from a
browser, as there's no server of ours). It works from the player view only, as `brief` builds it (D-135), plus what a
player knows of their deck: their decklist, what's left in their library (counts, never the order), the cards the
opponent has shown this game, and the deck's game plan. It asks the model only for real decisions (the match host
auto-passes the rest) and answers with the number of a legal action; an invalid reply is retried once, then the
heuristic AI decides. Prove it in the CLI first (a script that plays `brief --json` games against the built-in agents)
before the UI. Settings: key, model, a "thinking" indicator while it decides. The heuristic AI stays the default and
the only one offline. Information parity (D-137): the app's UI and the model read the same per-player data, so anything
a human sees the model gets, including everything a player remembers: the whole game's history as they saw it, cards
they know in the opponent's hand (one bounced there, say) and in a library (one they put on top or bottom), and the
rulings of the cards in play. Response windows a human would get (a combat trick, a counterspell) are offered to the
model too, and its pacing reads as a player's (not instant every time). *Accept:* in CLI games against the random agent it never makes an illegal move and wins most
games; in the app the owner can enter a key, pick a model and play a full game against it.

**M3-03 Web app scaffold.** `apps/web`: Vite + React + TypeScript, a PixiJS board canvas under the React UI
layer, GSAP, the `board-model` / `director` / `renderer` / `effects` structure and the `window.__board` test hook
(`ui.md`); the match host in a Web Worker; a
typed message protocol (plain JSON); a PWA manifest and service worker so the app works offline after the
first load; a Playwright test that loads the app. *Accept:* `pnpm dev` runs; an offline reload still works.

**M3-04 Board, compact layout.** For the folded phone and other phones, in landscape as Arena's phone client
(D-141, `ui.md`): both
battlefields, life totals, hand fan, stack panel (with targets), phase and priority indicator, the pass button, and
decision prompts. Everything M2's pool puts on the board: planeswalkers and their loyalty, counters, attached Auras and
Equipment, tokens, tapped and summoning-sick creatures, damage, graveyards and exile, and revealed hands and library
tops. *Accept:* a full game is playable at the folded phone's size in landscape in the browser's device emulation.

**M3-05 Board, full layout, and live switching.** The Arena-like layout for the unfolded phone and desktop,
switching live on resize with no loss of state or in-progress selection. *Accept:* a Playwright test resizes
mid-selection and the selection survives.

**M3-06 Touch interactions.** Tap to select and confirm, drag to play, long-press for card details, target
selection, attack and block assignment by tapping, and the damage assignment prompt. *Accept:* every decision kind the
engine has can be answered by touch; Playwright tests with touch emulation for each.

**M3-07 Animations from events.** The director: GSAP timelines built from engine events for zone moves (using
`cardId`), damage, life changes, tapping and combat; a first set of effects (spell impact, damage burst, glow on
playable cards, creature death); the dev effects gallery; speed setting including "instant". *Accept:* tests run at instant speed; animations don't block input.

**M3-08 Card art.** First-run download of the pool's images (about 240) from Scryfall's image hosts into the Cache
API, with a progress screen that shows the size first and resumes if interrupted; `navigator.storage.persist()`; a fallback text-only card frame when an image is
missing; artist credit in the long-press view. Follow `data-sources.md`. *Accept:* works offline after the
download; deleting the cache triggers a clean re-download.

**M3-09 Menus.** Title screen, deck choice (the five prebuilt decks; deckbuilding is M4), play vs AI, hotseat, settings (animation
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

**M3-11 Deploy (deferred, owner 2026-11-22).** No deployment yet: the owner runs the app locally on their MacBook
(`pnpm dev`) for testing. The goal is still to play it on the iPhone Duo; when that time comes, a static build on
Cloudflare Pages (D-015), added to the Home Screen and played offline. Until then, phone sizes are checked in the
browser's device emulation, and the dev server can be opened from a phone on the same network if the owner wants.

## Exit criteria

- The owner has played at least five complete games on the iPhone Duo (folded and unfolded) and on desktop.
- Every bug the owner reported is a scenario or Playwright test, and fixed (or listed in Known issues with the owner's agreement).
- The owner says the match feels smooth on the phone, and the performance-trace test passes.
- `pnpm check` is green, including Playwright tests.
- The M3 spec is drafted and reviewed with the owner.
