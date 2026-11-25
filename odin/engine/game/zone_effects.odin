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
	if x.up_to || len(x.conditional_enter_with_counters) > 0 do return false
	if x.enters_attacking && x.destination != .Battlefield do return false
	// "Return it to the battlefield with a +1/+1 counter on it" (CR 122.6): counters it enters with.
	for c in x.enter_with_counters {
		if x.destination != .Battlefield || !counter_kind_supported(c._0) || !quantity_supported(c._1) || quantity_reads_target(c._1) do return false
	}
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
	if _, parent := x.target.(types.TargetFilter_ParentTarget); parent {
		// An Aura returned would need what it enchants chosen as it enters (CR 303.4f): not yet.
		if x.destination != .Battlefield do return true
		return previous_instruction == nil || !may_match_aura(effect_target_filter(previous_instruction^))
	}
	// "Exile it, then return that card to the battlefield": what the instruction before moved (CR 400.7j), after one
	// that moves cards.
	if _, tracked := x.target.(types.TargetFilter_TrackedSet); tracked {
		if previous_instruction == nil || !moves_cards(previous_instruction^) do return false
		if instruction_before_previous != nil && moves_cards(instruction_before_previous^) do return false
		return x.destination != .Battlefield || !may_match_aura(effect_target_filter(previous_instruction^))
	}
	if _, from_graveyard := graveyard_filter(x.target); from_graveyard do return !has_origin || origin == .Graveyard
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
	together := begin_together() // at the same time (CR 603.2c)
	for id in chosen do move_object(g, id, .Hand)
	end_together(together)
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
	s.waiting_for = types.WaitingFor_EffectZoneChoice{player = controller, cards = eligible, count = 1, min_count = 1, source_id = source, effect_kind = .ChangeZone, zone = .Hand, destination = x.destination, enter_tapped = x.enter_tapped, enters_attacking = x.enters_attacking}
	return true
}

// The chosen card goes where the instruction says, under its chooser's control (CR 110.2).
answer_hand_choice :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_EffectZoneChoice, chosen: []types.ObjectId) -> bool {
	if !g.resolution.active || len(chosen) < w.min_count || len(chosen) > w.count || has_duplicates(chosen) do return false
	for id in chosen do if !slice.contains(w.cards[:], id) do return false
	to := w.destination.? or_else .Battlefield
	together := begin_together() // at the same time (CR 603.2c)
	for id in chosen {
		move_object(g, id, to)
		if to == .Battlefield {
			o := object(&g.state, id)
			o.controller = p
			if w.enter_tapped == .Tapped do o.tapped = true
			if w.enters_attacking do enter_attacking(&g.state, o)
		}
	}
	end_together(together)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// Moves the affected object; CR 400.7 makes it a new object in its new zone.
do_change_zone :: proc(g: ^Game, x: types.Effect_ChangeZone, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) {
	s := &g.state
	if _, tracked := x.target.(types.TargetFilter_TrackedSet); tracked {
		// CR 400.7j: an effect that moved an object to a public zone can find it there; one now in a hidden zone (or
		// a token that ceased to exist, CR 111.8) can't be found.
		together := begin_together()
		for id in slice.clone(g.resolution.moved[:], context.temp_allocator) {
			o := object(s, id)
			if o == nil || o.zone == .Hand || o.zone == .Library do continue
			if origin, has := x.origin.?; has && o.zone != origin do continue
			change_zone_of(g, x, o, controller, source)
		}
		end_together(together)
		return
	}
	moved: ^types.GameObject
	if id, ok := target_object(target); ok do moved = object(s, id)
	else if is_self(x.target) do moved = same_source(g, source)
	if moved == nil do return
	if origin, has := x.origin.?; has && moved.zone != origin do return // it left that zone: nothing to move
	if is_self(x.target) && moved.zone == .Stack do return
	change_zone_of(g, x, moved, controller, source)
}

// Moves one object as the instruction says: to its destination, and onto the battlefield under the control, tapped
// and with the counters it names.
@(private = "file")
change_zone_of :: proc(g: ^Game, x: types.Effect_ChangeZone, moved: ^types.GameObject, controller: types.PlayerId, source: types.ObjectId) {
	s := &g.state
	move_object(g, moved.id, x.destination)
	if x.destination == .Battlefield {
		// CR 110.2a: under the control the instruction states: "under your control" (the card data's enters_under),
		// else its owner's ("return that card to the battlefield under its owner's control").
		if _, has := x.enters_under.?; has do moved.controller = controller
		if x.enter_tapped == .Tapped do moved.tapped = true
		// CR 122.6: it enters with the counters the instruction names, as it enters.
		for c in x.enter_with_counters {
			if moved.zone != .Battlefield do break
			n := quantity_value(s, c._1, controller, source, 0)
			if n > 0 do add_counters(moved, c._0, u32(n))
		}
		if x.enters_attacking && moved.zone == .Battlefield do enter_attacking(s, moved)
	}
}

// Instructions that move cards, which "that card" / "those cards" after them can name (resolution.odin's moved):
// exiling, returning, milling. Tokens just made only within a delayed ability ("sacrifice those tokens at the
// beginning of the next end step"): straight after the instruction that makes them, "those" is a leaves-the-
// battlefield ability's (CR 603.6c) the data has lost.
moves_cards :: proc(e: types.Effect) -> bool {
	#partial switch _ in e {
	case types.Effect_ChangeZone, types.Effect_ChangeZoneAll, types.Effect_ExileTop, types.Effect_Bounce, types.Effect_Mill:
		return true
	case types.Effect_Token, types.Effect_CopyTokenOf:
		return checking_delayed
	}
	return false
}

// Instructions whose moved cards a count can read ("for each creature destroyed this way"): any of the above, and
// destroying, sacrificing, discarding (to a graveyard).
moves_counted_cards :: proc(e: types.Effect) -> bool {
	#partial switch _ in e {
	case types.Effect_Destroy, types.Effect_DestroyAll, types.Effect_Sacrifice, types.Effect_Discard:
		return true
	}
	return moves_cards(e)
}

// Whether a filter can match an Aura: one returned to the battlefield is attached as it enters (CR 303.4f), which
// isn't done yet, so such returns are refused.
may_match_aura :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		if len(x._0.type_filters) == 0 do return true
		for t in x._0.type_filters {
			#partial switch y in t {
			case types.TypeFilter_Creature, types.TypeFilter_Land, types.TypeFilter_Artifact, types.TypeFilter_Planeswalker, types.TypeFilter_Battle, types.TypeFilter_Instant, types.TypeFilter_Sorcery:
			case types.TypeFilter_Subtype:
				if y._0 == "Aura" do return true
			case:
				return true // enchantment, permanent, card, any, "non-": could be an Aura
			}
		}
		return false
	case types.TargetFilter_Or:
		for y in x.filters do if may_match_aura(y) do return true
		return false
	}
	return true
}

// "Those cards" after two instructions that both moved cards ("exile target artifact and target creature, then
// return them"): the data's last instruction alone moved only some of them, so this isn't read yet.
@(thread_local)
instruction_before_previous: ^types.Effect

// While a delayed ability's instructions are checked (delayed.odin).
@(thread_local)
checking_delayed: bool
