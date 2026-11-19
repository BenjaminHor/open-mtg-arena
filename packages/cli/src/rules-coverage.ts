// `pnpm coverage:rules [--accept-new-gaps]`: writes the rules coverage report (docs/testing.md, section 5; D-048).
// A change that makes coverage worse than the committed report (a new gap, or a rule no scenario tests any more)
// stops it, so accepting one is a deliberate act, never a side effect of regenerating.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ruleIds } from "./coverage/citations.ts";
import { REPO } from "./coverage/collect.ts";
import { type Coverage, collectInputs, coverage, gaps, newGaps, REPORT, reportText } from "./coverage/report.ts";

/** Writes the report for `c` over `committed` (the report's current text, "" if none), unless that's refused. */
export function writeReport(
  c: Coverage,
  committed: string,
  acceptNewGaps: boolean,
): { report: string | null; output: string } {
  if (c.notInCr.length > 0)
    return { report: null, output: `the code names rules that aren't in the CR: ${c.notInCr.join(", ")}` };
  const worse = newGaps(committed, c);
  if (worse.length > 0 && !acceptNewGaps) {
    return {
      report: null,
      output: `coverage got worse: ${worse.join("; ")}. Add a test, or run with --accept-new-gaps and say why in the commit.`,
    };
  }
  const accepted = worse.length > 0 ? `; accepted: ${worse.join("; ")}` : "";
  return { report: reportText(c), output: `${gaps(c).length} gaps${accepted}` };
}

if (import.meta.main) {
  const path = join(REPO, REPORT);
  const committed = existsSync(path) ? readFileSync(path, "utf8") : "";
  const c = coverage(collectInputs(ruleIds(join(REPO, "rules/cr"))));
  const { report, output } = writeReport(c, committed, process.argv.includes("--accept-new-gaps"));
  if (report === null) {
    console.error(output);
    process.exitCode = 1;
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, report);
    console.log(`wrote ${REPORT}: ${output}`);
  }
}
