#!/usr/bin/env node
// Look up Comprehensive Rules text from rules/raw/MagicCompRules.txt.
//
//   node scripts/rule.mjs 601.2c              one rule
//   node scripts/rule.mjs 601.2               a rule and all its subrules (601.2a, 601.2b, ...)
//   node scripts/rule.mjs 613                 a whole section
//   node scripts/rule.mjs 702.9 702.17        several at once
//   node scripts/rule.mjs --search "phased out"   rules whose text contains a phrase
//   node scripts/rule.mjs --glossary trample      a glossary entry (case-insensitive)
//
// Run scripts/fetch-rules.mjs first if rules/raw/ is missing.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRules } from "./lib/cr-parse.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW = path.join(ROOT, "rules", "raw", "MagicCompRules.txt");

function usage() {
  console.log("Usage: node scripts/rule.mjs <rule-number>... | --search <phrase> | --glossary <term>");
  process.exit(1);
}

/** Does entry `id` fall under query `q`? "601.2" matches 601.2 and 601.2a but not 601.20. */
function matches(id, q) {
  if (id === q) return true;
  if (/^\d{3}$/.test(q)) return id.startsWith(`${q}.`);
  return id.startsWith(q) && /^[a-z]$/.test(id.slice(q.length));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  let text;
  try {
    text = await readFile(RAW, "utf8");
  } catch {
    console.error("rules/raw/MagicCompRules.txt not found. Run: node scripts/fetch-rules.mjs");
    process.exit(1);
  }
  const rules = parseRules(text);
  const all = rules.sections.flatMap((s) => s.entries);

  if (args[0] === "--search") {
    const phrase = args.slice(1).join(" ").toLowerCase();
    if (!phrase) usage();
    const hits = all.filter((e) => e.text.toLowerCase().includes(phrase));
    for (const e of hits) console.log(`${e.text}\n`);
    console.log(`${hits.length} rule(s) contain "${phrase}". (CR effective ${rules.effective})`);
    return;
  }

  if (args[0] === "--glossary") {
    const term = args.slice(1).join(" ").toLowerCase();
    if (!term) usage();
    const hits = rules.glossary.filter((g) => g.term.toLowerCase().includes(term));
    for (const g of hits) console.log(`${g.term}\n${g.text}\n`);
    if (hits.length === 0) console.log(`No glossary term matches "${term}".`);
    return;
  }

  let missing = 0;
  for (const q of args) {
    const query = q.replace(/\.$/, "");
    const hits = all.filter((e) => matches(e.id, query));
    if (hits.length === 0) {
      console.log(`No rule ${query} in the CR effective ${rules.effective}.\n`);
      missing++;
      continue;
    }
    if (/^\d{3}$/.test(query)) {
      const s = rules.sections.find((x) => x.num === query);
      console.log(`${s.num}. ${s.title}\n`);
    }
    for (const e of hits) console.log(`${e.text}\n`);
  }
  if (missing) process.exit(2);
}

main();
