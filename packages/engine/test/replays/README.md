# Saved replays

Game files (docs/testing.md, section 4) that must keep playing out to the same final state. Each has a
`description`, the SHA-256 of its final state's JSON, and one action per line. `packages/cli/test/replays.test.ts`
replays them with the real card pool (D-046).

- If an intended engine change alters one, run `pnpm replays:update` and say why in the commit.
- To add one (a bug report, a fuzz failure once fixed), copy its game file here, run `pnpm replays:update` to fill in
  the hash and drop the cached state, and write its `description`.
