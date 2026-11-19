// The rules coverage report (docs/testing.md, section 5; D-048): citations are read in every form the code uses, the
// committed report is up to date, and coverage can't get worse without someone accepting it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { citedRules, covers, expandRange, laterRules, ruleIds } from "../src/coverage/citations.ts";
import { matrixCellGaps, REPO } from "../src/coverage/collect.ts";
import { collectInputs, coverage, listedGaps, newGaps, REPORT, reportText, sortRules } from "../src/coverage/report.ts";
import { writeReport } from "../src/rules-coverage.ts";

const CR = ruleIds(join(REPO, "rules/cr"));

describe("citedRules", () => {
  it("reads single citations, lists, ranges and asides, as the code writes them", () => {
    expect(citedRules("// The step ends (CR 117.3d, 117.4, 514.3a).")).toEqual(["117.3d", "117.4", "514.3a"]);
    expect(citedRules("the steps both share (CR 601.2b–i, 602.2b)")).toEqual([
      ...["b", "c", "d", "e", "f", "g", "h", "i"].map((l) => `601.2${l}`),
      "602.2b",
    ]);
    expect(citedRules("can't attack or use {T} yet (CR 302.6, with haste, 702.10)")).toEqual(["302.6", "702.10"]);
    expect(citedRules("CR 500.7–500.9 and CR 506–508")).toEqual(["500.7", "500.8", "500.9", "506", "507", "508"]);
  });

  it("reads a list that wraps onto the next comment line", () => {
    expect(citedRules("created on the stack (CR 602.2a,\n// 405.1), and")).toEqual(["602.2a", "405.1"]);
    expect(citedRules(" * lose (CR 104.3,\n * 104.4a)")).toEqual(["104.3", "104.4a"]);
  });

  it("reads short ranges whole, and keeps a range it can't read as written, so it's reported as not in the CR", () => {
    expect(citedRules("CR 601.2–4, 702.10–12, 704.5a–5c")).toEqual([
      ...["601.2", "601.3", "601.4", "702.10", "702.11", "702.12"],
      ...["704.5a", "704.5b", "704.5c"],
    ]);
    expect(citedRules("a CR 601.2c-style rule")).toEqual(["601.2c-style"]);
  });

  it("skips a mention of a rule not built yet, written `later: CR 614`, and laterRules finds it", () => {
    const text = "damage can't be prevented yet (later: CR 615) but is dealt (CR 120.3)";
    expect(citedRules(text)).toEqual(["120.3"]);
    expect(laterRules(text)).toEqual(["615"]);
  });

  it("reads nothing that isn't a citation", () => {
    expect(citedRules("a cap of 200 turns, 1.5 seconds; CR stands alone; CR 1234")).toEqual([]);
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
  it("counts a test of the rule itself or of a rule under it", () => {
    expect(covers("601.2c", "601.2c")).toBe(true);
    expect(covers("601.2c", "601.2")).toBe(true);
    expect(covers("601.2c", "601")).toBe(true);
  });

  it("doesn't count a test of a broader rule, a sibling, or a rule whose number only starts the same", () => {
    expect(covers("601.2", "601.2c")).toBe(false);
    expect(covers("601", "601.2c")).toBe(false);
    expect(covers("601.2b", "601.2c")).toBe(false);
    expect(covers("601.20", "601.2")).toBe(false);
    expect(covers("702.10", "702.1")).toBe(false);
  });
});

describe("matrixCellGaps", () => {
  const matrix = (cell: string) =>
    ["| | Flying | Reach |", "| --- | --- | --- |", `| Flying | — | ${cell} |`, "| Reach | | — |"].join("\n");

  it("finds cells above the diagonal marked not yet, however it's written, or left empty", () => {
    expect(matrixCellGaps(matrix("[reach-blocks-flyer](x.yaml)"))).toEqual([]);
    expect(matrixCellGaps(matrix("n/a"))).toEqual([]);
    for (const cell of ["not yet", "Not yet.", "`not yet`"]) {
      expect(matrixCellGaps(matrix(cell)), cell).toEqual(["Flying × Reach: not yet"]);
    }
    expect(matrixCellGaps(matrix(""))).toEqual(["Flying × Reach: empty"]);
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

  it("is up to date: run `pnpm coverage:rules` after changing citations or tests", () => {
    expect(committed).toBe(reportText(current));
  });

  it("names only rules that are in the CR", () => {
    expect(current.notInCr).toEqual([]);
  });

  it("reads back the gaps it writes", () => {
    expect(listedGaps(reportText(current))).toHaveLength(current.untested.length + current.matrixGaps.length);
    expect(newGaps(reportText(current), current)).toEqual([]);
  });

  it("gets worse when a scenario is removed, even if a unit test still cites the rule", () => {
    // A rule only one scenario covers, which a unit test also cites.
    const found = Object.entries(current.byScenario).find(
      ([rule, files]) => files.length === 1 && Object.keys(inputs.unitTests).some((t) => covers(t, rule)),
    );
    if (found === undefined) throw new Error("no rule with one scenario and a unit test: pick another example");
    const [rule, [scenario]] = found as [string, string[]];
    const scenarios = Object.fromEntries(
      Object.entries(inputs.scenarios).map(([r, files]) => [r, files.filter((f) => f !== scenario)]),
    );
    expect(newGaps(committed, coverage({ ...inputs, scenarios }))).toContain(
      `CR ${rule} is no longer tested by a scenario`,
    );
  });

  it("gets worse when a cited rule has no test at all", () => {
    const withNewCitation = coverage({ ...inputs, code: { ...inputs.code, "601.99": ["x.ts"] } });
    expect(newGaps(committed, withNewCitation)).toEqual(["CR 601.99"]);
  });
});

describe("writeReport", () => {
  const current = coverage(collectInputs(CR));
  const committed = reportText(current);
  const worse = coverage({ ...collectInputs(CR), matrixGaps: ["Flying × Reach: not yet"] });

  it("writes a report that's no worse", () => {
    expect(writeReport(current, committed, false).report).toBe(committed);
  });

  it("refuses a worse one unless the new gaps are accepted, and then says which", () => {
    expect(writeReport(worse, committed, false)).toEqual({
      report: null,
      output: expect.stringMatching(/^coverage got worse: matrix: Flying × Reach: not yet\. .*--accept-new-gaps/),
    });
    const accepted = writeReport(worse, committed, true);
    expect(accepted.report).toBe(reportText(worse));
    expect(accepted.output).toMatch(/accepted: matrix: Flying × Reach: not yet$/);
  });

  it("refuses a rule that isn't in the CR, accepted or not", () => {
    const typo = { ...current, notInCr: ["601.99"] };
    expect(writeReport(typo, committed, true).report).toBeNull();
  });
});
