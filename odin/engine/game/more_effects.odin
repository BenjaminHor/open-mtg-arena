// More effects: counters on a creature (CR 122), tapping and untapping (CR 701.26), milling (CR 701.17), and the
// "each"/"all" effects: "creatures you control get +N/+N", "destroy all creatures", "deal N damage to each creature".
package game

import "core:fmt"
import "core:reflect"
import types "../types"

// "Target creature" or "this", where a permanent is meant (not a player).
permanent_or_self :: proc(f: types.TargetFilter) -> bool {
	return is_self(f) || (filter_supported(f) && !may_name_player(f))
}

// A filter naming only players: "target player", "target opponent", "you".
is_player_filter :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Player, types.TargetFilter_Opponent, types.TargetFilter_Controller,
	     types.TargetFilter_TriggeringPlayer, types.TargetFilter_TriggeringSourceController:
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
	#partial switch x in c {
	case types.CounterType_Plus1Plus1, types.CounterType_Minus1Minus1, types.CounterType_Stun, types.CounterType_Lore,
	     types.CounterType_Shield, types.CounterType_Loyalty, types.CounterType_Finality:
		// Finality: exiled instead of going to a graveyard (CR 122.1h, move_object).
		return true
	case types.CounterType_Time, types.CounterType_Fade, types.CounterType_Age, types.CounterType_Generic:
		// Counters with no rules meaning of their own (CR 122.1): only what reads them ("for each plan counter")
		// gives them one.
		return true
	case types.CounterType_Keyword:
		_, ok := keyword_of_counter(x._0) // CR 122.1b
		return ok
	case types.CounterType_PowerToughness:
		return true // +1/+0 and the like: CR 122.1a, applied in layer 7c (continuous.odin)
	}
	return false
}

more_effect_supported :: proc(e: types.Effect, duration: Maybe(types.Duration)) -> (supported: bool, known: bool) {
	#partial switch x in e {
	case types.Effect_PutCounter:
		// "Put N counters on target creature / this / that creature / it (the token just made)."
		_, last := x.target.(types.TargetFilter_LastCreated)
		count_ok := quantity_supported(x.count) && !quantity_reads_target(x.count)
		return count_ok && counter_kind_supported(x.counter_type) && (last || permanent_or_self(x.target)), true
	case types.Effect_SetTapState:
		// "Tap all creatures your opponents control", "untap all lands you control": each permanent that fits as it
		// resolves (CR 608.2c). "Untap those creatures": the ones the instruction before acted on (tap_state.odin).
		if f, of_target := mass_tap_of_target_opponent(x); of_target do return typed_supported(f), true
		if x.scope == .All do return mass_filter_supported(x.target), true
		if _, tracked := x.target.(types.TargetFilter_TrackedSet); tracked do return x.scope == .Single && after_mass_instruction(), true
		return x.scope == .Single && permanent_or_self(x.target), true
	case types.Effect_Mill:
		_, fixed := fixed_quantity(x.count)
		_, top := x.position.(types.LibraryPosition_Top)
		player_ok := is_player_filter(x.target)
		return fixed && x.destination == .Graveyard && (x.position == nil || top) && player_ok, true
	case types.Effect_PumpAll:
		pf, tf := pump_value_supported(x.power), pump_value_supported(x.toughness)
		d, has := duration.?
		_, eot := d.(types.Duration_UntilEndOfTurn)
		return pf && tf && has && eot && mass_filter_supported(x.target), true
	case types.Effect_DestroyAll:
		// "They can't be regenerated": no regeneration shield exists to stop (as for Destroy, spells.odin).
		return mass_filter_supported(x.target), true
	case types.Effect_DamageAll:
		_, fixed := fixed_quantity(x.amount)
		players_ok := true
		if f, has := x.player_filter.?; has do players_ok = player_filter_simple(f)
		return fixed && players_ok && x.damage_source == nil && mass_filter_supported(x.target), true
	case types.Effect_DamageEachPlayer:
		// "This deals 1 damage to each opponent."
		return quantity_supported(x.amount) && !quantity_reads_target(x.amount) && player_filter_simple(x.player_filter), true
	case types.Effect_PutCounterAll:
		// "Put a +1/+1 counter on each creature you control."
		return quantity_supported(x.count) && !quantity_reads_target(x.count) && counter_kind_supported(x.counter_type) && mass_filter_supported(x.target), true
	case types.Effect_ChangeZoneAll:
		return change_zone_all_supported(x), true
	case types.Effect_BounceAll:
		// "Return all creatures to their owners' hands."
		if d, has := x.destination.?; has && d != .Hand do return false, true
		return x.count == nil && mass_filter_supported(x.target), true
	}
	return false, false
}

