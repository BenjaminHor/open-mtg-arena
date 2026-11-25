// Conditions of zone-change triggers about the object that moved: "when this land enters untapped", "whenever a
// creature you control dies, if it had a +1/+1 counter on it", "when this dies, if it wasn't a Demon", "if it isn't a
// token", "if that creature's power is greater than this creature's", "if it entered from your graveyard or you cast
// it from your graveyard". The object is read as it was for the event: one that left the battlefield as it last
// existed there (CR 603.10a, 608.2h), one that entered as it is on the battlefield.
package game

import types "../types"

// The trigger whose condition is being checked for support (trigger_supported): what its event moves, so that a
// condition about "it" knows there is such an object and where it went.
Condition_Move :: struct {
	defined:     bool, // the trigger's event moves one object (not a batch, not another kind of event)
	origin:      Maybe(types.Zone),
	destination: Maybe(types.Zone),
}

@(thread_local)
condition_move: Condition_Move
@(thread_local)
condition_mode: types.TriggerMode // the kind of trigger whose condition is being checked for support

// What a trigger's event moves, for its condition: one object, from and to the zones the trigger names.
condition_move_of :: proc(t: types.TriggerDefinition) -> Condition_Move {
	if t.batched do return {}
	#partial switch _ in t.mode {
	case types.TriggerMode_ChangesZone:
		return {defined = true, origin = t.origin, destination = t.destination}
	case types.TriggerMode_LeavesBattlefield:
		return {defined = true, origin = types.Zone.Battlefield, destination = t.destination}
	}
	return {}
}

moved_object_condition_supported :: proc(c: types.TriggerCondition) -> bool {
	m := condition_move
	if !m.defined do return false
	#partial switch x in c {
	case types.TriggerCondition_ZoneChangeObjectIsTapped:
		// "When this land enters untapped": whether it entered tapped (CR 110.5b: a permanent enters untapped unless
		// an effect says otherwise).
		d, has := m.destination.?
		return has && d == .Battlefield
	case types.TriggerCondition_DealtDamageBySourceThisTurn:
		// "Whenever a creature dealt damage by this creature this turn dies": the turn's damage records (CR 120.3),
		// the creature as it last existed (CR 603.10a).
		o, has := m.origin.?
		return has && o == .Battlefield
	case types.TriggerCondition_HadCounters:
		// "If it had a +1/+1 counter on it": the creature as it last existed on the battlefield (CR 603.10a).
		o, has := m.origin.?
		if !has || o != .Battlefield do return false
		if k, has_k := x.counter_type.?; has_k && !counter_kind_supported(k) do return false
		return true
	case types.TriggerCondition_ZoneChangeObjectMatchesFilter:
		// Where it moved: the trigger's own zones, or ones the condition adds ("if it entered from your graveyard").
		if d, has := m.destination.?; !has || d != x.destination do return false
		if o, has := x.origin.?; has {
			if mo, has_mo := m.origin.?; has_mo && mo != o do return false
		}
		typed, is_typed := x.filter.(types.TargetFilter_Typed)
		if !is_typed {
			_, any := x.filter.(types.TargetFilter_Any)
			return any
		}
		for p in typed._0.properties {
			#partial switch y in p {
			case types.FilterProp_Attacking, types.FilterProp_Blocking:
				// "If it wasn't blocking": a creature leaving the battlefield is removed from combat (CR 506.4), and
				// its last known information doesn't keep that.
				return false
			case types.FilterProp_PtComparison:
				// "If that creature's power is greater than this creature's": compared again as it resolves (CR
				// 603.4), with the power it last had on the battlefield if it has left (moved_object_as_was).
				if y.scope != .Current do return false
			case types.FilterProp_AnyOf:
				for q in y.props {
					pt, is_pt := q.(types.FilterProp_PtComparison)
					if !is_pt || pt.scope != .Current do return false
				}
			}
		}
		if len(typed._0.type_filters) == 0 && len(typed._0.properties) == 0 do return true
		return typed_supported(typed._0) || (len(typed._0.type_filters) == 0 && properties_supported(typed._0))
	}
	return false
}

@(private = "file")
properties_supported :: proc(f: types.TypedFilter) -> bool {
	for p in f.properties do if !property_supported(p) do return false
	return f.controller == nil
}

// Whether the filter compares the object's power or toughness, which can change before the ability resolves.
@(private = "file")
compares_stats :: proc(f: types.TargetFilter) -> bool {
	typed, ok := f.(types.TargetFilter_Typed)
	if !ok do return false
	for p in typed._0.properties {
		#partial switch _ in p {
		case types.FilterProp_PtComparison, types.FilterProp_AnyOf:
			return true
		}
	}
	return false
}

