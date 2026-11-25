package game

// "Put target creature on top of its owner's library", "put it on the bottom of its owner's library", "then shuffle
// and put that card on top": a card goes to its owner's library at the top or the bottom (CR 401.1: a library is a
// pile in a fixed order; its top is the last card of the list here).

import types "../types"

library_position_supported :: proc(x: types.Effect_PutAtLibraryPosition) -> bool {
	#partial switch _ in x.position {
	case types.LibraryPosition_Top, types.LibraryPosition_Bottom:
	case:
		return false
	}
	if x.arranger != nil do return false
	n, fixed := fixed_quantity(x.count)
	if !fixed || n != 1 do return false
	#partial switch t in x.target {
	case types.TargetFilter_Any:
		return true // the card a search found (ability_supported requires the search before it)
	case types.TargetFilter_SelfRef, types.TargetFilter_ParentTarget:
		return true
	case types.TargetFilter_Typed:
		if _, in_graveyard := graveyard_filter(x.target); in_graveyard do return true
		for p in t._0.properties do if z, in_zone := p.(types.FilterProp_InZone); in_zone && z.zone != .Battlefield do return false
		return filter_supported(x.target) && !may_name_player(x.target)
	}
	return false
}

do_library_position :: proc(g: ^Game, x: types.Effect_PutAtLibraryPosition, source: types.ObjectId, target: Maybe(types.TargetRef)) {
	s := &g.state
	_, top := x.position.(types.LibraryPosition_Top)
	if is_any(x.target) {
		for id in g.resolution.found do put_in_library(g, id, top)
		return
	}
	o: ^types.GameObject
	if is_self(x.target) {
		o = same_source(g, source)
		// "This card": from the battlefield or the graveyard it's in (CR 400.7: the same object only there).
		if o != nil && o.zone != .Battlefield && o.zone != .Graveyard do o = nil
	} else if id, ok := target_object(target); ok {
		o = object(s, id)
	}
	if o == nil || o.zone == .Stack do return
	put_in_library(g, o.id, top)
}

// Puts a card into its owner's library at the top or the bottom (from anywhere, or moving it within the library).
put_in_library :: proc(g: ^Game, id: types.ObjectId, top: bool) {
	s := &g.state
	o := object(s, id)
	if o == nil do return
	pl := player(s, o.owner)
	if o.zone == .Library {
		remove_id(&pl.library, id)
	} else {
		move_object(g, id, .Library) // a new object (CR 400.7), now on top
		if o.zone != .Library do return // a token ceases to exist (CR 111.8, 704.5d)
		remove_id(&pl.library, id)
	}
	if top {
		types.pvec_push(&pl.library, id, copy_id)
		return
	}
	rest := ids_of(pl.library)
	pl.library = {}
	types.pvec_push(&pl.library, id, copy_id) // the bottom is the front of the list
	for r in rest do types.pvec_push(&pl.library, r, copy_id)
}
