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
// The trigger event's object while its ability resolves ("the spell that triggered it").
@(thread_local)
event_object_now: types.ObjectId
// While an ability resolves: what its instruction before moved ("for each creature destroyed this way").
@(thread_local)
moved_now: ^[dynamic]types.ObjectId

// The instruction before the one being checked, for "the life lost this way" (CR 608.2c): set by ability_supported.
@(thread_local)
previous_instruction: ^types.Effect

// The resolving ability's source as it last existed, when it has left since (CR 608.2h, 107.3m).
@(thread_local)
source_was_now: ^types.GameObject

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
		case types.QuantityRef_PreviousEffectAmount:
			return previous_amount_readable(r.channel) && r.aggregate == .Sum
		case types.QuantityRef_TrackedSetSize:
			return previous_instruction != nil && moves_counted_cards(previous_instruction^)
		case types.QuantityRef_PlayerCounter:
			// "The number of poison counters you have" (CR 122.1f), experience, rad and ticket counters.
			#partial switch r.scope {
			case .Controller, .All, .Opponents:
				return true
			}
			return false
		case types.QuantityRef_CountersOnObjects:
			// "The number of +1/+1 counters on creatures you control"; any kind when it names none.
			if k, has := r.counter_type.?; has && !counter_kind_supported(k) do return false
			return mass_filter_supported(r.filter)
		case types.QuantityRef_FilteredTrackedSetSize:
			if previous_instruction == nil || !moves_counted_cards(previous_instruction^) || r.filter == nil do return false
			if cause, has := r.caused_by.?; has && cause_zone(cause) == nil do return false
			typed, is_typed := r.filter.(types.TargetFilter_Typed)
			return is_typed && typed_supported(typed._0)
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
		case types.QuantityRef_StartingLifeTotal:
			return player_scope_supported(r.player)
		case types.QuantityRef_ObjectCountDistinct:
			return object_count_distinct_supported(r)
		case types.QuantityRef_PartySize:
			return player_scope_supported(r.player)
		case types.QuantityRef_DistinctColorsAmong:
			return card_set_supported(r.source)
		case types.QuantityRef_BattlefieldEntriesThisTurn:
			// "The number of creatures that entered the battlefield under your control this turn": the turn's zone
			// change records, by kind and controller.
			t, typed := r.filter.(types.TargetFilter_Typed)
			if !typed || len(t._0.properties) > 0 || !player_scope_supported(r.player) do return false
			for tf in t._0.type_filters do if !record_type_supported(tf) do return false
			return true
		case types.QuantityRef_ManaSpentToCast:
			// "The amount of mana spent to cast this spell", "if {R} was spent to cast it" (this spell or permanent, or
			// the spell that triggered the ability).
			if _, from_source := r.metric.(types.CastManaSpentMetric_FromSource); from_source do return false
			return r.scope == .SelfObject || (r.scope == .TriggeringSpell && event_object_defined)
		case types.QuantityRef_LifeAboveStarting:
			return true
		case types.QuantityRef_ObjectManaValue:
			return scope_supported(r.scope)
		case types.QuantityRef_AttackedThisTurn:
			// Raid, "if you attacked this turn": creatures declared as attackers this turn, by whoever controlled them.
			return r.filter == nil && (r.scope == .Controller || r.scope == .All || r.scope == .Opponents)
		case types.QuantityRef_SpellsCast:
			// "The number of spells you've cast this turn": any spell, this turn only.
			filter_ok := r.filter == nil || spell_record_filter_supported(r.filter.?)
			return filter_ok && r.window == .ThisTurn && (r.scope == .Controller || r.scope == .All || r.scope == .Opponents)
		case types.QuantityRef_LifeGainedThisTurn:
			return player_scope_supported(r.player)
		case types.QuantityRef_LifeLost:
			return r.window == .ThisTurn && (player_scope_supported(r.player) || all_players_supported(r.player))
		case types.QuantityRef_DescendedThisTurn:
			return true // CR 700.11 (the turn's zone change records)
		case types.QuantityRef_CardsDiscardedThisTurn:
			return player_scope_supported(r.player)
		case types.QuantityRef_DamageDealtThisTurn:
			return damage_record_query_supported(r)
		case types.QuantityRef_SacrificedThisTurn:
			return player_scope_supported(r.player) && record_filter_supported(r.filter)

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
			// The record keeps types, controller and whether it was a token, so the filter may ask only about those.
			return record_filter_supported(r.filter)
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
		case types.QuantityRef_TrackedSetSize:
			return len(moved_now^) if moved_now != nil else 0
		case types.QuantityRef_PlayerCounter:
			n := 0
			for &p in s.players {
				#partial switch r.scope {
				case .Controller:
					if p.id != controller do continue
				case .Opponents:
					if p.id == controller do continue
				}
				if r.kind == .Poison do n += int(p.poison_counters)
				else do n += int(p.player_counters[r.kind] or_else 0)
			}
			return n
		case types.QuantityRef_CountersOnObjects:
			n := 0
			for o in affected_permanents(s, r.filter, controller, source, loc) {
				if k, has := r.counter_type.?; has do n += int(counter_count(o, k))
				else do for c in o.counters do n += int(c._1)
			}
			return n
		case types.QuantityRef_FilteredTrackedSetSize:
			// "For each creature destroyed this way": of what the instruction before moved, those that went where the
			// words say, matching as they last existed where they were (CR 608.2h).
			if moved_now == nil do return 0
			typed := r.filter.(types.TargetFilter_Typed)._0
			want: Maybe(types.Zone) = r.destination
			if cause, has := r.caused_by.?; has do want = cause_zone(cause)
			n := 0
			for id in moved_now^ {
				o := object(s, id)
				if o == nil do continue
				if zone, has := want.?; has && o.zone != zone do continue
				as_was := o
				if was := last_known(id); was != nil do as_was = was
				if object_matches(s, as_was, typed, controller, source) do n += 1
			}
			return n
		case types.QuantityRef_PreviousEffectAmount:
			// CR 608.2c: what the instruction before produced (resolution.odin's note_amount).
			if r.channel == .Excess do return int(s.last_effect_excess_amount.? or_else 0)
			return int(s.last_effect_amount.? or_else 0)
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
			o := object(s, source)
			if source_was_now != nil && source_was_now.id == source do o = source_was_now
			if o != nil do return int(o.cost_x_paid.? or_else 0)
		case types.QuantityRef_GraveyardSize:
			return types.pvec_len(player(s, scope_player(s, r.player, controller)).graveyard)
		case types.QuantityRef_LifeTotal:
			return int(player(s, scope_player(s, r.player, controller)).life)
		case types.QuantityRef_StartingLifeTotal:
			return starting_life(s) // CR 103.4: the same for every player in a two-player game
		case types.QuantityRef_ObjectCountDistinct:
			return object_count_distinct(s, r, controller, source)
		case types.QuantityRef_PartySize:
			return party_size(s, scope_player(s, r.player, controller))
		case types.QuantityRef_DistinctColorsAmong:
			// "The number of colors among permanents you control" (CR 105.2).
			seen: bit_set[types.ManaColor]
			for o in card_set(s, r.source, controller, source) do for c in o.color do seen += {c}
			return card(seen)
		case types.QuantityRef_BattlefieldEntriesThisTurn:
			who := scope_player(s, r.player, controller)
			t := r.filter.(types.TargetFilter_Typed)._0
			n := 0
			for i in 0 ..< types.pvec_len(s.zone_changes_this_turn) {
				rec := types.pvec_get(s.zone_changes_this_turn, i)
				if rec.to_zone != .Battlefield || rec.controller != who do continue
				fits := true
				for tf in t.type_filters do if !record_matches_type(rec, tf) do fits = false
				if fits do n += 1
			}
			return n
		case types.QuantityRef_ManaSpentToCast:
			o := object(s, source)
			if r.scope == .TriggeringSpell {
				id := event_object_now
				if id == 0 do id = collecting_event.object // checked as it triggers
				o = object(s, id)
			}
			if o == nil do return 0
			c := o.colors_spent_to_cast
			#partial switch m in r.metric {
			case types.CastManaSpentMetric_Total:
				return int(o.mana_spent_to_cast_amount)
			case types.CastManaSpentMetric_DistinctColors:
				n := 0
				for v in ([5]u32{c.white, c.blue, c.black, c.red, c.green}) do if v > 0 do n += 1
				return n
			case types.CastManaSpentMetric_OfColor:
				switch m.color {
				case .White:
					return int(c.white)
				case .Blue:
					return int(c.blue)
				case .Black:
					return int(c.black)
				case .Red:
					return int(c.red)
				case .Green:
					return int(c.green)
				}
			}
			return 0
		case types.QuantityRef_LifeAboveStarting:
			// "At least N life more than your starting life total" (Ajani, Strength of the Pride).
			return max(int(player(s, controller).life) - starting_life(s), 0)
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
				f, filtered := r.filter.?
				if !filtered {
					n += spells_cast_this_turn_by(s, p.id)
					continue
				}
				if list, ok := s.spells_cast_this_turn_by_player[p.id]; ok {
					for i in 0 ..< types.pvec_len(list) do if spell_record_matches(types.pvec_get(list, i), f) do n += 1
				}
			}
			return n
		case types.QuantityRef_LifeGainedThisTurn:
			// CR 119.3: the life a player gained this turn, counted on its own (a separate tally from life lost).
			return int(player(s, scope_player(s, r.player, controller)).life_gained_this_turn)
		case types.QuantityRef_LifeLost:
			// Life lost this turn: from damage (CR 119.2), effects (119.3) and paying life (119.4). "A player lost 4
			// or more life": the most any player lost.
			if all, is_all := r.player.(types.PlayerScope_AllPlayers); is_all {
				n := 0
				for p, i in s.players {
					v := int(p.life_lost_this_turn)
					switch all.aggregate {
					case .Sum: n += v
					case .Max: n = max(n, v)
					case .Min: n = v if i == 0 else min(n, v)
					}
				}
				return n
			}
			return int(player(s, scope_player(s, r.player, controller)).life_lost_this_turn)
		case types.QuantityRef_DamageDealtThisTurn:
			return damage_dealt_this_turn(s, r, controller, source)
		case types.QuantityRef_CardsDiscardedThisTurn:
			// CR 701.9a: the cards a player discarded this turn (discard_card).
			return int(s.cards_discarded_this_turn_by_player[scope_player(s, r.player, controller)] or_else 0)
		case types.QuantityRef_SacrificedThisTurn:
			// CR 701.21a: the permanents a player sacrificed this turn, as they last existed.
			who := scope_player(s, r.player, controller)
			n := 0
			for i in 0 ..< types.pvec_len(s.sacrificed_permanents_this_turn) {
				rec := types.pvec_get(s.sacrificed_permanents_this_turn, i)
				if rec.controller == who && record_matches(rec, r.filter, who) do n += 1
			}
			return n
		case types.QuantityRef_DescendedThisTurn:
			// CR 700.11: each permanent card put into your graveyard from anywhere this turn (a token isn't a card).
			n := 0
			for i in 0 ..< types.pvec_len(s.zone_changes_this_turn) {
				rec := types.pvec_get(s.zone_changes_this_turn, i)
				if rec.to_zone != .Graveyard || rec.owner != controller || rec.is_token do continue
				// A permanent card in the graveyard: the face it has there (an Adventure or a modal face goes back to its
				// main face, CR 716.4, 712.6a), while it's still there; else as it was recorded.
				if o := object(s, rec.object_id); o != nil && o.zone == .Graveyard {
					if is_permanent_card(o) do n += 1
				} else if record_matches_type(rec, types.TypeFilter_Permanent{}) do n += 1
			}
			return n

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
			n := 0
			for i in 0 ..< types.pvec_len(s.zone_changes_this_turn) {
				rec := types.pvec_get(s.zone_changes_this_turn, i)
				if from, has := r.from.?; has && rec.from_zone != from do continue
				if to, has := r.to.?; has && rec.to_zone != to do continue
				if record_matches(rec, r.filter, controller) do n += 1
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
		if source_was_now != nil && source_was_now.id == source do return source_was_now
		return object(s, source)
	case types.ObjectScope_Target:
		if target == 0 do return nil
		// "Its power" of a target that has left the battlefield: as it last existed there (CR 608.2h).
		o := object(s, target)
		if was := last_known(target); was != nil && o != nil && o.zone != .Battlefield do return was
		return o
	}
	return nil
}

