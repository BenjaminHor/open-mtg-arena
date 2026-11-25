import { readFileSync } from "node:fs";
// Prints whether the Odin engine fully supports each named card: node odin/engine-wasm/sup.mjs "Card Name" ...
const root = new URL("../../", import.meta.url).pathname;
const odin = await import(`${root}client/src/wasm-odin/engine_wasm.js`);
odin.initSync({ module: readFileSync(`${root}client/src/wasm-odin/engine_odin.wasm`) });
odin.load_card_database(readFileSync(`${root}client/public/card-data.json`, "utf8"));
const names = process.argv.slice(2);
const sup = new Set(odin.odin_call("odin_supported_cards", [names]));
for (const n of names) console.log(sup.has(n) ? "SUPPORTED" : "refused  ", n);
