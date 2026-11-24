// O-0 spike: can Odin read card-data.json (98 MB, 36k cards, the parsed card AST the engine runs) fast enough?
// Two ways: a generic JSON tree (json.parse), and typed structs for a few fields (json.unmarshal), which is the shape
// the port would use. Shared by the native timing program (main.odin) and the wasm module (odin/spike/wasm).
package carddata

import "core:encoding/json"

// A few CardFace fields with their serde shapes: mana_cost is internally tagged ({"type": "Cost", ...}), card_type a
// plain struct, power and toughness nullable. The port would decode every field; the spike checks the mechanism.
Mana_Cost :: struct {
	type:    string,
	shards:  []string,
	generic: int,
}

Card_Type :: struct {
	supertypes: []string,
	core_types: []string,
	subtypes:   []string,
}

Card_Face :: struct {
	name:      string,
	mana_cost: Mana_Cost,
	card_type: Card_Type,
	power:     Maybe(json.Value),
	toughness: Maybe(json.Value),
	keywords:  []json.Value,
}

parse_generic :: proc(data: []byte) -> (value: json.Value, err: json.Error) {
	return json.parse(data, json.DEFAULT_SPECIFICATION, parse_integers = true)
}

parse_typed :: proc(data: []byte) -> (cards: map[string]Card_Face, err: json.Unmarshal_Error) {
	err = json.unmarshal(data, &cards)
	return
}
