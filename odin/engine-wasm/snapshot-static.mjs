// Snapshots the engine's fixed tables from the Rust engine's WebAssembly into odin/engine-wasm/static.json, which
// the Odin engine embeds (D-187): the format registry, the LLM provider catalog, the Commander bracket table, the
// Horde challenge decks, and the per-format deck supply and best-of-three ceiling. These are data, not rules, so
// the Odin engine serves the same answers without restating them by hand. The Odin build never needs Rust: rerun
// this only when one of these tables changes (it needs a built client/src/wasm/engine_wasm_bg.wasm).
// Usage: node odin/engine-wasm/snapshot-static.mjs
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../../", import.meta.url).pathname;
const rust = await import(`${root}client/src/wasm/engine_wasm.js`);
rust.initSync({ module: readFileSync(`${root}client/src/wasm/engine_wasm_bg.wasm`) });

// Every GameFormat variant (crates/engine/src/types/format.rs), not only the selectable ones in the registry: the
// lookups answer for any variant the client can name. Custom carries data, so a bare tag decodes as the fallback.
const src = readFileSync(`${root}crates/engine/src/types/format.rs`, "utf8");
const body = src.slice(src.indexOf("pub enum GameFormat {"));
const variants = [...body.slice(0, body.indexOf("\n}")).matchAll(/^ {4}([A-Z][A-Za-z]+)/gm)].map((m) => m[1]);

const byFormat = (fn) => Object.fromEntries(variants.map((v) => [v, rust[fn](v)]));
const snapshot = {
  format_registry: rust.getFormatRegistry(),
  llm_provider_catalog: rust.llmProviderCatalog(),
  bracket_difficulty_table: rust.getBracketDifficultyTable(),
  challenge_deck_registry: rust.getChallengeDeckRegistry(),
  deck_supply: byFormat("deckSupplyForFormat"),
  deck_supply_fallback: rust.deckSupplyForFormat(null),
  best_of_three_ceiling: byFormat("bestOfThreeCeilingForFormat"),
  best_of_three_ceiling_fallback: rust.bestOfThreeCeilingForFormat(null),
};
const out = `${root}odin/engine-wasm/static.json`;
writeFileSync(out, JSON.stringify(snapshot) + "\n");
console.log(`${out}: ${variants.length} formats, ${JSON.stringify(snapshot).length} bytes`);
