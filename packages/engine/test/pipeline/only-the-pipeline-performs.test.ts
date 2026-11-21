// Every change to the game goes through the event pipeline (D-056), so replacement effects (later: CR 614) and
// triggered abilities (later: CR 603.2) see all of it. This checks the engine's own code: only `pipeline/perform.ts`
// calls the primitives that perform events, and only `pipeline/happen.ts` calls `perform`. Tests may call anything,
// to set up a board. Bookkeeping that isn't a game event (src/pipeline/README.md) isn't checked.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../../src");

/** The functions that perform an event. Only `perform.ts`, and the files that define them, may import them. */
const PRIMITIVES = [
  "moveCard",
  "createToken",
  "attach",
  "unattach",
  "ceaseToExist",
  "destroy",
  "sacrifice",
  "counterObject",
  "gainLife",
  "dealDamage",
  "loseLife",
  "markDamage",
  "tapPermanent",
  "untapPermanent",
  "addMana",
  "drawCard",
  "discardCard",
  "shuffleLibrary",
  "countLandPlay",
  "reveal",
  "reorderLibraryTop",
  "regenerate",
  "putCounters",
  "removeCounters",
];

/** The primitives a primitive's own file may use, because they're part of the event it performs. */
const BUILT_FROM: Record<string, string[]> = {
  "permanents/destroy.ts": ["moveCard"], // destroying is the move to the graveyard (CR 701.8a)
  "permanents/regenerate.ts": ["tapPermanent"], // regenerating taps it (CR 701.19a)
  "permanents/sacrifice.ts": ["moveCard"], // so is sacrificing (CR 701.21a)
  "zones/counter.ts": ["moveCard"], // a countered spell goes to its owner's graveyard (CR 701.6a)
  "zones/draw.ts": ["moveCard"], // the top card moves to the hand (CR 121.1)
  "zones/discard.ts": ["moveCard"], // from hand to graveyard (CR 701.9a)
  // A damage event's results are part of it (CR 120.4c), lifelink's life gain too (CR 120.3f).
  "effects/deal-damage.ts": ["loseLife", "markDamage", "gainLife"],
};

/** Other guarded names, and the only files (or folders) that may import them, with the reason. */
const GUARDED: Record<string, Record<string, string>> = {
  perform: { "pipeline/happen.ts": "the pipeline: replace, then perform, then check triggers" },
  withZoneList: {
    "zones/": "the zone primitives themselves",
    "game/create-game.ts": "setting up the zones before the game begins (CR 103.1)",
    "game/casting-steps.ts": "putting a cancelled cast back as it was (CR 734.1, D-035): it undoes events",
  },
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/**
 * The names a file imports as values, from `import { ... } from` lines (not `import type`, not `type X` inside the
 * braces). It doesn't handle `import * as` or default imports; the engine uses neither.
 */
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

/** The functions a file defines. */
function definedFunctions(source: string): string[] {
  return [...source.matchAll(/^export function (\w+)/gm)].map((m) => m[1] ?? "");
}

const files = sourceFiles(SRC).map((path) => ({ name: relative(SRC, path), source: readFileSync(path, "utf8") }));

describe("only the pipeline performs events (D-056)", () => {
  it("finds value imports, and skips type imports", () => {
    const source = 'import { a, type B, c as d } from "x";\nimport type { E } from "y";\nimport {\n  f,\n} from "z";\n';
    expect(importedValues(source)).toStrictEqual(["a", "c", "f"]);
  });

  it("no engine file but perform.ts imports a primitive, except the ones a primitive is built from", () => {
    const offenders = files
      .filter((f) => f.name !== "pipeline/perform.ts")
      .flatMap((f) =>
        importedValues(f.source)
          .filter((name) => PRIMITIVES.includes(name) && !(BUILT_FROM[f.name] ?? []).includes(name))
          .map((name) => `${f.name} imports ${name}`),
      );
    expect(offenders).toStrictEqual([]);
  });

  it("every primitive is defined somewhere, so the list stays true", () => {
    const defined = files.flatMap((f) => definedFunctions(f.source));
    expect(PRIMITIVES.filter((name) => !defined.includes(name))).toStrictEqual([]);
  });

  it("every function perform.ts calls from outside the pipeline is a guarded primitive", () => {
    const perform = files.find((f) => f.name === "pipeline/perform.ts");
    // Change nothing themselves: joining steps, reading where a land played goes, and reading what a permanent is, to
    // keep as last known information (CR 608.2h).
    const helpers = ["andThen", "playLandDestination", "characteristics"];
    const unguarded = importedValues(perform?.source ?? "").filter(
      (name) => !PRIMITIVES.includes(name) && !helpers.includes(name),
    );
    expect(unguarded).toStrictEqual([]);
  });

  it("only callers that do nothing after the event import happenOrAsk, which may wait for a choice (CR 616.1)", () => {
    // A resolving effect, one work item each, and combat damage, which queues its priority first.
    const allowed = [
      "effects/run-effect.ts",
      "effects/destroy-at-random.ts",
      "combat/combat-damage.ts",
      "game/advance.ts",
      "pipeline/happen.ts",
    ];
    const importers = files.filter((f) => importedValues(f.source).includes("happenOrAsk")).map((f) => f.name);
    expect(importers.filter((name) => !allowed.includes(name))).toStrictEqual([]);
  });

  it("only the allowed files import `perform` and `withZoneList`", () => {
    const offenders = files.flatMap((f) =>
      importedValues(f.source)
        .filter((name) => {
          const allowed = GUARDED[name];
          return allowed !== undefined && !Object.keys(allowed).some((path) => f.name.startsWith(path));
        })
        .map((name) => `${f.name} imports ${name}`),
    );
    expect(offenders).toStrictEqual([]);
  });
});
