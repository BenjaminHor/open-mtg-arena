// Mutation testing (docs/testing.md, section 7; D-139): StrykerJS changes the engine's code in small ways and checks
// that a test fails each time. Run one folder at a time, as a whole run takes hours:
//   pnpm mutate --mutate "packages/engine/src/combat/**/*.ts"
// The report is written to reports/mutation/ (gitignored).
export default {
  testRunner: "vitest",
  // Named here: under pnpm's strict layout the test runner's child processes don't find it by the default pattern.
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vitest.mutate.config.ts" },
  coverageAnalysis: "perTest",
  mutate: ["packages/engine/src/**/*.ts"],
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  tempDirName: ".stryker-tmp",
  // Stryker rewrites tsconfig.json with TypeScript's JavaScript API, which TypeScript 7 doesn't have. Node runs the
  // sources directly and Vitest needs no tsconfig, so that step is skipped by naming a file that doesn't exist.
  tsconfigFile: "no-tsconfig-for-stryker.json",
  concurrency: 4,
  timeoutMS: 60000,
  thresholds: { high: 90, low: 75, break: null },
};
