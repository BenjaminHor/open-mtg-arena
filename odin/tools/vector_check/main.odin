// The vector check (docs/odin-port.md, "Verifying translated code"): replays calls the Rust engine logged
// (odingen vector-patch, a patched copy of the engine running record-games with VECTOR_LOG set) against the
// translated Odin procedures, and compares results and `&mut` arguments afterwards as JSON.
//
// Build against a translation (odingen translate-report writes translated.odin and vector_harness.odin there):
//   odin build odin/tools/vector_check -collection:eng=<dir holding types/, json/, rng/> -define:VECTOR=true
// Usage: vector_check <log.jsonl> [-trace] [-only:<proc>] [-nofork]
// The log's large values are in <log.jsonl>.values.
package vector_check

import "core:c"
import "core:fmt"
import "core:mem/virtual"
import "core:os"
import "core:slice"
import "core:strconv"
import "core:strings"
import "core:sys/posix"
import json "eng:json"
import types "eng:types"

child_fd: posix.FD

Tally :: struct {
	counts:      [types.Vector_Outcome]int,
	crashes:     int,
	first_why:   string,
}

// Runs one call in a forked child, so a translated procedure that panics (a nil `.?`, `unreachable()`, a bounds
// check) is reported as a crash instead of ending the run. The child sends back "<outcome>\t<why>".
run_isolated :: proc(name, file: string, args: []json.Value, ret: json.Value, after: []json.Value) -> (outcome: types.Vector_Outcome, crashed: bool, why: string) {
	fds: [2]posix.FD
	if posix.pipe(&fds) != .OK do return .Unknown, true, "pipe failed"
	pid := posix.fork()
	if pid == 0 {
		posix.close(fds[0])
		// A stub ends the call: what follows it would run on a made-up value.
		child_fd = fds[1]
		types.vector_on_stub = proc(name: string) {
			msg := fmt.tprintf("%d\t%v", int(types.Vector_Outcome.Stub), name)
			posix.write(child_fd, raw_data(msg), c.size_t(len(msg)))
			posix._exit(0)
		}
		w := strings.builder_make()
		o := types.vector_call(name, file, args, ret, after, &w)
		detail := types.decode_error if o == .Undecodable else strings.to_string(w)
		msg := fmt.tprintf("%d\t%v", int(o), detail)
		posix.write(fds[1], raw_data(msg), c.size_t(len(msg)))
		posix._exit(0)
	}
	posix.close(fds[1])
	buf: [dynamic]byte
	chunk: [4096]byte
	for {
		n := posix.read(fds[0], &chunk[0], len(chunk))
		if n <= 0 do break
		append(&buf, ..chunk[:n])
	}
	posix.close(fds[0])
	status: c.int
	posix.waitpid(pid, &status, {})
	text := string(buf[:])
	tab := strings.index_byte(text, '\t')
	if tab < 0 do return .Unknown, true, "the call crashed"
	k, _ := strconv.parse_int(text[:tab])
	return types.Vector_Outcome(k), false, text[tab + 1:]
}