// "You" or "an opponent" (the only one, in a two-player game).
// CR 103.4: each player's starting life total, 20 in the formats the app plays unless the format says otherwise.
starting_life :: proc(s: ^types.GameState) -> int {
	return int(s.format_config.starting_life) if s.format_config.starting_life > 0 else 20
}

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
	return types_match(r.core_types[:], r.subtypes[:], t)
}

// Whether card types and subtypes as recorded (a zone change, a spell cast) fit one type in a filter.
types_match :: proc(core: []types.CoreType, subtypes: []string, t: types.TypeFilter) -> bool {
	has :: proc(core: []types.CoreType, c: types.CoreType) -> bool {
		for x in core do if x == c do return true
		return false
	}
	#partial switch x in t {
	case types.TypeFilter_Creature:
		return has(core, .Creature)
	case types.TypeFilter_Land:
		return has(core, .Land)
	case types.TypeFilter_Artifact:
		return has(core, .Artifact)
	case types.TypeFilter_Enchantment:
		return has(core, .Enchantment)
	case types.TypeFilter_Planeswalker:
		return has(core, .Planeswalker)
	case types.TypeFilter_Instant:
		return has(core, .Instant)
	case types.TypeFilter_Sorcery:
		return has(core, .Sorcery)
	case types.TypeFilter_Permanent:
		return !has(core, .Instant) && !has(core, .Sorcery)
	case types.TypeFilter_Subtype:
		for st in subtypes do if st == x._0 do return true
	case types.TypeFilter_Non:
		return x._0 != nil && !types_match(core, subtypes, x._0^)
	}
	return false
}

