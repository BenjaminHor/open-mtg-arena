# UI guidelines

The owner plays mainly on an **iPhone Duo**. Folded, it's a 5.4-inch phone. Unfolded, it's a
7.6-inch, nearly square screen. Desktop browsers are also supported. Every screen is designed
for touch first.

## Feel: the guiding principle

The match should feel as polished and smooth as MTG Arena. That's a product requirement, not a
finishing touch. Each item below is something the code can be checked against.

**The owner wants the interface to work like MTG Arena's as closely as possible (2026-11-22).** Arena's
interaction design is the model: where things sit on the board, how a turn flows, how passing, stops, targeting,
attacking, blocking and paying feel. The research behind this is in `arena-research.md` (two passes, 2026-11-22, with a layout map from screenshots;
each finding is tagged by how well it's sourced). The look is our own:
the art, card frames, icons, sounds and visual style are original, never Arena's assets or trade dress (D-140).
Where the research leaves a screen open (choosing X or a player, scry and search, dividing damage, exile, default
stops), we design it ourselves in the same spirit (owner, 2026-11-22). The owner expects the visual design and UX to
need a lot of refinement through play; Arena is the North Star for the direction (2026-11-22). So build each screen to
be easy to change (layout and motion values in one place, D-012's shared tokens), and show it to the owner early.

**The cards (owner, 2026-11-23, on the first M3-04a look):** "I feel like we could try harder to make it look like the
screenshot. Specifically the cards themselves", pointing at a 2018 Arena desktop screenshot. What that screenshot shows
of a permanent, which our own drawing follows (D-153): a wide "art card", wider than tall; a thick bevelled frame in
the card's colour with a light inner rim and a drop shadow on the table; a light name strip across the top with dark
serif text; the art filling the rest; power/toughness in a small light pill at the bottom centre, over the frame's
edge, its numbers coloured when changed; keyword badges at the bottom-left corner; identical tokens piled with an "x4"
count above the pile; a tapped card tilted, darkened and marked with a large curved arrow. The table is a warm,
textured playmat, not a flat colour.

**Tapped lands in a pile (owner, 2026-11-23):** "when there's a stack of cards like lands, tapping a subset of them
just taps them within the stack visually. I think if they're tapped then they should be on top of the visual stack if
that makes sense. So it doesn't look messy." A pile's tapped cards gather on top of it, together, in front of its
untapped ones (D-153).

**The rest of the HUD (owner, 2026-11-23, after the card redraw):** "Looks a lot better! I think some of the UI other
than the cards could use some polish, they look a little too generic and basic." The portraits, life crests, phase
ladder, main button, card backs, libraries and drawers get the same care as the cards: our own crafted shapes,
metal-and-enamel finishes, depth and light, in the spirit of Arena's ornate HUD (the reference's crest wraps the
portrait and the life total; the ladder sits on a curved rail around it), never its assets (D-140).

**Responsiveness**
- Every tap, drag or long-press gives visible feedback within 100 ms, **even while the AI is thinking**
  or the worker is busy. The UI responds locally right away (press state, card lift, selection highlight)
  and doesn't wait for a worker round trip to show that it heard you.
- Animations run at the display's full frame rate with no dropped frames during normal play. DOM elements
  animate only `transform` and `opacity`; the board is GPU-rendered by PixiJS (D-013). No layout shifts during a match: elements don't jump when text or counts change.
- Cold start to title screen in under 2 s on the phone after the first visit (served from the service worker).

**The player only makes meaningful decisions**
- **Smart auto-pass**: stop for priority only when the player has something they could actually do
  (a castable instant, an activatable ability), or at a stop they set. Never make them tap "pass" through empty steps.
- **Auto-tap mana**: pay costs automatically with a sensible choice of lands (keep the colors the hand
  still needs), with a way to pay manually for the rare case where it matters.
- One-tap shortcuts: "All attack", "No blocks", "Resolve", "Pass turn". Sensible defaults pre-filled
  (for example, damage assignment pre-set to a legal, sensible split).
- Prompts appear only when a real choice exists. A spell with exactly one legal target still asks, but
  pre-selects it; anything with no choice (a forced order, one option) just happens.

**Clarity**
- Playable cards glow, valid targets are highlighted, and everything else is dimmed while choosing.
- There's always one obvious primary button, and its label says what it will do ("Resolve Lightning Bolt", "Next: combat").
- Whose turn, which step, who has priority and what the game is waiting for are visible at all times.
- **Pacing for the opponent**: each AI action is shown clearly (the card is revealed, it travels, it lands)
  with a short beat between actions so the player can follow. A fast AI must not make the game hard to read;
  a slow one must not feel stuck (show a subtle "thinking" indicator after about 300 ms).
- Combat reads at a glance: attack and block arrows or pairings, damage numbers, creatures dying with a clear animation.
- Life totals and counters animate their changes rather than snapping.

**Never color alone**
- Magic is full of color, so nothing in the UI may rely on color by itself. Playable cards, valid targets, selected
  cards, attackers and blockers, and whose turn it is also differ by shape, outline, icon, motion or label.
- Mana symbols always use their symbol shapes, not just colored dots. Check screenshots with a colorblindness
  simulation (for example the browser dev tools' vision deficiency emulation) for the main board states.

**Feel details**
- Cards lift and tilt slightly when picked up and settle with a little easing when placed. Motion is quick
  (roughly 150–300 ms for most moves) and consistent, using one shared set of durations and easing curves.
- Sound effects for key moments (draw, play, attack, damage, win and lose), with volume and mute in settings.
  Music is optional and comes later.
- A reduced-motion setting (and respecting the system preference) that keeps the game clear without big movement.

**Never**
- Never block input behind an animation the player can't skip. Tapping during an animation speeds it up or queues the input.
- Never show a spinner during a normal action.
- Never lose the player's place: folding the phone, an incoming call or a reload returns them exactly where they were.

## How Claude Code checks UI work

UI quality has to be checked like rules correctness, not assumed:
- **Screenshots at both layouts.** For every UI change, run the Playwright screenshot suite at the folded
  (about 5.4-inch, played in landscape) and unfolded (about 7.6-inch, nearly square) sizes, plus desktop, and look at them.
- **Interaction tests** with touch emulation for every decision kind.
- **Performance traces.** A Playwright test that plays a scripted match and records a performance trace, failing
  if frames drop during animations or input feedback exceeds 100 ms. Run it with CPU throttling to approximate a phone.
- **Ask the `ux-reviewer` agent** to review UI changes against this document.
- The owner's real-phone playtest is the final judge. Their "this feels off" is a bug: write it down in
  `docs/status.md` and treat it like any other bug.

## Layouts

- Pick the layout from **viewport size and aspect ratio**, never from the device model or user agent.
  Two board layouts to start:
  - **Compact** (the folded phone and other phones, **in landscape**, as Arena's phone client plays; owner,
    D-141): Arena's phone layout: smaller permanents in grouped rows, a hand tucked at the bottom that fans out on
    tap, the stack at the side, and card details on long-press. In portrait, a phone shows a "turn your phone"
    prompt over the paused match.
  - **Full** (unfolded, tablets, desktop): an Arena-like board with both battlefields, hand,
    stack and log visible at once.
- **Folding or unfolding mid-game must just work.** Listen for resize/orientation changes, re-lay out
  with no state loss, and keep any in-progress selection (such as chosen targets).
- Respect safe areas (`env(safe-area-inset-*)`) and the fold/notch areas.

## Touch interaction

- **Tap** to select; **tap again or tap a target** to confirm. **Drag** a card from hand onto the board
  to play it (with tap-to-play as the equivalent, since dragging should never be the only way).
- **Long-press** (about 400 ms) shows the full card image, Oracle text, rulings and artist credit.
  There's no hover anywhere, because touch has none.
- Hit targets are at least 44×44 points. Spacing prevents mis-taps on dense boards.
- Prompts for decisions come from the engine's `PendingDecision`. The UI renders them; it never
  invents its own legality. Illegal choices are visibly disabled, not hidden.
- **Arena-style passing**: a big "Pass / Resolve / Next" button, auto-pass by default, and per-step
  stops the player can toggle. A "full control" toggle stops at every priority.
- Undo isn't supported for actions the opponent could see, but cancel works during any
  multi-step choice before it's committed (for example while choosing targets).
- Prevent browser gestures from interfering on the board: `touch-action: none` on the play area,
  no double-tap zoom, no text selection, `overscroll-behavior: none`.

## Animation and feedback

- Animate from engine **events** (`ZONE_CHANGED`, `DAMAGE_DEALT`, ...), using `cardId` to move the same
  card between zones. Sequence them with GSAP timelines (D-013). DOM elements animate only `transform`
  and `opacity`; board objects are drawn by PixiJS.
- Animation speed is a setting; "instant" must work, which the tests use.
- Always show whose turn it is, the step, who has priority and what the game is waiting for.

## Safari and storage (iOS)

Every browser on iOS uses Safari's WebKit engine, so plan for its rules:
- Safari can clear stored data for websites that haven't been used for a while. A web app added to
  the Home Screen is treated more like an installed app. The app should encourage "Add to Home Screen",
  call `navigator.storage.persist()`, and offer save export/import (M4) as the backstop.
- Test the PWA install, offline launch and the art cache on the real phone, not only in desktop Safari.

## Implementation notes

- **Stack (D-013):** PixiJS v8 renders the match board; React renders menus, prompts, buttons and the HUD
  as DOM on top of it; GSAP sequences animations. Plain CSS modules (or a similarly small approach) for DOM styling.
- **Board structure, kept readable and testable:**
  - `board-model/`: pure functions that turn a `SeatView` (D-144) plus the layout size into a **board model**:
    plain data listing every visible card with its position, rotation, scale, highlight and interaction
    state. Unit-tested without rendering anything. Layout logic lives here, not in Pixi code.
  - `director/`: turns engine events into an animation queue (GSAP timelines) that moves the board from
    the old model to the new one. It handles pacing, skipping and input during animations.
  - `renderer/`: the PixiJS scene. It draws the board model and plays the director's timelines. It contains
    no game logic and no layout math.
  - `effects/`: each visual effect (damage burst, glow, dissolve, foil) is its own small module with a
    one-line description, a preview in the dev effects gallery, and a reduced-motion fallback.
- **Testing a canvas:** Playwright can't see inside a canvas, so in dev and test builds the renderer exposes
  a test hook (for example `window.__board`) with the current board model and each card's screen rectangle.
  Tests find a card by name, tap at its rectangle, and assert on the model. Screenshots still check the
  visuals. PixiJS's accessibility support gives screen readers (and tests) labels for interactive objects.
- **Dev effects gallery:** a dev-only page that plays every animation and effect on demand, at both layouts
  and both speeds. It's how Claude Code and the owner review motion without playing a whole game.
- Install PixiJS's official agent skills for Claude Code (see README) so generated Pixi code uses current v8 APIs.
- Keep game rendering components "dumb": they receive a `PlayerView` and the pending decision, and emit `Action`s.
- Every interactive element gets an accessible name, which also gives Playwright stable selectors.
