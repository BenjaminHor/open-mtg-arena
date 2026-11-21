// A token's characteristics are kept on the token, not in the `CardDatabase` (CR 111.3), so reading `cards[oracleId]`
// directly would miss them. This checks the source of every package: only `cards/card-data.ts` indexes the database
// (and the cards package, which builds it). Tests may index it, to set up a board.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = join(import.meta.dirname, "../../..");
/** The files that may index the database, with the reason. */
const ALLOWED: Record<string, string> = {
  "engine/src/cards/card-data.ts": "the lookup itself",
  "cards/src/database.ts": "building the database",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Indexing a value named like the database: `cards[`, `db[`, `cards?.[`. Comments are skipped. It goes by name, so an
 * unrelated array called `cards` trips it too: rename the array (as `zones/shuffle.ts` did), the price of a simple scan.
 */
function lookups(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter((line) => /\b(cards|db|database|cardDatabase)(\?\.)?\[/.test(line));
}

describe("card data is read through cardDataOf (CR 111.3)", () => {
  it("finds an index into the database, and skips comments", () => {
    expect(
      lookups(
        "const a = cards[obj.oracleId];\nconst c = cards?.[id];\n// cards[x]\n * cards[y]\nconst b = shuffled[0];",
      ),
    ).toStrictEqual(["const a = cards[obj.oracleId];", "const c = cards?.[id];"]);
  });

  it("no package's source indexes the database but the allowed files", () => {
    const packages = readdirSync(PACKAGES, { withFileTypes: true }).filter((e) => e.isDirectory());
    const offenders = packages.flatMap((pkg) => {
      const src = join(PACKAGES, pkg.name, "src");
      let files: string[];
      try {
        files = sourceFiles(src);
      } catch {
        return [];
      }
      return files.flatMap((path) => {
        const name = relative(PACKAGES, path);
        if (ALLOWED[name] !== undefined) return [];
        return lookups(readFileSync(path, "utf8")).map((line) => `${name}: ${line.trim()}`);
      });
    });
    expect(offenders).toStrictEqual([]);
  });
});