main :: proc() {
	if len(os.args) < 2 {
		fmt.eprintln("usage: vector_check <log.jsonl> [-trace] [-only:<proc>]")
		os.exit(2)
	}
	trace := false
	no_fork := false
	only := ""
	for a in os.args[2:] {
		if a == "-trace" do trace = true
		if a == "-nofork" do no_fork = true
		if strings.has_prefix(a, "-only:") do only = a[len("-only:"):]
	}

	// Interned values (game states), by hash.
	values := make(map[string]json.Value)
	if data, rerr := os.read_entire_file_from_path(fmt.tprintf("%v.values", os.args[1]), context.allocator); rerr == nil {
		for line in strings.split_lines(string(data)) {
			if len(line) == 0 do continue
			v, err := json.parse(transmute([]byte)line)
			if err != nil do continue
			h, _ := json.get(v, "h")
			val, _ := json.get(v, "v")
			values[h.text] = val
		}
	}

	data, rerr := os.read_entire_file_from_path(os.args[1], context.allocator)
	if rerr != nil {
		fmt.eprintln("can't read", os.args[1])
		os.exit(1)
	}
	persistent := context.allocator
	tallies := make(map[string]Tally, allocator = persistent)
	arena: virtual.Arena
	_ = virtual.arena_init_growing(&arena)
	resolve := proc(v: json.Value, values: map[string]json.Value) -> json.Value {
		if v.kind == .Object && len(v.members) == 1 && v.members[0].key == "$ref" {
			if r, found := values[v.members[0].value.text]; found do return r
		}
		return v
	}
	n := 0
	for line in strings.split_lines(string(data)) {
		if len(line) == 0 do continue
		n += 1
		// Each record's parse and calls live in the arena (context changes are scoped to this iteration).
		context.allocator = virtual.arena_allocator(&arena)
		defer virtual.arena_free_all(&arena)
		rec, err := json.parse(transmute([]byte)line)
		if err != nil do continue
		f, _ := json.get(rec, "f")
		if only != "" && f.text != only do continue
		file, _ := json.get(rec, "file")
		args_v, _ := json.get(rec, "args")
		ret, _ := json.get(rec, "ret")
		after_v, _ := json.get(rec, "after")
		args := make([]json.Value, len(args_v.items))
		for a, i in args_v.items do args[i] = resolve(a, values)
		after := make([]json.Value, len(after_v.items))
		for a, i in after_v.items do after[i] = resolve(a, values)
		if trace do fmt.eprintln("call", n, f.text)
		outcome: types.Vector_Outcome
		crashed: bool
		w: string
		if no_fork {
			why := strings.builder_make()
			outcome = types.vector_call(f.text, file.text, args, resolve(ret, values), after, &why)
			w = types.decode_error if outcome == .Undecodable else strings.to_string(why)
		} else {
			outcome, crashed, w = run_isolated(f.text, file.text, args, resolve(ret, values), after)
		}
		if outcome == .Unknown && !crashed do continue
		t, seen := tallies[f.text]
		name := f.text if seen else strings.clone(f.text, persistent)
		if crashed do t.crashes += 1
		else do t.counts[outcome] += 1
		if (crashed || outcome == .Fail || outcome == .Undecodable) && t.first_why == "" {
			t.first_why = strings.clone(w if w != "" else "(no detail)", persistent)
		}
		tallies[name] = t
	}

	// Failures already understood (explained.txt beside this file, or -explained:<file>).
	explained := make(map[string]string)
	explained_path := "odin/tools/vector_check/explained.txt"
	for a in os.args[2:] do if strings.has_prefix(a, "-explained:") do explained_path = a[len("-explained:"):]
	if text, err := os.read_entire_file_from_path(explained_path, context.allocator); err == nil {
		for line in strings.split_lines(string(text)) {
			if len(line) == 0 || line[0] == '#' do continue
			if i := strings.index(line, ": "); i > 0 do explained[line[:i]] = line[i + 2:]
		}
	}
	explained_n := 0

	names := make([dynamic]string)
	for k in tallies do append(&names, k)
	slice.sort(names[:])
	totals: [types.Vector_Outcome]int
	fns: [types.Vector_Outcome]int
	crash_calls, crash_fns := 0, 0
	for k in names {
		t := tallies[k]
		worst := types.Vector_Outcome.Pass
		for o in types.Vector_Outcome do totals[o] += t.counts[o]
		crash_calls += t.crashes
		if t.crashes > 0 {
			crash_fns += 1
			fmt.printf("Crash %v (pass %v, crash %v): %v\n", k, t.counts[.Pass], t.crashes, t.first_why)
			continue
		}
		if t.counts[.Fail] > 0 do worst = .Fail
		else if t.counts[.Undecodable] > 0 do worst = .Undecodable
		else if t.counts[.Pass] > 0 do worst = .Pass
		else if t.counts[.PassUnloggedState] > 0 do worst = .PassUnloggedState
		else if t.counts[.PassNothingCompared] > 0 do worst = .PassNothingCompared
		else if t.counts[.Stub] > 0 do worst = .Stub
		else do worst = .Unlogged
		fns[worst] += 1
		if worst == .Fail {
			if why, ok := explained[k]; ok {
				explained_n += 1
				fns[.Fail] -= 1
				fmt.printf("Explained %v: %v\n", k, why)
				continue
			}
		}
		if worst == .Fail || worst == .Undecodable {
			fmt.printf("%v %v (pass %v, fail %v, stub %v): %v\n", worst, k, t.counts[.Pass], t.counts[.Fail], t.counts[.Stub], t.first_why)
		}
	}
	fmt.printf("\n%v calls checked over %v procedures\n", n, len(names))
	fmt.printf("explained failures %v\n", explained_n)
	fmt.printf("procedures: pass %v (and %v touching unlogged state, %v with nothing to compare), fail %v, crash %v, undecodable %v, only stubs reached %v, unlogged %v\n", fns[.Pass], fns[.PassUnloggedState], fns[.PassNothingCompared], fns[.Fail], crash_fns, fns[.Undecodable], fns[.Stub], fns[.Unlogged])
	fmt.printf("calls: pass %v, fail %v, crash %v, undecodable %v, stub %v, unlogged %v\n", totals[.Pass], totals[.Fail], crash_calls, totals[.Undecodable], totals[.Stub], totals[.Unlogged])
}
