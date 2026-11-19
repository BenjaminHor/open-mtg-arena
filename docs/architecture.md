# Architecture

This is the design the code must follow. If something here turns out to be
wrong, change this document (and `decisions.md`) in the same commit as the code.

## Layers and packages

```
apps/web            PWA: PixiJS match board + React UI (menus, prompts, HUD, deckbuilder) (M2+)
  └─ uses ─> packages/match   runs one game: routes decisions to UI or AI, auto-pass, saves
               ├─ uses ─> packages/ai       chooses actions from a player's view
               └─ uses ─> packages/engine   the rules: pure reducer
packages/cards      card definitions (data) + the extracted card pool
packages/cli        headless text interface for playing and debugging games
packages/scenarios  the scenario runner: YAML scenarios run against the engine with real cards (D-033)
packages/library    full card database, search index, Scryfall-style query parser (M4)
packages/decks      deck model, validation, stats, import/export (M4)
packages/meta       collection, packs, economy, later the RPG world (M4+)
```

Allowed dependencies (arrows point at what a package may import):

- `engine` → nothing in this repo. It takes card definitions as input data.
- `cards` → `engine` (only for types).
- `ai` → `engine`.
- `match` → `engine`, `ai`, `cards`.
- `scenarios` → `engine` (its tests also use `cards`).
- `cli` → `match`, `engine`, `ai`, `cards`, `scenarios`.
- `library` → nothing in this repo except types from `cards`.
- `decks` → `library`, `cards`.
- `meta` → `engine` (types), `cards`, `decks`. It never reaches into a running game. It creates a
  `GameSetup` and reads a `GameResult`.
- `apps/web` → everything above. The web app never decides rules. It only shows what
  the engine says and sends back actions the engine listed as legal.

## Engine API

The whole public surface is small and pure:

```ts
createGame(setup: GameSetup, cards: CardDatabase): EngineResult
applyAction(state: GameState, action: Action, cards: CardDatabase): EngineResult
legalActions(state: GameState, player: PlayerId, cards: CardDatabase): Action[]
playerView(state: GameState, player: PlayerId): PlayerView      // hides hidden information
characteristics(state: GameState, obj: ObjectId, cards: CardDatabase): Characteristics

type EngineResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: EngineError }   // illegal action: the state is unchanged
```

Nothing else is exported from `engine/src/index.ts` without a reason in `decisions.md`.

## Game state

`GameState` is plain JSON. A rough shape (the real types live in `engine/src/state/`):

```ts
type GameState = {
  version: number              // schema version, for saved games
  setup: GameSetup             // players, decks, starting life, rule modifiers, seed
  rng: RngState                // seeded PRNG state; the only source of randomness
  nextId: number               // allocator for object ids
  nextTimestamp: number        // CR 613.7

  turn: { number: number; activePlayer: PlayerId; step: Step } | null   // null before the first turn
  turnOrder: PlayerId[]        // starts with the starting player (CR 103.1)
  players: Record<PlayerId, PlayerState>   // life, manaPool, landsPlayed, poison, lost, ...
  objects: Record<ObjectId, GameObject>    // every card/token/copy/ability object currently in a zone
  zones: Zones                             // ordered id arrays per player/zone; stack; battlefield

  effects: ContinuousEffect[]      // CR 611, applied by the layer system
  replacements: ReplacementEffect[]// CR 614-616
  delayedTriggers: DelayedTrigger[]
  pendingTriggers: PendingTrigger[] // triggered, waiting to be put on the stack (CR 603.3)
  turnHistory: TurnHistory          // facts later rules ask about ("a creature died this turn")

  pregame: Pregame | null          // choosing the starting player and mulligans (CR 103), before turn 1
  passesInSuccession: number       // priority passes in a row (CR 117.4)
  casting: Casting | null          // a spell part way through being cast (CR 601.2)
  combat: Combat | null            // attacks and blocks, during the combat phase (CR 506)
  work: WorkItem[]                 // the resolution queue (see "Running the game")
  pending: PendingDecision | null  // who must act, and what their options are
  result: GameResult | null        // set when the game ends
}
```

