// O-0 spike: the engine's boundary in wasm. JavaScript copies a JSON string into the module's memory, calls an
// export, and reads a JSON string back, which is how every engine-wasm export works today (docs/odin-port.md).
package spike_wasm

import "base:runtime"
import "core:encoding/json"
import "core:strings"
import cd "../carddata"
import rng "../../engine/rng"

cards: map[string]cd.Card_Face
result: []byte

// JS asks the module for a buffer, writes the input into it, then calls an export with (ptr, len).
@(export)
alloc_bytes :: proc "c" (n: int) -> [^]byte {
	context = runtime.default_context()
	return raw_data(make([]byte, n))
}

@(export)
result_ptr :: proc "c" () -> [^]byte { return raw_data(result) }

@(export)
result_len :: proc "c" () -> int { return len(result) }

set_result :: proc(s: string) {
	delete(result)
	result = transmute([]byte)strings.clone(s)
}

// Parses the whole card-data.json; returns the number of cards, or -1.
@(export)
load_cards :: proc "c" (ptr: [^]byte, n: int) -> int {
	context = runtime.default_context()
	data := ptr[:n]
	parsed, err := cd.parse_typed(data)
	if err != nil do return -1
	cards = parsed
	return len(cards)
}

// JSON in ({"name": ..., "seed": ...}), JSON out: a few fields of the card and a seeded shuffle, the kind of round
// trip every engine call makes.
@(export)
query :: proc "c" (ptr: [^]byte, n: int) -> int {
	context = runtime.default_context()
	Request :: struct { name: string, seed: u64 }
	req: Request
	if json.unmarshal(ptr[:n], &req) != nil do return -1
	card, found := cards[req.name]
	r := rng.from_u64(req.seed)
	deck := []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}
	rng.shuffle(&r, deck)
	Response :: struct { found: bool, name: string, cost: []string, types: []string, shuffled: []int }
	out, merr := json.marshal(Response{found, card.name, card.mana_cost.shards, card.card_type.core_types, deck})
	if merr != nil do return -1
	set_result(string(out))
	return len(out)
}
