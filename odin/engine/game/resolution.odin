// Resolving a spell or ability (CR 608.2): its instructions are carried out in order. Some instructions ask a
// player to choose (scry, surveil); the resolution pauses there and continues once they answer.
package game

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
	g.resolution = Resolution{true, a, controller, source, targets, legal, 0, spell, stack_id}
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
			if target == nil do continue // CR 608.2b: an illegal target is unaffected
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
