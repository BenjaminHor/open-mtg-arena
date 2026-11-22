// The match host runs in the browser's worker (M3-03), so nothing it imports may use Node's own modules: no `node:`
// import anywhere in the packages it depends on.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES = ["match", "engine", "ai", "cards"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : name.endsWith(".ts") ? [path] : [];
  });
}

describe("the match host is browser-safe", () => {
  it("no source of match, engine, ai or cards imports a node: module", () => {
    const root = join(import.meta.dirname, "../..");
    const offenders = PACKAGES.flatMap((p) => sources(join(root, p, "src"))).filter((file) =>
      /from "node:/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toStrictEqual([]);
  });
});
