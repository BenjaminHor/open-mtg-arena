// Replacement effects (CR 614). Supported: a permanent's own "enters tapped" and "enters with N +1/+1 (or -1/-1)
// counters" (CR 614.1c, 614.12), which change how it enters rather than doing something after.
package game

import types "../types"

replacement_supported :: proc(r: types.ReplacementDefinition) -> bool {
	if _, moved := r.event.(types.ReplacementEvent_Moved); !moved do return false
	if _, mandatory := r.mode.(types.ReplacementMode_Mandatory); !mandatory do return false
	if r.condition != nil || r.execute == nil || r.execute.sub_ability != nil || r.execute.condition != nil do return false
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

// CR 614.12: as the permanent enters, its own replacement effects apply.
apply_entering_replacements :: proc(o: ^types.GameObject) {
	entry, ok := card_entry_of(o)
	if !ok do return
	for r in entry.face.replacements {
		if !replacement_supported(r) do continue
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