// "The number of instant and sorcery spells you've cast this turn": filters of card types (or "non-" types) only,
// or several such ("instant or sorcery"), matched against the turn's spell records.
spell_record_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		if len(x._0.properties) > 0 || x._0.controller != nil || len(x._0.type_filters) == 0 do return false
		for t in x._0.type_filters {
			if n, is_non := t.(types.TypeFilter_Non); is_non {
				if n._0 == nil || !record_type_supported(n._0^) do return false
			} else if !record_type_supported(t) do return false
		}
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if !spell_record_filter_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

spell_record_matches :: proc(rec: types.SpellCastRecord, f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		for t in x._0.type_filters do if !types_match(rec.core_types[:], rec.subtypes[:], t) do return false
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if spell_record_matches(rec, y) do return true
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

// ---- "The number of different [names / powers / mana values] among [objects]" ---------------------------------

// Whether the engine can count the objects such a filter names: on the battlefield, or cards in a graveyard,
// exile or hand (InZone), by kind, controller or owner.
zone_filter_supported :: proc(f: types.TypedFilter) -> bool {
	if len(f.type_filters) == 0 do return false
	for t in f.type_filters do if !type_filter_supported(t) do return false
	for p in f.properties {
		if z, in_zone := p.(types.FilterProp_InZone); in_zone {
			#partial switch z.zone {
			case .Battlefield, .Graveyard, .Exile, .Hand:
				continue
			}
			return false
		}
		if !property_supported(p) do return false
	}
	if c, has := f.controller.?; has {
		#partial switch _ in c {
		case types.ControllerRef_You, types.ControllerRef_Opponent:
		case:
			return false
		}
	}
	return true
}

