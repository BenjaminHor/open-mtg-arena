# @mtg/ai

**Placeholder.** The computer opponent arrives in M2 (heuristics), and search comes later.
See "AI" in [`docs/architecture.md`](../../docs/architecture.md).

It will take a `PlayerView` and the pending decision, and return an action. It never reads the full game state.
Depends only on `@mtg/engine`.

## Entry points

- `src/index.ts`: empty for now.

Until then, the CLI's `random` and `first-legal` agents (M1-17) play games for testing.

## Tests

None yet. When the AI arrives, `pnpm test` runs its tests along with the rest.
