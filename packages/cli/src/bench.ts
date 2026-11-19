// `pnpm bench [--update]` (docs/testing.md, section 6): times the engine on fixed work and compares with
// bench/baseline.json. Each time is also taken as a multiple of a reference loop run on the same machine at the same
// moment, and that multiple is what's compared, so the baseline holds across machines and a busy machine slows both.
// More than 20% slower on any measure fails; so does breaking a budget from docs/architecture.md, whatever the
// baseline says. `--update` writes the baseline: do it only for a justified slowdown, and say why in the commit.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { cardDatabase } from "@mtg/cards";
import { medianTimes, referenceWork } from "./bench/timing.ts";
import { workloads } from "./bench/workloads.ts";
import { REPO } from "./coverage/collect.ts";

export const BASELINE = join(REPO, "bench/baseline.json");
/** How much slower than the baseline a measure may get before the run fails. */
const ALLOWED_SLOWDOWN = 1.2;
/** Hard limits in milliseconds (architecture.md, "Performance budget"), by measure name prefix. */
const BUDGETS: Record<string, number> = { "applyAction.": 1, randomGame: 100 };

type Measure = { ms: number; relative: number };
export type Baseline = { machine: string; referenceMs: number; measures: Record<string, Measure> };

/** Measures and reports a time per applyAction, legalActions call, or game, as the workload's `what` says. */
function measureAll(): { referenceMs: number; results: { name: string; what: string; measure: Measure }[] } {
  const list = workloads(cardDatabase());
  const times = medianTimes({ reference: referenceWork, ...Object.fromEntries(list.map((w) => [w.name, w.run])) });
  const referenceMs = times.reference ?? 1;
  const results = list.map((w) => {
    const ms = (times[w.name] ?? 0) / w.count;
    return { name: w.name, what: w.what, measure: { ms, relative: ms / referenceMs } };
  });
  return { referenceMs, results };
}

export function bench(update: boolean): { output: string; code: number } {
  const { referenceMs, results } = measureAll();
  const lines = [`reference loop: ${time(referenceMs)}`];
  if (update) {
    const baseline: Baseline = {
      machine: `${cpus()[0]?.model ?? "unknown"}, Node ${process.versions.node}`,
      referenceMs,
      measures: Object.fromEntries(results.map((r) => [r.name, r.measure])),
    };
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    lines.push(...results.map((r) => `${r.name}: ${time(r.measure.ms)} (${r.what})`), "wrote bench/baseline.json");
    return { output: lines.join("\n"), code: 0 };
  }
  if (!existsSync(BASELINE)) return { output: "no bench/baseline.json: run pnpm bench --update", code: 1 };
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
  const failures: string[] = [];
  for (const { name, what, measure } of results) {
    const before = baseline.measures[name];
    const change = before === undefined ? null : measure.relative / before.relative;
    const budget = Object.entries(BUDGETS).find(([prefix]) => name.startsWith(prefix))?.[1];
    const changeText = change === null ? "new" : `${change >= 1 ? "+" : ""}${((change - 1) * 100).toFixed(0)}%`;
    lines.push(`${name}: ${time(measure.ms)}, ${changeText} against the baseline (${what})`);
    // A broken measure (NaN compares false with everything) must fail, not pass.
    if (!Number.isFinite(measure.ms) || measure.ms <= 0) failures.push(`${name} measured no time: the bench is broken`);
    if (change !== null && change > ALLOWED_SLOWDOWN)
      failures.push(`${name} is ${changeText} slower than the baseline`);
    if (budget !== undefined && measure.ms > budget)
      failures.push(`${name} takes ${time(measure.ms)}, over its ${budget} ms budget`);
  }
  for (const name of Object.keys(baseline.measures)) {
    if (!results.some((r) => r.name === name)) failures.push(`${name} is in the baseline but no longer measured`);
  }
  lines.push(failures.length === 0 ? "ok" : `FAILED:\n  ${failures.join("\n  ")}`);
  return { output: lines.join("\n"), code: failures.length === 0 ? 0 : 1 };
}

/** `43.6 ms`, or `16.2 µs` below a millisecond. */
function time(ms: number): string {
  return ms >= 1 ? `${ms.toFixed(1)} ms` : `${(ms * 1000).toFixed(1)} µs`;
}

if (import.meta.main) {
  const { output, code } = bench(process.argv.includes("--update"));
  if (code === 0) console.log(output);
  else console.error(output);
  process.exitCode = code;
}
