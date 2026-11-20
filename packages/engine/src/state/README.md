# engine/src/state

The types that make up a game, all plain JSON data (CLAUDE.md, hard invariants). No logic lives here except
tiny helpers that belong to one type (`emptyManaPool`, `phaseOf`).

| File | What it defines |
| --- | --- |
| `ids.ts` | `PlayerId` (`p1`), `ObjectId` (`o7`), `CardId` (`c7`), `DecisionId` (`d3`), `OracleId`. Distinct types, so an object id can't be used as a card id (CR 400.7). |
| `game-state.ts` | `GameState`, the whole game |
| `setup.ts` | `GameSetup`: players, decks, preset zones, a `standard` or `fixed` opening, rule modifiers |
| `objects.ts` | `GameObject`: a card in a zone, or an ability on the stack, plus the choices made while casting |
| `zones.ts` | Zones and their order conventions (library top is index 0; stack and graveyard tops are the last entry) |
| `players.ts`, `mana.ts`, `turn.ts` | Players, mana pools, steps and phases |
| `decisions.ts` | `PendingDecision`: what the game is waiting for |
| `game-state.ts` `Resolution` | What the resolving object did "this way" (CR 608.2c): found and exiled cards (D-064) |
| `casting.ts` | `Casting`: a spell part way through being cast or an ability being activated, with its origin and what's needed to reverse it (CR 734.1) |
| `work.ts` | `WorkItem`: work waiting in the queue (D-032) |
| `combat.ts` | `Combat` (with `newCombat()`), `Attack`, `Block`, `DamageDivision`, `CombatDivision`: attacks, blocks, creatures removed from combat (`removed`, CR 506.4) and first strike's steps during the combat phase (CR 506, 510.4) |
| `replacements.ts` | `ReplacementEffect`: replacement and prevention effects made by resolving spells and abilities: regeneration shields and "prevent all damage" (CR 614.1, 615.1a, 701.19a, D-086, D-088); `ReplacementRef` and `ChoiceFor`, what a CR 616.1 choice names and is for; `hasRegenerationShield`, `replacementEffectCard`, `endReplacementEffects` |
| `state-based-actions.ts` | `StateBasedAction`: one state-based action a check found (CR 704) |
| `effects.ts` | `ContinuousEffect`, `EffectChange`, `Duration` (CR 611); `EffectContext`, carried by `runEffect` work items (D-036) and by a `chooseCards` decision's `resume` (D-062) |
| `pregame.ts` | `Pregame`: the start of a standard game (starting player, mulligans), before turn 1 |
| `actions.ts` | `Action`: every input to the engine |
| `events.ts` | `GameEvent`: what happened |
| `result.ts` | `EngineResult`, `EngineError`, `GameResult` |

Things to know before using these types:
- Objects store state, not characteristics. Read power, types, abilities and **controller** through
  `characteristics()` (`rules/characteristics.ts`) or the per-layer readers it composes (D-038), never from fields. `baseController` is only the CR 110.2 default (D-022).
- States are never mutated. Each change makes a new state that shares the unchanged parts (D-021).
- Players come in turn order from `GameState.turnOrder`. Never assume two players or "the opponent".
- Iterate zones (for order) or `turnOrder` (for players), never `Object.keys(objects)` or `Object.keys(players)`:
  record key order is just creation order, with no rules meaning.
- `` `o${number}` `` also accepts strings like `o1.5`. Only the engine's id allocator (`nextId`) makes ids.

Tests: `test/state/` (a JSON round trip of a realistic mid-turn state, and type-level tests) and
`test/support/plain-json.ts`, a checker that lists anything in a value that isn't plain JSON.
