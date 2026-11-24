// Amounts in card text (CR 107.1, 107.3): a number, or one worked out as the effect happens: "for each creature you
// control", "equal to its power", "the number of +1/+1 counters on it", plus or times a number.
package game

import types "../types"

quantity_supported :: proc(q: types.QuantityExpr) -> bool {
	#partial switch x in q {
	case types.QuantityExpr_Fixed:
		return true
	case types.QuantityExpr_Offset:
		return x.inner != nil && quantity_supported(x.inner^)
	case types.QuantityExpr_Multiply:
		return x.inner != nil && quantity_supported(x.inner^)
	case types.QuantityExpr_ClampMin:
		return x.inner != nil && quantity_supported(x.inner^)
	case types.QuantityExpr_Ref:
		#partial switch r in x.qty {
		case types.QuantityRef_ObjectCount:
			return mass_filter_supported(r.filter)
		case types.QuantityRef_Power:
			return scope_supported(r.scope)
		case types.QuantityRef_Toughness:
			return scope_supported(r.scope)
		case types.QuantityRef_CountersOn:
			_, from_source := r.scope.(types.ObjectScope_Source)
			kind, has := r.counter_type.?
			return from_source && (!has || counter_kind_supported(kind))
		case types.QuantityRef_HandSize:
			#partial switch _ in r.player {
			case types.PlayerScope_Controller, types.PlayerScope_Opponent:
				return true
			}
		}
	}
	return false
}

@(private = "file")
scope_supported :: proc(scope: types.ObjectScope) -> bool {
	#partial switch _ in scope {
	case types.ObjectScope_Source, types.ObjectScope_Target:
		return true
	}
	return false
}

// The value as the instruction is carried out. `target` is the ability's first object target, for "its power".
quantity_value :: proc(s: ^types.GameState, q: types.QuantityExpr, controller: types.PlayerId, source: types.ObjectId, target: types.ObjectId) -> int {
	#partial switch x in q {
	case types.QuantityExpr_Fixed:
		return int(x.value)
	case types.QuantityExpr_Offset:
		return quantity_value(s, x.inner^, controller, source, target) + int(x.offset)
	case types.QuantityExpr_Multiply:
		return quantity_value(s, x.inner^, controller, source, target) * int(x.factor)
	case types.QuantityExpr_ClampMin:
		return max(quantity_value(s, x.inner^, controller, source, target), int(x.minimum))
	case types.QuantityExpr_Ref:
		#partial switch r in x.qty {
		case types.QuantityRef_ObjectCount:
			return len(affected_permanents(s, r.filter, controller, source))
		case types.QuantityRef_Power:
			if o := scope_object(s, r.scope, source, target); o != nil do return power_of(o)
		case types.QuantityRef_Toughness:
			if o := scope_object(s, r.scope, source, target); o != nil do return toughness_of(o)
		case types.QuantityRef_CountersOn:
			o := object(s, source)
			if o == nil do return 0
			kind, has := r.counter_type.?
			n := 0
			for c in o.counters do if !has || same_counter(c._0, kind) do n += int(c._1)
			return n
		case types.QuantityRef_HandSize:
			// "The number of cards in your hand" (or an opponent's, in a two-player game).
			who := controller
			if _, opp := r.player.(types.PlayerScope_Opponent); opp do who = opponent(s, controller)
			return types.pvec_len(player(s, who).hand)
		}
	}
	return 0
}

@(private = "file")
scope_object :: proc(s: ^types.GameState, scope: types.ObjectScope, source, target: types.ObjectId) -> ^types.GameObject {
	#partial switch _ in scope {
	case types.ObjectScope_Source:
		return object(s, source)
	case types.ObjectScope_Target:
		if target != 0 do return object(s, target)
	}
	return nil
}
