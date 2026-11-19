import { configDefaults, defineConfig } from "vitest/config";

// Two projects so scenario tests can run on their own (`pnpm test:scenarios`).
// Scenario YAML files live in packages/engine/test/scenarios/ and are run by
// the scenario runner's test files there (built in M1-16). See docs/testing.md.
const SCENARIOS = "packages/engine/test/scenarios/**/*.test.ts";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, SCENARIOS],
        },
      },
      {
        test: {
          name: "scenarios",
          include: [SCENARIOS],
        },
      },
    ],
  },
});