// "Return all creatures to their owners' hands", "exile all cards from all graveyards", "return all land cards
// from your graveyard to the battlefield tapped".
change_zone_all_supported :: proc(x: types.Effect_ChangeZoneAll) -> bool {
	if _, controller := x.actor.(types.LibraryInstructionActor_Controller); x.actor != nil && !controller do return false
	if c, has := x.enters_under.?; has {
		if _, you := c.(types.ControllerRef_You); !you do return false
	}
	if x.enters_attacking || len(x.enter_with_counters) > 0 || x.face_down_profile != nil || x.library_position != nil || x.random_order do return false
	if x.enter_tapped == .Untapped do return false
	origin := x.origin.? or_else .Battlefield
	#partial switch origin {
	case .Battlefield:
		#partial switch x.destination {
		case .Hand, .Graveyard, .Exile:
			return mass_filter_supported(x.target)
		}
	case .Graveyard:
		return graveyard_mass_supported(x)
	}
	return false
}

// Cards leaving graveyards all at once: "return all land cards from your graveyard to the battlefield tapped", "put
// all creature cards from all graveyards onto the battlefield under your control", "exile each opponent's
// graveyard", "exile target player's graveyard", "then exile that player's graveyard", "shuffle your graveyard into
// your library".
@(private = "file")
graveyard_mass_supported :: proc(x: types.Effect_ChangeZoneAll) -> bool {
	#partial switch x.destination {
	case .Hand, .Exile:
	case .Battlefield:
		// An Aura put onto the battlefield needs what it enchants chosen as it enters (CR 303.4f): not yet.
		if may_match_aura(x.target) do return false
	case .Library:
		// "Shuffle your graveyard into your library" (CR 701.24a), only into its owner's own library.
		shuffled := x.library_shuffle == .TerminalShuffle
		return shuffled && is_controller(x.target)
	case:
		return false
	}
	#partial switch y in x.target {
	case types.TargetFilter_Player:
		return true // a target player's whole graveyard
	case types.TargetFilter_ParentTarget:
		// "That player's graveyard": the player the instruction before targeted.
		return previous_instruction != nil && is_player_filter(effect_target_filter(previous_instruction^))
	case types.TargetFilter_Controller:
		return true
	case types.TargetFilter_TrackedSetFiltered:
		// "Mill four cards, then put all Elf cards from among them into your hand" (CR 701.17c): what the mill moved,
		// after nothing else that moved cards.
		if y.filter == nil || previous_instruction == nil || !among_filter_supported(y.filter^) do return false
		if instruction_before_previous != nil && moves_counted_cards(instruction_before_previous^) do return false
		mill, milled := previous_instruction^.(types.Effect_Mill)
		cause, has_cause := y.caused_by.?
		return milled && mill.destination == .Graveyard && (!has_cause || cause == .Milled)
	case types.TargetFilter_Typed:
		return graveyard_cards_filter(y._0)
	case types.TargetFilter_Or:
		for f in y.filters {
			typed, ok := f.(types.TargetFilter_Typed)
			if !ok || !graveyard_cards_filter(typed._0) do return false
		}
		return len(y.filters) > 0
	}
	return false
}

// "Land cards from your graveyard", "cards from all graveyards", "creature cards an opponent owns in a graveyard": a
// typed filter of graveyard cards, its controller meaning the graveyard's owner (a card goes to its owner's graveyard,
// CR 404.1, 400.3).
// "Target opponent's graveyard" and "all opponents' graveyards" come as the same data (no cards named, an opponent),
// so a filter naming no card type isn't read.
@(private = "file")
graveyard_cards_filter :: proc(f: types.TypedFilter) -> bool {
	if len(f.type_filters) == 0 do return false
	if c, has := f.controller.?; has {
		#partial switch _ in c {
		case types.ControllerRef_You, types.ControllerRef_Opponent:
		case:
			return false
		}
	}
	_, in_graveyard := graveyard_filter(types.TargetFilter_Typed{f})
	return in_graveyard
}

