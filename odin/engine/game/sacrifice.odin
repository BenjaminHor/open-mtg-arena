// Sacrificing as an effect (CR 701.21): "sacrifice this", "sacrifice a creature". The player sacrifices their own
// permanents only (CR 701.21a) and chooses which when there's a choice (CR 608.2d).
package game

import "core:slice"
import types "../types"

sacrifice_supported :: proc(x: types.Effect_Sacrifice) -> bool {
	n, fixed := fixed_quantity(x.count)
	if !fixed || n < 1 do return false
	if is_self(x.target) do return n == 1
	if _, parent := x.target.(types.TargetFilter_ParentTarget); parent do return n == 1 // "sacrifice it"
	// "Sacrifice those tokens": what an earlier instruction made or moved (a delayed ability's, delayed.odin).
	if _, tracked := x.target.(types.TargetFilter_TrackedSet); tracked do return previous_instruction != nil && moves_cards(previous_instruction^)
	// "Target opponent sacrifices a creature": the player is the target (edict_player); the kind of permanent is
	// read as for "sacrifice a creature".
	_, edict := edict_player(x.target)
	// "Whenever this creature deals combat damage to a player, that player sacrifices a creature": the trigger event's
	// player (sacrifice_scope_supported checks it's not also "each player ...").
	that_player := event_player_sacrifices(x.target)
	if that_player && !event_player_defined do return false
	// "Sacrifice a creature", "sacrifice another creature or artifact": the player's own permanents of a kind, or of
	// any of several kinds (CR 701.21a: one can sacrifice only permanents one controls).
	// "They" inside a comparison is the target player only in an edict (in "each opponent sacrifices", the scoped
	// player: sacrifice_scope_supported checks there's a scope).
	if _, names_target := players_in_comparisons(x.target); names_target && !edict do return false
	target := sacrificer_relative(x.target)
	parts: []types.TargetFilter
	#partial switch y in target {
	case types.TargetFilter_Typed:
		parts = []types.TargetFilter{target}
	case types.TargetFilter_Or:
		parts = y.filters[:]
	case:
		return false
	}
	for part in parts {
		typed, ok := part.(types.TargetFilter_Typed)
		if !ok do return false
		f := typed._0
		if edict || that_player do f.controller = nil // the targeted or the event's player's own
		if !typed_supported(f) do return false
		if c, has := f.controller.?; has {
			if _, you := c.(types.ControllerRef_You); !you do return false
		}
	}
	return len(parts) > 0
}

// "That player sacrifices a creature": every kind named as controlled by the scoped player, which outside "each
// player ..." the card data uses for the trigger event's player ("that player", CR 603.2: the player the event
// was about: the player dealt damage, the player whose upkeep it is).
event_player_sacrifices :: proc(f: types.TargetFilter) -> bool {
	parts: []types.TargetFilter
	#partial switch y in f {
	case types.TargetFilter_Typed:
		parts = []types.TargetFilter{f}
	case types.TargetFilter_Or:
		parts = y.filters[:]
	case:
		return false
	}
	for part in parts {
		typed, ok := part.(types.TargetFilter_Typed)
		if !ok do return false
		c, has := typed._0.controller.?
		if !has do return false
		if _, scoped := c.(types.ControllerRef_ScopedPlayer); !scoped do return false
	}
	return len(parts) > 0
}

// The player scope a sacrifice needs: "each opponent sacrifices a creature with the greatest power among creatures
// they control" names "they" as the scoped player, read only inside a scope; "that player sacrifices" names the
// trigger event's player the same way, read only outside one.
sacrifice_scope_supported :: proc(a: types.AbilityDefinition) -> bool {
	if a.effect == nil do return true
	x, sacrifices := a.effect^.(types.Effect_Sacrifice)
	if !sacrifices do return true
	if scoped, _ := players_in_comparisons(x.target); scoped && a.player_scope == nil do return false
	if event_player_sacrifices(x.target) && a.player_scope != nil do return false
	return true
}

