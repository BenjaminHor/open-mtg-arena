import { configDefaults, defineConfig } from "vitest/config";

// The tests mutation testing runs (`pnpm mutate`, docs/testing.md, section 7): the engine's unit tests and the rules
// scenarios. The CLI's golden games, fuzz and replays would catch mutants too, but they take minutes, and Stryker runs
// the tests again for every mutant that survives the rest.
export default defineConfig({
  test: {
    include: ["packages/engine/test/**/*.test.ts", "packages/scenarios/test/**/*.test.ts"],
    exclude: [...configDefaults.exclude],
  },
});