moved_object_condition_holds :: proc(s: ^types.GameState, source: types.ObjectId, controller: types.PlayerId, c: types.TriggerCondition) -> bool {
	ev := collecting_event
	#partial switch x in c {
	case types.TriggerCondition_ZoneChangeObjectIsTapped:
		if rechecking_on_resolution do return event_settled(true)
		o := object(s, ev.object)
		return event_settled(o != nil && o.zone == .Battlefield && o.incarnation == ev.incarnation && o.tapped)
	case types.TriggerCondition_DealtDamageBySourceThisTurn:
		if rechecking_on_resolution do return event_settled(true)
		src, was := object(s, source), ev.lki
		if src == nil || was == nil do return event_settled(false)
		for i in 0 ..< types.pvec_len(s.damage_dealt_this_turn) {
			rec := types.pvec_get(s.damage_dealt_this_turn, i)
			if rec.source_id != src.id || (rec.source_incarnation.? or_else src.incarnation) != src.incarnation do continue
			t, is_object := rec.target.(types.TargetRef_Object)
			if is_object && t._0 == ev.object && (rec.target_incarnation.? or_else was.incarnation) == was.incarnation do return event_settled(true)
		}
		return event_settled(false)
	case types.TriggerCondition_HadCounters:
		if rechecking_on_resolution do return event_settled(true)
		n := 0
		if was := ev.lki; was != nil do for k in was.counters {
			if want, has := x.counter_type.?; !has || same_counter(k._0, want) do n += int(k._1)
		}
		return event_settled(n > 0)
	case types.TriggerCondition_ZoneChangeObjectMatchesFilter:
		// What the event itself was (where it came from, what it was then) is settled by the event; a comparison of
		// power or toughness is checked again as it resolves (CR 603.4).
		if !compares_stats(x.filter) {
			if rechecking_on_resolution do return event_settled(true)
			return event_settled(moved_object_matches(s, x, source, controller))
		}
		return moved_object_matches(s, x, source, controller)
	}
	return false
}

@(private = "file")
moved_object_matches :: proc(s: ^types.GameState, x: types.TriggerCondition_ZoneChangeObjectMatchesFilter, source: types.ObjectId, controller: types.PlayerId) -> bool {
	ev := collecting_event
	if !ev.moved || ev.moved_to != x.destination do return false
	if o, has := x.origin.?; has && ev.moved_from != o do return false
	was, ok := moved_object_as_was(s)
	if !ok do return false
	#partial switch f in x.filter {
	case types.TargetFilter_Any:
		return true
	case types.TargetFilter_Typed:
		return object_matches(s, &was, f._0, controller, source)
	}
	return false
}

// The object the trigger event moved, as it was for the event: one that left the battlefield as it last existed
// there, with its controller then (CR 603.10a); one that entered as it is now, or if it has left the battlefield
// since, with the power and toughness it last had there (CR 608.2h; the turn's zone change records keep them).
moved_object_as_was :: proc(s: ^types.GameState) -> (types.GameObject, bool) {
	ev := collecting_event
	if ev.lki != nil {
		was := ev.lki^
		was.controller = ev.object_controller
		return was, true
	}
	o := object(s, ev.object)
	if o != nil && o.incarnation == ev.incarnation do return o^, true
	if o != nil && ev.moved_to != .Battlefield do return o^, true // a card that moved between other zones: its characteristics stay
	for i in ev.zone_change_mark ..< types.pvec_len(s.zone_changes_this_turn) {
		rec := types.pvec_get(s.zone_changes_this_turn, i)
		if rec.object_id != ev.object do continue
		if from, has := rec.from_zone.?; !has || from != .Battlefield do continue
		// As recorded when it left: a token that has since ceased to exist (CR 111.7) has only this.
		was: types.GameObject
		if o != nil do was = o^
		was.id = rec.object_id
		was.card_types.core_types, was.card_types.subtypes, was.card_types.supertypes = rec.core_types, rec.subtypes, rec.supertypes
		was.power, was.toughness = rec.power, rec.toughness
		was.controller, was.owner, was.is_token = rec.controller, rec.owner, rec.is_token
		was.color = rec.colors
		was.zone = .Battlefield
		return was, true
	}
	return {}, false
}

// The data's one zone-change clause as the trigger's own origin, destination and card: "whenever a card leaves your
// graveyard" (from a zone, to any other). Several clauses ("a creature dies or a creature card is put into a
// graveyard from a library") aren't read.
single_clause_view :: proc(t: types.TriggerDefinition) -> (types.TriggerDefinition, bool) {
	if len(t.zone_change_clauses) != 1 || t.origin != nil || t.destination != nil || t.valid_card != nil do return {}, false
	if _, zc := t.mode.(types.TriggerMode_ChangesZone); !zc do return {}, false
	c := t.zone_change_clauses[0]
	origin, equals := c.origin.(types.OriginConstraint_Equals)
	if !equals || c.valid_card == nil do return {}, false
	if c.destination_constraint != nil {
		if _, any := c.destination_constraint.(types.OriginConstraint_Any); !any do return {}, false
	}
	v := t
	v.zone_change_clauses = nil
	v.origin, v.destination, v.valid_card = origin._0, c.destination, c.valid_card
	return v, true
}
