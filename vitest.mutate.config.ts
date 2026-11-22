import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// The tests mutation testing runs (`pnpm mutate`, docs/testing.md, section 7): the engine's unit tests and the rules
// scenarios. The CLI's golden games, fuzz and replays would catch mutants too, but they take minutes, and Stryker runs
// the tests again for every mutant that survives the rest.
//
// The workspace packages are imported by name (`@mtg/engine`), which resolves through node_modules to the original
// checkout, not to Stryker's mutated copy of it. So each name is pointed at the source next to this file: in Stryker's
// sandbox, that's the mutated code. Without this, the scenarios would test the unchanged engine and kill nothing.
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mtg/engine": here("./packages/engine/src/index.ts"),
      "@mtg/cards": here("./packages/cards/src/index.ts"),
      "@mtg/scenarios": here("./packages/scenarios/src/index.ts"),
    },
  },
  test: {
    include: ["packages/engine/test/**/*.test.ts", "packages/scenarios/test/**/*.test.ts"],
    exclude: [...configDefaults.exclude],
  },
});
