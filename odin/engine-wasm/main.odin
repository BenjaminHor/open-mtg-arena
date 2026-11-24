// The Odin engine's WebAssembly boundary (D-187): the client's engine interface, served by Odin. The generated glue
// (gen-glue.mjs) sends every call as one request {"fn": name, "args": [...]} and gets back {"ok": value} or
// {"err": message}. Calls the engine doesn't do yet answer "not implemented", so the client shows what's missing.
package engine_odin

import "base:runtime"
import "core:strings"
import json "../engine/json"
import types "../engine/types"

// The card database, by lowercase name (as the Rust engine keys it).
cards: map[string]types.CardExportEntry
cards_arena: runtime.Arena

result: [dynamic]byte

@(export)
alloc_bytes :: proc "c" (n: int) -> [^]byte {
	context = runtime.default_context()
	return raw_data(make([]byte, n))
}

@(export)
result_ptr :: proc "c" () -> [^]byte {return raw_data(result)}

@(export)
result_len :: proc "c" () -> int {return len(result)}

// One engine call: the request's bytes in, the reply's length out (read through result_ptr).
@(export)
call :: proc "c" (ptr: [^]byte, n: int) -> int {
	context = runtime.default_context()
	request := ptr[:n]
	defer free(ptr)
	// Per-call scratch (the request tree and anything a handler builds), freed when the reply is out. Odin's
	// runtime arena grows in blocks and works in wasm, unlike the virtual-memory one.
	arena: runtime.Arena
	defer runtime.arena_destroy(&arena)

	b := strings.builder_make()
	{
		context.allocator = runtime.arena_allocator(&arena)
		req, perr := json.parse(request)
		if perr != nil {
			reply_err(&b, "malformed engine request")
		} else {
			fn_value, _ := json.get(req, "fn")
			args_value, _ := json.get(req, "args")
			dispatch(&b, fn_value.text, args_value.items)
		}
	}
	clear(&result)
	append(&result, ..transmute([]byte)strings.to_string(b))
	strings.builder_destroy(&b)
	return len(result)
}

reply_ok_raw :: proc(b: ^strings.Builder, value_json: string) {
	strings.write_string(b, `{"ok":`)
	strings.write_string(b, value_json)
	strings.write_byte(b, '}')
}

reply_err :: proc(b: ^strings.Builder, message: string) {
	strings.write_string(b, `{"err":`)
	json.write_string(b, message)
	strings.write_byte(b, '}')
}

// The engine's functions by name. Each writes its reply into b.
dispatch :: proc(b: ^strings.Builder, fn: string, args: []json.Value) {
	switch fn {
	case "ping":
		reply_ok_raw(b, `"engine ready"`)
	case "init_panic_hook", "set_debug_hand_reveal", "set_multiplayer_mode", "clear_replay_playback":
		reply_ok_raw(b, "null")
	case "is_multiplayer_mode", "has_replay_recording":
		reply_ok_raw(b, "false")
	case "load_card_database":
		load_card_database(b, args)
	case:
		reply_err(b, strings.concatenate({"not implemented in the Odin engine yet: ", fn}, context.temp_allocator))
	}
}

// load_card_database(json_str): the card data the client fetched, kept for the engine's lifetime.
load_card_database :: proc(b: ^strings.Builder, args: []json.Value) {
	if len(args) < 1 || args[0].kind != .String {
		reply_err(b, "load_card_database: expected the card data as a string")
		return
	}
	// The tree and the decoded cards live in their own arena, replaced on a reload.
	runtime.arena_destroy(&cards_arena)
	context.allocator = runtime.arena_allocator(&cards_arena)
	data := transmute([]byte)strings.clone(args[0].text)
	root, perr := json.parse(data)
	if perr != nil || root.kind != .Object {
		reply_err(b, "Failed to parse card database")
		return
	}
	cards = make(map[string]types.CardExportEntry, len(root.members))
	for m in root.members {
		entry: types.CardExportEntry
		if types.decode_CardExportEntry(m.value, &entry) do cards[m.key] = entry
	}
	count := strings.builder_make(context.temp_allocator)
	strings.write_int(&count, len(cards))
	reply_ok_raw(b, strings.to_string(count))
}
