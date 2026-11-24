// Activated abilities (CR 602): "[cost]: [effect]" on permanents. Supported costs: mana, {T}, "sacrifice this",
// "pay N life", and combinations of them; "activate only as a sorcery". Mana abilities (CR 605) are in mana.odin.
package game

import "core:slice"
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
		return ok && !has_x(x.cost) // an {X} in an activation cost isn't announced yet
	case types.AbilityCost_Tap:
		return true
	case types.AbilityCost_Sacrifice:
		// "Sacrifice this" or "sacrifice N creatures": CR 701.21a, a player sacrifices only their own permanents.
		count, is_count := x._0.requirement.(types.SacrificeRequirement_Count)
		if !is_count do return false
		if is_self(x._0.target) do return count.count == 1
		typed, ok := x._0.target.(types.TargetFilter_Typed)
		return ok && typed_supported(typed._0) && count.count >= 1 && count.count <= 10 && own_or_unrestricted(typed._0)
	case types.AbilityCost_Discard:
		// "Discard a card" or "discard two cards" from the hand, chosen by the player (not the card itself, which
		// is activated from the hand, and not at random).
		n, fixed := fixed_quantity(x.count)
		if !fixed || n < 1 || x.selection != .Chosen || x.self_scope != .FromHand do return false
		f, has := x.filter.?
		if !has do return true
		typed, ok := f.(types.TargetFilter_Typed)
		return ok && typed_supported(typed._0) && own_or_unrestricted(typed._0)
	case types.AbilityCost_PayLife:
		_, fixed := fixed_quantity(x.amount)
		return fixed
	case types.AbilityCost_Composite:
		// At most one part that has the player choose objects (object_cost asks for one).
		chosen := 0
		for part in x.costs {
			if !cost_supported(part) do return false
			#partial switch y in part {
			case types.AbilityCost_Sacrifice:
				if !is_self(y._0.target) do chosen += 1
			case types.AbilityCost_Discard:
				chosen += 1
			}
		}
		return chosen <= 1
	}
	return false
}

own_or_unrestricted :: proc(f: types.TypedFilter) -> bool {
	c, has := f.controller.?
	if !has do return true
	_, you := c.(types.ControllerRef_You)
	return you
}

// A cost that has the player choose objects: "sacrifice a creature", "discard a card" (CR 601.2h, 602.2b).
Object_Cost :: struct {
	kind:    enum {
		Sacrifice,
		Discard,
	},
	count:   int,
	choices: [dynamic]types.ObjectId,
}

object_cost :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, a: ^types.AbilityDefinition) -> (Object_Cost, bool) {
	s := &g.state
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost, _ := a.cost.?
	cost_parts(cost, &parts)
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Sacrifice:
			if is_self(x._0.target) do continue
			typed := x._0.target.(types.TargetFilter_Typed)
			c := Object_Cost{kind = .Sacrifice, count = int(x._0.requirement.(types.SacrificeRequirement_Count).count)}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			for perm in permanents_of(s, p) do if object_matches(s, perm, typed._0, p, o.id) do append(&c.choices, perm.id)
			return c, true
		case types.AbilityCost_Discard:
			n, _ := fixed_quantity(x.count)
			c := Object_Cost{kind = .Discard, count = n}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			f, has := x.filter.?
			for id in ids_of(player(s, p).hand) {
				card := object(s, id)
				if has && !object_matches(s, card, f.(types.TargetFilter_Typed)._0, p, o.id) do continue
				append(&c.choices, id)
			}
			return c, true
		}
	}
	return {}, false
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
	if c, has := object_cost(g, p, o, a); has && len(c.choices) < c.count do return false
	if mana == nil do return true // no mana in the cost ("Sacrifice a creature: ...")
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
	g.pending = Pending_Cast{object = source, ability_index = index}
	if len(target_slots(a)) > 0 {
		ask_target(g, p)
		return true
	}
	pay_activation(g, p)
	return true
}

// CR 601.2h (by 602.2b): with the targets chosen, the player pays the costs, first choosing what to sacrifice or
// discard when the cost asks for that.
pay_activation :: proc(g: ^Game, p: types.PlayerId) {
	s := &g.state
	o := object(s, g.pending.object)
	a := activated_ability(o, g.pending.ability_index)
	if c, has := object_cost(g, p, o, a); has && !g.pending.cost_chosen {
		choices := make([dynamic]types.ObjectId)
		append(&choices, ..c.choices[:])
		kind: types.PayCostKind = types.PayCostKind_Sacrifice{}
		if c.kind == .Discard do kind = types.PayCostKind_Discard{}
		s.waiting_for = types.WaitingFor_PayCost{player = p, kind = kind, choices = choices, count = c.count, min_count = c.count, resume = types.CostResume_Resolution{}}
		return
	}
	finish_activation(g, p, g.pending.object, g.pending.ability_index, g.pending.targets[:])
	g.pending = {}
}

// The player's choice of what to sacrifice or discard for the cost: exactly the number asked, from the choices.
answer_cost_choice :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_PayCost, chosen: []types.ObjectId) -> bool {
	if g.pending.object == 0 || len(chosen) != w.count || has_duplicates(chosen) do return false
	for id in chosen do if !slice.contains(w.choices[:], id) do return false
	g.pending.cost_objects = make([dynamic]types.ObjectId)
	append(&g.pending.cost_objects, ..chosen)
	g.pending.cost_chosen = true
	pay_activation(g, p)
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
			pay_mana(g, p, x.cost, source if taps_self else 0)
		case types.AbilityCost_Tap:
			o.tapped = true
		case types.AbilityCost_PayLife:
			n, _ := fixed_quantity(x.amount)
			lose_life(s, p, n) // CR 119.4: paying life is losing it
		}
	}
	// The chosen permanents are sacrificed and cards discarded after the mana is paid (CR 601.2g lets mana
	// abilities be activated first, so a land tapped for mana can still be sacrificed).
	for id in g.pending.cost_objects do move_object(g, id, .Graveyard)
	push_ability(g, source, p, a, targets, false)
	// Sacrificing it last: the ability on the stack is independent of its source (CR 113.7a).
	for part in parts do if sac, ok := part.(types.AbilityCost_Sacrifice); ok && is_self(sac._0.target) do move_object(g, source, .Graveyard)
	s.priority_passes = nil
	give_priority(g, p)
}
