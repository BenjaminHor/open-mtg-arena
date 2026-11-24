// O-2's replay harness (docs/odin-port.md, "Replaying recorded games"): steps a game the Rust engine recorded
// (crates/phase-ai/src/bin/record_games.rs) through the translated Odin engine and checks every step's state against
// the recording.
//
// Each step starts from the recording's state before it (not from the harness's own result), so a step is judged on
// its own and one divergence doesn't hide the steps after it. For each AI action the harness:
//   1. decodes the previous state and restores its RNG (GameState.rng is skipped on the wire; as
//      GameState::rehydrate_rng, from rng_seed and the previous line's rng_word_pos);
//   2. applies the action through the same reducer boundary as phase_ai's run_ai_action: a verified AI stack pass
//      (engine::verified_ai_stack_pass_player) goes to apply_verified_ai_priority_pass with the issued decision
//      contract, anything else to apply_interaction(actor, semantic_owner);
//   3. compares the resulting state with the recorded one as JSON (the first differing path), and the RNG position;
//   4. reports untranslated stubs reached (in a -define:VECTOR=true build a stub calls back and returns a zero value).
// Host settlements of physical contests are not game actions (the host plays them out with the AI's own RNG); they
// are skipped and counted.
//
// The step's verdict is its first stub, if any. After a stub the call goes on with a zero value, so the stubs met
// later in that step are only indicative ("also reached"); the ranking that matters is the first stub per step,
// ordered by the step it first blocks: what the translator should take next.
//
// Build against a translation (odingen translate-report; odin/tools/replay.sh does it all):
//   odin build odin/tools/replay -collection:eng=<dir holding types/, json/, rng/> -define:VECTOR=true
// Usage: replay <game.jsonl> [-steps:N] [-from:N] [-timeout:SECONDS] [-trace] [-first-stub] [-top:N]
//               [-translation:<translated.odin>] [-needs:<first-use log>]
//   -steps:N      replay at most N steps; -from:N  start at step N
//   -timeout:S    seconds a step may run (after a stub, zero values can loop); default 5
//   -trace        one line per step
//   -first-stub   end each step at its first stub (no "also reached" list)
//   -top:N        rows of each ranking to print; default 40
//   -translation:F  the translated.odin built against: stubs' reasons, and which functions it has at all
//   -needs:F      the first-use log of the same game (odingen trace-patch; FIRST_USE_LOG): every function the
//                 Rust reducer calls, with the step it is first called in. With -translation, the report lists
//                 all the untranslated functions the game needs, by first use, not only the first stub per step.
//   -self-check   check the harness, not the engine: each step's "result" is its own recorded state, decoded and
//                 put through the same RNG restore and comparison (every step must pass)
//   -out:F        with -needs: write that whole list as TSV (first step, procedure, status, why or file)
package replay

import "core:c"
import "core:fmt"
import "core:mem/virtual"
import "core:os"
import "core:path/filepath"
import "core:slice"
import "core:strconv"
import "core:strings"
import "core:sys/posix"
import json "eng:json"
import "eng:rng"
import types "eng:types"

Outcome :: enum {
	Pass,
	Differs,      // the state or the RNG position differs from the recording
	PassPairOrder, // equal once pair lists are sorted: a map held as a pair list whose order follows Rust's hashing
	ReducerError, // the reducer rejected an action the Rust engine accepted
	Stub,         // reached an untranslated procedure
	Undecodable,  // the recorded state or action doesn't decode
	Crash,        // the translated code panicked (a bounds check, a nil `.?`, ...)
	Timeout,
}

// The child's side of the pipe, and the stubs this step has reported (each once).
child_fd: posix.FD
step_stubs: map[string]bool
stop_at_first_stub: bool
self_check: bool

child_send :: proc(msg: string) {
	posix.write(child_fd, raw_data(msg), c.size_t(len(msg)))
}

on_stub :: proc(name: string) {
	if name in step_stubs do return
	step_stubs[name] = true
	child_send(fmt.tprintf("S\t%v\n", name))
	if stop_at_first_stub || len(step_stubs) >= 200 {
		child_send("R\t\t\n")
		posix._exit(0)
	}
}

