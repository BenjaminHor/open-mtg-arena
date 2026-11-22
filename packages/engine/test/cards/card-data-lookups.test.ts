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

// A permanent that entered as a copy (Clone, D-127) has the copied card's text: its own `oracleId` is the card it
// physically is. So engine code reads an object's text through `cardDataOf` or `textOracleId`, and reads a raw
// `.oracleId` only where it means the physical card, with the reason here.
const RAW_ORACLE_ID_ALLOWED: Record<string, string> = {
  "engine/src/cards/card-data.ts": "the lookup itself",
  "engine/src/zones/move-card.ts": "the new object is the same physical card",
  "engine/src/zones/tokens.ts": "a token made from its data",
  "engine/src/zones/spell-copies.ts": "a spell copy names the card it copies",
  "engine/src/game/copy-spell.ts": "a spell on the stack is never a copy of a permanent",
  "engine/src/effects/prevention.ts": "the spell that made the effect, never a copy",
  "engine/src/triggers/delayed.ts": "the resolving spell that made a delayed trigger, never a copy",
  "engine/src/game/create-game.ts": "setup data",
  "engine/src/game/setup-validation.ts": "setup data",
  "engine/src/rules/printed-start.ts": "an error message",
  "engine/src/rules/characteristics.ts": "an error message",
  "engine/src/rules/targets.ts": "an error message",
};

/** Reading `.oracleId` off something, other than `sourceOracleId` and a copy's own (`copied.oracleId`). Comments skipped. */
function rawOracleIdReads(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter((line) => /\.oracleId\b/.test(line.replace(/copied\??\.oracleId/g, "")));
}

describe("an object's text is read through cardDataOf or textOracleId (CR 707.2)", () => {
  it("finds a raw oracle id read, but not a copy's own", () => {
    expect(rawOracleIdReads("const a = obj.oracleId;\nconst b = obj.copied?.oracleId;\n// obj.oracleId")).toStrictEqual(
      ["const a = obj.oracleId;"],
    );
  });

  it("no engine source reads a raw oracle id but the allowed files", () => {
    const src = join(PACKAGES, "engine", "src");
    const offenders = sourceFiles(src).flatMap((path) => {
      const name = relative(PACKAGES, path);
      if (RAW_ORACLE_ID_ALLOWED[name] !== undefined) return [];
      return rawOracleIdReads(readFileSync(path, "utf8")).map((line) => `${name}: ${line.trim()}`);
    });
    expect(offenders).toStrictEqual([]);
  });
});
