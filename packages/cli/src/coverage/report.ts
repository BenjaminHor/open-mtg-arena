// The rules coverage report (docs/testing.md, section 5; D-048): which rules the rules code cites, which tests cover
// them, and the gaps. Written to docs/coverage/rules-coverage.md; `pnpm check` fails when the committed report is out
// of date, and `pnpm coverage:rules` won't write one with a new gap unless told to.

import { covers } from "./citations.ts";
import { type Citations, codeCitations, laterMentions, matrixGaps, scenarioRules, unitTestRules } from "./collect.ts";

export const REPORT = "docs/coverage/rules-coverage.md";

/** What coverage is computed from; `collectInputs` reads the repo, and tests can change one part. */
export type CoverageInputs = {
  crRules: readonly string[];
  code: Citations;
  later: Citations;
  scenarios: Citations;
  unitTests: Citations;
  matrixGaps: string[];
};

export type Coverage = {
  /** Rule → the files citing it. */
  code: Citations;
  /** Rules mentioned as not built yet (`later: CR 614`) → where. Not counted, but listed, so a change shows. */
  later: Citations;
  /** Cited rules a scenario covers → those scenarios. */
  byScenario: Citations;
  /** Cited rules only unit tests cover → those tests. */
  byUnitTestOnly: Citations;
  /** Cited rules no test covers. */
  untested: string[];
  /** Cited rules that aren't in the CR (a typo, or a rule renumbered by a CR update). */
  notInCr: string[];
  /** Interaction matrix cells marked "not yet" or left empty. */
  matrixGaps: string[];
  /** Every rule in the CR, for the chapter-by-chapter progress table. */
  crRules: readonly string[];
};

export function collectInputs(crRules: readonly string[]): CoverageInputs {
  return {
    crRules,
    code: codeCitations(),
    later: laterMentions(),
    scenarios: scenarioRules(),
    unitTests: unitTestRules(),
    matrixGaps: matrixGaps(),
  };
}

export function coverage(inputs: CoverageInputs): Coverage {
  const known = new Set(inputs.crRules);
  const result: Coverage = {
    code: inputs.code,
    later: inputs.later,
    byScenario: {},
    byUnitTestOnly: {},
    untested: [],
    notInCr: [],
    matrixGaps: inputs.matrixGaps,
    crRules: inputs.crRules,
  };
  for (const rule of sortRules([...Object.keys(inputs.code), ...Object.keys(inputs.later)])) {
    if (!known.has(rule) && !result.notInCr.includes(rule)) result.notInCr.push(rule);
  }
  for (const rule of sortRules(Object.keys(inputs.code))) {
    const inScenarios = coveringFiles(inputs.scenarios, rule);
    const inTests = coveringFiles(inputs.unitTests, rule);
    if (inScenarios.length > 0) result.byScenario[rule] = inScenarios;
    else if (inTests.length > 0) result.byUnitTestOnly[rule] = inTests;
    else result.untested.push(rule);
  }
  return result;
}

function coveringFiles(tests: Citations, rule: string): string[] {
  const found = Object.entries(tests).flatMap(([tested, files]) => (covers(tested, rule) ? files : []));
  return [...new Set(found)].sort();
}

