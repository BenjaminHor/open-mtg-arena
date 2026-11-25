// Searching a library (CR 701.23) and shuffling (CR 701.24): "Search your library for a basic land card, put it
// onto the battlefield tapped, then shuffle." The search chooses cards; the next instruction moves "those cards";
// the shuffle randomizes the library.
package game

import "core:slice"
import rng "../rng"
import types "../types"

search_supported :: proc(x: types.Effect_SearchLibrary) -> bool {
	for z in x.source_zones do if z != .Library do return false
	if x.target_player != nil do return false
	if split, has := x.split.?; has && !search_split_supported(split, x) do return false
	if !search_constraint_supported(x.selection_constraint) do return false
	if !search_filter_supported(x.filter) do return false
	_, _, counted := search_count(x)
	return counted
}

// "With different names" (CR 701.23a: the cards found must fit the search's description, taken together): the only
// constraint on the cards together read yet.
@(private = "file")
search_constraint_supported :: proc(c: types.SearchSelectionConstraint) -> bool {
	switch x in c {
	case types.SearchSelectionConstraint_None:
		return true
	case types.SearchSelectionConstraint_SharesQualities:
		return x.relation == .DoesNotShare && len(x.qualities) == 1 && x.qualities[0] == .Name
	case types.SearchSelectionConstraint_TotalManaValue, types.SearchSelectionConstraint_MatchEachFilter:
		return false
	}
	return true // none
}

// Whether the chosen cards have different names, when the search asks for that.
names_differ :: proc(s: ^types.GameState, c: types.SearchSelectionConstraint, chosen: []types.ObjectId) -> bool {
	if _, differ := c.(types.SearchSelectionConstraint_SharesQualities); !differ do return true
	for a, i in chosen do for b in chosen[i + 1:] do if object(s, a).name == object(s, b).name do return false
	return true
}

// "Put one onto the battlefield tapped and the other into your hand" (Cultivate), "put one into your hand and the
// other into your graveyard" (Final Parting): the found cards split between two zones, chosen after the search.
@(private = "file")
search_split_supported :: proc(split: types.SearchDestinationSplit, x: types.Effect_SearchLibrary) -> bool {
	n, _, ok := search_count(x)
	if !ok || split.primary_count < 1 || int(split.primary_count) >= n do return false
	for z in ([]types.Zone{split.primary_destination, split.rest_destination}) {
		#partial switch z {
		case .Hand, .Graveyard, .Battlefield:
		case:
			return false
		}
	}
	// Onto the battlefield: only permanent cards can be put there (a filter naming permanent types), and not an Aura,
	// whose host would be chosen as it enters (CR 303.4f): not asked yet.
	if (split.primary_destination == .Battlefield || split.rest_destination == .Battlefield) && (!filter_names_permanents_or(x.filter) || may_match_aura(x.filter)) do return false
	return true
}

// filter_names_permanents, for any of several kinds ("a basic land card or a Gate card").
@(private = "file")
filter_names_permanents_or :: proc(f: types.TargetFilter) -> bool {
	if or, is_or := f.(types.TargetFilter_Or); is_or {
		for y in or.filters do if !filter_names_permanents(y) do return false
		return len(or.filters) > 0
	}
	return filter_names_permanents(f)
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

// How many cards to find, whether it's "up to", and whether the count is one the engine reads. "Up to X, where X is
// the greatest power among creatures you control" is worked out as the search begins (CR 608.2h); without a state
// (checking support) it's 0.
search_count :: proc(x: types.Effect_SearchLibrary, s: ^types.GameState = nil, controller: types.PlayerId = 0, source: types.ObjectId = 0) -> (n: int, up_to: bool, ok: bool) {
	#partial switch q in x.count {
	case types.QuantityExpr_Fixed:
		return int(q.value), false, true
	case types.QuantityExpr_UpTo:
		if q.max == nil do return
		if m, fixed := fixed_quantity(q.max^); fixed do return m, true, true
		if s != nil do return max(quantity_value(s, q.max^, controller, source, 0), 0), true, true
		return 0, true, quantity_supported(q.max^) && !quantity_reads_target(q.max^)
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
	n, up_to, _ := search_count(x, s, controller, source)
	g.search_split = x.split
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
		constraint          = x.selection_constraint,
		split               = x.split,
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
	if !names_differ(&g.state, w.constraint, chosen) do return false // "with different names"
	append(&g.resolution.found, ..chosen)
	g.state.waiting_for = nil
	if split, has := g.search_split.?; has {
		// CR 608.2c: "put one onto the battlefield tapped and the other into your hand": the player chooses which,
		// when more than one was found; fewer go where the first part says (the rulings on Cultivate and Jarad's
		// Orders).
		if len(chosen) > int(split.primary_count) {
			cards := make([dynamic]types.ObjectId)
			append(&cards, ..chosen)
			g.state.priority_player = p
			g.state.waiting_for = types.WaitingFor_SearchPartitionChoice {
				player               = p,
				cards                = cards,
				primary_destination  = split.primary_destination,
				primary_count        = split.primary_count,
				primary_enter_tapped = split.primary_enter_tapped,
				rest_destination     = split.rest_destination,
				source_id            = g.resolution.source,
			}
			return true
		}
		place_split(g, p, split, chosen, nil)
	}
	if continue_resolution(g) do after_resolution(g)
	return true
}

// The player's choice of which found cards go where the split's first part says: exactly that many of them.
answer_search_partition :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_SearchPartitionChoice, primary: []types.ObjectId) -> bool {
	split, has := g.search_split.?
	if !g.resolution.active || !has || len(primary) != int(w.primary_count) || has_duplicates(primary) do return false
	for id in primary do if !slice.contains(w.cards[:], id) do return false
	rest := make([dynamic]types.ObjectId, context.temp_allocator)
	for id in w.cards do if !slice.contains(primary, id) do append(&rest, id)
	place_split(g, p, split, primary, rest[:])
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// Puts the found cards where the split says, at the same time (one event, CR 603.2c): onto the battlefield under
// the searcher's control (CR 110.2), tapped if it says so (CR 110.5b: it enters tapped; it doesn't become tapped).
@(private = "file")
place_split :: proc(g: ^Game, p: types.PlayerId, split: types.SearchDestinationSplit, primary: []types.ObjectId, rest: []types.ObjectId) {
	together := begin_together()
	defer end_together(together)
	for id in primary do put_found_card(g, p, id, split.primary_destination, split.primary_enter_tapped == .Tapped)
	for id in rest do put_found_card(g, p, id, split.rest_destination, false)
	g.search_split = nil
}

@(private = "file")
put_found_card :: proc(g: ^Game, p: types.PlayerId, id: types.ObjectId, zone: types.Zone, tapped: bool) {
	o := object(&g.state, id)
	if o == nil || o.zone != .Library do return
	move_object(g, id, zone)
	if zone == .Battlefield && o.zone == .Battlefield {
		o.controller = p
		if tapped do o.tapped = true
	}
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
