// Preparation cards (CR 723): a permanent card with an inset "prepare spell", alternative characteristics used only
// for copies (723.3). The card data lists the prepare spell as a card of its own, linked by oracle id; the object
// remembers its name in back_face (the client labels the cast with it). A permanent becomes prepared (723.3a); as it
// does, its controller creates a copy of it in exile with only the prepare spell's characteristics (723.3c), which
// stays in exile while that permanent is on the battlefield and prepared, and which that permanent's controller may
// cast; it loses the designation as the copy becomes cast (601.2i). Otherwise a copy of a card outside the stack and
// the battlefield ceases to exist (704.5e).
package game

import types "../types"

// The prepare spell of a preparation card's entry.
prepare_face :: proc(e: ^types.CardExportEntry) -> ^types.CardExportEntry {
	layout, has := e.layout.?
	if !has || layout != "prepare" || other_face_lookup == nil do return nil
	if i, has_index := e.face_index.?; !has_index || i != 0 do return nil
	return other_face_lookup(e)
}

// Whether the object has a prepare spell (CR 723.2a): a preparation card's permanent, or a copy of one (its
// alternative characteristics are copiable values, 723.2b).
has_prepare_spell :: proc(o: ^types.GameObject) -> bool {
	if o == nil || current_card_db == nil do return false
	b, has := o.back_face.?
	if !has do return false
	card := current_card_db(o.base_name if o.base_name != "" else o.name)
	if card == nil do return false
	prep := prepare_face(card)
	return prep != nil && prep.face.name == b.name
}

// CR 723.3a, 723.3c: the permanent becomes prepared, and its controller creates the copy of its prepare spell in
// exile. Nothing happens to a permanent without a prepare spell, or one already prepared.
become_prepared :: proc(s: ^types.GameState, o: ^types.GameObject) {
	if o == nil || o.prepared != nil || !has_prepare_spell(o) do return
	spell := current_card_db(o.back_face.?.name)
	if spell == nil do return
	o.prepared = types.PreparedState{}
	c := new_card_object(s, spell, o.controller, .Exile)
	c.prepared_copy_source = o.id
	c.back_face = nil
	types.pvec_push(&s.exile, c.id, copy_id)
}

// CR 723.3b: the designation goes; the copy, no longer kept in exile, ceases to exist (704.5e, at the next check of
// state-based actions: remove_departed_copies).
become_unprepared :: proc(o: ^types.GameObject) {
	if o != nil do o.prepared = nil
}

// The prepared permanent a copy in exile belongs to, if it may be cast now: still on the battlefield, still prepared,
// and the player its controller (CR 723.3c).
prepared_source :: proc(s: ^types.GameState, c: ^types.GameObject, p: types.PlayerId) -> (^types.GameObject, bool) {
	src_id, is_copy := c.prepared_copy_source.?
	if !is_copy || c.zone != .Exile do return nil, false
	src := object(s, src_id)
	if src == nil || src.zone != .Battlefield || src.prepared == nil || src.controller != p do return nil, false
	return src, true
}

// The copy a prepared permanent made, in exile.
prepared_copy_of :: proc(s: ^types.GameState, source: types.ObjectId) -> ^types.GameObject {
	for id in ids_of(s.exile) {
		c := object(s, id)
		if src, is_copy := c.prepared_copy_source.?; is_copy && src == source do return c
	}
	return nil
}

// CR 704.5e (with 723.3c's exception): a prepared copy outside the stack ceases to exist, unless it's in exile while
// its permanent is on the battlefield and prepared. True when one did.
remove_departed_copies :: proc(g: ^Game) -> bool {
	s := &g.state
	removed := false
	lists := make([dynamic]^types.PVec(types.ObjectId), context.temp_allocator)
	append(&lists, &s.exile)
	for &p in s.players do append(&lists, &p.hand, &p.graveyard, &p.library)
	for list in lists {
		keep := make([dynamic]types.ObjectId, context.temp_allocator)
		gone := false
		for id in ids_of(list^) {
			c := object(s, id)
			src_id, is_copy := c.prepared_copy_source.?
			stays := !is_copy
			if is_copy && c.zone == .Exile {
				src := object(s, src_id)
				stays = src != nil && src.zone == .Battlefield && src.prepared != nil
			}
			if stays do append(&keep, id)
			else do gone = true
		}
		if gone {
			list^ = {}
			for id in keep do types.pvec_push(list, id, copy_id)
			removed = true
		}
	}
	return removed
}

// "It becomes prepared" / "it becomes unprepared": the permanent itself.
prepare_effect_supported :: proc(target: types.TargetFilter, scope: types.EffectScope) -> bool {
	return scope == .Single && is_self(target)
}