// The objects such a filter names, from `controller`'s point of view.
zone_filter_objects :: proc(s: ^types.GameState, f: types.TypedFilter, controller: types.PlayerId, source: types.ObjectId) -> [dynamic]^types.GameObject {
	out := make([dynamic]^types.GameObject, context.temp_allocator)
	zone := types.Zone.Battlefield
	for p in f.properties do if z, in_zone := p.(types.FilterProp_InZone); in_zone do zone = z.zone
	ids := make([dynamic]types.ObjectId, context.temp_allocator)
	#partial switch zone {
	case .Battlefield:
		append(&ids, ..ids_of(s.battlefield)[:])
	case .Exile:
		append(&ids, ..ids_of(s.exile)[:])
	case .Graveyard:
		for &pl in s.players do append(&ids, ..ids_of(pl.graveyard)[:])
	case .Hand:
		for &pl in s.players do append(&ids, ..ids_of(pl.hand)[:])
	}
	for id in ids {
		o := object(s, id)
		if o == nil || o.zone != zone do continue
		// Off the battlefield, "your" and "an opponent's" are the owner's (CR 108.3, 404.2).
		if c, has := f.controller.?; has && zone != .Battlefield {
			_, you := c.(types.ControllerRef_You)
			if (o.owner == controller) != you do continue
			g := f
			g.controller = nil
			if object_matches(s, o, g, controller, source) do append(&out, o)
			continue
		}
		if object_matches(s, o, f, controller, source) do append(&out, o)
	}
	return out
}

object_count_distinct_supported :: proc(r: types.QuantityRef_ObjectCountDistinct) -> bool {
	typed, ok := r.filter.(types.TargetFilter_Typed)
	if !ok || len(r.qualities) != 1 || !zone_filter_supported(typed._0) do return false
	#partial switch r.qualities[0] {
	case .Name, .ManaValue, .Power, .Toughness:
		return true
	}
	return false
}

