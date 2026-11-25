// Replacement effects (CR 614). Supported: a permanent's own "enters tapped" and "enters with N +1/+1 (or -1/-1)
// counters" (CR 614.1c, 614.12), which change how it enters rather than doing something after.
package game

import "core:reflect"
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
		// A number, or an amount as it enters: "X +1/+1 counters" (the spell's X, CR 107.3m), "a counter for each".
		amount_ok := quantity_supported(e.count) && !quantity_reads_target(e.count)
		#partial switch _ in e.counter_type {
		case types.CounterType_Plus1Plus1, types.CounterType_Minus1Minus1, types.CounterType_Lore:
			// Lore: a Saga enters with a lore counter (CR 715.3a).
			return amount_ok && is_self(e.target)
		}
	}
	return false
}

// "Enters tapped unless ...": the conditions lands check as they enter.
entry_condition_supported :: proc(c: types.ReplacementCondition) -> bool {
	#partial switch x in c {
	case types.ReplacementCondition_CastViaKicker:
		return x.variant == nil && x.kicker_cost == nil // the one kicker cost
	case types.ReplacementCondition_OnlyIfQuantity:
		// "Enters with a +1/+1 counter if an opponent lost life this turn" (CR 614.1c).
		return x.active_player_req == nil && quantity_supported(x.lhs) && quantity_supported(x.rhs)
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
	case types.ReplacementCondition_OnlyIfQuantity:
		// CR 614.12: read as it's about to enter; it isn't among the permanents counted (not yet on the battlefield).
		return compare(quantity_value(s, x.lhs, o.controller, o.id, 0), x.comparator, quantity_value(s, x.rhs, o.controller, o.id, 0))
	case types.ReplacementCondition_CastViaKicker:
		return kicked(o) // "if it was kicked, it enters with ..." (CR 702.33d)
	}
	return true
}

// CR 614.12: as the permanent enters, its own replacement effects apply.
apply_entering_replacements :: proc(s: ^types.GameState, o: ^types.GameObject) {
	if o.replacement_definitions == nil do return
	// CR 107.3m: an X in its replacement effects is the X of the spell it was.
	x_defined = has_x(o.mana_cost)
	defer x_defined = false
	for r in (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^ {
		if !replacement_supported(r) do continue
		if c, has := r.condition.?; has && !entry_condition_holds(s, o, c) do continue
		#partial switch e in r.execute.effect^ {
		case types.Effect_SetTapState:
			o.tapped = true
		case types.Effect_PutCounter:
			n := quantity_value(s, e.count, o.controller, o.id, 0)
			if n > 0 do add_counters(o, e.counter_type, u32(n))
		}
	}
}

// Puts counters on an object: an event abilities trigger on ("whenever one or more +1/+1 counters are put on",
// a Saga's chapters), including the counters a permanent enters with (CR 122.6).
add_counters :: proc(o: ^types.GameObject, kind: types.CounterType, n: u32) {
	if n == 0 do return
	before := counter_count(o, kind)
	if action_events != nil do append(action_events, Event{kind = .Counter_Added, object = o.id, controller = o.controller, counter = kind, amount = int(n), before = int(before)})
	for &c in o.counters do if same_counter(c._0, kind) {
		c._1 += n
		return
	}
	append(&o.counters, types.Tuple2(types.CounterType, u32){kind, n})
}

// Whether two counters are of the same kind (CR 122.1): the same kind of counter, and for keyword and named
// counters the same keyword or name.
same_counter :: proc(a, b: types.CounterType) -> bool {
	if reflect.union_variant_typeid(a) != reflect.union_variant_typeid(b) do return false
	#partial switch x in a {
	case types.CounterType_Keyword:
		return x._0 == b.(types.CounterType_Keyword)._0
	case types.CounterType_Generic:
		return x._0 == b.(types.CounterType_Generic)._0
	case types.CounterType_PowerToughness:
		y := b.(types.CounterType_PowerToughness)
		return x.power == y.power && x.toughness == y.toughness
	}
	return true
}

counter_count :: proc(o: ^types.GameObject, kind: types.CounterType) -> u32 {
	for c in o.counters do if same_counter(c._0, kind) do return c._1
	return 0
}

remove_counters :: proc(o: ^types.GameObject, kind: types.CounterType, n: u32) {
	for c, i in o.counters do if same_counter(c._0, kind) {
		if c._1 <= n do ordered_remove(&o.counters, i)
		else do o.counters[i]._1 -= n
		return
	}
}

// Tapping a permanent (CR 701.26a: only an untapped one can be): an event abilities trigger on ("whenever this
// becomes tapped"). Entering tapped isn't becoming tapped.
tap_permanent :: proc(o: ^types.GameObject) {
	if o.tapped do return
	o.tapped = true
	if action_events != nil do append(action_events, Event{kind = .Tapped, object = o.id, controller = o.controller})
}

// Untapping a permanent (CR 701.26b). CR 122.1d: with a stun counter on it, a stun counter is removed instead.
untap :: proc(o: ^types.GameObject) {
	if !o.tapped do return
	if counter_count(o, types.CounterType_Stun{}) > 0 {
		remove_counters(o, types.CounterType_Stun{}, 1)
		return
	}
	o.tapped = false
}

// The keyword a keyword counter gives (CR 122.1b), of those this engine carries out.
keyword_of_counter :: proc(k: types.KeywordKind) -> (types.Keyword, bool) {
	#partial switch k {
	case .Flying:
		return types.Keyword_Flying{}, true
	case .FirstStrike:
		return types.Keyword_FirstStrike{}, true
	case .DoubleStrike:
		return types.Keyword_DoubleStrike{}, true
	case .Trample:
		return types.Keyword_Trample{}, true
	case .Deathtouch:
		return types.Keyword_Deathtouch{}, true
	case .Lifelink:
		return types.Keyword_Lifelink{}, true
	case .Vigilance:
		return types.Keyword_Vigilance{}, true
	case .Haste:
		return types.Keyword_Haste{}, true
	case .Reach:
		return types.Keyword_Reach{}, true
	case .Menace:
		return types.Keyword_Menace{}, true
	case .Indestructible:
		return types.Keyword_Indestructible{}, true
	case .Hexproof:
		return types.Keyword_Hexproof{}, true
	}
	return nil, false
}