/** Rules in CR order: 100.1 before 100.10, 601.2 before 601.2a. */
export function sortRules(rules: readonly string[]): string[] {
  return [...rules].sort((a, b) => {
    const [x, y] = [ruleKey(a), ruleKey(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const [p, q] = [x[i], y[i]];
      if (p === q) continue;
      // A rule comes before its subrules: 601.2 before 601.2a.
      if (p === undefined) return -1;
      if (q === undefined) return 1;
      if (typeof p === "number" && typeof q === "number") return p - q;
      return String(p) < String(q) ? -1 : 1;
    }
    return 0;
  });
}

/** `601.2c` is [601, 2, "c"]. */
function ruleKey(rule: string): (number | string)[] {
  return rule.split(".").flatMap((part) => {
    const match = /^(\d+)([a-z]?)$/.exec(part);
    if (match === null) return [part];
    return match[2] === "" ? [Number(match[1])] : [Number(match[1]), match[2] as string];
  });
}

/** The gaps: untested rules and the interaction matrix's open cells, as the report lists them. */
export function gaps(c: Coverage): string[] {
  return [...c.untested.map((r) => `CR ${r}`), ...c.matrixGaps.map((g) => `matrix: ${g}`)];
}

/**
 * What a change made worse than the committed report: gaps it doesn't list, and rules it lists as tested by
 * scenarios that no scenario tests now (whether or not a unit test still does). Rules the code no longer cites
 * don't count.
 */
export function newGaps(committedReport: string, c: Coverage): string[] {
  const listed = listedGaps(committedReport);
  const lostScenarios = listedRules(committedReport, "Tested by scenarios").filter(
    (rule) => c.code[rule] !== undefined && c.byScenario[rule] === undefined,
  );
  return [
    ...gaps(c).filter((g) => !listed.includes(g)),
    ...lostScenarios.map((rule) => `CR ${rule} is no longer tested by a scenario`),
  ];
}

export function reportText(c: Coverage): string {
  const files = (list: readonly string[]) => list.map((f) => `\`${f}\``).join(", ");
  const gapLines = [
    ...c.untested.map((r) => `- CR ${r} — cited in ${files(c.code[r] ?? [])}`),
    ...c.matrixGaps.map((g) => `- matrix: ${g}`),
  ];
  const later = sortRules(Object.keys(c.later));
  return [
    "# Rules coverage",
    "",
    "<!-- Generated by `pnpm coverage:rules` (docs/testing.md, section 5; D-048). Do not edit. -->",
    "",
    `The rules code (\`packages/engine/src\`, \`packages/cards/src\`) cites ${Object.keys(c.code).length} rules: ` +
      `${Object.keys(c.byScenario).length} are tested by scenarios, ` +
      `${Object.keys(c.byUnitTestOnly).length} only by unit tests, and ${c.untested.length} by nothing. ` +
      `${c.matrixGaps.length} interaction matrix cells are open. ${later.length} rules are mentioned as not built yet.`,
    "",
    "## Gaps",
    "",
    'Rules the code cites that no test covers, and interaction matrix cells marked "not yet" or empty. `pnpm check`',
    "fails on a gap that isn't listed here; close these.",
    "",
    ...(gapLines.length === 0 ? ["(none)"] : gapLines),
    "",
    "## Tested only by unit tests",
    "",
    ...section(c.byUnitTestOnly, c.code),
    "",
    "## Tested by scenarios",
    "",
    ...section(c.byScenario, c.code),
    "",
    "## Mentioned as not built yet",
    "",
    "Written `later: CR 614` in the code, and not counted above. Check that each really isn't built.",
    "",
    ...(later.length === 0 ? ["(none)"] : later.map((r) => `- CR ${r} — in ${files(c.later[r] ?? [])}`)),
    "",
    "## By chapter",
    "",
    "How much of each chapter of the Comprehensive Rules the engine implements: the rules (numbered rules and their",
    "lettered subrules) the rules code cites, every one of them tested, against all the chapter's rules, and those",
    "mentioned as not built yet. A rule cited is one the code implements at least in part. Most of chapter 7 is keyword",
    "abilities and mechanics no card in the pool has, chapter 8 is multiplayer and chapter 9 other ways to play.",
    "",
    ...chapterTable(c),
    "",
  ].join("\n");
}

/** The CR's chapters, by the first digit of a rule's number, as its table of contents names them. */
const CHAPTERS: readonly [string, string][] = [
  ["1", "Game Concepts"],
  ["2", "Parts of a Card"],
  ["3", "Card Types"],
  ["4", "Zones"],
  ["5", "Turn Structure"],
  ["6", "Spells, Abilities, and Effects"],
  ["7", "Additional Rules"],
  ["8", "Multiplayer Rules"],
  ["9", "Casual Variants"],
];

/** One row per chapter: its rules, how many the code cites (all tested), and how many are mentioned as later. */
function chapterTable(c: Coverage): string[] {
  const rows = CHAPTERS.map(([digit, title]) => {
    const inChapter = (rule: string) => rule.startsWith(digit);
    const total = new Set(c.crRules.filter(inChapter)).size;
    const cited = Object.keys(c.code).filter(inChapter).length;
    const later = Object.keys(c.later).filter((r) => inChapter(r) && c.code[r] === undefined).length;
    const share = total === 0 ? "0%" : `${Math.round((cited / total) * 100)}%`;
    return `| ${digit}xx ${title} | ${total} | ${cited} (${share}) | ${later} |`;
  });
  return ["| Chapter | Rules | Implemented and tested | Not built yet |", "| --- | --- | --- | --- |", ...rows];
}

function section(tested: Citations, code: Citations): string[] {
  const rules = sortRules(Object.keys(tested));
  if (rules.length === 0) return ["(none)"];
  return [
    "| Rule | Cited in | Tested by |",
    "| --- | --- | --- |",
    ...rules.map((r) => `| ${r} | ${(code[r] ?? []).join("<br>")} | ${(tested[r] ?? []).join("<br>")} |`),
  ];
}

/** The gaps a report lists (its "Gaps" section's items). */
export function listedGaps(report: string): string[] {
  return sectionLines(report, "Gaps").flatMap((line) => /^- (.+?)(?: — .*)?$/.exec(line)?.[1] ?? []);
}

/** The rules in one of a report's tables (`| 601.2c | ... |`). */
function listedRules(report: string, heading: string): string[] {
  return sectionLines(report, heading).flatMap((line) => /^\| (\d{3}[\d.a-z]*) \|/.exec(line)?.[1] ?? []);
}

function sectionLines(report: string, heading: string): string[] {
  const start = report.indexOf(`## ${heading}`);
  if (start === -1) return [];
  const end = report.indexOf("\n## ", start + 1);
  return report.slice(start, end === -1 ? undefined : end).split("\n");
}