// CR 201.2 (names), 202.3 (mana values), 208 (power and toughness): how many different values among the objects.
object_count_distinct :: proc(s: ^types.GameState, r: types.QuantityRef_ObjectCountDistinct, controller: types.PlayerId, source: types.ObjectId) -> int {
	objects := zone_filter_objects(s, r.filter.(types.TargetFilter_Typed)._0, controller, source)
	names := make(map[string]bool, context.temp_allocator)
	values := make(map[int]bool, context.temp_allocator)
	for o in objects {
		#partial switch r.qualities[0] {
		case .Name:
			names[o.name] = true
		case .ManaValue:
			values[object_mana_value(o)] = true
		case .Power:
			values[power_of(o)] = true
		case .Toughness:
			values[toughness_of(o)] = true
		}
	}
	return len(names) + len(values)
}

// CR 700.8: a player's party is up to one each of a Cleric, a Rogue, a Warrior and a Wizard they control, a creature
// counting for one type only, the count as large as it can be (700.8a-b).
party_size :: proc(s: ^types.GameState, p: types.PlayerId) -> int {
	ROLES :: [4]string{"Cleric", "Rogue", "Warrior", "Wizard"}
	creatures := make([dynamic]^types.GameObject, context.temp_allocator)
	for o in permanents_of(s, p) {
		if !is_type(o, .Creature) do continue
		roles := ROLES
		for r in roles do if has_subtype(o, r) {
			append(&creatures, o)
			break
		}
	}
	best := 0
	used := make([]bool, len(creatures), context.temp_allocator)
	fill :: proc(creatures: []^types.GameObject, used: []bool, role: int, count: int, best: ^int) {
		roles := ROLES
		if role == len(roles) {
			best^ = max(best^, count)
			return
		}
		fill(creatures, used, role + 1, count, best) // nobody in this role
		for o, i in creatures do if !used[i] && has_subtype(o, roles[role]) {
			used[i] = true
			fill(creatures, used, role + 1, count + 1, best)
			used[i] = false
		}
	}
	fill(creatures[:], used, 0, 0, &best)
	return best
}

all_players_supported :: proc(p: types.PlayerScope) -> bool {
	all, ok := p.(types.PlayerScope_AllPlayers)
	return ok && all.exclude == nil
}

// The filters a zone change record can be matched against: card types and subtypes, whose ("you control" / "an
// opponent controls", as it last existed), token or not.
record_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		for tf in x._0.type_filters {
			#partial switch _ in tf {
			case types.TypeFilter_Creature, types.TypeFilter_Land, types.TypeFilter_Artifact, types.TypeFilter_Enchantment,
			     types.TypeFilter_Planeswalker, types.TypeFilter_Instant, types.TypeFilter_Sorcery, types.TypeFilter_Permanent,
			     types.TypeFilter_Subtype:
			case:
				return false
			}
		}
		if c, has := x._0.controller.?; has {
			#partial switch _ in c {
			case types.ControllerRef_You, types.ControllerRef_Opponent:
			case:
				return false
			}
		}
		for p in x._0.properties {
			#partial switch _ in p {
			case types.FilterProp_Token, types.FilterProp_NonToken:
			case:
				return false
			}
		}
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if !record_filter_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

record_matches :: proc(rec: types.ZoneChangeRecord, f: types.TargetFilter, controller: types.PlayerId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		for tf in x._0.type_filters do if !record_matches_type(rec, tf) do return false
		if c, has := x._0.controller.?; has {
			#partial switch _ in c {
			case types.ControllerRef_You:
				if rec.controller != controller do return false
			case types.ControllerRef_Opponent:
				if rec.controller == controller do return false
			}
		}
		for p in x._0.properties {
			#partial switch _ in p {
			case types.FilterProp_Token:
				if !rec.is_token do return false
			case types.FilterProp_NonToken:
				if rec.is_token do return false
			}
		}
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if record_matches(rec, y, controller) do return true
	}
	return false
}