strip_key :: proc(v: ^json.Value, key: string) {
	#partial switch v.kind {
	case .Array:
		for &item in v.items do strip_key(&item, key)
	case .Object:
		kept := make([dynamic]json.Member, 0, len(v.members))
		for &m in v.members {
			if m.key == key do continue
			strip_key(&m.value, key)
			append(&kept, m)
		}
		v.members = kept[:]
	}
}

// Values the Rust engine computes while serializing and the Odin model leaves out (as in gamestate_roundtrip).
strip_derived :: proc(v: ^json.Value) {
	strip_key(v, "is_mana_ability")
	for k in types.WRITE_ONLY_FIELDS do strip_key(v, k)
}

// One step, run in the child. Returns the verdict ("R\t<outcome>\t<detail>"); stubs were sent as they were met.
run_step :: proc(prev, line: json.Value, prev_word_pos: u128) -> (Outcome, string) {
	state: types.GameState
	types.decode_error = ""
	if !types.decode_GameState(prev, &state) do return .Undecodable, fmt.tprintf("previous state: %v", types.decode_error)
	// GameState::rehydrate_rng, at the live position the recorder read after the previous step.
	state.rng = types.GameRng{generator = rng.from_u64(state.rng_seed)}
	rng.set_word_pos(&state.rng.generator, prev_word_pos)

	action: types.GameAction
	action_v, _ := json.get(line, "action")
	if !types.decode_GameAction(action_v, &action) do return .Undecodable, fmt.tprintf("action: %v", types.decode_error)
	actor_v, _ := json.get(line, "actor")
	owner_v, _ := json.get(line, "semantic_owner")
	actor, owner: u8
	if !types.decode_u8(actor_v, &actor) || !types.decode_u8(owner_v, &owner) do return .Undecodable, "actor or semantic_owner"

	// phase_ai::auto_play::run_ai_action's choice of reducer boundary.
	result: types.Result(types.ActionResult, types.EngineError)
	if self_check {
		// The recorded result in place of the reducer's, with its RNG at the recorded position after the step.
		after_v, _ := json.get(line, "state")
		state = {}
		if !types.decode_GameState(after_v, &state) do return .Undecodable, fmt.tprintf("state: %v", types.decode_error)
		pos_v, _ := json.get(line, "rng_word_pos")
		pos: u128
		types.decode_u128(pos_v, &pos)
		state.rng = types.GameRng{generator = rng.from_u64(state.rng_seed)}
		rng.set_word_pos(&state.rng.generator, pos)
	} else if _, verified := types.engine_verified_ai_stack_pass_player(state, action).?; verified {
		contract := types.AiDecisionContract_issue(state, types.PlayerId(owner))
		result = types.engine_apply_verified_ai_priority_pass(&state, types.PlayerId(actor), contract, action)
	} else {
		result = types.engine_apply_interaction(&state, types.PlayerId(actor), types.PlayerId(owner), action)
	}
	if len(step_stubs) > 0 do return .Stub, ""
	if err, failed := result.err.?; failed do return .ReducerError, fmt.tprintf("%v", err)

	want_pos_v, _ := json.get(line, "rng_word_pos")
	want_pos: u128
	types.decode_u128(want_pos_v, &want_pos)
	got_pos := rng.get_word_pos(&state.rng.generator)

	b := strings.builder_make()
	types.encode_GameState(&b, state)
	got, perr := json.parse(transmute([]byte)strings.to_string(b))
	if perr != nil do return .Differs, "the encoded state doesn't parse"
	want, _ := json.get(line, "state")
	strip_derived(&want)
	strip_derived(&got)
	path := strings.builder_make()
	if got_pos != want_pos do return .Differs, fmt.tprintf("rng word position %v, recorded %v", got_pos, want_pos)
	if json.equal(want, got) do return .Pass, ""
	// Maps whose keys Odin can't hash (HashMap<CounterType, u32>, ...) are pair lists in the model; the translation
	// appends new keys while Rust writes them in its hashing order, so the same entries can come in another order.
	// Sorted, they compare as the maps they are. A Vec of pairs whose order matters would pass here too, so these
	// steps are counted apart (docs/status.md, Known issues).
	sort_pair_lists(&want)
	sort_pair_lists(&got)
	if json.equal(want, got, &path) do return .PassPairOrder, ""
	return .Differs, fmt.tprintf("state at %v", strings.to_string(path))
}

