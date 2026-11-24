// The vector check (docs/odin-port.md, "Verifying translated code"): replays calls the Rust engine logged
// (odingen vector-patch, a patched copy of the engine running record-games with VECTOR_LOG set) against the
// translated Odin procedures, and compares results and `&mut` arguments afterwards as JSON.
//
// Build against a translation (odingen translate-report writes translated.odin and vector_harness.odin there):
//   odin build odin/tools/vector_check -collection:eng=<dir holding types/, json/, rng/> -define:VECTOR=true
// Usage: vector_check <log.jsonl> [-trace] [-only:<proc>]
// The log's large values are in <log.jsonl>.values.
package vector_check

import "core:fmt"
import "core:mem/virtual"
import "core:os"
import "core:slice"
import "core:strings"
import json "eng:json"
import types "eng:types"

Tally :: struct {
	counts:    [types.Vector_Outcome]int,
	first_why: string,
}

main :: proc() {
	if len(os.args) < 2 {
		fmt.eprintln("usage: vector_check <log.jsonl> [-trace] [-only:<proc>]")
		os.exit(2)
	}
	trace := false
	only := ""
	for a in os.args[2:] {
		if a == "-trace" do trace = true
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
		why := strings.builder_make()
		outcome := types.vector_call(f.text, file.text, args, resolve(ret, values), after, &why)
		if outcome == .Unknown do continue
		t, seen := tallies[f.text]
		name := f.text if seen else strings.clone(f.text, persistent)
		t.counts[outcome] += 1
		if (outcome == .Fail || outcome == .Undecodable) && t.first_why == "" {
			w := strings.to_string(why)
			if outcome == .Undecodable do w = types.decode_error
			t.first_why = strings.clone(w if w != "" else "(no detail)", persistent)
		}
		tallies[name] = t
	}

	names := make([dynamic]string)
	for k in tallies do append(&names, k)
	slice.sort(names[:])
	totals: [types.Vector_Outcome]int
	fns: [types.Vector_Outcome]int
	for k in names {
		t := tallies[k]
		worst := types.Vector_Outcome.Pass
		for o in types.Vector_Outcome do totals[o] += t.counts[o]
		if t.counts[.Fail] > 0 do worst = .Fail
		else if t.counts[.Undecodable] > 0 do worst = .Undecodable
		else if t.counts[.Pass] == 0 && t.counts[.Stub] > 0 do worst = .Stub
		else if t.counts[.Pass] == 0 do worst = .Unlogged
		fns[worst] += 1
		if worst == .Fail || worst == .Undecodable {
			fmt.printf("%v %v (pass %v, fail %v, stub %v): %v\n", worst, k, t.counts[.Pass], t.counts[.Fail], t.counts[.Stub], t.first_why)
		}
	}
	fmt.printf("\n%v calls checked over %v procedures\n", n, len(names))
	fmt.printf("procedures: pass %v, fail %v, undecodable %v, only stubs reached %v, unlogged %v\n", fns[.Pass], fns[.Fail], fns[.Undecodable], fns[.Stub], fns[.Unlogged])
	fmt.printf("calls: pass %v, fail %v, undecodable %v, stub %v, unlogged %v\n", totals[.Pass], totals[.Fail], totals[.Undecodable], totals[.Stub], totals[.Unlogged])
}