// "Target player sacrifices a creature", "target opponent sacrifices a creature or planeswalker": the instruction
// targets the player (CR 115.1), whose own permanents of that kind are the choice, theirs to make (CR 701.21a,
// 608.2d). The card data names the player only as the controller in the filter; the target it means.
edict_player :: proc(f: types.TargetFilter) -> (types.TargetFilter, bool) {
	// Whether a kind names the target player's permanents, and whether that player must be an opponent.
	player_of :: proc(f: types.TargetFilter) -> (names_target, opponent: bool) {
		typed, ok := f.(types.TargetFilter_Typed)
		if !ok do return false, false
		c, has := typed._0.controller.?
		if !has do return false, false
		#partial switch _ in c {
		case types.ControllerRef_TargetPlayer:
			return true, false
		case types.ControllerRef_TargetOpponent:
			return true, true
		}
		return false, false
	}
	parts: []types.TargetFilter
	#partial switch y in f {
	case types.TargetFilter_Typed:
		parts = []types.TargetFilter{f}
	case types.TargetFilter_Or:
		parts = y.filters[:] // each kind the same target player's ("a creature or planeswalker")
	case:
		return nil, false
	}
	if len(parts) == 0 do return nil, false
	_, opponent := player_of(parts[0])
	for part in parts {
		names_target, of_opponent := player_of(part)
		if !names_target || of_opponent != opponent do return nil, false
	}
	if opponent do return types.TargetFilter_Opponent{}, true
	return types.TargetFilter_Player{}, true
}

// The permanents a player could sacrifice for the instruction: their own that fit it (CR 701.21a). In an edict the
// filter's controller names the targeted player, who is `p` (object_matches doesn't read that controller).
sacrifice_choices :: proc(s: ^types.GameState, x: types.Effect_Sacrifice, p: types.PlayerId, source: types.ObjectId, allocator := context.allocator) -> [dynamic]types.ObjectId {
	out := make([dynamic]types.ObjectId, allocator)
	target := sacrificer_relative(x.target)
	for o in permanents_of(s, p) do if mass_filter_matches(s, o, target, p, source) do append(&out, o.id)
	return out
}

// "Each opponent sacrifices a creature with the greatest power among creatures they control", "target opponent
// sacrifices a creature or planeswalker with the greatest mana value among creatures and planeswalkers they control":
// the card data names "they" inside the comparison as the scoped or target player, who is the one sacrificing and
// choosing, so it reads as "you" for that player (the chooser the filter is matched for). With a tie, any of the tied
// permanents can be chosen.
sacrificer_relative :: proc(f: types.TargetFilter) -> types.TargetFilter {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		t := x._0
		props := make([dynamic]types.FilterProp, context.temp_allocator)
		for p in t.properties {
			q := p
			#partial switch y in p {
			case types.FilterProp_Cmc:
				z := y
				z.value = sacrificer_relative_amount(y.value)
				q = z
			case types.FilterProp_PtComparison:
				z := y
				z.value = sacrificer_relative_amount(y.value)
				q = z
			}
			append(&props, q)
		}
		t.properties = props
		return types.TargetFilter_Typed{t}
	case types.TargetFilter_Or:
		parts := make([dynamic]types.TargetFilter, context.temp_allocator)
		for y in x.filters do append(&parts, sacrificer_relative(y))
		return types.TargetFilter_Or{filters = parts}
	}
	return f
}

// Which players the comparisons of a sacrifice's filter name as "they": the scoped player ("each opponent sacrifices
// ... they control"), a target player.
players_in_comparisons :: proc(f: types.TargetFilter) -> (scoped, targeted: bool) {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		for p in x._0.properties {
			value: types.QuantityExpr
			#partial switch y in p {
			case types.FilterProp_Cmc:
				value = y.value
			case types.FilterProp_PtComparison:
				value = y.value
			case:
				continue
			}
			ref, is_ref := value.(types.QuantityExpr_Ref)
			if !is_ref do continue
			agg, is_aggregate := ref.qty.(types.QuantityRef_PropertyAggregate)
			if !is_aggregate do continue
			objects, of_objects := agg._0.source.(types.CardTypeSetSource_Objects)
			if !of_objects do continue
			s, t := filter_players(objects.filter)
			scoped, targeted = scoped || s, targeted || t
		}
	case types.TargetFilter_Or:
		for y in x.filters {
			s, t := players_in_comparisons(y)
			scoped, targeted = scoped || s, targeted || t
		}
	}
	return
}

@(private = "file")
filter_players :: proc(f: types.TargetFilter) -> (scoped, targeted: bool) {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		c, has := x._0.controller.?
		if !has do return
		#partial switch _ in c {
		case types.ControllerRef_ScopedPlayer:
			scoped = true
		case types.ControllerRef_TargetOpponent, types.ControllerRef_TargetPlayer:
			targeted = true
		}
	case types.TargetFilter_Or:
		for y in x.filters {
			s, t := filter_players(y)
			scoped, targeted = scoped || s, targeted || t
		}
	}
	return
}

