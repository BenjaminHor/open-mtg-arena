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
//   -steps:N      replay at most N steps; -from:N  start at step N
//   -timeout:S    seconds a step may run (after a stub, zero values can loop); default 5
//   -trace        one line per step
//   -first-stub   end each step at its first stub (no "also reached" list)
//   -top:N        rows of each ranking to print; default 40
package replay

import "core:c"
import "core:fmt"
import "core:mem/virtual"
import "core:os"
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
	if _, verified := types.engine_verified_ai_stack_pass_player(state, action).?; verified {
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
	if !json.equal(want, got, &path) do return .Differs, fmt.tprintf("state at %v", strings.to_string(path))
	if got_pos != want_pos do return .Differs, fmt.tprintf("rng word position %v, recorded %v", got_pos, want_pos)
	return .Pass, ""
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
	for a in os.args[2:] {
		switch {
		case strings.has_prefix(a, "-steps:"):   max_steps, _ = strconv.parse_int(a[len("-steps:"):])
		case strings.has_prefix(a, "-from:"):    from, _ = strconv.parse_int(a[len("-from:"):])
		case strings.has_prefix(a, "-timeout:"): timeout_s, _ = strconv.parse_int(a[len("-timeout:"):])
		case strings.has_prefix(a, "-top:"):     top, _ = strconv.parse_int(a[len("-top:"):])
		case a == "-trace":                      trace = true
		case a == "-first-stub":                 stop_at_first_stub = true
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
			case .Pass: fmt.printf("step %4d  %-28v pass\n", step, tag)
			case .Differs, .ReducerError, .Undecodable, .Crash, .Timeout:
				fmt.printf("step %4d  %-28v %v: %v\n", step, tag, r.outcome, r.detail)
			}
		}
		if r.outcome != .Pass && first_stop < 0 {
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
	fmt.printf("  pass %v, differ %v, reducer error %v, stub %v, undecodable %v, crash %v, timeout %v\n",
		counts[.Pass], counts[.Differs], counts[.ReducerError], counts[.Stub], counts[.Undecodable], counts[.Crash], counts[.Timeout])
	if first_stop >= 0 do fmt.printf("first step that doesn't pass: %v\n", first_stop_line)
	else do fmt.println("every replayed step passes")
	if first_diff >= 0 do fmt.printf("first difference: %v\n", first_diff_line)

	print_ranking("Stubs that block steps, by first use (each step's first stub):", blockers, top)
	if !stop_at_first_stub do print_ranking("Also reached after a stub returned a zero value (indicative only):", reached, top)
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

print_ranking :: proc(title: string, table: map[string]Stub_Rank, top: int) {
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
		fmt.printf("  %4d  %10d  %5d  %v\n", i + 1, r.first_step, r.steps, r.name)
	}
}
