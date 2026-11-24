// Effects that move objects between zones (CR 400.6, 701.4 bounce-style returns, 701.13 exile): "exile target
// creature", "return target creature to its owner's hand", "return target creature card from your graveyard to
// your hand / the battlefield", and the same for "this".
package game

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
	if x.owner_library || x.enter_transformed || x.enters_under != nil || x.enter_tapped == .Untapped do return false
	if x.enters_attacking || x.up_to || len(x.enter_with_counters) > 0 || len(x.conditional_enter_with_counters) > 0 do return false
	if x.face_down_profile != nil || x.enters_modified_if != nil do return false
	#partial switch x.destination {
	case .Hand, .Battlefield, .Graveyard, .Exile:
	case:
		return false
	}
	origin, has_origin := x.origin.?
	if is_self(x.target) do return true
	if _, from_graveyard := graveyard_filter(x.target); from_graveyard do return has_origin && origin == .Graveyard
	// A permanent on the battlefield.
	return (!has_origin || origin == .Battlefield) && x.destination != .Battlefield && filter_supported(x.target)
}

bounce_supported :: proc(x: types.Effect_Bounce) -> bool {
	if d, has := x.destination.?; has && d != .Hand do return false
	return x.selection == .Targeted && filter_supported(x.target)
}

// Graveyard cards matching a filter, as targets for the player choosing.
graveyard_targets :: proc(s: ^types.GameState, f: types.TypedFilter, chooser: types.PlayerId, out: ^[dynamic]types.TargetRef) {
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

// Moves the affected object; CR 400.7 makes it a new object in its new zone.
do_change_zone :: proc(g: ^Game, x: types.Effect_ChangeZone, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) {
	s := &g.state
	moved: ^types.GameObject
	if id, ok := target_object(target); ok do moved = object(s, id)
	else if is_self(x.target) do moved = object(s, source)
	if moved == nil do return
	if origin, has := x.origin.?; has && moved.zone != origin do return // it left that zone: nothing to move
	if is_self(x.target) && moved.zone == .Stack do return
	move_object(g, moved.id, x.destination)
	if x.destination == .Battlefield {
		// CR 110.2: it enters under the control of the player who put it there.
		moved.controller = controller
		if x.enter_tapped == .Tapped do moved.tapped = true
	}
}