// Whether a graveyard card fits a graveyard_cards_filter: its owner as the filter's controller says (a card in a
// graveyard is its owner's, CR 404.1, 400.3), and the rest as for any object.
@(private = "file")
graveyard_card_matches :: proc(s: ^types.GameState, o: ^types.GameObject, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		plain := x._0
		if c, has := plain.controller.?; has {
			#partial switch _ in c {
			case types.ControllerRef_You:
				if o.owner != controller do return false
			case types.ControllerRef_Opponent:
				if o.owner == controller do return false
			}
		}
		plain.controller = nil
		return object_matches(s, o, plain, controller, source)
	case types.TargetFilter_Or:
		for y in x.filters do if graveyard_card_matches(s, o, y, controller, source) do return true
	}
	return false
}

// The graveyard cards a "return/exile all ... from graveyards" instruction moves, decided as it resolves (CR 608.2c).
@(private = "file")
graveyard_cards_moving :: proc(g: ^Game, x: types.Effect_ChangeZoneAll, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> [dynamic]^types.GameObject {
	s := &g.state
	out := make([dynamic]^types.GameObject, context.temp_allocator)
	whole_graveyard_of: Maybe(types.PlayerId) // "target player's graveyard", "that player's", "your"
	#partial switch y in x.target {
	case types.TargetFilter_TrackedSetFiltered:
		// "All Elf cards from among them": those the mill just moved (CR 701.17c).
		for id in among_moved(g, y.filter^, controller, source) do append(&out, object(s, id))
		return out
	case types.TargetFilter_Player, types.TargetFilter_ParentTarget:
		p, ok := target_player(target)
		if !ok do return out
		whole_graveyard_of = p
	case types.TargetFilter_Controller:
		whole_graveyard_of = controller
	}
	for &p in s.players {
		if who, whole := whole_graveyard_of.?; whole && p.id != who do continue
		for id in ids_of(p.graveyard) {
			o := object(s, id)
			if _, whole := whole_graveyard_of.?; whole || graveyard_card_matches(s, o, x.target, controller, source) do append(&out, o)
		}
	}
	return out
}

// "Each opponent", "each player", "you": the players an each-player instruction reaches.
player_filter_simple :: proc(f: types.PlayerFilter) -> bool {
	#partial switch _ in f {
	case types.PlayerFilter_Opponent, types.PlayerFilter_All, types.PlayerFilter_Controller:
		return true
	}
	return false
}

player_filter_matches :: proc(f: types.PlayerFilter, p, controller: types.PlayerId) -> bool {
	#partial switch _ in f {
	case types.PlayerFilter_Opponent:
		return p != controller
	case types.PlayerFilter_Controller:
		return p == controller
	}
	return true
}

// "Each creature", "creatures you control": a typed filter applied to every permanent, not targeted.
mass_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		return typed_supported(x._0)
	case types.TargetFilter_Or:
		// "Each artifact and enchantment", "a Swamp or a Mountain": a permanent matching any of them.
		for y in x.filters do if !mass_filter_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

// The permanents an "each"/"all" effect affects, decided as it resolves (CR 608.2c, 611.2c).
affected_permanents :: proc(s: ^types.GameState, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId, loc := #caller_location) -> [dynamic]^types.GameObject {
	out := make([dynamic]^types.GameObject, context.temp_allocator)
	if !mass_filter_supported(f) {
		// Callers check mass_filter_supported first; one that doesn't is a bug to fix, not a reason to end the game.
		fmt.eprintf("affected_permanents: unsupported filter %v from %v\n", reflect.union_variant_typeid(f), loc)
		return out
	}
	for id in ids_of(s.battlefield) {
		o := object(s, id)
		if mass_filter_matches(s, o, f, controller, source) do append(&out, o)
	}
	return out
}

mass_filter_matches :: proc(s: ^types.GameState, o: ^types.GameObject, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		return object_matches(s, o, x._0, controller, source)
	case types.TargetFilter_Or:
		for y in x.filters do if mass_filter_matches(s, o, y, controller, source) do return true
	}
	return false
}

