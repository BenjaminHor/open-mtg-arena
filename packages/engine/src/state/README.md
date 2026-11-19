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
| `actions.ts` | `Action`: every input to the engine |
| `events.ts` | `GameEvent`: what happened |
| `result.ts` | `EngineResult`, `EngineError`, `GameResult` |

Things to know before using these types:
- Objects store state, not characteristics. Read power, types, abilities and **controller** through
  `characteristics()` (from M1-11), never from fields. `baseController` is only the CR 110.2 default (D-022).
- States are never mutated. Each change makes a new state that shares the unchanged parts (D-021).
- Players come in turn order from `GameState.turnOrder`. Never assume two players or "the opponent".

Tests: `test/state/` (a JSON round trip of a realistic mid-turn state, and type-level tests) and
`test/support/plain-json.ts`, a checker that lists anything in a value that isn't plain JSON.
