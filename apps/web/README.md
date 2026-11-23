# @mtg/web

The web app (M3): the match against the built-in AI in the browser, touch first, in the spirit of MTG Arena (D-140).
Vite + React + TypeScript; PixiJS draws the board under a React DOM layer; GSAP will sequence the animations (D-013).
Everything runs in the browser: the engine and the AI in a Web Worker, nothing on a server.

## Run it

- `pnpm dev`: the app with hot reload at http://localhost:5173 (no service worker in development).
- Live at https://benjaminhor.github.io/open-mtg-arena/, rebuilt from `main` on every merge by
  `.github/workflows/pages.yml` (D-159). Built there with `BASE_PATH=/open-mtg-arena/`; locally the base stays `/`.
- `pnpm build` then `pnpm preview`: the production build, with the service worker, at http://localhost:4173.
- `pnpm test:e2e`: the Playwright tests against a production build with the test hooks, in `dist-e2e` (never `dist`).
  Once per machine, first:
  `pnpm --filter @mtg/web exec playwright install chromium`.
- `?seed=12&deck=red-aggro&vs=white-soldiers` in the address starts a given match; `?fixture=mid-game` (or
  `crowded`, `attack`, `block`, `tokens`, `prompts`) starts a fixture board (`src/fixtures/`).

## Structure

