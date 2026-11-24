// The engine's fixed tables (formats, LLM providers, Commander brackets, Horde challenge decks), embedded from
// static.json. They are data rather than rules; snapshot-static.mjs regenerates the file when a table changes.
package engine_odin

import "base:runtime"
import "core:strings"
import json "../engine/json"

STATIC_JSON :: #load("static.json", string)

@(private = "file")
static_arena: runtime.Arena
@(private = "file")
static_tree: json.Value
@(private = "file")
static_loaded: bool

// The parsed tables, parsed on first use and kept for the module's lifetime.
static_data :: proc() -> json.Value {
	if !static_loaded {
		context.allocator = runtime.arena_allocator(&static_arena)
		static_tree, _ = json.parse(transmute([]byte)STATIC_JSON)
		static_loaded = true
	}
	return static_tree
}

static_table :: proc(key: string) -> json.Value {
	return json.get_or_null(static_data(), key)
}

// The format registry entry for a format tag ("Standard"), if the format is user-selectable.
format_entry :: proc(format: string) -> (json.Value, bool) {
	for entry in static_table("format_registry").items {
		if tag, ok := json.get(entry, "format"); ok && tag.kind == .String && tag.text == format {
			return entry, true
		}
	}
	return {}, false
}

// A per-format lookup (deck_supply, best_of_three_ceiling): the format's own answer, or the table's fallback when
// the argument isn't a format tag, as the Rust bindings fall back when it doesn't decode.
format_lookup :: proc(b: ^strings.Builder, table: string, format: json.Value) {
	if format.kind == .String {
		if v, ok := json.get(static_table(table), format.text); ok {
			reply_ok_value(b, v)
			return
		}
	}
	reply_ok_value(b, static_table(table_fallback(table)))
}

@(private = "file")
table_fallback :: proc(table: string) -> string {
	switch table {
	case "deck_supply":
		return "deck_supply_fallback"
	case "best_of_three_ceiling":
		return "best_of_three_ceiling_fallback"
	}
	return ""
}
