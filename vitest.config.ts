import { configDefaults, defineConfig } from "vitest/config";

// Two projects so scenario tests can run on their own (`pnpm test:scenarios`).
// Scenario YAML files live in packages/engine/test/scenarios/; the runner in
// packages/scenarios runs them all (docs/testing.md, D-033).
const SCENARIOS = "packages/scenarios/test/**/*.test.ts";

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
