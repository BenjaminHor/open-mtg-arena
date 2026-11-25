// Effects that move objects between zones (CR 400.6, 701.4 bounce-style returns, 701.13 exile): "exile target
// creature", "return target creature to its owner's hand", "return target creature card from your graveyard to
// your hand / the battlefield", and the same for "this".
package game

import "core:slice"
import types "../types"

// A target in a graveyard: "target creature card in your graveyard" (CR 115.1, 400.3).
graveyard_filter :: proc(f: types.TargetFilter) -> (types.TypedFilter, bool) {
	t, typed := f.(types.TargetFilter_Typed)
	if !typed do return {}, false
	in_graveyard := false
	for p in t._0.properties {
		#partial switch x in p {
		case types.FilterProp_InZone:
			if x.zone != .Graveyard do return {}, false
			in_graveyard = true
		case types.FilterProp_Owned:
			#partial switch _ in x.controller {
			case types.ControllerRef_You, types.ControllerRef_Opponent:
			case:
				return {}, false
			}
		case:
			if !property_supported(p) do return {}, false
		}
	}
	for tf in t._0.type_filters do if !type_filter_supported(tf) do return {}, false
	return t._0, in_graveyard
}

change_zone_supported :: proc(x: types.Effect_ChangeZone) -> bool {
	if _, controller := x.actor.(types.LibraryInstructionActor_Controller); x.actor != nil && !controller do return false
	if x.owner_library || x.enter_transformed || x.enter_tapped == .Untapped do return false
	if under, has := x.enters_under.?; has {
		// "Under your control": the controller of the ability, as the engine already puts it (CR 110.2).
		if _, you := under.(types.ControllerRef_You); !you do return false
	}
	if x.enters_attacking || x.up_to || len(x.enter_with_counters) > 0 || len(x.conditional_enter_with_counters) > 0 do return false
	if x.face_down_profile != nil || x.enters_modified_if != nil do return false
	#partial switch x.destination {
	case .Hand, .Battlefield, .Graveyard, .Exile:
	case:
		return false
	}
	origin, has_origin := x.origin.?
	if _, from_hand := hand_choice(x); from_hand do return x.destination != .Hand
	if is_self(x.target) do return true
	if has_origin && origin == .Library && is_any(x.target) do return x.destination != .Library // the found cards
	// "Return it to the battlefield": the earlier instruction's target, wherever that put it (CR 608.2c).
	if _, parent := x.target.(types.TargetFilter_ParentTarget); parent do return true
	if _, from_graveyard := graveyard_filter(x.target); from_graveyard do return has_origin && origin == .Graveyard
	if either, is_or := x.target.(types.TargetFilter_Or); is_or && has_origin && origin == .Graveyard {
		// "Target instant or sorcery card from your graveyard".
		for f in either.filters do if _, ok := graveyard_filter(f); !ok do return false
		return len(either.filters) > 0
	}
	// A permanent on the battlefield.
	return (!has_origin || origin == .Battlefield) && x.destination != .Battlefield && filter_supported(x.target) && !may_name_player(x.target)
}

bounce_supported :: proc(x: types.Effect_Bounce) -> bool {
	if d, has := x.destination.?; has && d != .Hand do return false
	if is_self(x.target) do return true // "return this to its owner's hand"
	if x.selection == .Targeted do return filter_supported(x.target) && !may_name_player(x.target)
	// "Return a creature you control to its owner's hand": chosen as it resolves (CR 608.2d), from the player's own.
	typed, ok := x.target.(types.TargetFilter_Typed)
	if !ok || !typed_supported(typed._0) do return false
	c, has := typed._0.controller.?
	_, you := c.(types.ControllerRef_You)
	return has && you
}