// Sorts, at every depth, the arrays whose items are all two-element arrays (pair lists), by their JSON text.
sort_pair_lists :: proc(v: ^json.Value) {
	#partial switch v.kind {
	case .Object:
		for &m in v.members do sort_pair_lists(&m.value)
	case .Array:
		pairs := len(v.items) > 1
		for &item in v.items {
			sort_pair_lists(&item)
			if item.kind != .Array || len(item.items) != 2 do pairs = false
		}
		if !pairs do return
		Keyed :: struct { text: string, value: json.Value }
		keyed := make([]Keyed, len(v.items))
		for item, i in v.items {
			b := strings.builder_make()
			json.write_value(&b, item)
			keyed[i] = {strings.to_string(b), item}
		}
		slice.sort_by(keyed, proc(a, b: Keyed) -> bool { return a.text < b.text })
		items := make([]json.Value, len(keyed))
		for k, i in keyed do items[i] = k.value
		v.items = items
	}
}

Step_Result :: struct {
	outcome: Outcome,
	detail:  string,
	stubs:   [dynamic]string, // in the order met; stubs[0] is the step's blocker
}

// Runs a step in a forked child, so a panic or an endless loop (zero values after a stub) ends only that step.
run_isolated :: proc(prev, line: json.Value, prev_word_pos: u128, timeout_s: int) -> Step_Result {
	res: Step_Result
	fds: [2]posix.FD
	if posix.pipe(&fds) != .OK {
		res.outcome, res.detail = .Crash, "pipe failed"
		return res
	}
	pid := posix.fork()
	if pid == 0 {
		posix.close(fds[0])
		child_fd = fds[1]
		types.vector_on_stub = on_stub
		o, why := run_step(prev, line, prev_word_pos)
		child_send(fmt.tprintf("R\t%d\t%v\n", int(o), why))
		posix._exit(0)
	}
	posix.close(fds[1])
	buf: [dynamic]byte
	chunk: [4096]byte
	timed_out := false
	pfd := posix.pollfd{fd = fds[0], events = {.IN}}
	for {
		ready := posix.poll(&pfd, 1, c.int(timeout_s * 1000))
		if ready == 0 {
			timed_out = true
			posix.kill(pid, .SIGKILL)
			break
		}
		n := posix.read(fds[0], &chunk[0], len(chunk))
		if n <= 0 do break
		append(&buf, ..chunk[:n])
	}
	posix.close(fds[0])
	status: c.int
	posix.waitpid(pid, &status, {})

	verdict_seen := false
	rest := string(buf[:])
	for l in strings.split_lines_iterator(&rest) {
		parts := strings.split_n(l, "\t", 3)
		if len(parts) < 2 do continue
		switch parts[0] {
		case "S":
			append(&res.stubs, strings.clone(parts[1]))
		case "R":
			verdict_seen = true
			if parts[1] == "" {
				res.outcome = .Stub // ended at a stub (-first-stub, or the stub cap)
			} else {
				k, _ := strconv.parse_int(parts[1])
				res.outcome = Outcome(k)
				if len(parts) > 2 do res.detail = strings.clone(parts[2])
			}
		}
	}
	if !verdict_seen {
		res.outcome = .Timeout if timed_out else .Crash
		res.detail = fmt.aprintf("after %v s", timeout_s) if timed_out else "the step panicked"
	}
	// A step that met a stub is judged by it, whatever happened after the zero value came back.
	if len(res.stubs) > 0 do res.outcome = .Stub
	return res
}

Stub_Rank :: struct {
	name:       string,
	first_step: int,
	steps:      int, // steps it blocks (is their first stub), or reaches (for the "also reached" list)
}

