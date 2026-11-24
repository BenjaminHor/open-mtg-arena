// Resolving a spell or ability (CR 608.2): its instructions are carried out in order. Some instructions ask a
// player to choose (scry, surveil); the resolution pauses there and continues once they answer.
package game

import rng "../rng"
import types "../types"

Resolution :: struct {
	active:     bool,
	next:       ^types.AbilityDefinition, // the next instruction to carry out
	controller: types.PlayerId,
	source:     types.ObjectId,
	targets:    []types.TargetRef,
	legal:      []bool, // which targets are still legal (CR 608.2b)
	slot:       int, // the next target slot
	spell:      types.ObjectId, // an instant or sorcery to put into the graveyard at the end (CR 608.2n), or 0
	stack_id:   types.ObjectId, // an ability's stack object, or 0
	last_target: Maybe(types.TargetRef), // the most recent instruction's target, which "it" in the next refers to
}

// Starts resolving: checks targets (CR 608.2b) and carries out the instructions. False while a player chooses.
start_resolution :: proc(g: ^Game, a: ^types.AbilityDefinition, controller: types.PlayerId, source: types.ObjectId, resolved: ^types.ResolvedAbility, spell: types.ObjectId = 0, stack_id: types.ObjectId = 0) -> bool {
	s := &g.state
	slots := target_slots(a)
	targets := make([]types.TargetRef, len(resolved.targets))
	copy(targets, resolved.targets[:])
	legal := make([]bool, len(targets))
	any_legal := len(slots) == 0
	for t, i in targets do if i < len(slots) && same_object_as_chosen(s, resolved, i) && target_still_legal(s, t, slots[i], controller, source) {
		legal[i] = true
		any_legal = true
	}
	g.resolution = Resolution{true, a, controller, source, targets, legal, 0, spell, stack_id, nil}
	// CR 608.2b: with every target illegal, the spell or ability does nothing.
	if !any_legal do g.resolution.next = nil
	return continue_resolution(g)
}

// Carries out the remaining instructions. False while a player chooses; true once resolved.
continue_resolution :: proc(g: ^Game) -> bool {
	r := &g.resolution
	for r.next != nil {
		x := r.next
		r.next = x.sub_ability
		if x.effect == nil do continue
		target: Maybe(types.TargetRef)
		if _, targets_one := effect_target(x.effect^); targets_one {
			if r.slot < len(r.targets) && r.legal[r.slot] do target = r.targets[r.slot]
			r.slot += 1
			r.last_target = target
			if target == nil do continue // CR 608.2b: an illegal target is unaffected
		} else if refers_to_parent_target(x.effect^) {
			// "Untap target creature. It gains flying": "it" is the previous instruction's target, and an illegal
			// one is unaffected by the rest too (CR 608.2b).
			target = r.last_target
			if target == nil do continue
			if _, of_controller := effect_target_filter(x.effect^).(types.TargetFilter_ParentTargetController); of_controller {
				// "That creature's controller" (its last known controller if it has left, CR 608.2h).
				id, is_object := target_object(target)
				if !is_object do continue
				target = types.TargetRef_Player{object(&g.state, id).controller}
			}
		}
		if do_effect(g, x, r.controller, r.source, target) do return false // waiting for a choice
	}
	if r.spell != 0 do move_object(g, r.spell, .Graveyard) // CR 608.2n
	if r.stack_id != 0 do delete_key(&g.stack_abilities, r.stack_id)
	r^ = {}
	return true
}

// ---- Scry and surveil (CR 701.22, 701.25) --------------------------------------------------------------------

// The top n cards of a library, top first.
top_cards :: proc(p: ^types.Player, n: int) -> [dynamic]types.ObjectId {
	out := make([dynamic]types.ObjectId)
	count := types.pvec_len(p.library)
	for i in 0 ..< min(n, count) do append(&out, types.pvec_get(p.library, count - 1 - i))
	return out
}

// Asks the player; false when there's nothing to look at.
ask_scry :: proc(g: ^Game, p: types.PlayerId, n: int, surveil: bool) -> bool {
	s := &g.state
	cards := top_cards(player(s, p), n)
	if len(cards) == 0 do return false
	s.priority_player = p
	if surveil do s.waiting_for = types.WaitingFor_SurveilChoice{player = p, cards = cards}
	else do s.waiting_for = types.WaitingFor_ScryChoice{player = p, cards = cards}
	return true
}