// "If an opponent was dealt damage this turn", "the damage dealt to this creature this turn", "if an opponent was
// dealt 3 or more damage this turn" (the most dealt to one of them): the turn's damage records (damage
// dealt, after prevention: CR 615.1, 615.6).
damage_record_query_supported :: proc(r: types.QuantityRef_DamageDealtThisTurn) -> bool {
	if r.channel != .Total || r.source == nil || r.target == nil do return false
	if _, has := r.group_by.?; has && r.aggregate == .Min do return false
	#partial switch x in r.source^ {
	case types.TargetFilter_Any, types.TargetFilter_SelfRef:
	case types.TargetFilter_Typed:
		// "A source you controlled": only who controlled it.
		if len(x._0.type_filters) > 0 || len(x._0.properties) > 0 || x._0.controller == nil do return false
		if _, you := x._0.controller.?.(types.ControllerRef_You); !you do return false
	case:
		return false
	}
	_, ok := damaged_player_side(r.target^)
	#partial switch _ in r.target^ {
	case types.TargetFilter_Any, types.TargetFilter_SelfRef:
		ok = true
	}
	return ok
}

// "[An opponent / you] was dealt damage": a player, by whose they are.
@(private = "file")
damaged_player_side :: proc(f: types.TargetFilter) -> (you: bool, ok: bool) {
	and, is_and := f.(types.TargetFilter_And)
	if !is_and || len(and.filters) != 2 do return
	if _, player := and.filters[0].(types.TargetFilter_Player); !player do return
	typed, is_typed := and.filters[1].(types.TargetFilter_Typed)
	if !is_typed || len(typed._0.type_filters) > 0 || len(typed._0.properties) > 0 do return
	c, has := typed._0.controller.?
	if !has do return
	#partial switch _ in c {
	case types.ControllerRef_You:
		return true, true
	case types.ControllerRef_Opponent:
		return false, true
	}
	return
}

@(private = "file")
damage_dealt_this_turn :: proc(s: ^types.GameState, r: types.QuantityRef_DamageDealtThisTurn, controller: types.PlayerId, source: types.ObjectId) -> int {
	groups := make(map[u64]int, allocator = context.temp_allocator)
	total := 0
	// "This creature": the object it is now (CR 400.7: damage dealt by or to it before a zone change was another's).
	this: Maybe(u64)
	// (A dies trigger reads the creature as it last existed: its last known object, CR 603.10a.)
	if source_was_now != nil && source_was_now.id == source do this = source_was_now.incarnation
	else if o := object(s, source); o != nil do this = o.incarnation
	for i in 0 ..< types.pvec_len(s.damage_dealt_this_turn) {
		rec := types.pvec_get(s.damage_dealt_this_turn, i)
		#partial switch r.damage_kind {
		case .CombatOnly:
			if !rec.is_combat do continue
		case .NoncombatOnly:
			if rec.is_combat do continue
		}
		#partial switch x in r.source^ {
		case types.TargetFilter_SelfRef:
			if rec.source_id != source || rec.source_incarnation != this do continue
		case types.TargetFilter_Typed:
			if rec.source_controller != controller do continue
		}
		key: u64
		#partial switch x in r.target^ {
		case types.TargetFilter_SelfRef:
			id, is_object := rec.target.(types.TargetRef_Object)
			if !is_object || id._0 != source || rec.target_incarnation != this do continue
		case types.TargetFilter_Any:
		case:
			you, _ := damaged_player_side(r.target^)
			p, is_player := rec.target.(types.TargetRef_Player)
			if !is_player || (p._0 == controller) != you do continue
		}
		g, grouped := r.group_by.?
		if grouped {
			switch g {
			case .Target:
				switch t in rec.target {
				case types.TargetRef_Player: key = u64(t._0) + 1 << 62
				case types.TargetRef_Object: key = u64(t._0)
				}
			case .SourceId:
				key = u64(rec.source_id)
			}
			groups[key] += int(rec.amount)
		}
		total += int(rec.amount)
	}
	if _, grouped := r.group_by.?; grouped {
		best := 0
		for _, v in groups do best = max(best, v)
		return best if r.aggregate == .Max else total
	}
	return total
}

// "This way": readable when the instruction before produces that number (resolution.odin's amount_producer).
previous_amount_readable :: proc(channel: types.DamageChannel) -> bool {
	if previous_instruction == nil do return false
	total, excess := amount_producer(previous_instruction^)
	return excess if channel == .Excess else total
}

// Where "destroyed / sacrificed / discarded / milled / exiled / returned this way" put the cards (CR 701.8a, 701.21a,
// 701.9a, 701.17a, 701.13a); nil for the causes not read this way.
cause_zone :: proc(c: types.ThisWayCause) -> Maybe(types.Zone) {
	#partial switch c {
	case .Exiled:
		return .Exile
	case .Destroyed, .Sacrificed, .Discarded, .Milled, .PutIntoGraveyard:
		return .Graveyard
	case .Returned, .Bounced:
		return .Hand
	}
	return nil
}
