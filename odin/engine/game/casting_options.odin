// A spell's own ways to be cast other than the usual (its casting options): "You may pay {W}{U}{B}{R}{G} rather than
// pay this spell's mana cost" and "If you control a commander, you may cast this spell without paying its mana cost"
// (alternative costs, CR 118.9), "This spell has flash as long as you control a Merfolk" (CR 601.3d) and "You may
// cast this spell as though it had flash if you pay {2} more to cast it" (CR 601.3c).
package game

import types "../types"

// ---- What's supported ----------------------------------------------------------------------------------------

casting_options_supported :: proc(face: ^types.CardFace) -> bool {
	for opt in face.casting_options {
		if c, has := opt.condition.?; has && !casting_condition_supported(c) do return false
		switch opt.kind {
		case .AsThoughHadFlash:
			// With no cost, or for an extra mana cost ("if you pay {2} more"); not for another kind of cost ("if you
			// behold a Dragon as an additional cost") yet.
			cost, has := opt.cost.?
			if !has do continue
			if opt.condition != nil do return false
			m, is_mana := cost.(types.AbilityCost_Mana)
			if !is_mana || !mana_cost_supported(m.cost) do return false
		case .CastWithoutManaCost:
			if opt.cost != nil do return false
		case .AlternativeCost:
			cost, has := opt.cost.?
			if !has || !alternative_cost_supported(cost) do return false
			// The part other than mana is paid the way an additional cost is (spell_additional_cost): only for a spell
			// with no additional cost of its own.
			if _, rest := split_alternative_cost(cost); rest != nil && face.additional_cost != nil do return false
		case .CastAdventure:
			return false
		}
	}
	return true
}

// A mana cost the payer can pay: no {X} (CR 107.3: none announced for it) and every symbol payable.
@(private = "file")
mana_cost_supported :: proc(c: types.ManaCost) -> bool {
	cost, ok := c.(types.ManaCost_Cost)
	if !ok || has_x(c) do return false
	for shard in cost.shards do if _, _, payable := shard_payers(shard); !payable do return false
	return true
}

// Mana, life, and the objects an additional cost may take (sacrificed, tapped, returned to the hand, exiled from a
// graveyard or from the hand), alone or together.
@(private = "file")
alternative_cost_supported :: proc(cost: types.AbilityCost) -> bool {
	mana, rest := split_alternative_cost(cost)
	if m, has := mana.?; has && !mana_cost_supported(m) do return false
	r, has_rest := rest.?
	if !has_rest do return true
	// One kind of object chosen at most (the payment chooses one set, CR 601.2h).
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts_of(r, &parts)
	chosen := 0
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_PayLife:
			if !cost_supported(part) do return false
		case types.AbilityCost_Sacrifice:
			if is_self(x._0.target) || !cost_supported(part) do return false
			chosen += 1
		case types.AbilityCost_TapCreatures, types.AbilityCost_ReturnToHand:
			if !cost_supported(part) do return false
			chosen += 1
		case types.AbilityCost_Exile:
			zone, has_zone := x.zone.?
			f, has_filter := x.filter.?
			if !has_zone || (has_filter && is_self(f)) || x.count < 1 || x.count > 10 do return false
			if zone == .Hand {
				// "Exile a blue card from your hand" (Object_Cost_Kind.Exile_From_Hand).
				if !has_filter || !each_typed_filter(f, hand_card_supported) do return false
			} else if zone != .Graveyard || !cost_supported(part) {
				return false
			}
			chosen += 1
		case:
			return false
		}
	}
	return chosen <= 1
}

// "A blue card", "a green card": what a card in the hand is, read where it is.
@(private = "file")
hand_card_supported :: proc(f: types.TypedFilter) -> bool {
	if !own_or_unrestricted(f) do return false
	for t in f.type_filters do if !type_filter_supported(t) do return false
	for p in f.properties {
		if z, in_zone := p.(types.FilterProp_InZone); in_zone && z.zone == .Hand do continue
		if !property_supported(p) do return false
	}
	return true
}

