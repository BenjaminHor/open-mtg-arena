// The rules coverage report (docs/testing.md, section 5; D-048): citations are read in every form the code uses,
// and `pnpm check` fails on a gap the committed report doesn't list.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { citedRules, covers, expandRange, ruleIds } from "../src/coverage/citations.ts";
import { notYetCells, REPO } from "../src/coverage/collect.ts";
import { collectInputs, coverage, gaps, listedGaps, REPORT, reportText, sortRules } from "../src/coverage/report.ts";

const CR = ruleIds(join(REPO, "rules/cr"));

describe("citedRules", () => {
  it("reads single citations, lists, ranges and asides, as the code writes them", () => {
    expect(citedRules("// The step ends (CR 117.3d, 117.4, 514.3a).")).toEqual(["117.3d", "117.4", "514.3a"]);
    expect(citedRules("the steps both share (CR 601.2b–i, 602.2b)")).toEqual([
      ...["b", "c", "d", "e", "f", "g", "h", "i"].map((l) => `601.2${l}`),
      "602.2b",
    ]);
    expect(citedRules("can't attack or use {T} yet (CR 302.6, with haste, 702.10)")).toEqual(["302.6", "702.10"]);
    expect(citedRules("CR 506.4, 508.1a, 509.1a, 509.1h")).toEqual(["506.4", "508.1a", "509.1a", "509.1h"]);
    expect(citedRules("CR 500.7–500.9 and CR 506–508")).toEqual(["500.7", "500.8", "500.9", "506", "507", "508"]);
  });

  it("skips a mention of a rule not built yet, written `later: CR 614`", () => {
    expect(citedRules("damage can't be prevented yet (later: CR 615) but is dealt (CR 120.3)")).toEqual(["120.3"]);
  });

  it("reads nothing that isn't a citation", () => {
    expect(citedRules("a cap of 200 turns, 1.5 seconds; CR stands alone")).toEqual([]);
  });
});

describe("expandRange", () => {
  it("leaves a single rule alone", () => {
    expect(expandRange("704.5g")).toEqual(["704.5g"]);
  });
});

describe("ruleIds", () => {
  it("reads sections and rules from rules/cr, including the sections split one file per keyword", () => {
    for (const rule of ["100", "601", "601.2", "601.2c", "702", "702.9", "702.9b", "704.5g"])
      expect(CR).toContain(rule);
    expect(CR).not.toContain("601.99");
  });
});

describe("covers", () => {
  it("counts a test of the rule itself, of a rule under it, or of a lettered subrule's rule", () => {
    expect(covers("601.2c", "601.2c")).toBe(true);
    expect(covers("601.2c", "601.2")).toBe(true);
    expect(covers("601.2c", "601")).toBe(true);
    expect(covers("601.2", "601.2c")).toBe(true);
  });

  it("doesn't count a sibling, a section for a subrule, or a rule whose number only starts the same", () => {
    expect(covers("601.2b", "601.2c")).toBe(false);
    expect(covers("601", "601.2c")).toBe(false);
    expect(covers("601.20", "601.2")).toBe(false);
    expect(covers("702.10", "702.1")).toBe(false);
  });
});

describe("notYetCells", () => {
  it("finds the interaction matrix's cells marked not yet, by row and column", () => {
    const matrix = [
      "| | Flying | Reach |",
      "| --- | --- | --- |",
      "| Flying | — | [reach-blocks-flyer](x.yaml) |",
      "| Reach | | not yet |",
    ].join("\n");
    expect(notYetCells(matrix)).toEqual(["Reach × Reach"]);
    expect(notYetCells(matrix.replace("[reach-blocks-flyer](x.yaml)", "Not yet"))).toEqual([
      "Flying × Reach",
      "Reach × Reach",
    ]);
  });
});

describe("sortRules", () => {
  it("puts rules in CR order", () => {
    expect(sortRules(["601.10", "601.2c", "601.2", "100.1", "601"])).toEqual([
      "100.1",
      "601",
      "601.2",
      "601.2c",
      "601.10",
    ]);
  });
});

describe("the committed report", () => {
  const inputs = collectInputs(CR);
  const current = coverage(inputs);
  const committed = readFileSync(join(REPO, REPORT), "utf8");

  it("every rule the code cites is in the CR", () => {
    expect(current.notInCr).toEqual([]);
  });

  it("lists every gap there is: a new one means a test is missing (or pnpm coverage:rules --accept-new-gaps)", () => {
    const listed = listedGaps(committed);
    expect(gaps(current).filter((g) => !listed.includes(g))).toEqual([]);
  });

  it("would fail if a scenario were removed: its rules become gaps", () => {
    // A scenario that's the only test of one of the cited rules.
    const [rule, files] = Object.entries(current.byScenario).find(
      ([r, f]) => f.length === 1 && !Object.keys(inputs.unitTests).some((t) => covers(t, r)),
    ) ?? ["", []];
    const removed = files[0] ?? "";
    const scenarios = Object.fromEntries(
      Object.entries(inputs.scenarios).map(([r, f]) => [r, f.filter((x) => x !== removed)]),
    );
    const without = coverage({ ...inputs, scenarios });
    expect(gaps(without).filter((g) => !listedGaps(committed).includes(g))).toContain(`CR ${rule}`);
  });

  it("reads back the gaps it writes", () => {
    expect(listedGaps(reportText(current))).toEqual(gaps(current));
  });
});