main :: proc() {
	if len(os.args) < 2 {
		fmt.eprintln("usage: replay <game.jsonl> [-steps:N] [-from:N] [-timeout:SECONDS] [-trace] [-first-stub] [-top:N]")
		os.exit(2)
	}
	max_steps, from, timeout_s, top := max(int), 0, 5, 40
	trace := false
	translation_path, needs_path, out_path: string
	for a in os.args[2:] {
		switch {
		case strings.has_prefix(a, "-steps:"):   max_steps, _ = strconv.parse_int(a[len("-steps:"):])
		case strings.has_prefix(a, "-from:"):    from, _ = strconv.parse_int(a[len("-from:"):])
		case strings.has_prefix(a, "-timeout:"): timeout_s, _ = strconv.parse_int(a[len("-timeout:"):])
		case strings.has_prefix(a, "-top:"):     top, _ = strconv.parse_int(a[len("-top:"):])
		case strings.has_prefix(a, "-translation:"): translation_path = a[len("-translation:"):]
		case strings.has_prefix(a, "-out:"):     out_path = a[len("-out:"):]
		case strings.has_prefix(a, "-needs:"):   needs_path = a[len("-needs:"):]
		case a == "-trace":                      trace = true
		case a == "-first-stub":                 stop_at_first_stub = true
		case a == "-self-check":                 self_check = true
		case:
			fmt.eprintln("unknown option", a)
			os.exit(2)
		}
	}
	path := os.args[1]
	data, rerr := os.read_entire_file_from_path(path, context.allocator)
	if rerr != nil {
		fmt.eprintln("can't read", path)
		os.exit(1)
	}
	persistent := context.allocator

	// Two arenas, alternating: the previous line (its state is the step's input) and the current one.
	arenas: [2]virtual.Arena
	for &a in arenas do _ = virtual.arena_init_growing(&a)
	prev_state: json.Value
	prev_word_pos: u128
	have_prev := false

	counts: [Outcome]int
	settlements, replayed := 0, 0
	first_stop := -1
	first_stop_line: string
	first_diff := -1
	first_diff_line: string
	blockers := make(map[string]Stub_Rank, allocator = persistent)
	reached := make(map[string]Stub_Rank, allocator = persistent)

	rest := string(data)
	line_no := 0
	for line_text in strings.split_lines_iterator(&rest) {
		if len(line_text) == 0 do continue
		arena := &arenas[line_no % 2]
		line_no += 1
		virtual.arena_free_all(arena)
		context.allocator = virtual.arena_allocator(arena)
		context.temp_allocator = context.allocator
		line, perr := json.parse(transmute([]byte)line_text)
		if perr != nil {
			fmt.eprintln(path, "line", line_no, "doesn't parse:", perr)
			os.exit(1)
		}
		pos_v, _ := json.get(line, "rng_word_pos")
		word_pos: u128
		types.decode_u128(pos_v, &word_pos)
		defer {
			// This line's state is the next step's input.
			if s, ok := json.get(line, "initial_state"); ok do prev_state = s
			else if s, ok := json.get(line, "state"); ok do prev_state = s
			prev_word_pos = word_pos
			have_prev = true
		}
		step_v, is_step := json.get(line, "step")
		if !is_step || !have_prev do continue // the header
		step_u: u64
		types.decode_u64(step_v, &step_u)
		step := int(step_u)
		if step < from do continue
		if replayed + settlements >= max_steps do break
		if _, ok := json.get(line, "host_settlement"); ok {
			settlements += 1
			if trace do fmt.printf("step %4d  host settlement (not replayed)\n", step)
			continue
		}
		replayed += 1
		r := run_isolated(prev_state, line, prev_word_pos, timeout_s)
		counts[r.outcome] += 1
		where_ := fmt.aprintf("step %d (rng word %v before it)", step, prev_word_pos, allocator = persistent)
		if trace {
			action_v, _ := json.get(line, "action")
			tag := action_label(action_v)
			switch r.outcome {
			case .Stub: fmt.printf("step %4d  %-28v stub %v\n", step, tag, r.stubs[0])
			case .Pass, .PassPairOrder: fmt.printf("step %4d  %-28v %v\n", step, tag, r.outcome)
			case .Differs, .ReducerError, .Undecodable, .Crash, .Timeout:
				fmt.printf("step %4d  %-28v %v: %v\n", step, tag, r.outcome, r.detail)
			}
		}
		if r.outcome != .Pass && r.outcome != .PassPairOrder && first_stop < 0 {
			first_stop = step
			first_stop_line = describe(where_, r, persistent)
		}
		if r.outcome == .Differs && first_diff < 0 {
			first_diff = step
			first_diff_line = describe(where_, r, persistent)
		}
		for name, i in r.stubs {
			table := &blockers if i == 0 else &reached
			if i > 0 && name in blockers do continue // already ranked as a blocker
			if e, ok := &table[name]; ok {
				e.steps += 1
			} else {
				key := strings.clone(name, persistent)
				table[key] = Stub_Rank{name = key, first_step = step, steps = 1}
			}
		}
	}
	context.allocator = persistent
	// A stub first met "after a stub" and later as a blocker is listed once, as a blocker.
	for k in blockers do delete_key(&reached, k)

	fmt.printf("replay %v: %v steps replayed, %v host settlements skipped\n", path, replayed, settlements)
	fmt.printf("  pass %v (%v more with pair lists in another order), differ %v, reducer error %v, stub %v, undecodable %v, crash %v, timeout %v\n",
		counts[.Pass], counts[.PassPairOrder], counts[.Differs], counts[.ReducerError], counts[.Stub], counts[.Undecodable], counts[.Crash], counts[.Timeout])
	if first_stop >= 0 do fmt.printf("first step that doesn't pass: %v\n", first_stop_line)
	else do fmt.println("every replayed step passes")
	if first_diff >= 0 do fmt.printf("first difference: %v\n", first_diff_line)
	if self_check {
		// The harness's own check: anything but a pass is the harness's fault.
		if first_stop >= 0 do os.exit(1)
		return
	}

	tr := read_translation(translation_path) if translation_path != "" else Translation{}
	print_ranking("Stubs that block steps, by first use (each step's first stub):", blockers, top, tr)
	if !stop_at_first_stub do print_ranking("Also reached after a stub returned a zero value (indicative only):", reached, top, tr)
	if needs_path != "" && translation_path != "" do report_needs(needs_path, tr, top, out_path)
}

