// The card database at the boundary: one shared database (odin/engine/carddb) for the engine's lifetime.
package engine_odin

import "core:strings"
import carddb "../engine/carddb"
import json "../engine/json"
import types "../engine/types"

@(private = "file")
db: carddb.DB

card_db_loaded :: proc() -> bool {return carddb.loaded(&db)}

card_count :: proc() -> int {return carddb.count(&db)}

card_by_key :: proc(key: string) -> (^types.CardExportEntry, bool) {return carddb.by_key(&db, key)}

// load_card_database(json_str): indexes the card data and answers the count.
load_card_database :: proc(b: ^strings.Builder, args: []json.Value) {
	if len(args) < 1 || args[0].kind != .String {
		reply_err(b, "load_card_database: expected the card data as a string")
		return
	}
	if !carddb.load(&db, args[0].text) {
		reply_err(b, "Failed to parse card database")
		return
	}
	count := strings.builder_make(context.temp_allocator)
	strings.write_int(&count, carddb.count(&db))
	reply_ok_raw(b, strings.to_string(count))
}
