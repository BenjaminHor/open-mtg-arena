// Runs the captured Rust tests (D-187, step 1) against an engine through the client's interface and reports the
// pass rate. Each captured step restores its starting state, submits the action for the recorded seat, and compares
// the game-relevant projection (projection.mjs) of the engine's state with the captured result. A test passes when
// every one of its steps does. Run it against the Rust engine to check the harness itself (it must pass everything),
// and against the Odin engine to measure it.
// A recording with a line that isn't JSON (a state the capture couldn't serialize) is counted as unreadable and left
// out. Options: --results <file> appends one line per test as it finishes ("<file>\t<pass|fail|unreadable>\t<first
// difference>\t<card names, separated by |>"), and a rerun with the same file skips the tests already in it, so a
// long run can be resumed; --only <file> runs just the files listed there. Run on Rust, the passing tests are the
// usable fixtures; the card names map tests to cards, to count a card as validated when its tests pass.
// Usage: node odin/engine-wasm/run-captured.mjs <rust|odin> <capture dir> [--verbose] [--results f] [--only f]
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { project, firstDifference } from "./projection.mjs";

const [which, dir, ...flags] = process.argv.slice(2);
if (!["rust", "odin"].includes(which) || !dir) {
  console.error("usage: run-captured.mjs <rust|odin> <capture dir> [--verbose]");
  process.exit(2);
}
const verbose = flags.includes("--verbose");
const option = (name) => (flags.indexOf(name) >= 0 ? flags[flags.indexOf(name) + 1] : null);
const resultsFile = option("--results"), onlyFile = option("--only");
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

let files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") || f.endsWith(".jsonl.gz")).sort();
if (onlyFile) {
  const only = new Set(readFileSync(onlyFile, "utf8").split("\n").filter(Boolean));
  files = files.filter((f) => only.has(f));
}
if (resultsFile && existsSync(resultsFile)) {
  const done = new Set(readFileSync(resultsFile, "utf8").split("\n").map((l) => l.split("\t")[0]));
  files = files.filter((f) => !done.has(f));
}
const record = (file, status, why, names) =>
  resultsFile && appendFileSync(resultsFile, `${file}\t${status}\t${why ?? ""}\t${[...(names ?? [])].join("|")}\n`);
const read = (f) => (f.endsWith(".gz") ? gunzipSync(readFileSync(f)).toString("utf8") : readFileSync(f, "utf8"));
let passed = 0, steps = 0, stepsPassed = 0, unreadable = 0, done = 0;
const failures = new Map(); // first difference path -> count
for (const file of files) {
  if (++done % 500 === 0) console.error(`${done}/${files.length}`);
  let prev = null, ok = true, firstFail = null;
  let parsed;
  try {
    parsed = read(`${dir}/${file}`).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    unreadable++;
    record(file, "unreadable");
    continue;
  }
  const names = new Set();
  for (const step of parsed) for (const o of Object.values(step.pre?.objects ?? {})) if (o && !o.is_token && o.name && o.zone !== "Library") names.add(o.name); // cards a test puts in play, not its filler library
  for (const [i, step] of parsed.entries()) {
    const pre = step.pre ?? prev;
    prev = step.post;
    steps++;
    let why = null;
    try {
      engine.restore_game_state(JSON.stringify(pre));
      const r = submit(step.actor ?? 0, step.action);
      if (r.accepted !== step.ok) why = { path: `accepted ${step.action?.type ?? "?"} (${step.ok ? "rejected here" : "accepted here"})`, a: step.ok, b: `${r.accepted} ${r.why ?? ""}` };
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
  record(file, ok ? "pass" : "fail", ok ? "" : `step ${firstFail.step} ${firstFail.path}`, names);
  if (ok) {
    passed++;
  } else {
    const key = firstFail.path.replace(/\.\d+/g, ".N");
    failures.set(key, (failures.get(key) ?? 0) + 1);
    if (verbose) console.log(`FAIL ${file} step ${firstFail.step} at ${firstFail.path}\n  expected: ${JSON.stringify(firstFail.a)?.slice(0, 300)}\n  got:      ${JSON.stringify(firstFail.b)?.slice(0, 300)}`);
  }
}
console.log(`${which}: ${passed}/${files.length - unreadable} tests pass (${stepsPassed}/${steps} steps); ${unreadable} unreadable recordings left out`);

for (const [k, n] of [...failures].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${n}  first difference at ${k}`);