// "The greatest power among creatures they control": the aggregate's objects, "they" read as "you".
@(private = "file")
sacrificer_relative_amount :: proc(q: types.QuantityExpr) -> types.QuantityExpr {
	ref, is_ref := q.(types.QuantityExpr_Ref)
	if !is_ref do return q
	agg, is_aggregate := ref.qty.(types.QuantityRef_PropertyAggregate)
	if !is_aggregate do return q
	objects, of_objects := agg._0.source.(types.CardTypeSetSource_Objects)
	if !of_objects do return q
	theirs :: proc(f: types.TargetFilter) -> types.TargetFilter {
		#partial switch x in f {
		case types.TargetFilter_Typed:
			c, has := x._0.controller.?
			if !has do return f
			#partial switch _ in c {
			case types.ControllerRef_ScopedPlayer, types.ControllerRef_TargetOpponent, types.ControllerRef_TargetPlayer:
				t := x._0
				t.controller = types.ControllerRef_You{}
				return types.TargetFilter_Typed{t}
			}
		case types.TargetFilter_Or:
			parts := make([dynamic]types.TargetFilter, context.temp_allocator)
			for y in x.filters do append(&parts, theirs(y))
			return types.TargetFilter_Or{filters = parts}
		}
		return f
	}
	a := agg._0
	a.source = types.CardTypeSetSource_Objects{filter = theirs(objects.filter)}
	return types.QuantityExpr_Ref{qty = types.QuantityRef_PropertyAggregate{a}}
}

// Returns true while the player chooses.
do_sacrifice :: proc(g: ^Game, x: types.Effect_Sacrifice, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef) = nil) -> bool {
	s := &g.state
	n, _ := fixed_quantity(x.count)
	if _, parent := x.target.(types.TargetFilter_ParentTarget); parent {
		// "Sacrifice it": that permanent, if its controller is this player (CR 701.21a).
		if id, ok := target_object(target); ok {
			if o := object(s, id); o != nil && o.zone == .Battlefield && o.controller == controller do sacrifice_permanent(g, id)
		}
		return false
	}
	if _, tracked := x.target.(types.TargetFilter_TrackedSet); tracked {
		// Each of them still the same permanent, under this player's control (CR 701.21a), at once.
		together := begin_together()
		defer end_together(together)
		for id in slice.clone(g.resolution.moved[:], context.temp_allocator) {
			if o := object(s, id); o != nil && o.zone == .Battlefield && o.controller == controller do sacrifice_permanent(g, id)
		}
		return false
	}
	if is_self(x.target) {
		// "Sacrifice this": only while it's still the same permanent, under this player's control.
		if o := same_source(g, source); o != nil && o.zone == .Battlefield && o.controller == controller do sacrifice_permanent(g, source)
		return false
	}
	who := controller
	if _, edict := edict_player(x.target); edict {
		// The targeted player sacrifices (a target made illegal left the instruction undone, CR 608.2b).
		p, is_player := target_player(target)
		if !is_player do return false
		who = p
	} else if event_player_sacrifices(x.target) {
		// "That player": the trigger event's (CR 603.2).
		p, has := g.resolution.event.player.?
		if !g.resolution.active || !has do return false
		who = p
	}
	eligible := sacrifice_choices(s, x, who, source)
	if len(eligible) <= n {
		together := begin_together()
		defer end_together(together)
		for id in eligible do sacrifice_permanent(g, id)
		return false
	}
	s.priority_player = who
	s.waiting_for = types.WaitingFor_EffectZoneChoice{player = who, cards = eligible, count = n, min_count = n, source_id = source, effect_kind = .Sacrifice, zone = .Battlefield}
	return true
}

answer_sacrifice :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_EffectZoneChoice, chosen: []types.ObjectId) -> bool {
	if !g.resolution.active || w.effect_kind != .Sacrifice || p != w.player || len(chosen) != w.count || has_duplicates(chosen) do return false
	for id in chosen do if !slice.contains(w.cards[:], id) do return false
	scoped := join_scope_moves(g) // one of "each player sacrifices": the instruction's event (CR 603.2c)
	together := begin_together()
	for id in chosen do sacrifice_permanent(g, id)
	end_together(together)
	end_together(scoped)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}