// CR 701.22a: the cards kept go back on top in the order chosen (first is the top); the others go to the bottom.
// CR 701.25a: surveil puts the others into the graveyard instead.
answer_scry :: proc(g: ^Game, p: types.PlayerId, looked: []types.ObjectId, keep: []types.ObjectId, surveil: bool) -> bool {
	s := &g.state
	if has_duplicates(keep) do return false
	for id in keep {
		found := false
		for l in looked do if l == id do found = true
		if !found do return false
	}
	pl := player(s, p)
	// Take the looked-at cards off the top.
	rest := make([dynamic]types.ObjectId, context.temp_allocator)
	for id in ids_of(pl.library) {
		seen := false
		for l in looked do if l == id do seen = true
		if !seen do append(&rest, id)
	}
	others := make([dynamic]types.ObjectId, context.temp_allocator)
	for id in looked {
		kept := false
		for k in keep do if k == id do kept = true
		if !kept do append(&others, id)
	}
	pl.library = {}
	if !surveil do for id in others do types.pvec_push(&pl.library, id, copy_id) // the bottom is the front
	for id in rest do types.pvec_push(&pl.library, id, copy_id)
	for i := len(keep) - 1; i >= 0; i -= 1 do types.pvec_push(&pl.library, keep[i], copy_id) // first kept ends on top
	if surveil do for id in others {
		// Back in the library list for the zone move to take it from there.
		types.pvec_push(&pl.library, id, copy_id)
		move_object(g, id, .Graveyard)
	}
	s.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// ---- Discard (CR 701.9) -------------------------------------------------------------------------------------

// CR 701.9b: the discarding player chooses which cards, unless the effect says random. A player with no more cards
// than the count discards their hand; nothing to choose.
start_discard :: proc(g: ^Game, p: types.PlayerId, n: int, random: bool, source: types.ObjectId) -> (asked: bool) {
	s := &g.state
	hand := ids_of(player(s, p).hand)
	if n <= 0 || len(hand) == 0 do return false
	if len(hand) <= n {
		for id in hand do move_object(g, id, .Graveyard)
		return false
	}
	if random {
		for _ in 0 ..< n {
			cards := ids_of(player(s, p).hand)
			move_object(g, cards[choose_index(g, len(cards))], .Graveyard)
		}
		return false
	}
	cards: [dynamic]types.ObjectId
	append(&cards, ..hand)
	s.priority_player = p
	s.waiting_for = types.WaitingFor_DiscardChoice{player = p, count = n, cards = cards, source_id = source}
	return true
}

answer_discard :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_DiscardChoice, chosen: []types.ObjectId) -> bool {
	if len(chosen) != w.count || has_duplicates(chosen) do return false
	for id in chosen {
		found := false
		for c in w.cards do if c == id do found = true
		if !found do return false
	}
	for id in chosen do move_object(g, id, .Graveyard)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// ---- Look at the top cards and take some ("dig") ------------------------------------------------------------

// "Look at the top N cards of your library. Put K of them [matching] into your hand and the rest on the bottom of
// your library [or into your graveyard]."
start_dig :: proc(g: ^Game, x: types.Effect_Dig, p: types.PlayerId, controller: types.PlayerId, source: types.ObjectId) -> (asked: bool) {
	s := &g.state
	n := quantity_value(s, x.count, controller, source, 0)
	cards := top_cards(player(s, p), n)
	if len(cards) == 0 do return false
	selectable: [dynamic]types.ObjectId
	for id in cards do if dig_matches(s, x.filter, object(s, id), controller, source) do append(&selectable, id)
	keep, _ := x.keep_count.?
	s.priority_player = p
	s.waiting_for = types.WaitingFor_DigChoice {
		player           = p,
		library_owner    = p,
		cards            = cards,
		keep_count       = int(keep),
		up_to            = x.up_to,
		selectable_cards = selectable,
		kept_destination = x.destination,
		rest_destination = x.rest_destination,
		source_id        = source,
	}
	return true
}

dig_matches :: proc(s: ^types.GameState, f: types.TargetFilter, o: ^types.GameObject, controller: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Any:
		return true
	case types.TargetFilter_Typed:
		plain := x._0
		plain.controller = nil
		return object_matches(s, o, plain, controller, source)
	case types.TargetFilter_Or:
		for y in x.filters do if dig_matches(s, y, o, controller, source) do return true
	}
	return false
}

answer_dig :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_DigChoice, kept: []types.ObjectId) -> bool {
	s := &g.state
	if has_duplicates(kept) || len(kept) > w.keep_count do return false
	// "Up to" may take fewer; otherwise as many as there are to take (CR 107.1c doesn't force the impossible).
	if !w.up_to && len(kept) < min(w.keep_count, len(w.selectable_cards)) do return false
	for id in kept {
		found := false
		for c in w.selectable_cards do if c == id do found = true
		if !found do return false
	}
	pl := player(s, p)
	kept_to, _ := w.kept_destination.?
	rest_to := w.rest_destination.? or_else .Library
	for id in kept do move_object(g, id, kept_to)
	rest := make([dynamic]types.ObjectId, context.temp_allocator)
	for id in w.cards {
		taken := false
		for k in kept do if k == id do taken = true
		if !taken do append(&rest, id)
	}
	if rest_to == .Library {
		// The rest go to the bottom (the front of the list), in the order they were.
		others := make([dynamic]types.ObjectId, context.temp_allocator)
		for id in ids_of(pl.library) {
			looked := false
			for r in rest do if r == id do looked = true
			if !looked do append(&others, id)
		}
		pl.library = {}
		for id in rest do types.pvec_push(&pl.library, id, copy_id)
		for id in others do types.pvec_push(&pl.library, id, copy_id)
	} else {
		for id in rest do move_object(g, id, rest_to)
	}
	s.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

choose_index :: proc(g: ^Game, n: int) -> int {
	return rng.choose_index(&g.rng, n)
}
