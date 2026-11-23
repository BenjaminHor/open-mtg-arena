# @mtg/web

The web app (M3): the match against the built-in AI in the browser, touch first, in the spirit of MTG Arena (D-140).
Vite + React + TypeScript; PixiJS draws the board under a React DOM layer; GSAP will sequence the animations (D-013).
Everything runs in the browser: the engine and the AI in a Web Worker, nothing on a server.

## Run it

- `pnpm dev`: the app with hot reload at http://localhost:5173 (no service worker in development).
- `pnpm build` then `pnpm preview`: the production build, with the service worker, at http://localhost:4173.
- `pnpm test:e2e`: the Playwright tests against a production build with the test hooks, in `dist-e2e` (never `dist`).
  Once per machine, first:
  `pnpm --filter @mtg/web exec playwright install chromium`.
- `?seed=12&deck=red-aggro&vs=white-soldiers` in the address starts a given match.

## Structure

- `src/app/`: the React app: `App.tsx` (the match screen for now), `option-label.ts` (a label for each legal action),
  `app.css`.
- `src/worker/`: the match host in a Web Worker (architecture.md, "Match host"). `protocol.ts` is the typed message
  protocol (plain JSON; the UI only ever gets the person's `SeatView` and the events they saw), `match-session.ts` the
  worker's logic as pure functions (a refused or failed message is an error reply, never a throw), `match.worker.ts`
  the thin `onmessage` shell, `client.ts` the UI's side.
- `src/board-model/`: pure functions from a `SeatView` and the board's size to the board model, every card with its
  place and state (ui.md, "Board structure"). Unit-tested without drawing.
- `src/renderer/`: the PixiJS scene (`board-scene.ts`) and its React component (`BoardCanvas.tsx`). Draws the board
  model, no game logic or layout math; puts the model on `window.__board` in development and test builds.
- `src/director/`, `src/effects/`: the animation director (M3-07) and the visual effects; only their READMEs so far.
- `service-worker/sw.js`: the service worker; `vite.config.ts` writes `dist/sw.js` from it with the build's files.

## Tests

`test/` (Vitest, in `pnpm check`): the worker session (start, act, refuse, nothing hidden in a reply) and the board
model. `e2e/` (Playwright, `pnpm test:e2e`, run in CI): the app loads and plays a round trip through the worker, and
works offline after its first load.