Translation :: struct {
	procs: map[string]bool,   // every procedure translated.odin defines
	stubs: map[string]string, // the untranslated ones, with the construct that stopped them
	instanced: map[string]bool, // generic or closure-taking functions translated per call site (`name__g..`, `name__cl..`)
}

// Reads translated.odin's procedure names and its stubs' reasons (`panic("not translated yet: <name> (<why>)")`).
read_translation :: proc(path: string) -> Translation {
	t: Translation
	data, err := os.read_entire_file_from_path(path, context.allocator)
	if err != nil {
		fmt.eprintln("can't read", path)
		os.exit(1)
	}
	// Procedures written by hand (hand_logic.odin, the runtime) sit beside it and count as translated.
	dir, _ := filepath.split(path)
	if files, derr := os.read_all_directory_by_path(dir if dir != "" else ".", context.allocator); derr == nil {
		for f in files {
			if !strings.has_suffix(f.name, ".odin") || f.name == "translated.odin" do continue
			text, ferr := os.read_entire_file_from_path(f.fullpath, context.allocator)
			if ferr != nil do continue
			r := string(text)
			for line in strings.split_lines_iterator(&r) do if i := strings.index(line, " :: proc"); i > 0 && line[0] != '\t' && line[0] != ' ' do t.procs[line[:i]] = true
		}
	}
	rest := string(data)
	PANIC :: "panic(\"not translated yet: "
	for line in strings.split_lines_iterator(&rest) {
		if i := strings.index(line, " :: proc"); i > 0 && line[0] != '\t' && line[0] != ' ' {
			t.procs[line[:i]] = true
		} else if j := strings.index(line, PANIC); j >= 0 {
			body := line[j + len(PANIC):]
			sp := strings.index(body, " (")
			if sp < 0 do continue
			why := body[sp + 2:]
			why = why[:max(0, len(why) - len(")\")"))]
			t.stubs[body[:sp]] = why
		}
	}
	for name in t.procs {
		for marker in ([]string{"__cl", "__g"}) {
			if i := strings.index(name, marker); i > 0 do t.instanced[name[:i]] = true
		}
	}
	return t
}

