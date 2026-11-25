// Modal double-faced cards (CR 712.1, 712.3): a full card face on each side. Cast, the player chooses which face
// (712.8b); played as a land, a face that's a land (712.9). On the stack and the battlefield the object has the
// face that's up (712.6e); everywhere else its front face (712.6a). The card data lists each face as a card of its
// own, linked by oracle id; the object remembers its other face in back_face, and modal_back_face says the back is up.
package game

import types "../types"

// The back face of a modal double-faced card's entry.
modal_back_face :: proc(e: ^types.CardExportEntry) -> ^types.CardExportEntry {
	layout, has := e.layout.?
	if !has || layout != "modal_dfc" || other_face_lookup == nil do return nil
	if i, has_index := e.face_index.?; !has_index || i != 0 do return nil
	return other_face_lookup(e)
}

// Whether the object is a modal double-faced card.
is_mdfc :: proc(o: ^types.GameObject) -> bool {
	if o.back_face == nil || current_card_db == nil do return false
	e := current_card_db(o.base_name)
	if e == nil do return false
	layout, has := e.layout.?
	return has && layout == "modal_dfc"
}

// Turns the other face up (only the characteristics; the object is the same).
@(private = "file")
turn_other_face_up :: proc(card_db: Card_Lookup, o: ^types.GameObject) -> bool {
	other, has := o.back_face.?
	if !has || card_db == nil do return false
	card := card_db(other.name)
	if card == nil do return false
	hidden := types.BackFaceData{name = o.base_name, card_types = o.base_card_types}
	set_card_characteristics(o, &card.face)
	o.back_face = hidden
	o.modal_back_face = !o.modal_back_face
	return true
}

// CR 712.6a: the front face again, off the stack and battlefield.
mdfc_front_up :: proc(card_db: Card_Lookup, o: ^types.GameObject) {
	if o.modal_back_face do turn_other_face_up(card_db, o)
}

// What can be done with each face now: cast it, or play it as a land.
@(private = "file")
face_usable :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> bool {
	if is_type(o, .Land) do return can_play_land(g, p, o) && object_supported(o, g.card_db)
	return castable(&g.state, p, o, g.card_db)
}

mdfc_faces_usable :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> (front, back: bool) {
	// From the hand, or exile with a permission to play it (CR 712.8b, 712.9 apply however it's cast or played).
	_, from_exile := exile_permission(o, p)
	if !(o.zone == .Hand || from_exile) || o.modal_back_face || !is_mdfc(o) do return
	front = face_usable(g, p, o)
	if turn_other_face_up(g.card_db, o) {
		back = face_usable(g, p, o)
		turn_other_face_up(g.card_db, o)
	}
	return
}

// Casting or playing a modal double-faced card from the hand: the face, asked when both can be used. True when
// handled here.
offer_modal_face :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> (handled: bool, ok: bool) {
	front, back := mdfc_faces_usable(g, p, o)
	if !back do return false, false // the front face as usual (or nothing)
	if !front do return true, use_face(g, p, o, true)
	g.state.priority_player = p
	g.state.waiting_for = types.WaitingFor_ModalFaceChoice{player = p, object_id = o.id, card_id = o.card_id}
	return true, true
}

answer_modal_face :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ModalFaceChoice, back: bool) -> bool {
	o := object(&g.state, w.object_id)
	if o == nil || p != w.player do return false
	front_ok, back_ok := mdfc_faces_usable(g, p, o)
	if (back && !back_ok) || (!back && !front_ok) do return false
	g.state.waiting_for = types.WaitingFor_Priority{player = p}
	return use_face(g, p, o, back)
}

@(private = "file")
use_face :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, back: bool) -> bool {
	if back && !turn_other_face_up(g.card_db, o) do return false
	ok: bool
	if is_type(o, .Land) do ok = play_land(g, p, o.id, face_decided = true) // CR 712.9
	else do ok = cast_spell(g, p, o.id, nil, adventure_decided = true, face_decided = true) // CR 712.8b
	if !ok && back && o.zone == .Hand do turn_other_face_up(g.card_db, o)
	return ok
}
