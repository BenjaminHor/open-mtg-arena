// Amounts in card text (CR 107.1, 107.3): a number, or one worked out as the effect happens: "for each creature you
// control", "equal to its power", "the number of +1/+1 counters on it", plus or times a number.
package game

import types "../types"

// Whether the ability being checked has an X it can read: a spell's own, announced as it's cast (CR 107.3a). Set
// by card_supported around the checks of a spell with {X} in its mana cost.
@(thread_local)
x_defined: bool

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
			return player_scope_supported(r.player)
		case types.QuantityRef_Variable:
			return r.name == "X" && x_defined
		case types.QuantityRef_CostXPaid:
			return x_defined
		case types.QuantityRef_GraveyardSize:
			return player_scope_supported(r.player)
		case types.QuantityRef_LifeTotal:
			return player_scope_supported(r.player)
		case types.QuantityRef_ObjectManaValue:
			return scope_supported(r.scope)
		case types.QuantityRef_SpellsCast:
			// "The number of spells you've cast this turn": any spell, this turn only.
			return r.filter == nil && r.window == .ThisTurn && (r.scope == .Controller || r.scope == .All || r.scope == .Opponents)
		case types.QuantityRef_LifeGainedThisTurn:
			return player_scope_supported(r.player)
		case types.QuantityRef_LifeLost:
			return r.window == .ThisTurn && player_scope_supported(r.player)
		case types.QuantityRef_CardsDrawnThisTurn:
			return player_scope_supported(r.player)
		case types.QuantityRef_ZoneCardCount:
			if r.filter != nil do return false
			#partial switch r.scope {
			case .Controller, .All, .Opponents:
			case:
				return false
			}
			for t in r.card_types do if !type_filter_supported(t) do return false
			return true
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
quantity_value :: proc(s: ^types.GameState, q: types.QuantityExpr, controller: types.PlayerId, source: types.ObjectId, target: types.ObjectId, loc := #caller_location) -> int {
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
			return len(affected_permanents(s, r.filter, controller, source, loc))
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
			return types.pvec_len(player(s, scope_player(s, r.player, controller)).hand)
		case types.QuantityRef_Variable, types.QuantityRef_CostXPaid:
			// CR 107.3a, 107.3m: X is the value announced for the spell (an enters ability of the permanent it became
			// uses that too).
			if o := object(s, source); o != nil do return int(o.cost_x_paid.? or_else 0)
		case types.QuantityRef_GraveyardSize:
			return types.pvec_len(player(s, scope_player(s, r.player, controller)).graveyard)
		case types.QuantityRef_LifeTotal:
			return int(player(s, scope_player(s, r.player, controller)).life)
		case types.QuantityRef_ObjectManaValue:
			// CR 202.3: the mana value of the object.
			if o := scope_object(s, r.scope, source, target); o != nil do return object_mana_value(o)
		case types.QuantityRef_SpellsCast:
			// CR 601.2i: a spell becomes cast once its costs are paid; the count is of those cast this turn.
			n := 0
			for p in s.players {
				switch {
				case r.scope == .Controller && p.id != controller, r.scope == .Opponents && p.id == controller:
					continue
				}
				n += spells_cast_this_turn_by(s, p.id)
			}
			return n
		case types.QuantityRef_LifeGainedThisTurn:
			// CR 119.3: the life a player gained this turn, all of it (losses don't offset it).
			return int(player(s, scope_player(s, r.player, controller)).life_gained_this_turn)
		case types.QuantityRef_LifeLost:
			// Life lost this turn: from damage (CR 119.2), effects (119.3) and paying life (119.4).
			return int(player(s, scope_player(s, r.player, controller)).life_lost_this_turn)
		case types.QuantityRef_CardsDrawnThisTurn:
			// CR 121.1: the cards a player drew this turn.
			return int(player(s, scope_player(s, r.player, controller)).cards_drawn_this_turn)
		case types.QuantityRef_ZoneCardCount:
			// "The number of creature cards in your graveyard": cards of any of the listed types.
			n := 0
			for &p in s.players {
				#partial switch r.scope {
				case .Controller:
					if p.id != controller do continue
				case .Opponents:
					if p.id == controller do continue
				}
				list := zone_list(s, zone_of_ref(r.zone), p.id)
				for i in 0 ..< types.pvec_len(list^) {
					o := object(s, types.pvec_get(list^, i))
					if o.owner != p.id do continue // exile is shared: count each player's own cards
					if len(r.card_types) == 0 do n += 1
					else do for t in r.card_types do if type_matches(o, t) {
						n += 1
						break
					}
				}
			}
			return n
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

// "You" or "an opponent" (the only one, in a two-player game).
player_scope_supported :: proc(p: types.PlayerScope) -> bool {
	#partial switch _ in p {
	case types.PlayerScope_Controller, types.PlayerScope_Opponent:
		return true
	}
	return false
}

@(private = "file")
scope_player :: proc(s: ^types.GameState, p: types.PlayerScope, controller: types.PlayerId) -> types.PlayerId {
	if _, opp := p.(types.PlayerScope_Opponent); opp do return opponent(s, controller)
	return controller
}

@(private = "file")
zone_of_ref :: proc(z: types.ZoneRef) -> types.Zone {
	switch z {
	case .Graveyard:
		return .Graveyard
	case .Exile:
		return .Exile
	case .Library:
		return .Library
	case .Hand:
		return .Hand
	}
	return .Graveyard
}

// Whether an amount reads a target ("target creature's power"), which filters have no access to.
quantity_reads_target :: proc(q: types.QuantityExpr) -> bool {
	#partial switch x in q {
	case types.QuantityExpr_Offset:
		return x.inner != nil && quantity_reads_target(x.inner^)
	case types.QuantityExpr_Multiply:
		return x.inner != nil && quantity_reads_target(x.inner^)
	case types.QuantityExpr_ClampMin:
		return x.inner != nil && quantity_reads_target(x.inner^)
	case types.QuantityExpr_Ref:
		#partial switch r in x.qty {
		case types.QuantityRef_Power:
			_, t := r.scope.(types.ObjectScope_Target)
			return t
		case types.QuantityRef_Toughness:
			_, t := r.scope.(types.ObjectScope_Target)
			return t
		case types.QuantityRef_ObjectManaValue:
			_, t := r.scope.(types.ObjectScope_Target)
			return t
		}
	}
	return false
}