// An alternative cost's mana, and the rest of it ("pay 1 life and exile a blue card", "{W} and tap four untapped
// creatures").
split_alternative_cost :: proc(cost: types.AbilityCost) -> (mana: Maybe(types.ManaCost), rest: Maybe(types.AbilityCost)) {
	#partial switch x in cost {
	case types.AbilityCost_Mana:
		return x.cost, nil
	case types.AbilityCost_Composite:
		others := make([dynamic]types.AbilityCost)
		for part in x.costs {
			if m, is_mana := part.(types.AbilityCost_Mana); is_mana && mana == nil {
				mana = m.cost
				continue
			}
			append(&others, part)
		}
		if len(others) == 1 do return mana, others[0]
		if len(others) > 1 do return mana, types.AbilityCost(types.AbilityCost_Composite{costs = others})
		return mana, nil
	}
	return nil, cost
}

// "If you control a commander", "if it's not your turn", "if you control a Swamp", "as long as you control a Merfolk":
// the conditions read as the spell is cast.
casting_condition_supported :: proc(c: types.ParsedCondition) -> bool {
	#partial switch x in c {
	case types.ParsedCondition_QuantityComparison:
		return quantity_supported(x.lhs) && quantity_supported(x.rhs) && !quantity_reads_target(x.lhs) && !quantity_reads_target(x.rhs)
	case types.ParsedCondition_IsYourTurn, types.ParsedCondition_IsOpponentsTurn, types.ParsedCondition_ControlsCommander:
		return true
	case types.ParsedCondition_Not:
		return x.condition != nil && casting_condition_supported(x.condition^)
	case types.ParsedCondition_And:
		for y in x.conditions do if !casting_condition_supported(y) do return false
		return len(x.conditions) > 0
	case types.ParsedCondition_Or:
		for y in x.conditions do if !casting_condition_supported(y) do return false
		return len(x.conditions) > 0
	}
	return false
}

casting_condition_holds :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, c: types.ParsedCondition) -> bool {
	#partial switch x in c {
	case types.ParsedCondition_QuantityComparison:
		return compare(quantity_value(s, x.lhs, p, o.id, 0), x.comparator, quantity_value(s, x.rhs, p, o.id, 0))
	case types.ParsedCondition_IsYourTurn:
		return s.active_player == p
	case types.ParsedCondition_IsOpponentsTurn:
		return s.active_player != p
	case types.ParsedCondition_ControlsCommander:
		// CR 903.3: a commander is a designation of a card; "a commander" is anyone's unless it says "your".
		for perm in permanents_of(s, p) {
			if !perm.is_commander do continue
			if x.ownership == .Own && perm.owner != p do continue
			return true
		}
		return false
	case types.ParsedCondition_Not:
		return !casting_condition_holds(s, p, o, x.condition^)
	case types.ParsedCondition_And:
		for y in x.conditions do if !casting_condition_holds(s, p, o, y) do return false
		return true
	case types.ParsedCondition_Or:
		for y in x.conditions do if casting_condition_holds(s, p, o, y) do return true
		return false
	}
	return false
}

@(private = "file")
option_condition_holds :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, opt: types.SpellCastingOption) -> bool {
	c, has := opt.condition.?
	return !has || casting_condition_holds(s, p, o, c)
}

// The object's casting options (from its card: casting options aren't kept on objects, object_face).
@(private = "file")
options_of :: proc(o: ^types.GameObject) -> []types.SpellCastingOption {
	if len(o.casting_options) > 0 do return o.casting_options[:]
	if e, ok := card_entry_of(o); ok && e.face.name == o.name do return e.face.casting_options[:]
	return nil
}

// ---- Flash (CR 601.3c-d) ---------------------------------------------------------------------------------------

