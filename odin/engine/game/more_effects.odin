// More effects: counters on a creature (CR 122), tapping and untapping (CR 701.26), milling (CR 701.17), and the
// "each"/"all" effects: "creatures you control get +N/+N", "destroy all creatures", "deal N damage to each creature".
package game

import types "../types"

// "Target creature" or "this", where a permanent is meant (not a player).
permanent_or_self :: proc(f: types.TargetFilter) -> bool {
	return is_self(f) || (filter_supported(f) && !may_name_player(f))
}

// A filter naming only players: "target player", "target opponent", "you".
is_player_filter :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Player, types.TargetFilter_Opponent, types.TargetFilter_Controller:
		return true
	case types.TargetFilter_Typed:
		_, player := player_typed(x._0)
		return player
	}
	return false
}

// Whether a filter can name a player at all ("any target", "target opponent or planeswalker"): such a target can't
// be destroyed, pumped or moved, so effects on objects only don't accept it.
may_name_player :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Any:
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if may_name_player(y) do return true
		return false
	}
	return is_player_filter(f)
}

counter_kind_supported :: proc(c: types.CounterType) -> bool {
	#partial switch _ in c {
	case types.CounterType_Plus1Plus1, types.CounterType_Minus1Minus1:
		return true
	}
	return false
}

more_effect_supported :: proc(e: types.Effect, duration: Maybe(types.Duration)) -> (supported: bool, known: bool) {
	#partial switch x in e {
	case types.Effect_PutCounter:
		_, fixed := fixed_quantity(x.count)
		return fixed && counter_kind_supported(x.counter_type) && permanent_or_self(x.target), true
	case types.Effect_SetTapState:
		return x.scope == .Single && permanent_or_self(x.target), true
	case types.Effect_Mill:
		_, fixed := fixed_quantity(x.count)
		_, top := x.position.(types.LibraryPosition_Top)
		player_ok := is_player_filter(x.target)
		return fixed && x.destination == .Graveyard && (x.position == nil || top) && player_ok, true
	case types.Effect_PumpAll:
		_, pf := x.power.(types.PtValue_Fixed)
		_, tf := x.toughness.(types.PtValue_Fixed)
		d, has := duration.?
		_, eot := d.(types.Duration_UntilEndOfTurn)
		return pf && tf && has && eot && mass_filter_supported(x.target), true
	case types.Effect_DestroyAll:
		return !x.cant_regenerate && mass_filter_supported(x.target), true
	case types.Effect_DamageAll:
		_, fixed := fixed_quantity(x.amount)
		return fixed && x.player_filter == nil && x.damage_source == nil && mass_filter_supported(x.target), true
	}
	return false, false
}

// "Each creature", "creatures you control": a typed filter applied to every permanent, not targeted.
mass_filter_supported :: proc(f: types.TargetFilter) -> bool {
	t, typed := f.(types.TargetFilter_Typed)
	return typed && typed_supported(t._0)
}

// The permanents an "each"/"all" effect affects, decided as it resolves (CR 608.2c, 611.2c).
affected_permanents :: proc(s: ^types.GameState, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId) -> [dynamic]^types.GameObject {
	out := make([dynamic]^types.GameObject, context.temp_allocator)
	t := f.(types.TargetFilter_Typed)
	for id in ids_of(s.battlefield) {
		o := object(s, id)
		if object_matches(s, o, t._0, controller, source) do append(&out, o)
	}
	return out
}

do_more_effect :: proc(g: ^Game, e: types.Effect, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) {
	s := &g.state
	affected: ^types.GameObject
	if id, ok := target_object(target); ok do affected = object(s, id)
	#partial switch x in e {
	case types.Effect_PutCounter:
		if is_self(x.target) do affected = same_source(g, source)
		if affected == nil || affected.zone != .Battlefield do return
		n, _ := fixed_quantity(x.count)
		add_counters(affected, x.counter_type, u32(n))
		apply_continuous_effects(g)
	case types.Effect_SetTapState:
		if is_self(x.target) do affected = same_source(g, source)
		if affected == nil || affected.zone != .Battlefield do return
		affected.tapped = x.state == .Tap
	case types.Effect_Mill:
		// CR 701.17a: the player puts the top N cards of their library into their graveyard.
		who := controller
		if pid, ok := target_player(target); ok do who = pid
		n, _ := fixed_quantity(x.count)
		pl := player(s, who)
		for _ in 0 ..< n {
			count := types.pvec_len(pl.library)
			if count == 0 do break
			move_object(g, types.pvec_get(pl.library, count - 1), .Graveyard)
		}
	case types.Effect_PumpAll:
		p, t := x.power.(types.PtValue_Fixed)._0, x.toughness.(types.PtValue_Fixed)._0
		for o in affected_permanents(s, x.target, controller, source) do pump(g, o, p, t)
	case types.Effect_DestroyAll:
		// CR 701.8: all at once.
		for o in affected_permanents(s, x.target, controller, source) do destroy(g, o)
	case types.Effect_DamageAll:
		n, _ := fixed_quantity(x.amount)
		for o in affected_permanents(s, x.target, controller, source) do deal_damage(g, source, types.TargetRef_Object{o.id}, n)
	}
}
