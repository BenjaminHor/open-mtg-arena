// Double-faced cards that transform (CR 712, 701.27). The card data lists each face as a card of its own; the host
// links them (other_face_lookup). An object made from a front face remembers its other face's name (back_face); while
// it's a permanent with its back face up it has only the back face's characteristics, its mana value still the front
// face's mana cost (CR 712.6d), and everywhere else it's its front face (CR 712.6a).
package game

import types "../types"

// The other face of a double-faced card's entry, set by the host (the card database's link by oracle id).
Other_Face_Lookup :: proc(e: ^types.CardExportEntry) -> ^types.CardExportEntry
other_face_lookup: Other_Face_Lookup

// A transforming double-faced card's back face, if this entry is the front of one.
transform_back_face :: proc(e: ^types.CardExportEntry) -> ^types.CardExportEntry {
	layout, has := e.layout.?
	if !has || layout != "transform" || other_face_lookup == nil do return nil
	if i, has_index := e.face_index.?; !has_index || i != 0 do return nil
	return other_face_lookup(e)
}

// The object made from a card remembers its back face (new_card_object).
note_back_face :: proc(o: ^types.GameObject, card: ^types.CardExportEntry) {
	if back := transform_back_face(card); back != nil do o.back_face = types.BackFaceData{name = back.face.name}
	else if adventure := adventure_face(card); adventure != nil do o.back_face = types.BackFaceData{name = adventure.face.name, card_types = adventure.face.card_type}
	else if back := modal_back_face(card); back != nil do o.back_face = types.BackFaceData{name = back.face.name, card_types = back.face.card_type}
	else if prep := prepare_face(card); prep != nil do o.back_face = types.BackFaceData{name = prep.face.name, card_types = prep.face.card_type} // CR 723.2
}

transform_supported :: proc(x: types.Effect_Transform) -> bool {
	return x.scope == .Single && is_self(x.target) // "transform this" (other targets not yet)
}

// CR 701.27a: the permanent turns so its other face is up; it's the same object (701.27c). Nothing happens if it
// isn't a double-faced card (701.27d) or the other face is an instant or sorcery (701.27e).
transform_permanent :: proc(g: ^Game, o: ^types.GameObject) -> bool {
	if o == nil || o.zone != .Battlefield || o.face_down || g.card_db == nil do return false
	other, has := o.back_face.?
	if !has do return false
	card := g.card_db(other.name)
	if card == nil do return false
	for t in card.face.card_type.core_types do if t == .Instant || t == .Sorcery do return false
	now_up := o.base_name // the face up now, which will be hidden
	now_cost := o.base_mana_cost
	set_card_characteristics(o, &card.face)
	// The hidden face's name, and its mana cost: with the back face up, the front's mana cost is its mana value
	// (CR 712.6d, object_mana_value).
	o.back_face = types.BackFaceData{name = now_up, mana_cost = now_cost}
	o.transformed = !o.transformed
	o.transformation_count += 1
	// CR 613.7g: a double-faced permanent gets a new timestamp each time it transforms.
	o.timestamp = g.state.next_timestamp
	g.state.next_timestamp += 1
	apply_continuous_effects(g)
	return true
}

// CR 712.6a: off the battlefield a transformed card has its front face up again.
turn_front_face_up :: proc(g: ^Game, o: ^types.GameObject) {
	if !o.transformed || g.card_db == nil do return
	other, has := o.back_face.?
	if !has do return
	card := g.card_db(other.name)
	if card == nil do return
	back_name := o.base_name
	set_card_characteristics(o, &card.face)
	o.back_face = types.BackFaceData{name = back_name}
	o.transformed = false
}