// "This spell has flash as long as you control a Merfolk" (CR 601.3d): it may be cast as though it had flash while
// the condition holds.
has_conditional_flash :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) -> bool {
	for opt in options_of(o) do if opt.kind == .AsThoughHadFlash && opt.cost == nil && option_condition_holds(s, p, o, opt) do return true
	return false
}

// "You may cast this spell as though it had flash if you pay {2} more to cast it": the extra mana.
@(private = "file")
flash_cost :: proc(o: ^types.GameObject) -> (types.ManaCost_Cost, bool) {
	for opt in options_of(o) {
		if opt.kind != .AsThoughHadFlash do continue
		cost, has := opt.cost.?
		if !has do continue
		if m, is_mana := cost.(types.AbilityCost_Mana); is_mana do return m.cost.(types.ManaCost_Cost), true
	}
	return {}, false
}

has_flash_for_a_cost :: proc(o: ^types.GameObject) -> bool {
	_, has := flash_cost(o)
	return has
}

// CR 601.3c: cast at a time only flash allows, it's cast as though it had flash, for the extra cost. (At a time it
// could be cast anyway, the extra cost isn't offered: paying it would change nothing.)
note_flash_cost :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) {
	o.cast_timing_permission = nil
	// A spell cast while another resolves isn't cast at a time flash would matter for (CR 608.2g).
	if cast_free(o) || !has_flash_for_a_cost(o) || can_cast_now(s, p, o, flash_for_a_cost = false) do return
	o.cast_timing_permission = types.Tuple2(types.CastTimingPermission, u32){_0 = .AsThoughHadFlash, _1 = 0}
}

// The extra mana the spell costs for being cast as though it had flash: once its cast has begun, as noted then;
// before, as it would be now.
flash_extra_cost :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) -> (types.ManaCost_Cost, bool) {
	extra, has := flash_cost(o)
	if !has || cast_free(o) do return {}, false
	if _, noted := o.cast_timing_permission.?; noted do return extra, true
	if _, being_cast := stack_entry_of(s, o.id); being_cast || o.zone == .Stack do return {}, false
	if can_cast_now(s, p, o, flash_for_a_cost = false) do return {}, false
	return extra, true
}

// ---- Alternative costs (CR 118.9) ------------------------------------------------------------------------------

// The alternative cost chosen for the spell being cast (CR 601.2b): which of its casting options, while it's cast.
// (Kept beside the cast in progress, as cost_targets is: the total cost reads it, CR 601.2f.)
Casting_Alternative :: struct {
	spell:  types.ObjectId,
	option: int,
	free:   bool, // cast without paying its mana cost by a resolving effect's permission (cast_during_resolution.odin)
}

@(thread_local)
casting_alternative: Casting_Alternative

chosen_alternative :: proc(o: ^types.GameObject) -> (types.SpellCastingOption, bool) {
	if o == nil || casting_alternative.spell != o.id || casting_alternative.free do return {}, false
	opts := options_of(o)
	if casting_alternative.option >= len(opts) do return {}, false
	return opts[casting_alternative.option], true
}

// Whether the spell is being cast without paying its mana cost by a resolving effect's permission (CR 608.2g).
cast_free :: proc(o: ^types.GameObject) -> bool {
	return o != nil && casting_alternative.spell == o.id && casting_alternative.free
}

forget_alternative :: proc(id: types.ObjectId) {
	if casting_alternative.spell == id do casting_alternative = {}
}

// The mana the alternative cost asks instead of the mana cost (CR 118.9c: the mana cost itself is unchanged).
alternative_mana :: proc(o: ^types.GameObject) -> (types.ManaCost, bool) {
	if cast_free(o) do return types.ManaCost(types.ManaCost_Cost{}), true // CR 118.9: without paying its mana cost
	opt, chosen := chosen_alternative(o)
	if !chosen do return nil, false
	if opt.kind == .CastWithoutManaCost do return types.ManaCost(types.ManaCost_Cost{}), true
	mana, _ := split_alternative_cost(opt.cost.?)
	if m, has := mana.?; has do return m, true
	return types.ManaCost(types.ManaCost_Cost{}), true // "sacrifice two Mountains rather than pay": no mana
}

