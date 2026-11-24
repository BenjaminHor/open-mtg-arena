// O-1 check: every card in card-data.json decodes into the generated Odin model and encodes back to an equal JSON
// value (object member order ignored, array order kept). Usage: carddata_roundtrip <card-data.json> [max reports]
//
// One key is skipped: AbilityDefinition's computed `is_mana_ability`, not yet ported (hand_codecs.odin explains).
// The reserved top-level key `__engine_parses__` isn't a card: it holds the engine's precomputed card-text parses
// (D-183), and round-trips as one EngineParses value.
package carddata_roundtrip

import "core:fmt"
import "core:mem/virtual"
import "core:os"
import "core:strconv"
import "core:strings"
import "core:time"
import json "../../engine/json"
import types "../../engine/types"

ENGINE_PARSES_KEY :: "__engine_parses__"

// Removes members named key anywhere in the tree (the original's copy, so both sides compare alike).
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

main :: proc() {
	arena: virtual.Arena
	_ = virtual.arena_init_growing(&arena)
	context.allocator = virtual.arena_allocator(&arena)
	max_reports := 10
	if len(os.args) > 2 do max_reports, _ = strconv.parse_int(os.args[2])

	data, rerr := os.read_entire_file_from_path(os.args[1], context.allocator)
	if rerr != nil { fmt.eprintln("can't read", os.args[1]); os.exit(1) }
	root, perr := json.parse(data)
	if perr != nil { fmt.eprintln("parse error", perr); os.exit(1) }

	// The cards, and the engine's parse table apart from them.
	cards := make([dynamic]json.Member, 0, len(root.members))
	engine_parses: Maybe(json.Value)
	for m in root.members {
		if m.key == ENGINE_PARSES_KEY {
			engine_parses = m.value
		} else {
			append(&cards, m)
		}
	}

	t := time.now()
	decoded := make([]types.CardExportEntry, len(cards))
	decode_failures := 0
	for m, i in cards {
		types.decode_error = ""
		if !types.decode_CardExportEntry(m.value, &decoded[i]) {
			decode_failures += 1
			if decode_failures <= max_reports do fmt.printf("decode failed: %q at %v\n", m.key, types.decode_error)
		}
	}
	decode_ms := time.duration_milliseconds(time.since(t))

	// Debug: carddata_roundtrip <file> <n> "<card name>" prints that card's re-encoded JSON.
	if len(os.args) > 3 {
		for m, i in cards do if m.key == os.args[3] {
			b := strings.builder_make()
			types.encode_CardExportEntry(&b, decoded[i])
			fmt.println(strings.to_string(b))
		}
		return
	}

	t = time.now()
	mismatches := 0
	for m, i in cards {
		b := strings.builder_make()
		types.encode_CardExportEntry(&b, decoded[i])
		again, err := json.parse(transmute([]byte)strings.to_string(b))
		if err != nil {
			mismatches += 1
			if mismatches <= max_reports do fmt.printf("re-parse failed: %q %v\n", m.key, err)
			continue
		}
		original := m.value
		strip_key(&original, "is_mana_ability")

		path := strings.builder_make()
		if !json.equal(original, again, &path) {
			mismatches += 1
			if mismatches <= max_reports do fmt.printf("mismatch: %q at %v\n", m.key, strings.to_string(path))
		}
	}
	// The engine's parse table (D-183): one value, compared the same way.
	parses_ok := false
	if value, ok := engine_parses.?; ok {
		parses: types.EngineParses
		types.decode_error = ""
		if !types.decode_EngineParses(value, &parses) {
			fmt.printf("decode failed: %q at %v\n", ENGINE_PARSES_KEY, types.decode_error)
		} else {
			b := strings.builder_make()
			types.encode_EngineParses(&b, parses)
			again, err := json.parse(transmute([]byte)strings.to_string(b))
			original := value
			strip_key(&original, "is_mana_ability")
			path := strings.builder_make()
			if err != nil {
				fmt.printf("re-parse failed: %q %v\n", ENGINE_PARSES_KEY, err)
			} else if !json.equal(original, again, &path) {
				fmt.printf("mismatch: %q at %v\n", ENGINE_PARSES_KEY, strings.to_string(path))
			} else {
				parses_ok = true
			}
		}
	} else {
		fmt.printf("missing: %q (card data from before D-183)\n", ENGINE_PARSES_KEY)
	}

	when types.COVERAGE {
		if path, ok := os.lookup_env("COVERAGE_OUT", context.allocator); ok {
			b := strings.builder_make()
			for k in types.COVERAGE_KEYS do fmt.sbprintf(&b, "%v\t%v\n", types.coverage[k], k)
			for k in types.HAND_COVERAGE_KEYS do fmt.sbprintf(&b, "%v\t%v\n", types.coverage[k], k)
			_ = os.write_entire_file(path, transmute([]byte)strings.to_string(b))
		}
	}
	fmt.printf("cards %v: decode failures %v (%.0f ms), round-trip mismatches %v (%.0f ms); engine parses round-trip: %v\n",
		len(cards), decode_failures, decode_ms, mismatches, time.duration_milliseconds(time.since(t)), parses_ok)
	if decode_failures > 0 || mismatches > 0 || !parses_ok do os.exit(1)
}