### Object identity

- An `ObjectId` names one game object. **When a card changes zones it becomes a new object
  with a new id** (CR 400.7). The engine never "moves" an id between zones.
- Each object also has a `cardId`, the physical card from a deck (or the token that was created).
  The `cardId` stays the same across zone changes. The UI uses it to animate a card moving from
  hand to stack to battlefield. Rules logic uses only `ObjectId`.
- `ZONE_CHANGED` events carry `from`, `to`, the old and new `ObjectId`, and the `cardId`.

### Characteristics are computed

Objects point at their card definition by `oracleId` (the printed values live there, D-022) and store
state like counters, damage, tapped, face-down. The stored controller is only the default (CR 110.2, 112.2, 113.8). Current power, toughness, types, colors, abilities and controller are
computed by `characteristics()`, which applies continuous effects in layer order (CR 613.1),
using timestamps (CR 613.7) and dependencies (CR 613.8). Memoize per state object if profiling
shows a need, never by caching values inside the state.

## Actions and decisions

Every input is an `Action`, and every action answers the current `PendingDecision`.

```ts
type PendingDecision = {
  id: string                 // must be echoed back, so stale answers are rejected
  player: PlayerId
  kind: 'priority' | 'mulligan' | 'chooseTargets' | 'chooseMode' | 'payCost'
      | 'declareAttackers' | 'declareBlockers' | 'assignDamage'
      | 'orderTriggers' | 'orderReplacements' | 'chooseCards' | 'chooseYesNo' | ...
  ...                        // fields for that kind: what is asked and its constraints (min/max, legal ids), as data.
}                            // Priority stores none: legalActions() computes its options.

type Action =
  | { type: 'PASS_PRIORITY'; decisionId: string; player: PlayerId }
  | { type: 'PLAY_LAND'; decisionId: string; player: PlayerId; object: ObjectId }
  | { type: 'CAST_SPELL'; decisionId: string; player: PlayerId; object: ObjectId }
  | { type: 'ACTIVATE_ABILITY'; decisionId: string; player: PlayerId; object: ObjectId; ability: AbilityRef }
  | { type: 'ANSWER'; decisionId: string; player: PlayerId; answer: Answer }
  | { type: 'CONCEDE'; player: PlayerId }   // any time, never listed by legalActions (D-042)
```

- Priority is just one kind of decision. Its options are the actions that `legalActions()` returns.
- Multi-step procedures such as casting a spell (CR 601.2a–i) are a sequence of decisions:
  announce → choose modes → choose targets → pay costs. Each answer is one action. The
  in-progress cast lives in `GameState.casting`, so the game can be saved and resumed in the middle of it. Activating
  an ability that uses the stack follows the same steps (CR 602.2b, D-041).
- The engine validates every action. An illegal action returns `ok: false` and changes nothing.

## Running the game: the work queue

`applyAction` applies the action, then calls `advance(state)`, which loops (D-032):

1. If `result` is set, or a decision is pending, stop.
2. Otherwise pop the next `WorkItem` and run it. A work item can queue more work items (at the front of the queue, so
   they run before older work), change state, emit events, or **set `pending`**, which stops the loop.
3. An empty queue with nothing pending is an engine bug: `advance` throws.

The work items so far: `givePriority` (state-based actions are checked first, CR 117.5, and it re-queues itself
while any are performed, D-039; triggers will join that check), `endStep` (CR 500.2), `resolveTopOfStack` (CR 608: it
queues the resolution's effects, `finishResolving`, then priority for the active player), `runEffect` (one effect of a
resolving spell or ability, CR 608.2c), `finishResolving`, `doesNotResolve` (CR 608.2b), `finishCleanup`,
`cleanupCheck` and `anotherCleanupStep` (CR 514.3a), and combat's turn-based actions `declareAttackers`,
`declareBlockers` and `combatDamage` (D-040). When all players pass in succession, the top of the stack
resolves; with an empty stack the step ends, or after a cleanup step that gave players priority, another cleanup step
begins (CR 117.4, 514.3a).

