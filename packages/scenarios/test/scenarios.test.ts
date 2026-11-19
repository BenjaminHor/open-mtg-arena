// Runs every scenario in packages/engine/test/scenarios, one test each (docs/testing.md, section 1).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cardDatabase } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { runScenario } from "../src/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../engine/test/scenarios");
const files = readdirSync(ROOT, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".yaml"))
  .sort();
const cards = cardDatabase();

// A floor, so scenarios moved somewhere the runner doesn't look fail loudly instead of passing as zero tests.
const AT_LEAST = 10;

describe("scenarios", () => {
  it(`finds at least ${AT_LEAST} scenario files`, () => {
    expect(files.length).toBeGreaterThanOrEqual(AT_LEAST);
  });

  for (const file of files) {
    it(file, () => {
      const result = runScenario(readFileSync(path.join(ROOT, file), "utf8"), cards);
      expect(result.problems, result.name).toStrictEqual([]);
    });
  }
});
