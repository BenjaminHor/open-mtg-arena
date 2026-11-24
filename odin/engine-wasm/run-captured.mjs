// Runs the captured Rust tests (D-187, step 1) against an engine through the client's interface and reports the
// pass rate. Each captured step restores its starting state, submits the action for the recorded seat, and compares
// the game-relevant projection (projection.mjs) of the engine's state with the captured result. A test passes when
// every one of its steps does. Run it against the Rust engine to check the harness itself (it must pass everything),
// and against the Odin engine to measure it.
// Usage: node odin/engine-wasm/run-captured.mjs <rust|odin> <capture dir> [--verbose]
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { project, firstDifference } from "./projection.mjs";

const [which, dir, ...flags] = process.argv.slice(2);
if (!["rust", "odin"].includes(which) || !dir) {
  console.error("usage: run-captured.mjs <rust|odin> <capture dir> [--verbose]");
  process.exit(2);
}
const verbose = flags.includes("--verbose");
const root = new URL("../../", import.meta.url).pathname;
const [glueDir, wasmFile] = which === "rust" ? ["wasm", "engine_wasm_bg.wasm"] : ["wasm-odin", "engine_odin.wasm"];
const engine = await import(`${root}client/src/${glueDir}/engine_wasm.js`);
engine.initSync({ module: readFileSync(`${root}client/src/${glueDir}/${wasmFile}`) });
// A restored state's cards are looked up in the card database (the Rust engine rehydrates their abilities from it).
engine.load_card_database(readFileSync(`${root}client/public/card-data.json`, "utf8"));

// Whether the engine took the action: it throws, or answers a rejection, when it doesn't.
function submit(actor, action) {
  try {
    const r = engine.submit_action(actor, action);
    if (typeof r === "string") return { accepted: false, why: r };
    if (r && (r.rejected || r.rejection || r.error)) return { accepted: false, why: JSON.stringify(r).slice(0, 200) };
    return { accepted: true };
  } catch (e) {
    return { accepted: false, why: String(e.message ?? e) };
  }
}

const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") || f.endsWith(".jsonl.gz")).sort();
const read = (f) => (f.endsWith(".gz") ? gunzipSync(readFileSync(f)).toString("utf8") : readFileSync(f, "utf8"));
let passed = 0, steps = 0, stepsPassed = 0;
const failures = new Map(); // first difference path -> count
for (const file of files) {
  let prev = null, ok = true, firstFail = null;
  const lines = read(`${dir}/${file}`).split("\n").filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const step = JSON.parse(line);
    const pre = step.pre ?? prev;
    prev = step.post;
    steps++;
    let why = null;
    try {
      engine.restore_game_state(JSON.stringify(pre));
      const r = submit(step.actor ?? 0, step.action);
      if (r.accepted !== step.ok) why = { path: "accepted", a: step.ok, b: `${r.accepted} ${r.why ?? ""}` };
      // The full state (get_game_state hides what the viewer can't see, like the library).
      else if (step.ok) why = firstDifference(project(step.post), project(JSON.parse(engine.export_game_state_json())));
    } catch (e) {
      why = { path: "error", a: null, b: String(e.message ?? e).slice(0, 200) };
    }
    if (why) {
      ok = false;
      firstFail ??= { step: i, ...why };
    } else stepsPassed++;
  }
  if (ok) passed++;
  else {
    const key = firstFail.path.replace(/\.\d+/g, ".N");
    failures.set(key, (failures.get(key) ?? 0) + 1);
    if (verbose) console.log(`FAIL ${file} step ${firstFail.step} at ${firstFail.path}\n  expected: ${JSON.stringify(firstFail.a)?.slice(0, 300)}\n  got:      ${JSON.stringify(firstFail.b)?.slice(0, 300)}`);
  }
}
console.log(`${which}: ${passed}/${files.length} tests pass (${stepsPassed}/${steps} steps)`);
for (const [k, n] of [...failures].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n}  first difference at ${k}`);
