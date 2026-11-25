// Sacrificing as an effect (CR 701.21): "sacrifice this", "sacrifice a creature". The player sacrifices their own
// permanents only (CR 701.21a) and chooses which when there's a choice (CR 608.2d).
package game

import "core:slice"
import types "../types"

sacrifice_supported :: proc(x: types.Effect_Sacrifice) -> bool {
	n, fixed := fixed_quantity(x.count)
	if !fixed || n < 1 do return false
	if is_self(x.target) do return n == 1
	typed, ok := x.target.(types.TargetFilter_Typed)
	if !ok || !typed_supported(typed._0) do return false
	c, has := typed._0.controller.?
	if !has do return true
	_, you := c.(types.ControllerRef_You)
	return you
}

// Returns true while the player chooses.
do_sacrifice :: proc(g: ^Game, x: types.Effect_Sacrifice, controller: types.PlayerId, source: types.ObjectId) -> bool {
	s := &g.state
	n, _ := fixed_quantity(x.count)
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
	together := begin_together()
	for id in chosen do sacrifice_permanent(g, id)
	end_together(together)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}