- `?pace=instant` shows what the host did at once rather than frame by frame (D-172; the e2e build's default),
  `?pace=normal` frame by frame (everyone else's default).
- `src/app/`: the React app: `App.tsx` (the match screen; it makes the board model the canvas and the HUD share, and
  keeps whether the hand is open), `option-label.ts` (a label for each legal action), `safe-area.ts`, `use-playback.ts` (the worker's frames played in order, Skip, D-172), `orientation.ts` and `use-portrait.ts` (a phone held upright: the "turn your phone" prompt, D-171), `app.css`.
- `src/layout/`: `board-layout.ts` (the `BoardLayout` type: every position and size as data) and `compact.ts` (the
  folded phone in landscape, each value tagged [R] from the owner's screenshots or [guess]; D-152).
- `src/board-model/`: pure functions from a `SeatView`, the board's size, its safe-area insets and the UI state (hand
  open or not) to the board model: every card with its place and state, the hidden cards, combat's links and the HUD's
  anchors (ui.md, "Board structure"). `battlefield.ts` (the rows), `piles.ts` and `land-slots.ts` (piles of permanents
  that look the same), `combat.ts` (attackers step forward, blockers under their attackers, D-154), `picks.ts` (the
  declaration under way), `playable.ts` (what can be played now, from the options), `hand.ts` (collapsed and open),
  `hidden-cards.ts` (the opponent's hand, libraries), `ladder.ts` (the phase ladders), `stack.ts` (the whole stack, an ability as a panel), `ability-text.ts` (an ability's own line of its card's text), `target-arrows.ts` (arrows from the stack's top to its targets),
  `regions.ts` (where a tap lands), `badges.ts` (a permanent's keyword icons, counters, loyalty, sickness),
  `attachments.ts` (Auras and Equipment beside their host),
  `board-card.ts`, `card-info.ts`
  (printed cost, text, art and images from the pool data), `spread.ts` (a row between two edges). Unit-tested without
  drawing.
- `src/interaction/controls.ts`: what the person can do now and where (D-156): every legal option as a control, a tap
  on a card or portrait, the main button, Undo or Cancel beside it, or a prompt. Pure and tested over whole games.
  `prompt-text.ts`: what a prompt says, its title and each choice's label from the decision ("Choose X for Fireball",
  "Keep 7"), how it lays its choices out (buttons, a row of numbers, a filter box for naming a card) and how the filter
  ranks matches. `ability-label.ts`: an activated ability's short label ("Add {G}", "+2"). `all-attack.ts`: All
  Attack's picks, one at a time (the engine has no "all" action). `card-details.ts`: what the card view shows, a card's
  text and image and the hangers beside it (keyword reminders, counters, damage, what's attached, who controls it).
  `pacing.ts`: how long each frame of the host's run holds, by its events (D-172); `event-line.ts`: what a
  frame shows, in a line. `zones.ts`: each player's zones as the person may see them, the counts and the zone browser's tabs (D-168), and the
  whole stack's. `stack-details.ts`: what the card view adds for a stack object (an ability's own panel, targets, X).
- `src/hud/`: the DOM layer over the board, placed only by the model's anchors: buttons over the cards a tap acts on
  (`CardButtons.tsx`), each player's info in a left corner (`PlayerInfo.tsx`: life and zone counts, targetable as a
  player, a tap or a long-press opening their zones, and what of theirs is revealed beside it), the zone browser
  (`ZoneBrowser.tsx`: graveyard, exile and revealed cards in tabs, D-168; `long-press.ts` its long-press), the phase ladders (`PhaseLadder.tsx`), the main
  button (`main-button.ts` decides what it says and does) and the small ones beside it, the prompt (`Prompt.tsx`), a
  card's menu of choices (`ChoiceMenu.tsx`) and the settings cog with Concede and full control (`SettingsMenu.tsx`).
  `hand-drag.ts`: drag a hand card up onto the table to play it, followed on the window so lifting it can't lose it.
  The card view (`CardView.tsx`, opened by `card-inspect.ts`, D-161): a long-press, a right-click or "i" shows a card
  large; a mouse resting on a card previews it. `swallow-click.ts`: stops the click a drag's or a long-press's release
  fires, so neither also counts as a tap.
- `src/renderer/`: the PixiJS scene (`board-scene.ts`, sprites kept by object id, drawn on demand) and its React
  component (`BoardCanvas.tsx`). `card-sprite.ts` (a card's lifetime and art loading), `battlefield-tile.ts` (a permanent:
  its art only, name over a fade, power/toughness pill, D-162), `badge-marks.ts` (its keyword icons, counter badge,
  loyalty shield and "zz", D-166), `card-face.ts` (a whole card off the battlefield: frame,
  name strip, art, text, until its image loads), `face.ts`, `hand-face.ts` (a hand card's lower half), `card-marks.ts` (combat
  badges, pile counts, the tap mark), `mana-symbols.ts` (mana symbols as shapes), `card-back.ts`, `text-fit.ts`,
  `art.ts`, `palette.ts`. Draws the board model, no game logic or layout math; puts the model on `window.__board`
  (and `window.__artShown()`) in development and test builds.
- `src/fixtures/`: fixture boards written by card name (`mid-game`, `crowded`, `attack`, `block`, `tokens`, `prompts`, `badges`, `attachments`, `zones`, `stack`), for tests
  and screenshots; `setupOf` turns a board a test writes itself into a game setup.
- `src/worker/`: the match host in a Web Worker (architecture.md, "Match host"), stepped one action at a time so each
  reply carries frames of what happened (D-172). `protocol.ts` is the typed message
  protocol (plain JSON; the UI only ever gets the person's `SeatView` and the events they saw), `match-session.ts` the
  worker's logic as pure functions (a refused or failed message is an error reply, never a throw), `match.worker.ts`
  the thin `onmessage` shell, `client.ts` the UI's side.
- `src/director/`, `src/effects/`: the animation director (M3-07) and the visual effects; only their READMEs so far.
- `service-worker/sw.js`: the service worker; `vite.config.ts` writes `dist/sw.js` from it with the build's files.

## Tests

`test/` (Vitest, in `pnpm check`): the worker session (start, start from a setup, act, refuse, nothing hidden in a
reply), the board model on fixture boards and boards the tests write (`board-model.test.ts`), combat and the
declaration under way through the real session (`combat-board.test.ts`), the main button, `spread`. `controls.test.ts` plays seeded games through the worker and
checks every option has a control. `e2e/` (Playwright, `pnpm test:e2e`, run in CI, at desktop size and the folded phone
in landscape): playing by taps (`play.spec.ts`: a spell with a target, attacks, blocks, a whole game by the controls
alone, the keyboard); the app loads and plays a
round trip through the worker, draws a fixture board, opens and closes the hand, shows art when it loads and the
art-less frame when it can't, and works offline after its first load. They block Scryfall's image host (or serve a
stand-in image): no test needs the network.
