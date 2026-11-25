// Searching a library (CR 701.23) and shuffling (CR 701.24): "Search your library for a basic land card, put it
// onto the battlefield tapped, then shuffle." The search chooses cards; the next instruction moves "those cards";
// the shuffle randomizes the library.
package game

import "core:slice"
import rng "../rng"
import types "../types"

search_supported :: proc(x: types.Effect_SearchLibrary) -> bool {
	for z in x.source_zones do if z != .Library do return false
	if x.target_player != nil || x.split != nil do return false
	if _, plain := x.selection_constraint.(types.SearchSelectionConstraint_None); x.selection_constraint != nil && !plain do return false
	if !search_filter_supported(x.filter) do return false
	_, _, counted := search_count(x)
	return counted
}

// "A basic land card", "a Mountain or Plains card", "a card named X".
@(private = "file")
search_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		return typed_supported(x._0)
	case types.TargetFilter_Or:
		for y in x.filters do if !search_filter_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

// How many cards to find, whether it's "up to", and whether the count is one the engine reads.
search_count :: proc(x: types.Effect_SearchLibrary) -> (n: int, up_to: bool, ok: bool) {
	#partial switch q in x.count {
	case types.QuantityExpr_Fixed:
		return int(q.value), false, true
	case types.QuantityExpr_UpTo:
		if q.max == nil do return
		m, fixed := fixed_quantity(q.max^)
		return m, true, fixed
	}
	return
}

// "Move those cards": a zone change from the library of the cards the search found (its target is written as
// "any").
moves_found_cards :: proc(e: types.Effect) -> bool {
	if p, positions := e.(types.Effect_PutAtLibraryPosition); positions do return is_any(p.target) // "put that card on top"
	x, ok := e.(types.Effect_ChangeZone)
	if !ok do return false
	origin, has := x.origin.?
	return has && origin == .Library && is_any(x.target)
}

// CR 701.23a: the player looks through their library and finds cards that match. CR 701.23b: when the cards have a
// stated quality ("a basic land card"), they may find fewer, even none.
start_search :: proc(g: ^Game, x: types.Effect_SearchLibrary, controller: types.PlayerId, source: types.ObjectId) {
	s := &g.state
	clear(&g.resolution.found)
	n, up_to, _ := search_count(x)
	cards: [dynamic]types.ObjectId
	for id in ids_of(player(s, controller).library) {
		if mass_filter_matches(s, object(s, id), x.filter, controller, source) do append(&cards, id)
	}
	typed, is_typed := x.filter.(types.TargetFilter_Typed)
	any_card := is_typed && len(typed._0.properties) == 0 && len(typed._0.type_filters) == 1 && is_card_filter(typed._0.type_filters[0])
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_SearchChoice {
		player              = controller,
		library_owner       = controller,
		cards               = cards,
		count               = n,
		reveal              = x.reveal,
		up_to               = up_to,
		allows_partial_find = !any_card,
	}
}

@(private = "file")
is_card_filter :: proc(t: types.TypeFilter) -> bool {
	_, ok := t.(types.TypeFilter_Card)
	return ok
}

// The player's finds: up to the count, from the matching cards; "a card" (no stated quality) must be found if the
// library has one (CR 701.23b doesn't apply).
answer_search :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_SearchChoice, chosen: []types.ObjectId) -> bool {
	if !g.resolution.active || len(chosen) > w.count || has_duplicates(chosen) do return false
	for id in chosen do if !slice.contains(w.cards[:], id) do return false
	if !w.up_to && !w.allows_partial_find && len(chosen) < min(w.count, len(w.cards)) do return false
	append(&g.resolution.found, ..chosen)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// Moves the found cards (CR 608.2c: "put it onto the battlefield tapped", "put that card into your hand").
move_found_cards :: proc(g: ^Game, x: types.Effect_ChangeZone, controller: types.PlayerId) {
	s := &g.state
	together := begin_together() // the found cards are put there at the same time (CR 603.2c: one event)
	defer end_together(together)
	for id in g.resolution.found {
		o := object(s, id)
		if o == nil || o.zone != .Library do continue
		move_object(g, id, x.destination)
		if x.destination == .Battlefield {
			o.controller = controller // CR 110.2
			if x.enter_tapped == .Tapped do o.tapped = true
		}
	}
}

// CR 701.24a: shuffling randomizes the library.
shuffle_library :: proc(g: ^Game, p: types.PlayerId) {
	pl := player(&g.state, p)
	library := ids_of(pl.library)
	rng.shuffle(&g.rng, library)
	pl.library = {}
	for id in library do types.pvec_push(&pl.library, id, copy_id)
}
