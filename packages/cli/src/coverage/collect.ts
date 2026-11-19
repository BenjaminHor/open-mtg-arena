// What the coverage report reads: rules cited by the rules code, rules tested by scenarios and by unit tests, and the
// interaction matrix's "not yet" cells.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseScenario } from "@mtg/scenarios";
import { citedRules, laterRules } from "./citations.ts";

export const REPO = join(import.meta.dirname, "../../../..");

/** The rules code: the engine and the card definitions. Tooling (the CLI, the scenario runner) cites rules too, but
 * only to explain itself. */
const CODE_DIRS = ["packages/engine/src", "packages/cards/src"];
const SCENARIOS_DIR = "packages/engine/test/scenarios";
export const MATRIX = `${SCENARIOS_DIR}/interactions/README.md`;

/** Rule → the files that cite it (paths from the repo root). */
export type Citations = Record<string, string[]>;

function files(dir: string, extension: string): string[] {
  const root = join(REPO, dir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(extension))
    .sort()
    .map((f) => join(root, f));
}

function addAll(into: Citations, rules: string[], file: string): void {
  const path = relative(REPO, file);
  for (const rule of rules) {
    const list = into[rule] ?? [];
    if (!list.includes(path)) list.push(path);
    into[rule] = list;
  }
}

export function codeCitations(): Citations {
  const citations: Citations = {};
  for (const dir of CODE_DIRS)
    for (const f of files(dir, ".ts")) addAll(citations, citedRules(readFileSync(f, "utf8")), f);
  return citations;
}

/** The rules each scenario lists (`rules: [CR 601.2c]`). */
export function scenarioRules(): Citations {
  const citations: Citations = {};
  for (const f of files(SCENARIOS_DIR, ".yaml")) {
    const rules = parseScenario(readFileSync(f, "utf8")).rules.map((r) => r.replace(/^CR /, ""));
    addAll(citations, rules, f);
  }
  return citations;
}

/** The coverage report's own tests: their citations are sample text for the parser, not tests of those rules. */
const NOT_RULE_TESTS = ["packages/cli/test/coverage.test.ts"];

/** The rules unit tests cite, in their names or comments (`packages/<name>/test/**.ts`). */
export function unitTestRules(): Citations {
  const citations: Citations = {};
  const packages = readdirSync(join(REPO, "packages"));
  for (const pkg of packages) {
    // Test files only: fixtures and helpers (test/support/) cite rules to explain themselves, not to test them.
    for (const f of files(`packages/${pkg}/test`, ".test.ts")) {
      if (NOT_RULE_TESTS.includes(relative(REPO, f))) continue;
      addAll(citations, citedRules(readFileSync(f, "utf8")), f);
    }
  }
  return citations;
}

/**
 * The interaction matrix's gaps (docs/testing.md, "Interaction scenarios"): a markdown table with mechanics as rows
 * and columns, filled in above the diagonal. Each is `row × column: not yet` or `row × column: empty`.
 */
export function matrixGaps(): string[] {
  const path = join(REPO, MATRIX);
  if (!existsSync(path)) throw new Error(`${MATRIX} is missing: the interaction matrix (docs/testing.md)`);
  return matrixCellGaps(readFileSync(path, "utf8"));
}

/** The cells above the diagonal of a mechanics table that are marked "not yet" or left empty. */
export function matrixCellGaps(markdown: string): string[] {
  const rows = markdown
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  const [header, , ...body] = rows;
  if (header === undefined) return [];
  return body.flatMap((cells, row) =>
    // Row r's own mechanic is column r + 1; the cells after it are the upper half.
    cells.flatMap((cell, column) => {
      if (column <= row + 1) return [];
      const pair = `${cells[0]} × ${header[column]}`;
      if (cell === "") return [`${pair}: empty`];
      return /^`?not yet\b/i.test(cell) ? [`${pair}: not yet`] : [];
    }),
  );
}

/** The rules the rules code mentions as not built yet (`later: CR 614`), and where. */
export function laterMentions(): Citations {
  const mentions: Citations = {};
  for (const dir of CODE_DIRS) {
    for (const f of files(dir, ".ts")) addAll(mentions, laterRules(readFileSync(f, "utf8")), f);
  }
  return mentions;
}