Resolving a spell means turning its effect data into work items. Because the queue lives in
the state rather than on the JavaScript call stack, **any point that waits for a decision is a
plain data snapshot**. That's what makes saves, undo, replays, AI simulation and the web worker
simple.

## Effects, events, replacements, triggers

- **Effects are data**, for example
  `{ op: "dealDamage", amount: 3, from: "self", to: { target: 0 } }` (the draft shapes are in
  `engine/src/cards/types.ts`, D-026). The engine has one
  interpreter that turns effect nodes into work items. Card definitions never contain functions.
- Anything that happens in the game goes through one pipeline:
  1. **Propose** an event (draw a card, deal damage, move to a zone).
  2. **Replace**: apply replacement and prevention effects (CR 614–616). If several apply, the
     affected player or controller chooses the order (CR 616.1), which is a decision.
  3. **Perform** the event and emit `GameEvent`s.
  4. **Trigger**: check triggered abilities against the events and add `pendingTriggers` (CR 603.2).
- Events returned from `applyAction` are the UI's animation script and the AI's and tests'
  record of what happened. They're never needed to rebuild state.

## Hidden information and randomness

- Events can carry hidden information too (a drawn card), so the match host filters them per player with
  `eventsFor(events, p)` before they reach the UI or AI, the same way `playerView` filters state (D-044).
- `GameState.rng` predicts every future shuffle, so `playerView` must leave it out too (CR 701.24a: no player knows
  a library's order).
- `playerView(state, p)` leaves out hidden objects (other players' hands, libraries; face-down cards later) and keeps
  only counts and public facts; it also leaves out the setup (its seed and decklists) and the engine's internals. The
  AI and the UI get views only. Tests and the CLI's debug mode can see full state.
- All randomness (shuffles, coin flips, random choices) comes from `state.rng`, a small seeded
  PRNG implemented in the engine. The same setup and the same actions always give the same game.

## Match host (`packages/match`)

- Holds the current state. Asks the AI or the human for each decision. Applies actions.
- **Smart auto-pass**: skips priority decisions the player has nothing meaningful to do in, honoring the
  player's stops, as Arena does. Auto-pass lives here, not in the engine.
- **Auto-tap**: chooses which mana sources pay a cost (keeping colors the hand still needs). The engine
  lists the legal ways to pay; the match host picks one, and the player can override it.
- **Answer instantly where there's no real choice** (one legal option, a forced order), so the UI never
  shows an empty prompt. See the "Feel" section in `ui.md`.
- **Replay log**: a match is `setup + seed + ordered actions`. Saving stores a state snapshot plus
  the log. **The log is also the bug-report format.** One button in the app exports it, and a test
  can replay it exactly.
- In the browser, the match host runs in a **Web Worker**. The UI sends actions and receives
  `{ view, events, legalActions, pending }` messages. All of these are plain JSON.

## AI (`packages/ai`)

- Input: a `PlayerView` plus the pending decision. Output: an action. It never reads full state.
- v0 (M2): heuristics. Board evaluation, simple attack/block math, burn the best target,
  never make an illegal move.
- Later: search (for example Monte Carlo tree search). Clone the state from a sampled "plausible
  world" consistent with the view, and simulate with the real reducer. This is why the reducer
  must stay pure and reasonably fast.
- Card definitions may carry optional `aiHints` (for example "hold this for a combat trick").

## Requirements that exist for the RPG (keep them working from M1)

- `GameSetup` supports non-standard starts: any starting life per player, cards that start on
  the battlefield or in other zones, extra **rule modifiers** (emblem-like continuous effects
  owned by no card, such as "creatures you control have flying"), and who goes first.
- `GameResult` reports winner, reason, turn count and anything the meta layer needs (cards that
  were exiled, for ante-style rules later). The engine doesn't know the RPG exists.
- Save in the middle of a game works at any decision point.

## Performance budget

- One `applyAction` for a normal action in a normal board state: well under 1 ms on a phone.
- A full random-legal game in the fuzzer: under 100 ms on a laptop.
- `pnpm bench` (built in M1) tracks these against a baseline (see `testing.md`). Measure before optimizing anything.
