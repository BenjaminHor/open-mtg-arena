// Adventurer cards (CR 716): a creature (or other permanent) card with an inset Adventure, an instant or sorcery
// with its own name, cost and text. The card data lists the Adventure as a card of its own, linked by oracle id; the
// object remembers it in back_face. Cast as an Adventure, the spell has only the Adventure's characteristics
// (716.3b); as it resolves it's exiled instead of going to the graveyard, and its controller may cast the card from
// exile, not as an Adventure (716.3d). Everywhere else it's the creature (716.4).
package game

import "core:slice"
import types "../types"

// The Adventure of an adventurer card's entry.
adventure_face :: proc(e: ^types.CardExportEntry) -> ^types.CardExportEntry {
	layout, has := e.layout.?
	if !has || layout != "adventure" || other_face_lookup == nil do return nil
	if i, has_index := e.face_index.?; !has_index || i != 0 do return nil
	return other_face_lookup(e)
}

// Whether the object has an Adventure it isn't showing (its creature face up).
has_adventure :: proc(o: ^types.GameObject) -> bool {
	b, has := o.back_face.?
	return has && slice.contains(b.card_types.subtypes[:], "Adventure")
}

// Whether the object shows its Adventure (it's being cast or is on the stack as one).
showing_adventure :: proc(o: ^types.GameObject) -> bool {
	return o.back_face != nil && slice.contains(o.base_card_types.subtypes[:], "Adventure")
}

// The object turns to its Adventure's characteristics (CR 716.3b); the creature's are kept to turn back to.
@(private = "file")
show_adventure :: proc(g: ^Game, o: ^types.GameObject) -> bool {
	if !has_adventure(o) || g.card_db == nil do return false
	adventure := g.card_db(o.back_face.?.name)
	if adventure == nil do return false
	front := types.BackFaceData{name = o.base_name, card_types = o.base_card_types}
	set_card_characteristics(o, &adventure.face)
	o.back_face = front
	return true
}

// Back to the creature (CR 716.4).
show_creature :: proc(card_db: Card_Lookup, o: ^types.GameObject) {
	if !showing_adventure(o) || card_db == nil do return
	front := card_db(o.back_face.?.name)
	if front == nil do return
	adventure := types.BackFaceData{name = o.base_name, card_types = o.base_card_types}
	set_card_characteristics(o, &front.face)
	o.back_face = adventure
}

// Whether the Adventure could be cast now (CR 716.3a: only its characteristics are evaluated).
adventure_castable :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> bool {
	if !adventure_zone_ok(o, p) || !has_adventure(o) do return false
	if !show_adventure(g, o) do return false
	defer show_creature(g.card_db, o)
	return castable(&g.state, p, o, g.card_db)
}

// Where it can be cast as an Adventure: the hand, or exile with an effect's permission to play it, but not the
// permission its own Adventure gave (CR 716.3d: the creature only).
@(private = "file")
adventure_zone_ok :: proc(o: ^types.GameObject, p: types.PlayerId) -> bool {
	if o.zone == .Hand do return true
	_, from_exile := exile_permission(o, p)
	return from_exile
}

// CR 716.3: casting an adventurer card from the hand, the player chooses the creature or the Adventure; asked only
// when both can be cast. True when the cast was handled here (asked, or started as the Adventure).
offer_adventure :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> (handled: bool, ok: bool) {
	if !adventure_zone_ok(o, p) || !has_adventure(o) do return false, false
	adventure := adventure_castable(g, p, o)
	if !adventure do return false, false
	if !castable(&g.state, p, o, g.card_db) do return true, cast_as_adventure(g, p, o)
	g.state.priority_player = p
	g.state.waiting_for = types.WaitingFor_CastOffer{player = p, kind = types.CastOfferKind_Adventure{object_id = o.id, card_id = o.card_id}}
	return true, true
}

answer_adventure_offer :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_CastOffer, creature: bool) -> bool {
	k, is_adventure := w.kind.(types.CastOfferKind_Adventure)
	if !is_adventure || p != w.player do return false
	o := object(&g.state, k.object_id)
	if o == nil do return false
	g.state.waiting_for = types.WaitingFor_Priority{player = p}
	if creature do return cast_spell(g, p, o.id, nil, adventure_decided = true)
	return cast_as_adventure(g, p, o)
}

@(private = "file")
cast_as_adventure :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> bool {
	if !show_adventure(g, o) do return false
	if !cast_spell(g, p, o.id, nil, adventure_decided = true) {
		show_creature(g.card_db, o)
		return false
	}
	return true
}

// CR 716.3d: an Adventure that resolves is exiled, and its controller may cast the creature from exile.
adventure_resolved :: proc(g: ^Game, o: ^types.GameObject) -> bool {
	if !showing_adventure(o) do return false
	controller := o.controller
	move_object(g, o.id, .Exile)
	append(&o.casting_permissions, types.CastingPermission(types.CastingPermission_AdventureCreature{}))
	o.controller = controller
	return true
}

// Whether the player may cast this card from exile after its Adventure (CR 716.3d).
adventure_permission :: proc(o: ^types.GameObject, p: types.PlayerId) -> bool {
	if o.zone != .Exile || o.controller != p do return false
	for c in o.casting_permissions do if _, ok := c.(types.CastingPermission_AdventureCreature); ok do return true
	return false
}
