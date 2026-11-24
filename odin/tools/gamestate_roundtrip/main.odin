// O-1 check: every game state and action in recorded games (crates/phase-ai/src/bin/record_games.rs) decodes into
// the generated Odin model and encodes back to an equal JSON value (object member order ignored, array order kept).
// Usage: gamestate_roundtrip <game.jsonl>... [-reports:N]
//
// Skipped from the comparison: AbilityDefinition's computed `is_mana_ability` (as in carddata_roundtrip) and the
// write-only fields (types.WRITE_ONLY_FIELDS), values the engine derives and never reads; both come back once the
// logic that computes them is ported.
package gamestate_roundtrip

import "core:fmt"
import "core:mem/virtual"
import "core:os"
import "core:strconv"
import "core:strings"
import "core:time"
import json "../../engine/json"
import types "../../engine/types"

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

Stats :: struct {
	checked, decode_failures, mismatches: int,
	decode_ms, encode_ms:                 f64,
}

max_reports := 10
reports := 0

report :: proc(format: string, args: ..any) {
	reports += 1
	if reports <= max_reports do fmt.printf(format, ..args)
}

// Decodes v as T, encodes it back and compares; `where_` names the value in reports.
check :: proc(v: json.Value, $T: typeid, dec: proc(json.Value, ^T) -> bool, enc: proc(^strings.Builder, T), s: ^Stats, where_: string) {
	s.checked += 1
	x: T
	types.decode_error = ""
	t := time.now()
	ok := dec(v, &x)
	s.decode_ms += time.duration_milliseconds(time.since(t))
	if !ok {
		s.decode_failures += 1
		report("decode failed: %v at %v\n", where_, types.decode_error)
		return
	}
	t = time.now()
	b := strings.builder_make()
	enc(&b, x)
	again, err := json.parse(transmute([]byte)strings.to_string(b))
	s.encode_ms += time.duration_milliseconds(time.since(t))
	if err != nil {
		s.mismatches += 1
		report("re-parse failed: %v %v\n", where_, err)
		return
	}
	original := v
	strip_key(&original, "is_mana_ability")
	for k in types.WRITE_ONLY_FIELDS {
		strip_key(&original, k)
		strip_key(&again, k)
	}
	path := strings.builder_make()
	if !json.equal(original, again, &path) {
		s.mismatches += 1
		report("mismatch: %v at %v\n", where_, strings.to_string(path))
	}
}

main :: proc() {
	files: [dynamic]string
	for a in os.args[1:] {
		if strings.has_prefix(a, "-reports:") do max_reports, _ = strconv.parse_int(a[len("-reports:"):])
		else do append(&files, a)
	}
	states, actions: Stats
	for file in files {
		data, rerr := os.read_entire_file_from_path(file, context.allocator)
		if rerr != nil { fmt.eprintln("can't read", file); os.exit(1) }
		rest := string(data)
		line_no := 0
		for line in strings.split_lines_iterator(&rest) {
			if len(line) == 0 do continue
			line_no += 1
			// One arena per line: a state's decoded tree is dropped once it's checked.
			arena: virtual.Arena
			_ = virtual.arena_init_growing(&arena)
			defer virtual.arena_destroy(&arena)
			context.allocator = virtual.arena_allocator(&arena)
			context.temp_allocator = context.allocator
			root, perr := json.parse(transmute([]byte)line)
			if perr != nil { fmt.eprintln(file, line_no, "parse error", perr); os.exit(1) }
			where_ := fmt.tprintf("%v line %v", file, line_no)
			if s, ok := json.get(root, "initial_state"); ok do check(s, types.GameState, types.decode_GameState, types.encode_GameState, &states, where_)
			if s, ok := json.get(root, "state"); ok do check(s, types.GameState, types.decode_GameState, types.encode_GameState, &states, where_)
			if a, ok := json.get(root, "action"); ok do check(a, types.GameAction, types.decode_GameAction, types.encode_GameAction, &actions, where_)
		}
	}
	fmt.printf("states %v: decode failures %v (%.0f ms), mismatches %v (%.0f ms)\n", states.checked, states.decode_failures, states.decode_ms, states.mismatches, states.encode_ms)
	fmt.printf("actions %v: decode failures %v, mismatches %v\n", actions.checked, actions.decode_failures, actions.mismatches)
	if states.decode_failures + states.mismatches + actions.decode_failures + actions.mismatches > 0 do os.exit(1)
}
