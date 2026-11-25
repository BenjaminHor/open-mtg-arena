// Amass, CR 701.47a: "If you don't control an Army creature, create a 0/0 black [subtype] Army creature token.
// Choose an Army creature you control. Put N +1/+1 counters on that creature. If it isn't a [subtype], it becomes a
// [subtype] in addition to its other types."
package game

import "core:slice"
import "core:strings"
import types "../types"

amass_supported :: proc(x: types.Effect_Amass) -> bool {
	if x.player != nil && !is_controller(x.player) do return false
	return x.subtype != "" && quantity_supported(x.count) && !quantity_reads_target(x.count)
}

// The Army creatures a player controls.
@(private = "file")
armies_of :: proc(s: ^types.GameState, p: types.PlayerId) -> [dynamic]types.ObjectId {
	out := make([dynamic]types.ObjectId)
	for o in permanents_of(s, p) do if is_type(o, .Creature) && slice.contains(o.card_types.subtypes[:], "Army") do append(&out, o.id)
	return out
}

// Returns true while the player chooses which Army.
do_amass :: proc(g: ^Game, x: types.Effect_Amass, controller: types.PlayerId, source: types.ObjectId) -> bool {
	s := &g.state
	armies := armies_of(s, controller)
	if len(armies) == 0 {
		token := types.Effect_Token {
			name      = strings.concatenate({x.subtype, " Army"}),
			power     = types.PtValue_Fixed{0},
			toughness = types.PtValue_Fixed{0},
			count     = types.QuantityExpr_Fixed{value = 1},
			owner     = types.TargetFilter_Controller{},
		}
		append(&token.types, "Creature", x.subtype, "Army")
		append(&token.colors, types.ManaColor.Black)
		do_effect(g, token, nil, controller, source, nil)
		armies = armies_of(s, controller)
	}
	if len(armies) == 0 do return false
	if len(armies) == 1 {
		amass_onto(g, x, object(s, armies[0]), controller, source)
		return false
	}
	// CR 701.47a: the player chooses which Army.
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_EffectZoneChoice{player = controller, cards = armies, count = 1, min_count = 1, source_id = source, effect_kind = .Amass, zone = .Battlefield}
	return true
}

answer_amass :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_EffectZoneChoice, chosen: []types.ObjectId) -> bool {
	r := &g.resolution
	if !r.active || r.current == nil || len(chosen) != 1 || !slice.contains(w.cards[:], chosen[0]) do return false
	x, is_amass := r.current.effect.(types.Effect_Amass)
	if !is_amass do return false
	amass_onto(g, x, object(&g.state, chosen[0]), r.controller, r.source)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

@(private = "file")
amass_onto :: proc(g: ^Game, x: types.Effect_Amass, army: ^types.GameObject, controller: types.PlayerId, source: types.ObjectId) {
	n := quantity_value(&g.state, x.count, controller, source, 0)
	if n > 0 do add_counters(army, types.CounterType_Plus1Plus1{}, u32(n))
	if !slice.contains(army.card_types.subtypes[:], x.subtype) {
		// "It becomes a [subtype] in addition to its other types", for as long as it's on the battlefield.
		mods := make([dynamic]types.ContinuousModification)
		append(&mods, types.ContinuousModification(types.ContinuousModification_AddSubtype{subtype = x.subtype}))
		append(&g.temp_effects, Temp_Effect{object = army.id, incarnation = army.incarnation, modifications = mods[:], permanent = true})
	}
	apply_continuous_effects(g)
}