do_more_effect :: proc(g: ^Game, e: types.Effect, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) {
	s := &g.state
	affected: ^types.GameObject
	if id, ok := target_object(target); ok do affected = object(s, id)
	#partial switch x in e {
	case types.Effect_PutCounter:
		if is_self(x.target) do affected = same_source(g, source)
		if _, last := x.target.(types.TargetFilter_LastCreated); last {
			// The permanent the instruction before made (a token), CR 608.2c.
			affected = nil
			#reverse for id in g.resolution.moved do if o := object(s, id); o != nil && o.zone == .Battlefield {
				affected = o
				break
			}
		}
		if affected == nil || affected.zone != .Battlefield do return
		n := quantity_value(s, x.count, controller, source, 0)
		if n <= 0 do return
		add_counters(affected, x.counter_type, u32(n))
		apply_continuous_effects(g)
	case types.Effect_SetTapState:
		if f, of_target := mass_tap_of_target_opponent(x); of_target {
			// The target opponent's permanents of that kind (a target made illegal left it undone, CR 608.2b).
			p, is_player := target_player(target)
			if !is_player do return
			for o in permanents_of(s, p) do if object_matches(s, o, f, controller, source) do set_tap_state(o, x.state)
			return
		}
		if x.scope == .All {
			// CR 701.26: all of them (an untapped one can't be tapped, nor a tapped one untapped: nothing happens to it).
			for o in affected_permanents(s, x.target, controller, source) do set_tap_state(o, x.state)
			return
		}
		if _, tracked := x.target.(types.TargetFilter_TrackedSet); tracked {
			for o in mass_affected_now(g) do set_tap_state(o, x.state)
			return
		}
		if is_self(x.target) do affected = same_source(g, source)
		if affected == nil || affected.zone != .Battlefield do return
		if x.state == .Tap do tap_permanent(affected)
		else do untap(affected) // CR 122.1d
	case types.Effect_Mill:
		// CR 701.17a: the player puts the top N cards of their library into their graveyard.
		who := controller
		if pid, ok := target_player(target); ok do who = pid
		n, _ := fixed_quantity(x.count)
		pl := player(s, who)
		together := begin_together() // the cards are milled at the same time ("one or more cards", CR 603.2c)
		for _ in 0 ..< n {
			count := types.pvec_len(pl.library)
			if count == 0 do break
			move_object(g, types.pvec_get(pl.library, count - 1), .Graveyard)
		}
		end_together(together)
	case types.Effect_PumpAll:
		// CR 608.2h: worked out once, then the same for each creature.
		p, t := pump_value(g, x.power, controller, source, nil), pump_value(g, x.toughness, controller, source, nil)
		pumped := affected_permanents(s, x.target, controller, source)
		for o in pumped do pump(g, o, p, t)
		note_mass_affected(g, pumped[:]) // "untap those creatures" next
	case types.Effect_DestroyAll:
		// CR 701.8: all at once.
		together := begin_together() // "destroy all": at the same time
		for o in affected_permanents(s, x.target, controller, source) do destroy(g, o)
		end_together(together)
	case types.Effect_DamageAll:
		n, _ := fixed_quantity(x.amount)
		for o in affected_permanents(s, x.target, controller, source) do deal_damage(g, source, types.TargetRef_Object{o.id}, n)
		// "... and each player" (CR 120.3).
		if f, has := x.player_filter.?; has do for p in s.players do if player_filter_matches(f, p.id, controller) do deal_damage(g, source, types.TargetRef_Player{p.id}, n)
	case types.Effect_DamageEachPlayer:
		// CR 120.3: damage to each player the instruction names, from its source.
		n := quantity_value(s, x.amount, controller, source, 0)
		for p in s.players do if player_filter_matches(x.player_filter, p.id, controller) do deal_damage(g, source, types.TargetRef_Player{p.id}, n)
	case types.Effect_ChangeZoneAll:
		// All at once (CR 608.2c: those that match as it resolves).
		origin := x.origin.? or_else .Battlefield
		moving := make([dynamic]^types.GameObject, context.temp_allocator)
		if origin == .Battlefield {
			append(&moving, ..affected_permanents(s, x.target, controller, source)[:])
		} else {
			append(&moving, ..graveyard_cards_moving(g, x, controller, source, target)[:])
		}
		together := begin_together()
		for o in moving {
			move_object(g, o.id, x.destination)
			if x.destination == .Battlefield {
				if _, has := x.enters_under.?; has do o.controller = controller // CR 110.2a
				if x.enter_tapped == .Tapped do o.tapped = true
			}
		}
		end_together(together)
		// "Shuffle your graveyard into your library": then that library is shuffled (CR 701.24a).
		if x.destination == .Library do shuffle_library(g, controller)
	case types.Effect_BounceAll:
		// To their owners' hands (CR 400.3), all at once.
		together := begin_together()
		for o in affected_permanents(s, x.target, controller, source) do move_object(g, o.id, .Hand)
		end_together(together)
	case types.Effect_PutCounterAll:
		// CR 122.6: counters put on each matching permanent.
		n := quantity_value(s, x.count, controller, source, 0)
		each := affected_permanents(s, x.target, controller, source)
		if n > 0 do for o in each do add_counters(o, x.counter_type, u32(n))
		note_mass_affected(g, each[:]) // "untap those creatures" next
		apply_continuous_effects(g)
	}
}
