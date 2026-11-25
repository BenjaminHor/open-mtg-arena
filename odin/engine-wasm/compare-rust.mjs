// Compares the Odin engine's answers with the Rust engine's (D-187: Rust as the test reference) for the calls the
// Odin engine serves as data lookups: the fixed tables, and the deck checks over every precon deck in
// client/public/decks.json under each constructed format and Commander. Prints agreement per call and the first
// differences. Needs both engines built (client/src/wasm and client/src/wasm-odin) and the card data generated.
// Usage: node odin/engine-wasm/compare-rust.mjs [max decks]
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const root = new URL("../../", import.meta.url).pathname;
const maxDecks = Number(process.argv[2] ?? Infinity);

async function load(dir, wasm) {
  const m = await import(`${root}client/src/${dir}/engine_wasm.js`);
  m.initSync({ module: readFileSync(`${root}client/src/${dir}/${wasm}`) });
  return m;
}
const rust = await load("wasm", "engine_wasm_bg.wasm");
const odin = await load("wasm-odin", "engine_odin.wasm");

// The Odin engine leaves out a deck's engine coverage until it can say which cards it supports (step 3 of D-187),
// so the comparison does too.
// The Rust engine's per-format deck legality stops at the first banned or not-legal card in hash order, so a deck
// with both reads either way there; the Odin engine says banned when any card is banned. Compared as legal or not.
function normalize(v) {
  if (!v || typeof v !== "object" || !("format_legality" in v)) return v;
  const { coverage: _, ...rest } = v;
  const legality = Object.fromEntries(Object.entries(v.format_legality).map(([k, s]) => [k, s === "legal" ? "legal" : "not legal"]));
  return { ...rest, format_legality: legality };
}
const call = (engine, fn, args) => {
  try {
    return { ok: normalize(engine[fn](...args)) };
  } catch (e) {
    return { err: String(e.message ?? e) };
  }
};

const tally = new Map();
function compare(fn, args, label = "") {
  const r = call(rust, fn, args);
  const o = call(odin, fn, args);
  const t = tally.get(fn) ?? { same: 0, total: 0, diffs: [] };
  t.total++;
  if (isDeepStrictEqual(r, o)) t.same++;
  else if (t.diffs.length < 8) t.diffs.push({ label, rust: r, odin: o });
  tally.set(fn, t);
}

for (const fn of ["getFormatRegistry", "llmProviderCatalog", "getBracketDifficultyTable", "getChallengeDeckRegistry"]) {
  compare(fn, []);
}
const formats = rust.getFormatRegistry().map((f) => f.format);
for (const f of [...formats, "Custom", null, { bogus: 1 }]) {
  compare("deckSupplyForFormat", [f], JSON.stringify(f));
  compare("bestOfThreeCeilingForFormat", [f], JSON.stringify(f));
}
for (const f of rust.getFormatRegistry()) compare("sideboardPolicyForFormat", [f.default_config], f.format);

compare("evaluate_deck_compatibility_js", [{ main_deck: ["Forest"] }], "before the card database");
const cardData = readFileSync(`${root}client/public/card-data.json`, "utf8");
rust.load_card_database(cardData);
odin.load_card_database(cardData);

const decks = JSON.parse(readFileSync(`${root}client/public/decks.json`, "utf8"));
const expand = (list) => (list ?? []).flatMap((c) => Array(c.count ?? 1).fill(c.name));
// Every selectable format: the Odin engine answers "no opinion" (null) for those it does not check yet, which shows
// here as a disagreement wherever the Rust engine gives a verdict.
const checked = rust.getFormatRegistry().map((f) => f.format);
for (const [key, deck] of Object.entries(decks).slice(0, maxDecks)) {
  const request = {
    main_deck: expand(deck.mainBoard),
    sideboard: expand(deck.sideBoard),
    commander: expand(deck.commander),
    planar_deck: [], scheme_deck: [], signature_spell: [], companion: [], draft_set_codes: [],
    selected_format: null, selected_match_type: null, selected_challenge_deck: null, player_count: 2,
    summary_only: false, min_deck_size: null,
  };
  compare("evaluate_deck_compatibility_js", [request], key);
  for (const format of checked) {
    const selected = { ...request, selected_format: format };
    // The client's deck lists ask for the summary; the setup page asks for the full result.
    const r = call(rust, "evaluate_deck_compatibility_js", [selected]);
    const o = call(odin, "evaluate_deck_compatibility_js", [selected]);
    const t = tally.get(`verdict ${format}`) ?? { same: 0, total: 0, diffs: [] };
    t.total++;
    if (r.ok?.selected_format_compatible === o.ok?.selected_format_compatible) t.same++;
    else if (t.diffs.length < 8) t.diffs.push({ label: key, rust: r.ok?.selected_format_reasons, odin: o.ok?.selected_format_reasons });
    tally.set(`verdict ${format}`, t);
    // The quick check (summary_only) stops at its first failed rule, which the Odin engine doesn't pick the same way
    // yet, so only its verdict is compared.
    const rs = call(rust, "evaluate_deck_compatibility_js", [{ ...selected, summary_only: true }]);
    const os = call(odin, "evaluate_deck_compatibility_js", [{ ...selected, summary_only: true }]);
    const ts = tally.get(`summary verdict ${format}`) ?? { same: 0, total: 0, diffs: [] };
    ts.total++;
    if (rs.ok?.selected_format_compatible === os.ok?.selected_format_compatible) ts.same++;
    else if (ts.diffs.length < 8) ts.diffs.push({ label: key, rust: rs.ok?.selected_format_reasons, odin: os.ok?.selected_format_reasons });
    tally.set(`summary verdict ${format}`, ts);
  }
}

// The first place two values differ, as a path and the two values there.
function firstDiff(a, b, path = "") {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return { path, rust: a, odin: b };
}

let allSame = true;
for (const [fn, t] of tally) {
  console.log(`${t.same === t.total ? "same" : "DIFF"}  ${fn}: ${t.same}/${t.total}`);
  if (t.same !== t.total) allSame = false;
  for (const d of t.diffs) {
    // A verdict that differs with the same reasons (or none) has no differing field to show.
    const f = firstDiff(d.rust, d.odin) ?? { path: " (verdict only)", rust: d.rust, odin: d.odin };
    console.log(`      ${d.label} at ${f.path}\n        rust: ${JSON.stringify(f.rust)?.slice(0, 400)}\n        odin: ${JSON.stringify(f.odin)?.slice(0, 400)}`);
  }
}
process.exit(allSame ? 0 : 1);
