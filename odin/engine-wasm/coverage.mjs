// How many cards of the pool the owner cares about (Scryfall `game:arena in:paper`, D-187) the Odin engine fully
// supports, next to the Rust engine's count (client/public/coverage-data.json). "Fully supports" is the engine's own
// check (card_supported in odin/engine/game/spells.odin): every ability and keyword is one it can carry out.
// The pool list is fetched from Scryfall's search API once into data/scryfall/arena-paper-names.json (not committed).
// Usage: node odin/engine-wasm/coverage.mjs [--list-missing N] [--examples "<gap>"]
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const poolFile = `${root}data/scryfall/arena-paper-names.json`;

async function fetchPool() {
  const names = new Set();
  let url = "https://api.scryfall.com/cards/search?q=" + encodeURIComponent("game:arena in:paper") + "&unique=cards";
  while (url) {
    const r = await fetch(url, { headers: { "User-Agent": "open-mtg-arena-coverage/1.0", Accept: "application/json" } });
    if (!r.ok) throw new Error(`Scryfall ${r.status}`);
    const page = await r.json();
    for (const c of page.data) names.add(c.name);
    url = page.has_more ? page.next_page : null;
    await new Promise((res) => setTimeout(res, 120)); // Scryfall asks for 50-100 ms between requests
  }
  return [...names].sort();
}

if (!existsSync(poolFile)) writeFileSync(poolFile, JSON.stringify(await fetchPool()));
const pool = JSON.parse(readFileSync(poolFile, "utf8"));

const odin = await import(`${root}client/src/wasm-odin/engine_wasm.js`);
odin.initSync({ module: readFileSync(`${root}client/src/wasm-odin/engine_odin.wasm`) });
odin.load_card_database(readFileSync(`${root}client/public/card-data.json`, "utf8"));
const supported = new Set();
for (let i = 0; i < pool.length; i += 500) for (const n of odin.odin_call("odin_supported_cards", [pool.slice(i, i + 500)])) supported.add(n);

// The Rust engine's verdicts, by card name.
const rust = new Map();
const coverage = JSON.parse(readFileSync(`${root}client/public/coverage-data.json`, "utf8"));
for (const c of coverage.cards ?? []) rust.set(c.card_name, !!c.supported);
// A split or double-faced card ("Fire // Ice") is listed under its full name or its front face's.
const rustSupports = (n) => rust.get(n) ?? rust.get(n.split(" // ")[0]) ?? false;
const rustCount = pool.filter(rustSupports).length;

console.log(`pool ${pool.length}: Odin fully supports ${supported.size}, Rust ${rustCount} (target ${rustCount})`);
const i = process.argv.indexOf("--list-missing");
if (i > 0) console.log(pool.filter((n) => !supported.has(n) && rustSupports(n)).slice(0, Number(process.argv[i + 1] ?? 50)).join("\n"));

// What to build next: the missing pieces, ranked by how many Rust-supported pool cards each one blocks, and by how
// many cards it is the only thing missing from.
const gaps = {};
for (let i = 0; i < pool.length; i += 500) Object.assign(gaps, odin.odin_call("odin_card_gaps", [pool.slice(i, i + 500)]));
const blocks = new Map(), only = new Map();
for (const [name, list] of Object.entries(gaps)) {
  if (!rustSupports(name) || list.length === 0) continue;
  const unique = [...new Set(list)];
  for (const gap of unique) blocks.set(gap, (blocks.get(gap) ?? 0) + 1);
  if (unique.length === 1) only.set(unique[0], (only.get(unique[0]) ?? 0) + 1);
}
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `  ${String(v).padStart(5)}  ${k}`).join("\n");
console.log(`\nmissing pieces, by cards they block:\n${top(blocks, 30)}`);
console.log(`\nthe only missing piece, by cards it would add:\n${top(only, 30)}`);

// --examples "<gap>": cards for which that gap is the only thing missing, to look at next.
const ex = process.argv.indexOf("--examples");
if (ex > 0) {
  const want = process.argv[ex + 1];
  const names = Object.entries(gaps).filter(([n, l]) => rustSupports(n) && new Set(l).size === 1 && l[0] === want).map(([n]) => n);
  console.log(`\n${want}: ${names.slice(0, 40).join(" | ")}`);
}
