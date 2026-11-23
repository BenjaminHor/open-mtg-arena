// Parser for the plain-text Magic: The Gathering Comprehensive Rules
// (the "TXT" download from https://magic.wizards.com/en/rules).
//
// The TXT file is laid out as:
//   title, "These rules are effective as of <date>.", introduction,
//   "Contents" (a table of contents that ends with "Glossary" and "Credits"),
//   the numbered rules, "Glossary", glossary entries, "Credits", credits.
//
// This module has no dependencies so the scripts run with plain `node`.

/**
 * Decode the raw bytes of the rules file. Recent files are UTF-8 (often with
 * a byte-order mark). Older ones were Windows-1252, so fall back to that.
 * @param {Uint8Array} bytes
 * @returns {string} text with "\n" line endings and no BOM
 */
export function decodeRulesText(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

const CHAPTER_RE = /^(\d)\.\s+(.+)$/; //            "1. Game Concepts"
const SECTION_RE = /^(\d{3})\.\s+(.+)$/; //         "100. General"
const RULE_RE = /^(\d{3})\.(\d+)([a-z]?)\.?\s+(.*)$/; // "100.1. ..." or "100.1a ..."

/**
 * @typedef {{ id: string, section: string, top: string, text: string }} RuleEntry
 *   id: "601.2c"; top: the top-level rule it belongs to, e.g. "601.2";
 *   text: the full entry text, including the leading number and any
 *   "Example:" lines (joined with "\n").
 * @typedef {{ num: string, title: string, chapter: string, entries: RuleEntry[] }} Section
 * @typedef {{ num: string, title: string }} Chapter
 * @typedef {{ term: string, text: string }} GlossaryEntry
 * @typedef {{ effective: string|null, chapters: Chapter[], sections: Section[],
 *             glossary: GlossaryEntry[] }} ParsedRules
 */

/**
 * @param {string} text decoded rules text
 * @returns {ParsedRules}
 */
export function parseRules(text) {
  const lines = text.split("\n").map((l) => l.trimEnd());

  const effectiveMatch = text.match(/These rules are effective as of ([^.\n]+)\./);
  const effective = effectiveMatch ? effectiveMatch[1].trim() : null;

  // The table of contents ends with a line that is exactly "Credits".
  // The real rules start after it.
  const tocCredits = lines.indexOf("Credits");
  if (tocCredits === -1) throw new Error('Could not find the table of contents ("Credits" line).');
  const glossaryStart = lines.indexOf("Glossary", tocCredits + 1);
  if (glossaryStart === -1) throw new Error('Could not find the "Glossary" heading after the contents.');
  let glossaryEnd = lines.indexOf("Credits", glossaryStart + 1);
  if (glossaryEnd === -1) glossaryEnd = lines.length;

  /** @type {Chapter[]} */ const chapters = [];
  /** @type {Section[]} */ const sections = [];
  /** @type {Section|null} */ let section = null;
  /** @type {RuleEntry|null} */ let entry = null;
  let chapter = "";

  for (const line of lines.slice(tocCredits + 1, glossaryStart)) {
    if (line.trim() === "") continue;

    const rule = line.match(RULE_RE);
    if (rule && section && rule[1] === section.num) {
      const top = `${rule[1]}.${rule[2]}`;
      entry = { id: top + rule[3], section: rule[1], top, text: line.trim() };
      section.entries.push(entry);
      continue;
    }
    const sec = line.match(SECTION_RE);
    if (sec) {
      section = { num: sec[1], title: sec[2].trim(), chapter, entries: [] };
      sections.push(section);
      entry = null;
      continue;
    }
    const chap = line.match(CHAPTER_RE);
    if (chap) {
      chapter = chap[1];
      chapters.push({ num: chap[1], title: chap[2].trim() });
      section = null;
      entry = null;
      continue;
    }
    // "Example: ..." lines and any wrapped text belong to the previous entry.
    if (entry) entry.text += `\n${line.trim()}`;
  }

  /** @type {GlossaryEntry[]} */ const glossary = [];
  /** @type {GlossaryEntry|null} */ let g = null;
  for (const line of lines.slice(glossaryStart + 1, glossaryEnd)) {
    if (line.trim() === "") {
      g = null;
      continue;
    }
    if (!g) {
      g = { term: line.trim(), text: "" };
      glossary.push(g);
    } else {
      g.text += (g.text ? "\n" : "") + line.trim();
    }
  }

  if (sections.length === 0) throw new Error("Parsed zero rule sections; the file format may have changed.");
  return { effective, chapters, sections, glossary };
}

/** "Casting Spells" -> "casting-spells" */
export function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}
