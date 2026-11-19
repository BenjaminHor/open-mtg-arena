// Reading CR citations out of text: `CR 601.2c`, lists (`CR 117.3d, 117.4, 514.3a`), ranges (`CR 601.2b–i`,
// `CR 506–511`, `CR 500.7–500.11`) and asides (`CR 302.6, with haste, 702.10`). A mention of a rule not built yet is
// written `later: CR 614` and isn't a citation (D-048).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One rule number: `601`, `601.2`, `601.2c`, optionally followed by a range (`–i`, `–611`, `–500.11`, `–4`). The
 * lookaheads stop `CR 1234` reading as 123. Whatever follows a dash is taken whole, so a range `expandRange` can't read
 * stays as written and fails the "is it in the CR" check, rather than quietly losing its end.
 */
const NUMBER = String.raw`\d{3}(?!\d)(?:\.\d+[a-z]?(?![a-z]))?(?:[–-][0-9a-z.]*[0-9a-z])?`;
/** Between citations in a list: commas (also across a comment's line break), "and", "or", or a short aside. */
const SEPARATOR = String.raw`(?:,\s*(?:(?:\/\/|\*)\s*)?|\s+and\s+|\s+or\s+|,\s*with [a-z ]+,\s*)`;
const CITATION = new RegExp(String.raw`(later:\s*)?CR (${NUMBER}(?:${SEPARATOR}${NUMBER})*)`, "g");

/** Every rule the text cites, ranges expanded, in order of appearance, without repeats. */
export function citedRules(text: string): string[] {
  return rulesIn(text, false);
}

/** Every rule the text mentions as not built yet (`later: CR 614`). */
export function laterRules(text: string): string[] {
  return rulesIn(text, true);
}

function rulesIn(text: string, later: boolean): string[] {
  const rules: string[] = [];
  for (const match of text.matchAll(CITATION)) {
    if ((match[1] !== undefined) !== later) continue;
    for (const token of (match[2] ?? "").match(new RegExp(NUMBER, "g")) ?? []) {
      for (const rule of expandRange(token)) if (!rules.includes(rule)) rules.push(rule);
    }
  }
  return rules;
}

/**
 * `601.2b–d` and `704.5a–5c` are subrules a to c of one rule; `506–508` is three sections; `500.7–500.9` and
 * `601.2–4` are rules 7 to 9 and 2 to 4 of a section. Any other shape stays as written, so it's reported as not in
 * the CR.
 */
export function expandRange(token: string): string[] {
  const letters = /^(\d{3}\.(\d+))([a-z])[–-](?:\2)?([a-z])$/.exec(token);
  if (letters !== null) {
    const [, base = "", , from = "a", to = "a"] = letters;
    return span(from.charCodeAt(0), to.charCodeAt(0)).map((c) => `${base}${String.fromCharCode(c)}`);
  }
  const sections = /^(\d{3})[–-](\d{3})$/.exec(token);
  if (sections !== null) return span(Number(sections[1]), Number(sections[2])).map(String);
  const rules = /^(\d{3})\.(\d+)[–-](?:(\d{3})\.)?(\d+)$/.exec(token);
  if (rules !== null && (rules[3] === undefined || rules[3] === rules[1])) {
    return span(Number(rules[2]), Number(rules[4])).map((n) => `${rules[1]}.${n}`);
  }
  return [token];
}

function span(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

/** Every rule number in the CR files under `rules/cr`: sections (`601`) and rules (`601.2`, `601.2c`). */
export function ruleIds(rulesDir: string): string[] {
  const ids: string[] = [];
  for (const file of readdirSync(rulesDir, { recursive: true, encoding: "utf8" })) {
    if (!file.endsWith(".md")) continue;
    for (const line of readFileSync(join(rulesDir, file), "utf8").split("\n")) {
      // `# 601. Casting Spells`, or for the sections split one file per keyword, `# 702.9. Flying (in 702. ...)`.
      const section = /^# (\d{3})\. /.exec(line) ?? /^# .*\(in (\d{3})\. /.exec(line);
      if (section?.[1] !== undefined && !ids.includes(section[1])) ids.push(section[1]);
      const rule = /^(\d{3}\.\d+[a-z]?)\.? /.exec(line);
      if (rule?.[1] !== undefined) ids.push(rule[1]);
    }
  }
  return ids;
}

/**
 * Whether a test of `tested` covers code citing `cited` (D-048): the same rule, or a rule under it (a test of 601.2c
 * covers code citing 601.2 or 601). Not the other way: a test of 601.2 doesn't show that 601.2c is built.
 */
export function covers(tested: string, cited: string): boolean {
  if (tested === cited || tested.startsWith(`${cited}.`)) return true;
  // 601.2c is under 601.2: the same rule number, then one letter.
  const lettered = /^(\d{3}\.\d+)[a-z]$/.exec(tested);
  return lettered !== null && lettered[1] === cited;
}
