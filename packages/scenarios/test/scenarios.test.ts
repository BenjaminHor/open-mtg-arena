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

// Golden games cover mechanics, not cards (D-082), so each card in the pool is covered by scenarios: at least one sets
// it up or names it in a step, as a whole card name ("Shatter" isn't found in "Mind Shatter"), not in a title or comment.
describe("every card in the pool", () => {
  const bodies = files.map((f) =>
    readFileSync(path.join(ROOT, f), "utf8")
      .split("\n")
      .filter((line) => !/^\s*#/.test(line) && !line.startsWith("name:"))
      .join("\n"),
  );
  const named = (body: string, name: string) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A YAML value or reference: after "[", ",", ":" or "- ", and before "]", ",", "#n", ":" or the line's end.
    return new RegExp(`(^|[\\[,:]|- )\\s*${escaped}\\s*($|[\\],:#])`, "m").test(body);
  };
  it("appears in at least one scenario", () => {
    const names = Object.values(cards).map((c) => c.printed.name);
    expect(names.filter((name) => !bodies.some((b) => named(b, name)))).toStrictEqual([]);
  });
});