// The rest of the alternative cost, paid as the spell's additional cost would be (CR 601.2h).
alternative_rest :: proc(o: ^types.GameObject) -> (types.AbilityCost, bool) {
	opt, chosen := chosen_alternative(o)
	if !chosen || opt.kind != .AlternativeCost do return nil, false
	_, rest := split_alternative_cost(opt.cost.?)
	r, has := rest.?
	return r, has
}

// The first alternative cost the player could cast the spell with now (CR 118.9a: the controller chooses one; here,
// the first one available is offered beside the mana cost).
available_alternative :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) -> (int, bool) {
	for opt, i in options_of(o) {
		if opt.kind != .AlternativeCost && opt.kind != .CastWithoutManaCost do continue
		if !option_condition_holds(s, p, o, opt) do continue
		saved := casting_alternative
		casting_alternative = {spell = o.id, option = i}
		ok := additional_cost_payable(s, p, o)
		if ok {
			_, ok = plan_payment(s, p, spell_cost(s, o, p), 0, nil, Payment{o, true})
		}
		casting_alternative = saved
		if ok do return i, true
	}
	return 0, false
}

// CR 601.2b: the player announces whether they'll pay the alternative cost, before anything else of the cast. The
// choice is offered as the two costs to pick between: the alternative first, then the mana cost.
ask_alternative_cost :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> bool {
	if g.pending.alternative_decided do return false
	g.pending.alternative_decided = true
	i, available := available_alternative(&g.state, p, o)
	if !available do return false
	g.pending.alternative_offered = i
	opt := options_of(o)[i]
	alt: types.AbilityCost = types.AbilityCost_Mana{cost = types.ManaCost_Cost{}}
	if c, has := opt.cost.?; has do alt = c
	costs := make([dynamic]types.AbilityCost)
	append(&costs, alt)
	append(&costs, types.AbilityCost(types.AbilityCost_Mana{cost = spell_cost(&g.state, o, p)}))
	pending := new(types.PendingCast)
	pending.object_id = o.id
	pending.card_id = o.card_id
	pending.cost = o.mana_cost
	g.pending.asking_alternative = true
	g.state.waiting_for = types.WaitingFor_OptionalCostChoice{player = p, cost = types.AdditionalCost_Choice{costs}, pending_cast = pending}
	return true
}

// The answer: 0 for the alternative cost, 1 for the mana cost. Either must be one the player can pay.
decide_alternative_cost :: proc(g: ^Game, p: types.PlayerId, index: int) -> bool {
	s := &g.state
	o := object(s, g.pending.object)
	if o == nil || !g.pending.asking_alternative do return false
	switch index {
	case 0:
		i := g.pending.alternative_offered
		casting_alternative = {spell = o.id, option = i}
		// CR 107.3b: paying neither the mana cost nor an alternative cost with {X}, X is 0.
		if has_x(o.mana_cost) do o.cost_x_paid = 0
	case 1:
		if !additional_cost_payable(s, p, o) do return false
		if _, payable := plan_payment(s, p, spell_cost(s, o, p), 0, nil, Payment{o, true}); !payable do return false
	case:
		return false
	}
	g.pending.asking_alternative = false
	continue_casting(g, p)
	return true
}

// Adds mana to a cost (CR 601.2f: an additional or extra cost adds to the total).
add_mana :: proc(c: ^types.ManaCost_Cost, extra: types.ManaCost_Cost) {
	c.generic += extra.generic
	shards := make([dynamic]types.ManaCostShard, context.temp_allocator)
	append(&shards, ..c.shards[:])
	append(&shards, ..extra.shards[:])
	c.shards = shards
}
