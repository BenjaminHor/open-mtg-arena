// Sacrificing as an effect (CR 701.21): "sacrifice this", "sacrifice a creature". The player sacrifices their own
// permanents only (CR 701.21a) and chooses which when there's a choice (CR 608.2d).
package game

import "core:slice"
import types "../types"

sacrifice_supported :: proc(x: types.Effect_Sacrifice) -> bool {
	n, fixed := fixed_quantity(x.count)
	if !fixed || n < 1 do return false
	if is_self(x.target) do return n == 1
	if _, parent := x.target.(types.TargetFilter_ParentTarget); parent do return n == 1 // "sacrifice it"
	// "Sacrifice those tokens": what an earlier instruction made or moved (a delayed ability's, delayed.odin).
	if _, tracked := x.target.(types.TargetFilter_TrackedSet); tracked do return previous_instruction != nil && moves_cards(previous_instruction^)
	typed, ok := x.target.(types.TargetFilter_Typed)
	if !ok || !typed_supported(typed._0) do return false
	c, has := typed._0.controller.?
	if !has do return true
	_, you := c.(types.ControllerRef_You)
	return you
}

// Returns true while the player chooses.
do_sacrifice :: proc(g: ^Game, x: types.Effect_Sacrifice, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef) = nil) -> bool {
	s := &g.state
	n, _ := fixed_quantity(x.count)
	if _, parent := x.target.(types.TargetFilter_ParentTarget); parent {
		// "Sacrifice it": that permanent, if its controller is this player (CR 701.21a).
		if id, ok := target_object(target); ok {
			if o := object(s, id); o != nil && o.zone == .Battlefield && o.controller == controller do sacrifice_permanent(g, id)
		}
		return false
	}
	if _, tracked := x.target.(types.TargetFilter_TrackedSet); tracked {
		// Each of them still the same permanent, under this player's control (CR 701.21a), at once.
		together := begin_together()
		defer end_together(together)
		for id in slice.clone(g.resolution.moved[:], context.temp_allocator) {
			if o := object(s, id); o != nil && o.zone == .Battlefield && o.controller == controller do sacrifice_permanent(g, id)
		}
		return false
	}
	if is_self(x.target) {
		// "Sacrifice this": only while it's still the same permanent, under this player's control.
		if o := same_source(g, source); o != nil && o.zone == .Battlefield && o.controller == controller do sacrifice_permanent(g, source)
		return false
	}
	typed := x.target.(types.TargetFilter_Typed)._0
	eligible: [dynamic]types.ObjectId
	for o in permanents_of(s, controller) do if object_matches(s, o, typed, controller, source) do append(&eligible, o.id)
	if len(eligible) <= n {
		together := begin_together()
		defer end_together(together)
		for id in eligible do sacrifice_permanent(g, id)
		return false
	}
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_EffectZoneChoice{player = controller, cards = eligible, count = n, min_count = n, source_id = source, effect_kind = .Sacrifice, zone = .Battlefield}
	return true
}

answer_sacrifice :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_EffectZoneChoice, chosen: []types.ObjectId) -> bool {
	if !g.resolution.active || w.effect_kind != .Sacrifice || len(chosen) != w.count || has_duplicates(chosen) do return false
	for id in chosen do if !slice.contains(w.cards[:], id) do return false
	scoped := join_scope_moves(g) // one of "each player sacrifices": the instruction's event (CR 603.2c)
	together := begin_together()
	for id in chosen do sacrifice_permanent(g, id)
	end_together(together)
	end_together(scoped)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}
