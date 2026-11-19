// `pnpm coverage:rules [--accept-new-gaps]`: writes the rules coverage report (docs/testing.md, section 5; D-048).
// A gap the committed report doesn't list stops it, so accepting a new gap is a deliberate act, never a side effect
// of regenerating.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ruleIds } from "./coverage/citations.ts";
import { REPO } from "./coverage/collect.ts";
import { collectInputs, coverage, gaps, listedGaps, REPORT, reportText } from "./coverage/report.ts";

export function rulesCoverage(acceptNewGaps: boolean): { output: string; code: number } {
  const c = coverage(collectInputs(ruleIds(join(REPO, "rules/cr"))));
  if (c.notInCr.length > 0) {
    return { output: `code cites rules that aren't in the CR: ${c.notInCr.join(", ")}`, code: 1 };
  }
  const path = join(REPO, REPORT);
  const listed = existsSync(path) ? listedGaps(readFileSync(path, "utf8")) : [];
  const added = gaps(c).filter((g) => !listed.includes(g));
  if (added.length > 0 && !acceptNewGaps) {
    return {
      output: `new gaps: ${added.join(", ")}. Add a test, or run with --accept-new-gaps and say why in the commit.`,
      code: 1,
    };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, reportText(c));
  const closed = listed.filter((g) => !gaps(c).includes(g));
  return {
    output: `wrote ${REPORT}: ${gaps(c).length} gaps${closed.length > 0 ? `; closed: ${closed.join(", ")}` : ""}`,
    code: 0,
  };
}

if (import.meta.main) {
  const { output, code } = rulesCoverage(process.argv.includes("--accept-new-gaps"));
  if (code === 0) console.log(output);
  else console.error(output);
  process.exitCode = code;
}