// Returns true while the player chooses.
do_bounce :: proc(g: ^Game, x: types.Effect_Bounce, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> bool {
	s := &g.state
	if is_self(x.target) {
		// CR 400.7: only while it's the same object, from the battlefield or the graveyard it went to.
		if o := same_source(g, source); o != nil && (o.zone == .Battlefield || o.zone == .Graveyard) do move_object(g, o.id, .Hand)
		return false
	}
	if x.selection == .Targeted {
		if id, ok := target_object(target); ok && object(s, id).zone == .Battlefield do move_object(g, id, .Hand)
		return false
	}
	typed := x.target.(types.TargetFilter_Typed)._0
	eligible: [dynamic]types.ObjectId
	for o in permanents_of(s, controller) do if object_matches(s, o, typed, controller, source) do append(&eligible, o.id)
	if len(eligible) <= 1 {
		for id in eligible do move_object(g, id, .Hand)
		return false
	}
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_EffectZoneChoice{player = controller, cards = eligible, count = 1, min_count = 1, source_id = source, effect_kind = .Bounce, zone = .Battlefield, destination = .Hand}
	return true
}

answer_bounce :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_EffectZoneChoice, chosen: []types.ObjectId) -> bool {
	if !g.resolution.active || len(chosen) != w.count || has_duplicates(chosen) do return false
	for id in chosen do if !slice.contains(w.cards[:], id) do return false
	for id in chosen do move_object(g, id, .Hand)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// Graveyard cards matching a filter, as targets for the player choosing.
// `source` is left out: a spell cast from a graveyard (flashback) can't target itself (CR 115.5).
graveyard_targets :: proc(s: ^types.GameState, f: types.TypedFilter, chooser: types.PlayerId, source: types.ObjectId, out: ^[dynamic]types.TargetRef) {
	for p in s.players {
		owned_ok := true
		for prop in f.properties do if owned, ok := prop.(types.FilterProp_Owned); ok {
			#partial switch _ in owned.controller {
			case types.ControllerRef_You:
				owned_ok = p.id == chooser
			case types.ControllerRef_Opponent:
				owned_ok = p.id != chooser
			}
		}
		if c, has := f.controller.?; has {
			#partial switch _ in c {
			case types.ControllerRef_You:
				owned_ok = owned_ok && p.id == chooser
			case types.ControllerRef_Opponent:
				owned_ok = owned_ok && p.id != chooser
			}
		}
		if !owned_ok do continue
		for id in ids_of(p.graveyard) {
			if id == source do continue
			o := object(s, id)
			plain := f
			plain.controller = nil // a card's owner was checked above; in a graveyard it has no controller as such
			if object_matches(s, o, plain, chooser, 0) do append(out, types.TargetRef_Object{id})
		}
	}
}

// A card's types outside the battlefield; "permanent card" means any card that isn't an instant or sorcery.
card_matches_type :: proc(o: ^types.GameObject, t: types.TypeFilter) -> bool {
	if _, permanent := t.(types.TypeFilter_Permanent); permanent do return is_permanent_card(o)
	return matches_type(o, t)
}

// "Put a land card from your hand onto the battlefield": a card the player chooses from their own hand as the
// instruction is carried out, not a target (CR 115.10a: only what the text calls "target" is one; CR 608.2d).
hand_choice :: proc(x: types.Effect_ChangeZone) -> (types.TypedFilter, bool) {
	origin, has := x.origin.?
	if !has || origin != .Hand do return {}, false
	t, typed := x.target.(types.TargetFilter_Typed)
	if !typed do return {}, false
	in_hand := false
	for p in t._0.properties {
		#partial switch y in p {
		case types.FilterProp_InZone:
			if y.zone != .Hand do return {}, false
			in_hand = true
		case:
			if !property_supported(p) do return {}, false
		}
	}
	if c, has_c := t._0.controller.?; has_c {
		if _, you := c.(types.ControllerRef_You); !you do return {}, false
	}
	for tf in t._0.type_filters do if !type_filter_supported(tf) do return {}, false
	return t._0, in_hand
}

// Asks the player which card of their hand to move; false when there's none to choose (nothing happens).
start_hand_choice :: proc(g: ^Game, x: types.Effect_ChangeZone, controller: types.PlayerId, source: types.ObjectId) -> bool {
	s := &g.state
	f, _ := hand_choice(x)
	eligible: [dynamic]types.ObjectId
	for id in ids_of(player(s, controller).hand) do if object_matches(s, object(s, id), f, controller, source) do append(&eligible, id)
	if len(eligible) == 0 do return false
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_EffectZoneChoice{player = controller, cards = eligible, count = 1, min_count = 1, source_id = source, effect_kind = .ChangeZone, zone = .Hand, destination = x.destination, enter_tapped = x.enter_tapped}
	return true
}

// The chosen card goes where the instruction says, under its chooser's control (CR 110.2).
answer_hand_choice :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_EffectZoneChoice, chosen: []types.ObjectId) -> bool {
	if !g.resolution.active || len(chosen) < w.min_count || len(chosen) > w.count || has_duplicates(chosen) do return false
	for id in chosen do if !slice.contains(w.cards[:], id) do return false
	to := w.destination.? or_else .Battlefield
	for id in chosen {
		move_object(g, id, to)
		if to == .Battlefield {
			o := object(&g.state, id)
			o.controller = p
			if w.enter_tapped == .Tapped do o.tapped = true
		}
	}
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// Moves the affected object; CR 400.7 makes it a new object in its new zone.
do_change_zone :: proc(g: ^Game, x: types.Effect_ChangeZone, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) {
	s := &g.state
	moved: ^types.GameObject
	if id, ok := target_object(target); ok do moved = object(s, id)
	else if is_self(x.target) do moved = same_source(g, source)
	if moved == nil do return
	if origin, has := x.origin.?; has && moved.zone != origin do return // it left that zone: nothing to move
	if is_self(x.target) && moved.zone == .Stack do return
	move_object(g, moved.id, x.destination)
	if x.destination == .Battlefield {
		// CR 110.2a: under the control the instruction states: "under your control" (the card data's enters_under),
		// else its owner's ("return that card to the battlefield under its owner's control").
		if _, has := x.enters_under.?; has do moved.controller = controller
		if x.enter_tapped == .Tapped do moved.tapped = true
	}
}
