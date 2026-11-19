// `pnpm coverage:rules [--accept-scenario-loss]`: writes the rules coverage report (docs/testing.md, section 5; D-048,
// D-052).
// A change that makes coverage worse than the committed report (a new gap, or a rule no scenario tests any more)
// stops it, so accepting one is a deliberate act, never a side effect of regenerating.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ruleIds } from "./coverage/citations.ts";
import { REPO } from "./coverage/collect.ts";
import { type Coverage, collectInputs, coverage, gaps, newGaps, REPORT, reportText } from "./coverage/report.ts";

/**
 * Writes the report for `c` over `committed` (the report's current text, "" if none), unless that's refused. Every
 * rule the code cites must have a test (owner, D-052): a gap is always refused. A rule losing its last scenario while a
 * unit test still covers it is allowed (D-050), but only deliberately, with `acceptScenarioLoss`.
 */
export function writeReport(
  c: Coverage,
  committed: string,
  acceptScenarioLoss: boolean,
): { report: string | null; output: string } {
  if (c.notInCr.length > 0) {
    return { report: null, output: `the code names rules that aren't in the CR: ${c.notInCr.join(", ")}` };
  }
  if (gaps(c).length > 0) {
    return { report: null, output: `every cited rule needs a test (D-052); untested: ${gaps(c).join("; ")}` };
  }
  const lost = newGaps(committed, c);
  if (lost.length > 0 && !acceptScenarioLoss) {
    return {
      report: null,
      output: `${lost.join("; ")}. Add a scenario, or run with --accept-scenario-loss and say why in the commit.`,
    };
  }
  return { report: reportText(c), output: lost.length > 0 ? `accepted: ${lost.join("; ")}` : "no gaps" };
}

if (import.meta.main) {
  const path = join(REPO, REPORT);
  const committed = existsSync(path) ? readFileSync(path, "utf8") : "";
  const c = coverage(collectInputs(ruleIds(join(REPO, "rules/cr"))));
  const { report, output } = writeReport(c, committed, process.argv.includes("--accept-scenario-loss"));
  if (report === null) {
    console.error(output);
    process.exitCode = 1;
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, report);
    console.log(`wrote ${REPORT}: ${output}`);
  }
}
