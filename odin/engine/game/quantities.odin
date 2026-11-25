// Amounts in card text (CR 107.1, 107.3): a number, or one worked out as the effect happens: "for each creature you
// control", "equal to its power", "the number of +1/+1 counters on it", plus or times a number.
package game

import types "../types"

// Whether the ability being checked has an X it can read: a spell's own, announced as it's cast (CR 107.3a). Set
// by card_supported around the checks of a spell with {X} in its mana cost.
@(thread_local)
x_defined: bool

// "That much" (the damage that triggered the ability): defined while a trigger whose event has an amount is
// checked, and its value while that ability resolves.
@(thread_local)
event_amount_defined: bool
@(thread_local)
event_amount: int

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
		case types.QuantityRef_AttackedThisTurn:
			// Raid, "if you attacked this turn": creatures declared as attackers this turn, by whoever controlled them.
			return r.filter == nil && (r.scope == .Controller || r.scope == .All || r.scope == .Opponents)
		case types.QuantityRef_SpellsCast:
			// "The number of spells you've cast this turn": any spell, this turn only.
			return r.filter == nil && r.window == .ThisTurn && (r.scope == .Controller || r.scope == .All || r.scope == .Opponents)
		case types.QuantityRef_LifeGainedThisTurn:
			return player_scope_supported(r.player)
		case types.QuantityRef_LifeLost:
			return r.window == .ThisTurn && player_scope_supported(r.player)
		case types.QuantityRef_CardsDrawnThisTurn:
			return player_scope_supported(r.player)
		case types.QuantityRef_SelfManaValue:
			return true
		case types.QuantityRef_EventContextAmount:
			return event_amount_defined
		case types.QuantityRef_PropertyAggregate:
			_, special := r._0.property.(types.ObjectProperty_ManaSymbolCount)
			return !special && card_set_supported(r._0.source)
		case types.QuantityRef_Devotion:
			_, fixed := r.colors.(types.DevotionColors_Fixed)
			return fixed
		case types.QuantityRef_DistinctCardTypes:
			return card_set_supported(r.source)
		case types.QuantityRef_PlayerCount:
			#partial switch _ in r.filter {
			case types.PlayerFilter_Controller, types.PlayerFilter_Opponent, types.PlayerFilter_All:
				return true
			case types.PlayerFilter_ControlsCount:
				// "If an opponent controls more lands than you": players by what they control.
				f := r.filter.(types.PlayerFilter_ControlsCount)
				return f.count != nil && mass_filter_supported(f.filter) && quantity_supported(f.count^)
			}
			return false
		case types.QuantityRef_BasicLandTypeCount:
			_, you := r.controller.(types.ControllerRef_You)
			return you
		case types.QuantityRef_ZoneChangeCountThisTurn:
			// The record keeps types and controller, so the filter may ask only about those.
			t, typed := r.filter.(types.TargetFilter_Typed)
			if !typed || len(t._0.properties) > 0 do return false
			if c, has := t._0.controller.?; has {
				#partial switch _ in c {
				case types.ControllerRef_You, types.ControllerRef_Opponent:
				case:
					return false
				}
			}
			for tf in t._0.type_filters do if !record_type_supported(tf) do return false
			return true
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
		case types.QuantityRef_AttackedThisTurn:
			// CR 508.1: a creature attacked when it was declared as an attacker (CR 508.3a); counted by its controller then.
			n := 0
			for rec in s.attacker_declarations_this_turn {
				c := rec.lki.controller
				switch {
				case r.scope == .Controller && c != controller, r.scope == .Opponents && c == controller:
					continue
				}
				n += 1
			}
			return n
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
			// CR 119.3: the life a player gained this turn, counted on its own (a separate tally from life lost).
			return int(player(s, scope_player(s, r.player, controller)).life_gained_this_turn)
		case types.QuantityRef_LifeLost:
			// Life lost this turn: from damage (CR 119.2), effects (119.3) and paying life (119.4).
			return int(player(s, scope_player(s, r.player, controller)).life_lost_this_turn)
		case types.QuantityRef_CardsDrawnThisTurn:
			// CR 121.1: the cards a player drew this turn.
			return int(player(s, scope_player(s, r.player, controller)).cards_drawn_this_turn)
		case types.QuantityRef_SelfManaValue:
			if o := object(s, source); o != nil do return object_mana_value(o) // CR 202.3
		case types.QuantityRef_EventContextAmount:
			return event_amount
		case types.QuantityRef_PropertyAggregate:
			// "The greatest power among creatures you control", "the total mana value of ...".
			a := r._0
			n, first := 0, true
			for o in card_set(s, a.source, controller, source) {
				v: int
				#partial switch _ in a.property {
				case types.ObjectProperty_Power:
					v = power_of(o)
				case types.ObjectProperty_Toughness:
					v = toughness_of(o)
				case types.ObjectProperty_ManaValue:
					v = object_mana_value(o)
				}
				switch a.function {
				case .Max:
					n = v if first || v > n else n
				case .Min:
					n = v if first || v < n else n
				case .Sum:
					n += v
				}
				first = false
			}
			return n
		case types.QuantityRef_Devotion:
			// CR 700.5: the mana symbols of the colors among the mana costs of permanents the player controls, a
			// hybrid symbol of two of them counted once.
			colors: bit_set[types.ManaColor]
			for c in r.colors.(types.DevotionColors_Fixed)._0 do colors += {c}
			n := 0
			for o in permanents_of(s, controller) {
				c, ok := o.mana_cost.(types.ManaCost_Cost)
				if !ok do continue
				for shard in c.shards do if shard_colors(shard) & colors != {} do n += 1
			}
			return n
		case types.QuantityRef_DistinctCardTypes:
			// "The number of card types among cards in your graveyard" (CR 205.2a).
			seen: bit_set[types.CoreType]
			for o in card_set(s, r.source, controller, source) do for t in o.card_types.core_types do seen += {t}
			return card(seen)
		case types.QuantityRef_PlayerCount:
			#partial switch _ in r.filter {
			case types.PlayerFilter_Controller:
				return 1
			case types.PlayerFilter_Opponent:
				return len(s.players) - 1
			case types.PlayerFilter_ControlsCount:
				f := r.filter.(types.PlayerFilter_ControlsCount)
				want := quantity_value(s, f.count^, controller, source, target)
				n := 0
				for p in s.players {
					if f.relation == .Opponent && p.id == controller do continue
					if f.relation == .Controller && p.id != controller do continue
					// The permanents that player controls among those matching the filter.
					have := 0
					for o in affected_permanents(s, f.filter, controller, source) do if o.controller == p.id do have += 1
					if compare(have, f.comparator, want) do n += 1
				}
				return n
			}
			return len(s.players)
		case types.QuantityRef_BasicLandTypeCount:
			// Domain: the basic land types (CR 305.6) among lands the player controls.
			BASIC :: [5]string{"Plains", "Island", "Swamp", "Mountain", "Forest"}
			n := 0
			for name in BASIC {
				for o in permanents_of(s, controller) do if is_type(o, .Land) && has_subtype(o, name) {
					n += 1
					break
				}
			}
			return n
		case types.QuantityRef_ZoneChangeCountThisTurn:
			// "If a creature died this turn" (CR 700.4: dies means put into a graveyard from the battlefield).
			t := r.filter.(types.TargetFilter_Typed)._0
			n := 0
			for i in 0 ..< types.pvec_len(s.zone_changes_this_turn) {
				rec := types.pvec_get(s.zone_changes_this_turn, i)
				if from, has := r.from.?; has && rec.from_zone != from do continue
				if to, has := r.to.?; has && rec.to_zone != to do continue
				if c, has := t.controller.?; has {
					_, you := c.(types.ControllerRef_You)
					if (rec.controller == controller) != you do continue
				}
				fits := true
				for tf in t.type_filters do if !record_matches_type(rec, tf) do fits = false
				if fits do n += 1
			}
			return n
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

