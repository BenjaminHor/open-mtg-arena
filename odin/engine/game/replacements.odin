// Replacement effects (CR 614). Supported: a permanent's own "enters tapped" and "enters with N +1/+1 (or -1/-1)
// counters" (CR 614.1c, 614.12), which change how it enters rather than doing something after.
package game

import types "../types"

replacement_supported :: proc(r: types.ReplacementDefinition) -> bool {
	if _, moved := r.event.(types.ReplacementEvent_Moved); !moved do return false
	if _, mandatory := r.mode.(types.ReplacementMode_Mandatory); !mandatory do return false
	if c, has := r.condition.?; has && !entry_condition_supported(c) do return false
	if r.execute == nil || r.execute.sub_ability != nil || r.execute.condition != nil do return false
	if dest, has := r.destination_zone.?; !has || dest != .Battlefield do return false
	f, has := r.valid_card.?
	if !has || !is_self(f) || r.execute.effect == nil do return false
	#partial switch e in r.execute.effect^ {
	case types.Effect_SetTapState:
		return is_self(e.target) && e.state == .Tap && e.scope == .Single
	case types.Effect_PutCounter:
		_, fixed := fixed_quantity(e.count)
		#partial switch _ in e.counter_type {
		case types.CounterType_Plus1Plus1, types.CounterType_Minus1Minus1:
			return fixed && is_self(e.target)
		}
	}
	return false
}

// "Enters tapped unless ...": the conditions lands check as they enter.
entry_condition_supported :: proc(c: types.ReplacementCondition) -> bool {
	#partial switch x in c {
	case types.ReplacementCondition_CastViaKicker:
		return x.variant == nil && x.kicker_cost == nil // the one kicker cost
	case types.ReplacementCondition_UnlessControlsSubtype, types.ReplacementCondition_UnlessPlayerLifeAtMost,
	     types.ReplacementCondition_UnlessMultipleOpponents, types.ReplacementCondition_UnlessYourTurn:
		return true
	case types.ReplacementCondition_UnlessControlsOtherLeq:
		return typed_supported(x.filter)
	case types.ReplacementCondition_UnlessControlsMatching:
		return mass_filter_supported(x.filter)
	case types.ReplacementCondition_UnlessControlsCountMatching:
		return mass_filter_supported(x.filter)
	}
	return false
}

// Whether the replacement applies to the entering permanent `o`. CR 614.12: it's checked as the permanent would
// enter, so the permanent itself isn't among those its controller already controls.
entry_condition_holds :: proc(s: ^types.GameState, o: ^types.GameObject, c: types.ReplacementCondition) -> bool {
	count :: proc(s: ^types.GameState, o: ^types.GameObject, f: types.TypedFilter) -> int {
		n := 0
		for perm in permanents_of(s, o.controller) do if perm.id != o.id && object_matches(s, perm, f, o.controller, o.id) do n += 1
		return n
	}
	#partial switch x in c {
	case types.ReplacementCondition_UnlessControlsSubtype:
		for perm in permanents_of(s, o.controller) do if perm.id != o.id {
			for name in x.subtypes do if has_subtype(perm, name) do return false
		}
		return true
	case types.ReplacementCondition_UnlessControlsOtherLeq:
		return count(s, o, x.filter) > int(x.count)
	case types.ReplacementCondition_UnlessControlsMatching:
		return count(s, o, x.filter.(types.TargetFilter_Typed)._0) == 0
	case types.ReplacementCondition_UnlessControlsCountMatching:
		return count(s, o, x.filter.(types.TargetFilter_Typed)._0) < int(x.minimum)
	case types.ReplacementCondition_UnlessPlayerLifeAtMost:
		for &p in s.players do if p.life <= i32(x.amount) do return false
		return true
	case types.ReplacementCondition_UnlessMultipleOpponents:
		return len(s.players) <= 2 // a two-player game has one opponent
	case types.ReplacementCondition_UnlessYourTurn:
		return s.active_player != o.controller
	case types.ReplacementCondition_CastViaKicker:
		return kicked(o) // "if it was kicked, it enters with ..." (CR 702.33d)
	}
	return true
}

// CR 614.12: as the permanent enters, its own replacement effects apply.
apply_entering_replacements :: proc(s: ^types.GameState, o: ^types.GameObject) {
	entry, ok := card_entry_of(o)
	if !ok do return
	for r in entry.face.replacements {
		if !replacement_supported(r) do continue
		if c, has := r.condition.?; has && !entry_condition_holds(s, o, c) do continue
		#partial switch e in r.execute.effect^ {
		case types.Effect_SetTapState:
			o.tapped = true
		case types.Effect_PutCounter:
			n, _ := fixed_quantity(e.count)
			add_counters(o, e.counter_type, u32(n))
		}
	}
}

add_counters :: proc(o: ^types.GameObject, kind: types.CounterType, n: u32) {
	for &c in o.counters do if same_counter(c._0, kind) {
		c._1 += n
		return
	}
	append(&o.counters, types.Tuple2(types.CounterType, u32){kind, n})
}

same_counter :: proc(a, b: types.CounterType) -> bool {
	#partial switch _ in a {
	case types.CounterType_Plus1Plus1:
		_, ok := b.(types.CounterType_Plus1Plus1)
		return ok
	case types.CounterType_Minus1Minus1:
		_, ok := b.(types.CounterType_Minus1Minus1)
		return ok
	}
	return false
}