// Every function the Rust reducer called in the recorded game (the first-use log), against the translation: the
// untranslated ones in the order the game first needs them, and those the translation doesn't define at all.
report_needs :: proc(path: string, tr: Translation, top: int, out_path: string) {
	data, err := os.read_entire_file_from_path(path, context.allocator)
	if err != nil {
		fmt.eprintln("can't read", path)
		os.exit(1)
	}
	Need :: struct { step: int, name, file: string }
	needed, missing: [dynamic]Need
	called, translated, instanced := 0, 0, 0
	seen := make(map[string]bool)
	rest := string(data)
	for line in strings.split_lines_iterator(&rest) {
		parts := strings.split(line, "\t")
		if len(parts) < 3 || parts[1] in seen do continue
		seen[parts[1]] = true
		called += 1
		step, _ := strconv.parse_int(parts[0])
		n := Need{step, parts[1], parts[2]}
		if n.name in tr.stubs do append(&needed, n)
		else if n.name in tr.procs do translated += 1
		else if n.name in tr.instanced do instanced += 1
		else do append(&missing, n)
	}
	// The log is in call order; a stable sort by step keeps that order within a step.
	slice.stable_sort_by(needed[:], proc(a, b: Need) -> bool { return a.step < b.step })
	slice.stable_sort_by(missing[:], proc(a, b: Need) -> bool { return a.step < b.step })
	fmt.printf("\nWhat the game needs (the Rust reducer's calls, %v): %v functions called; %v translated, %v translated as instances (some call sites may lack one), %v stubs, %v not in the translation\n",
		path, called, translated, instanced, len(needed), len(missing))
	if out_path != "" {
		b := strings.builder_make()
		for n in needed do fmt.sbprintf(&b, "%v\t%v\tstub\t%v\n", n.step, n.name, tr.stubs[n.name])
		for n in missing do fmt.sbprintf(&b, "%v\t%v\tabsent\t%v\n", n.step, n.name, n.file)
		if werr := os.write_entire_file(out_path, transmute([]byte)strings.to_string(b)); werr != nil do fmt.eprintln("can't write", out_path)
	}
	fmt.println("\nUntranslated functions the game needs, by first use:")
	fmt.println("  rank  first step  stub  (why it isn't translated)")
	for n, i in needed {
		if i >= top {
			fmt.printf("  ... %v more\n", len(needed) - top)
			break
		}
		fmt.printf("  %4d  %10d  %v  (%v)\n", i + 1, n.step, n.name, tr.stubs[n.name])
	}
	fmt.println("\nCalled but not in the translation (trait impls, macro-generated or colliding names), by first use:")
	for n, i in missing {
		if i >= top {
			fmt.printf("  ... %v more\n", len(missing) - top)
			break
		}
		fmt.printf("  %4d  %10d  %v  %v\n", i + 1, n.step, n.name, n.file)
	}
}

describe :: proc(where_: string, r: Step_Result, a: = context.allocator) -> string {
	if r.outcome == .Stub do return fmt.aprintf("%v stops at stub %v", where_, r.stubs[0], allocator = a)
	return fmt.aprintf("%v: %v %v", where_, r.outcome, r.detail, allocator = a)
}

// The action's variant, for -trace: the serde tag or the unit variant's name.
action_label :: proc(v: json.Value) -> string {
	#partial switch v.kind {
	case .String:
		return v.text
	case .Object:
		if t, ok := json.get(v, "type"); ok do return t.text
		if len(v.members) > 0 do return v.members[0].key
	}
	return "?"
}

print_ranking :: proc(title: string, table: map[string]Stub_Rank, top: int, tr: Translation) {
	rows := make([dynamic]Stub_Rank, 0, len(table))
	for _, r in table do append(&rows, r)
	slice.sort_by(rows[:], proc(a, b: Stub_Rank) -> bool {
		if a.first_step != b.first_step do return a.first_step < b.first_step
		return a.name < b.name
	})
	fmt.printf("\n%v %v\n", title, len(rows))
	fmt.println("  rank  first step  steps  stub")
	for r, i in rows {
		if i >= top {
			fmt.printf("  ... %v more\n", len(rows) - top)
			break
		}
		if why, ok := tr.stubs[r.name]; ok do fmt.printf("  %4d  %10d  %5d  %v  (%v)\n", i + 1, r.first_step, r.steps, r.name, why)
		else do fmt.printf("  %4d  %10d  %5d  %v\n", i + 1, r.first_step, r.steps, r.name)
	}
}