// A card type a zone-change record can be checked for: a core type, a subtype, "permanent".
@(private = "file")
record_type_supported :: proc(t: types.TypeFilter) -> bool {
	#partial switch _ in t {
	case types.TypeFilter_Creature, types.TypeFilter_Land, types.TypeFilter_Artifact, types.TypeFilter_Enchantment,
	     types.TypeFilter_Planeswalker, types.TypeFilter_Instant, types.TypeFilter_Sorcery, types.TypeFilter_Subtype,
	     types.TypeFilter_Permanent:
		return true
	}
	return false
}

@(private = "file")
record_matches_type :: proc(r: types.ZoneChangeRecord, t: types.TypeFilter) -> bool {
	has :: proc(r: types.ZoneChangeRecord, c: types.CoreType) -> bool {
		for x in r.core_types do if x == c do return true
		return false
	}
	#partial switch x in t {
	case types.TypeFilter_Creature:
		return has(r, .Creature)
	case types.TypeFilter_Land:
		return has(r, .Land)
	case types.TypeFilter_Artifact:
		return has(r, .Artifact)
	case types.TypeFilter_Enchantment:
		return has(r, .Enchantment)
	case types.TypeFilter_Planeswalker:
		return has(r, .Planeswalker)
	case types.TypeFilter_Instant:
		return has(r, .Instant)
	case types.TypeFilter_Sorcery:
		return has(r, .Sorcery)
	case types.TypeFilter_Permanent:
		return !has(r, .Instant) && !has(r, .Sorcery)
	case types.TypeFilter_Subtype:
		for st in r.subtypes do if st == x._0 do return true
	}
	return false
}

// The objects an amount reads: permanents matching a filter, or the cards in a zone (a player's graveyard, hand,
// library, or their cards in exile).
@(private = "file")
card_set_supported :: proc(src: types.CardTypeSetSource) -> bool {
	#partial switch x in src {
	case types.CardTypeSetSource_Objects:
		return mass_filter_supported(x.filter)
	case types.CardTypeSetSource_Zone:
		#partial switch x.scope {
		case .Controller, .All, .Opponents:
			return true
		}
	}
	return false
}

@(private = "file")
card_set :: proc(s: ^types.GameState, src: types.CardTypeSetSource, controller: types.PlayerId, source: types.ObjectId) -> [dynamic]^types.GameObject {
	#partial switch x in src {
	case types.CardTypeSetSource_Objects:
		return affected_permanents(s, x.filter, controller, source)
	case types.CardTypeSetSource_Zone:
		out := make([dynamic]^types.GameObject, context.temp_allocator)
		for &p in s.players {
			#partial switch x.scope {
			case .Controller:
				if p.id != controller do continue
			case .Opponents:
				if p.id == controller do continue
			}
			list := zone_list(s, zone_of_ref(x.zone), p.id)
			for i in 0 ..< types.pvec_len(list^) {
				o := object(s, types.pvec_get(list^, i))
				if o.owner == p.id do append(&out, o)
			}
		}
		return out
	}
	return make([dynamic]^types.GameObject, context.temp_allocator)
}
