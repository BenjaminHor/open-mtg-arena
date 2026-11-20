// Every change to the game goes through the event pipeline (D-056), so replacement effects (later: CR 614) and
// triggered abilities (later: CR 603.2) see all of it. This checks the engine's own code: only `src/pipeline/` may call
// the primitives that change the game. Tests may call them directly, to set up a board.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../../src");

/** The functions that make a change `happen` must see. Only `perform` calls them. */
const PRIMITIVES = [
  "moveCard",
  "destroy",
  "dealDamage",
  "loseLife",
  "markDamage",
  "tapPermanent",
  "untapPermanents",
  "addMana",
  "drawCard",
  "discardCards",
  "shuffleLibrary",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** The names a file imports as values (not `import type`, not `type X` inside the braces). */
function importedValues(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from/gm)) {
    if (match[1] !== undefined) continue;
    for (const part of (match[2] ?? "").split(",")) {
      const name = part.trim();
      if (name === "" || name.startsWith("type ")) continue;
      names.push(name.split(/\s+as\s+/)[0] ?? name);
    }
  }
  return names;
}

describe("only the pipeline performs events (D-056)", () => {
  it("finds value imports, and skips type imports", () => {
    const source = 'import { a, type B, c as d } from "x";\nimport type { E } from "y";\nimport {\n  f,\n} from "z";\n';
    expect(importedValues(source)).toStrictEqual(["a", "c", "f"]);
  });

  it("no engine file outside src/pipeline imports a primitive", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !relative(SRC, file).startsWith("pipeline"))
      .flatMap((file) =>
        importedValues(readFileSync(file, "utf8"))
          .filter((name) => PRIMITIVES.includes(name))
          .map((name) => `${relative(SRC, file)} imports ${name}`),
      );
    expect(offenders).toStrictEqual([]);
  });
});
