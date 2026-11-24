// Activated abilities (CR 602): "[cost]: [effect]" on permanents. Supported costs: mana, {T}, "sacrifice this",
// "pay N life", and combinations of them; "activate only as a sorcery". Mana abilities (CR 605) are in mana.odin.
package game

import types "../types"

activated_supported :: proc(a: types.AbilityDefinition) -> bool {
	if a.kind != .Activated || !ability_supported(a) do return false
	cost, has := a.cost.?
	if !has || !cost_supported(cost) do return false
	if a.activation_zone != nil || a.activator_filter != nil || a.activation_mana_payment_restriction != nil do return false
	for r in a.activation_restrictions {
		#partial switch _ in r {
		case types.ActivationRestriction_AsSorcery, types.ActivationRestriction_AsInstant:
		case:
			return false
		}
	}
	return true
}

cost_supported :: proc(c: types.AbilityCost) -> bool {
	#partial switch x in c {
	case types.AbilityCost_Mana:
		_, ok := x.cost.(types.ManaCost_Cost)
		return ok
	case types.AbilityCost_Tap:
		return true
	case types.AbilityCost_Sacrifice:
		count, is_count := x._0.requirement.(types.SacrificeRequirement_Count)
		return is_self(x._0.target) && is_count && count.count == 1
	case types.AbilityCost_PayLife:
		_, fixed := fixed_quantity(x.amount)
		return fixed
	case types.AbilityCost_Composite:
		for part in x.costs do if !cost_supported(part) do return false
		return true
	}
	return false
}

// The parts of a cost, flattened.
@(private = "file")
cost_parts :: proc(c: types.AbilityCost, out: ^[dynamic]types.AbilityCost) {
	if comp, ok := c.(types.AbilityCost_Composite); ok {
		for part in comp.costs do cost_parts(part, out)
	} else {
		append(out, c)
	}
}

activated_ability :: proc(o: ^types.GameObject, index: int) -> ^types.AbilityDefinition {
	if o.abilities == nil || index < 0 || index >= len(o.abilities^) do return nil
	return &o.abilities^[index]
}

// CR 602.5, 602.2b: whether the player may activate the ability now and can pay its costs and choose its targets.
can_activate :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, index: int) -> bool {
	s := &g.state
	a := activated_ability(o, index)
	if a == nil || o.zone != .Battlefield || o.controller != p || !object_supported(o, g.card_db) do return false
	if _, _, mana := tap_mana_ability(a^); mana || !activated_supported(a^) do return false
	for r in a.activation_restrictions {
		if _, sorcery := r.(types.ActivationRestriction_AsSorcery); sorcery && !sorcery_timing(s, p) do return false
	}
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost, _ := a.cost.?
	cost_parts(cost, &parts)
	taps_self := false
	mana: types.ManaCost
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Tap:
			// CR 302.6: a creature's {T} ability needs it to have been under control since the turn began.
			if !can_tap_for_cost(o) do return false
			taps_self = true
		case types.AbilityCost_PayLife:
			n, _ := fixed_quantity(x.amount)
			if int(player(s, p).life) < n do return false // CR 119.4: a player can pay life only up to their total
		case types.AbilityCost_Mana:
			mana = x.cost
		}
	}
	for f in target_slots(a) do if len(legal_targets(s, f, p, o.id)) == 0 do return false
	_, payable := plan_payment(s, p, mana, o.id if taps_self else 0)
	return payable
}

// CR 602.2: activating. The ability goes on the stack, its targets are chosen (the player is asked when the action
// doesn't name them), and its costs are paid.
activate_ability :: proc(g: ^Game, p: types.PlayerId, source: types.ObjectId, index: int) -> bool {
	s := &g.state
	o := object(s, source)
	if o == nil || !can_activate(g, p, o, index) do return false
	a := activated_ability(o, index)
	if len(target_slots(a)) > 0 {
		g.pending = Pending_Cast{object = source, ability_index = index}
		ask_target(g, p)
		return true
	}
	finish_activation(g, p, source, index, nil)
	return true
}

// CR 602.2h: the costs are paid; the ability is activated and its controller gets priority (CR 117.3c).
finish_activation :: proc(g: ^Game, p: types.PlayerId, source: types.ObjectId, index: int, targets: []types.TargetRef) {
	s := &g.state
	o := object(s, source)
	a := activated_ability(o, index)
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost, _ := a.cost.?
	cost_parts(cost, &parts)
	taps_self := false
	for part in parts do if _, tap := part.(types.AbilityCost_Tap); tap do taps_self = true
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Mana:
			taps, _ := plan_payment(s, p, x.cost, source if taps_self else 0)
			for t in taps do t.tapped = true
		case types.AbilityCost_Tap:
			o.tapped = true
		case types.AbilityCost_PayLife:
			n, _ := fixed_quantity(x.amount)
			lose_life(s, p, n) // CR 119.4: paying life is losing it
		}
	}
	push_ability(g, source, p, a, targets, false)
	// Sacrificing it last: the ability on the stack is independent of its source (CR 113.7a).
	for part in parts do if _, sac := part.(types.AbilityCost_Sacrifice); sac do move_object(g, source, .Graveyard)
	s.priority_passes = nil
	give_priority(g, p)
}
