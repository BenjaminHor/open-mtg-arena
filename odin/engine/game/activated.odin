// Activated abilities (CR 602): "[cost]: [effect]" on permanents. Supported costs: mana, {T}, "sacrifice this",
// "pay N life", and combinations of them; "activate only as a sorcery". Mana abilities (CR 605) are in mana.odin.
package game

import "core:fmt"
import "core:slice"
import "core:strings"
import types "../types"

activated_supported :: proc(a: types.AbilityDefinition) -> bool {
	if a.kind != .Activated || !ability_supported(a) do return false
	// "Remove a counter from this": a remove-counter cost the data writes with no object is read as this one's; a
	// description naming another ("from a permanent you control") isn't.
	if d, has := a.description.?; has && strings.contains(d, "Remove ") && !strings.contains(d, "from this") && !strings.contains(d, "from ~") && !strings.contains(d, "from it") {
		if c, has_cost := a.cost.?; has_cost && has_remove_counter(c) do return false
	}
	// An activated ability that adds mana is a mana ability (CR 605.1a): it doesn't use the stack, and it's carried out
	// by mana.odin (mana_ability_option) or not at all.
	if _, adds_mana := a.effect.(types.Effect_Mana); adds_mana do return false
	cost, has := a.cost.?
	if !has || !cost_supported(cost) do return false
	if a.activator_filter != nil || a.activation_mana_payment_restriction != nil do return false
	if a.cost_reduction != nil do return false // "costs {1} less for each ..." (channel): not applied yet
	// From the hand: abilities that discard the card itself as their cost (cycling, CR 702.29a). From the
	// graveyard: abilities whose text puts them there, "return this card from your graveyard" (CR 113.6b), or
	// whose cost exiles the card from there (CR 113.6j).
	if zone, has := a.activation_zone.?; has {
		#partial switch zone {
		case .Hand:
			if !discards_itself(a) do return false
		case .Graveyard:
		case:
			return false
		}
	}
	for r in a.activation_restrictions do if !restriction_supported(r) do return false
	return true
}

// "Activate only ..." (CR 602.5): timing, how often, and "only if" conditions on an amount.
restriction_supported :: proc(r: types.ActivationRestriction) -> bool {
	#partial switch x in r {
	case types.ActivationRestriction_AsSorcery, types.ActivationRestriction_AsInstant, types.ActivationRestriction_OnlyOnceEachTurn,
	     types.ActivationRestriction_OnlyOnce, types.ActivationRestriction_DuringYourTurn, types.ActivationRestriction_DuringYourUpkeep,
	     types.ActivationRestriction_BeforeAttackersDeclared:
		return true
	case types.ActivationRestriction_RequiresCondition:
		c, has := x.condition.?
		if !has do return false
		#partial switch y in c {
		case types.ParsedCondition_QuantityComparison:
			return quantity_supported(y.lhs) && quantity_supported(y.rhs)
		}
	}
	return false
}

restriction_met :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, index: int, r: types.ActivationRestriction) -> bool {
	#partial switch x in r {
	case types.ActivationRestriction_AsSorcery:
		return sorcery_timing(s, p) // CR 602.5d
	case types.ActivationRestriction_OnlyOnceEachTurn:
		return activations(s.activated_abilities_this_turn, o, index) == 0
	case types.ActivationRestriction_OnlyOnce:
		return activations(s.activated_abilities_this_game, o, index) == 0
	case types.ActivationRestriction_DuringYourTurn:
		return s.active_player == p
	case types.ActivationRestriction_DuringYourUpkeep:
		return s.active_player == p && s.phase == .Upkeep
	case types.ActivationRestriction_BeforeAttackersDeclared:
		return s.phase < .DeclareAttackers
	case types.ActivationRestriction_RequiresCondition:
		c := x.condition.?.(types.ParsedCondition_QuantityComparison)
		return compare(quantity_value(s, c.lhs, p, o.id, 0), c.comparator, quantity_value(s, c.rhs, p, o.id, 0))
	}
	return true
}

// How many times this object's ability has been activated (this turn or this game), as the state counts them: by
// the object (its incarnation, CR 400.7) and the ability's index.
activations :: proc(list: ^[dynamic]types.Tuple2(types.AbilityUsageKey, u32), o: ^types.GameObject, index: int) -> u32 {
	if list == nil do return 0
	for e in list^ do if usage_matches(e._0, o, index) do return e._1
	return 0
}

record_activation :: proc(list: ^^[dynamic]types.Tuple2(types.AbilityUsageKey, u32), o: ^types.GameObject, index: int) {
	if list^ == nil do list^ = new([dynamic]types.Tuple2(types.AbilityUsageKey, u32))
	for &e in list^^ do if usage_matches(e._0, o, index) {
		e._1 += 1
		return
	}
	key := types.AbilityUsageKey{source = o.id, provenance = types.ObjectIncarnationRef{object_id = o.id, incarnation = o.incarnation}, fingerprint = fmt.aprintf("ability %d", index)}
	append(list^, types.Tuple2(types.AbilityUsageKey, u32){key, 1})
}

@(private = "file")
usage_matches :: proc(k: types.AbilityUsageKey, o: ^types.GameObject, index: int) -> bool {
	ref, has := k.provenance.?
	return k.source == o.id && has && ref.incarnation == o.incarnation && k.fingerprint == fmt.tprintf("ability %d", index)
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
		return sacrifice_filter_supported(x._0.target) && count.count >= 1 && count.count <= 10
	case types.AbilityCost_Discard:
		// "Discard this card" (cycling), or "discard a card" / "discard two cards" from the hand, chosen by the
		// player (not at random).
		n, fixed := fixed_quantity(x.count)
		if x.self_scope == .SourceCard do return fixed && n == 1
		if !fixed || n < 1 || x.selection != .Chosen || x.self_scope != .FromHand do return false
		f, has := x.filter.?
		if !has do return true
		typed, ok := f.(types.TargetFilter_Typed)
		return ok && typed_supported(typed._0) && own_or_unrestricted(typed._0)
	case types.AbilityCost_PayLife:
		_, fixed := fixed_quantity(x.amount)
		return fixed
	case types.AbilityCost_Loyalty:
		return true // CR 606.4 (checked and paid below)
	case types.AbilityCost_RemoveCounter:
		// "Remove two +1/+1 counters from this creature": counters of one kind from the ability's own permanent.
		if t, has := x.target.?; has && !is_self(t) do return false
		kind, of_type := x.counter_type.(types.CounterMatch_OfType)
		return of_type && x.selection == .SingleObject && x.count >= 1 && counter_kind_supported(kind._0)
	case types.AbilityCost_Exile:
		// "Exile this card from your graveyard", or "exile N [kind of] cards from your graveyard" (chosen).
		f, has := x.filter.?
		zone, has_zone := x.zone.?
		if !has_zone || zone != .Graveyard do return false
		if !has do return x.count >= 1 && x.count <= 10 // "exile a card from your graveyard": any card
		if is_self(f) do return x.count == 1
		typed, ok := f.(types.TargetFilter_Typed)
		if !ok || x.count < 1 || x.count > 10 do return false
		if c, has_c := typed._0.controller.?; has_c {
			if _, you := c.(types.ControllerRef_You); !you do return false
		}
		for p in typed._0.properties do if z, in_zone := p.(types.FilterProp_InZone); in_zone && z.zone != .Graveyard do return false
		plain := typed._0
		plain.controller = nil
		plain.properties = nil
		return typed_supported(plain) && graveyard_props_supported(typed._0)
	case types.AbilityCost_Composite:
		// At most one part that has the player choose objects (object_cost asks for one).
		chosen := 0
		for part in x.costs {
			if !cost_supported(part) do return false
			#partial switch y in part {
			case types.AbilityCost_Sacrifice:
				if !is_self(y._0.target) do chosen += 1
			case types.AbilityCost_Discard:
				if y.self_scope != .SourceCard do chosen += 1
			case types.AbilityCost_Exile:
				if f, has := y.filter.?; !has || !is_self(f) do chosen += 1
			}
		}
		return chosen <= 1
	}
	return false
}

// What may be sacrificed: a kind of permanent the player controls (CR 701.21a), or any of several kinds ("an
// artifact or creature").
@(private = "file")
sacrifice_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		return typed_supported(x._0) && own_or_unrestricted(x._0)
	case types.TargetFilter_Or:
		for y in x.filters do if !sacrifice_filter_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

@(private = "file")
sacrifice_filter_matches :: proc(s: ^types.GameState, f: types.TargetFilter, perm: ^types.GameObject, p: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		return object_matches(s, perm, x._0, p, source)
	case types.TargetFilter_Or:
		for y in x.filters do if sacrifice_filter_matches(s, y, perm, p, source) do return true
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
		Exile_From_Graveyard,
	},
	count:   int,
	choices: [dynamic]types.ObjectId,
}

object_cost :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, a: ^types.AbilityDefinition) -> (Object_Cost, bool) {
	cost, has := a.cost.?
	if !has do return {}, false
	return object_cost_of(&g.state, p, o, cost)
}

object_cost_of :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, cost: types.AbilityCost) -> (Object_Cost, bool) {
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts(cost, &parts)
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Sacrifice:
			if is_self(x._0.target) do continue
			c := Object_Cost{kind = .Sacrifice, count = int(x._0.requirement.(types.SacrificeRequirement_Count).count)}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			for perm in permanents_of(s, p) do if sacrifice_filter_matches(s, x._0.target, perm, p, o.id) do append(&c.choices, perm.id)
			return c, true
		case types.AbilityCost_Exile:
			if f, has := x.filter.?; has && is_self(f) do continue // "exile this card": no choice
			zone, has_zone := x.zone.?
			if !has_zone || zone != .Graveyard do continue
			// "Exile a [creature] card from your graveyard": the player's own graveyard (CR 404.1), the source excluded.
			c := Object_Cost{kind = .Exile_From_Graveyard, count = int(x.count)}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			typed, has_filter := x.filter.?
			for id in ids_of(player(s, p).graveyard) {
				if id == o.id do continue
				if has_filter {
					f := typed.(types.TargetFilter_Typed)._0
					f.controller = nil
					if !object_matches(s, object(s, id), f, p, o.id) do continue
				}
				append(&c.choices, id)
			}
			return c, true
		case types.AbilityCost_Discard:
			if x.self_scope == .SourceCard do continue // the card itself: no choice
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
	if a == nil do return refuse("no such ability")
	if !object_supported(o, g.card_db) do return refuse_unsupported(o)
	// CR 602.2: a permanent's ability, by its controller; a hand ability (cycling), by the card's owner from their
	// hand (CR 702.29a).
	if zone, elsewhere := a.activation_zone.?; elsewhere {
		// From the hand or graveyard, by the card's owner (CR 602.2, 113.6j).
		if (zone != .Hand && zone != .Graveyard) || o.zone != zone || o.owner != p do return refuse("not activatable from its zone")
	} else if o.zone != .Battlefield || o.controller != p do return refuse("not activatable from its zone")
	if _, _, mana := tap_mana_ability(a^); mana do return refuse("a mana ability (activated through mana payment)")
	if !activated_supported(a^) do return refuse("ability not supported")
	for r in a.activation_restrictions do if !restriction_met(&g.state, p, o, index, r) do return refuse("activation restriction")
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost, _ := a.cost.?
	cost_parts(cost, &parts)
	taps_self := false
	mana: types.ManaCost
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Tap:
			// CR 302.6: a creature's {T} ability needs it to have been under control since the turn began.
			if !can_tap_for_cost(o) do return refuse("can't tap")
			taps_self = true
		case types.AbilityCost_PayLife:
			n, _ := fixed_quantity(x.amount)
			if int(player(s, p).life) < n do return refuse("not enough life") // CR 119.4: a player can pay life only up to their total
		case types.AbilityCost_Loyalty:
			// CR 606.3: main phase, own turn, empty stack, and once per turn for the permanent's loyalty abilities.
			if !sorcery_timing(s, p) do return refuse("loyalty ability: sorcery timing")
			if loyalty_ability_used(s, o) do return refuse("a loyalty ability of it was activated this turn")
			// CR 606.6: removing counters it doesn't have can't be paid.
			if x.amount < 0 && int(o.loyalty.? or_else 0) < int(-x.amount) do return refuse("not enough loyalty")
		case types.AbilityCost_RemoveCounter:
			// CR 118.3: counters it doesn't have can't be removed to pay.
			kind := x.counter_type.(types.CounterMatch_OfType)._0
			if counter_count(o, kind) < x.count do return refuse("not enough counters")
		case types.AbilityCost_Mana:
			mana = x.cost
		}
	}
	if !slots_fillable(s, slot_list(a)[:], p, o.id) do return refuse("no legal targets")
	if c, has := object_cost(g, p, o, a); has && !cost_objects_leave_mana(s, p, c.choices[:], c.count, mana, o.id if taps_self else 0, Payment{o, false}) do return refuse("cost objects unavailable")
	if mana == nil do return true // no mana in the cost ("Sacrifice a creature: ...")
	_, payable := plan_payment(s, p, mana, o.id if taps_self else 0, nil, Payment{o, false})
	return payable || refuse("mana cost unpayable")
}

// CR 602.2: activating. The ability goes on the stack, its targets are chosen (the player is asked when the action
// doesn't name them), and its costs are paid.
activate_ability :: proc(g: ^Game, p: types.PlayerId, source: types.ObjectId, index: int) -> bool {
	s := &g.state
	o := object(s, source)
	if o == nil do return false
	if a := activated_ability(o, index); a != nil && object_supported(o, g.card_db) {
		if _, is_mana := mana_ability_option(a^); is_mana do return activate_mana_ability(g, p, o, a)
	}
	if !can_activate(g, p, o, index) do return false
	a := activated_ability(o, index)
	g.pending = Pending_Cast{object = source, ability_index = index}
	next_target_or_finish(g, p)
	return true
}

// CR 601.2h (by 602.2b): with the targets chosen, the player pays the costs, first choosing what to sacrifice or
// discard when the cost asks for that.
pay_activation :: proc(g: ^Game, p: types.PlayerId) {
	s := &g.state
	o := object(s, g.pending.object)
	a := activated_ability(o, g.pending.ability_index)
	if c, has := object_cost(g, p, o, a); has && !g.pending.cost_chosen {
		ask_cost_objects(g, p, c)
		return
	}
	finish_activation(g, p, g.pending.object, g.pending.ability_index, g.pending.targets[:])
	g.pending = {}
}

// The player's choice of what to sacrifice or discard for the cost: exactly the number asked, from the choices.
answer_cost_choice :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_PayCost, chosen: []types.ObjectId) -> bool {
	if g.pending.object == 0 || len(chosen) != w.count || has_duplicates(chosen) do return false
	for id in chosen do if !slice.contains(w.choices[:], id) do return false
	if !cost_choice_leaves_mana(g, p, chosen) do return false // CR 601.2h: the rest of the cost must still be payable
	g.pending.cost_objects = make([dynamic]types.ObjectId)
	append(&g.pending.cost_objects, ..chosen)
	g.pending.cost_chosen = true
	if g.pending.ability_index >= 0 do pay_activation(g, p)
	else do next_target_or_finish(g, p) // a spell's additional cost (CR 601.2h)
	return true
}

// The PayCost prompt for a cost that has the player choose objects.
ask_cost_objects :: proc(g: ^Game, p: types.PlayerId, c: Object_Cost) {
	choices := make([dynamic]types.ObjectId)
	append(&choices, ..c.choices[:])
	kind: types.PayCostKind = types.PayCostKind_Sacrifice{}
	if c.kind == .Discard do kind = types.PayCostKind_Discard{}
	if c.kind == .Exile_From_Graveyard do kind = types.PayCostKind_ExileFromZone{zone = .Graveyard}
	g.state.waiting_for = types.WaitingFor_PayCost{player = p, kind = kind, choices = choices, count = c.count, min_count = c.count, resume = types.CostResume_Resolution{}}
}

// CR 602.2b, 601.2h: the costs are paid; the ability is activated and its controller gets priority (CR 117.3c).
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
			pay_mana(g, p, x.cost, source if taps_self else 0, g.pending.cost_objects[:], Payment{object(s, source), false}) // CR 601.2h
		case types.AbilityCost_Tap:
			tap_permanent(o)
		case types.AbilityCost_PayLife:
			n, _ := fixed_quantity(x.amount)
			lose_life(s, p, n) // CR 119.4: paying life is losing it
		case types.AbilityCost_Loyalty:
			// CR 606.4: put on or remove that many loyalty counters.
			l := int(o.loyalty.? or_else 0) + int(x.amount)
			o.loyalty = u32(max(l, 0))
		case types.AbilityCost_RemoveCounter:
			remove_counters(o, x.counter_type.(types.CounterMatch_OfType)._0, x.count) // CR 602.2b, 601.2h
		}
	}
	// The chosen permanents are sacrificed and cards discarded after the mana is paid (CR 601.2g lets mana
	// abilities be activated first, so a land tapped for mana can still be sacrificed).
	together := begin_together() // paid at once ("sacrifice two creatures")
	for id in g.pending.cost_objects do pay_with_object(g, id)
	end_together(together)
	push_ability(g, source, p, a, targets, false, g.pending.counts[:], division = g.pending.division[:])
	record_activation(&s.activated_abilities_this_turn, o, index)
	record_activation(&s.activated_abilities_this_game, o, index)
	// Sacrificing it last: the ability on the stack is independent of its source (CR 113.7a).
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Sacrifice:
			if is_self(x._0.target) do sacrifice_permanent(g, source)
		case types.AbilityCost_Discard:
			if x.self_scope == .SourceCard do discard_card(g, source) // "discard this card" (CR 702.29a)
		case types.AbilityCost_Exile:
			if f, has := x.filter.?; has && is_self(f) do move_object(g, source, .Exile) // "exile this card from your graveyard" (CR 701.13a)
		}
	}
	s.priority_passes = nil
	give_priority(g, p)
}

// Whether the ability's cost includes discarding the card it's on.
discards_itself :: proc(a: types.AbilityDefinition) -> bool {
	cost, has := a.cost.?
	if !has do return false
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts(cost, &parts)
	for part in parts do if d, ok := part.(types.AbilityCost_Discard); ok && d.self_scope == .SourceCard do return true
	return false
}

cost_parts_of :: proc(c: types.AbilityCost, out: ^[dynamic]types.AbilityCost) {cost_parts(c, out)}

// CR 601.2h: whether `count` of the choices can be sacrificed or discarded and the mana still paid without them.
// Tries the choices that make no mana first.
cost_objects_leave_mana :: proc(s: ^types.GameState, p: types.PlayerId, choices: []types.ObjectId, count: int, mana: types.ManaCost, exclude: types.ObjectId, paying: Payment = {}) -> bool {
	if len(choices) < count do return false
	ordered := slice.clone(choices, context.temp_allocator)
	makes_mana :: proc(s: ^types.GameState, id: types.ObjectId) -> bool {
		o := object(s, id)
		if o.abilities == nil do return false
		for a in o.abilities^ do if _, ok := mana_ability_option(a); ok do return true
		return false
	}
	Ranked :: struct {
		id:   types.ObjectId,
		mana: bool,
	}
	ranked := make([dynamic]Ranked, context.temp_allocator)
	for id in ordered do append(&ranked, Ranked{id, makes_mana(s, id)})
	slice.sort_by(ranked[:], proc(a, b: Ranked) -> bool {return !a.mana && b.mana})
	picked := make([dynamic]types.ObjectId, context.temp_allocator)
	for r in ranked[:count] do append(&picked, r.id)
	if mana == nil do return true
	_, payable := plan_payment(s, p, mana, exclude, picked[:], paying)
	return payable
}

@(private = "file")
cost_choice_leaves_mana :: proc(g: ^Game, p: types.PlayerId, chosen: []types.ObjectId) -> bool {
	s := &g.state
	o := object(s, g.pending.object)
	if g.pending.ability_index < 0 {
		saved := cost_targets
		defer cost_targets = saved
		cost_targets = {spell = o.id, caster = p, targets = g.pending.targets[:]} // CR 601.2f
		_, payable := plan_payment(s, p, spell_cost(s, o, p), 0, chosen, Payment{o, true})
		return payable
	}
	a := activated_ability(o, g.pending.ability_index)
	cost, _ := a.cost.?
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts(cost, &parts)
	taps_self := false
	mana: types.ManaCost
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Tap:
			taps_self = true
		case types.AbilityCost_Mana:
			mana = x.cost
		}
	}
	if mana == nil do return true
	_, payable := plan_payment(s, p, mana, o.id if taps_self else 0, chosen, Payment{o, false})
	return payable
}

// Whether a loyalty ability of this permanent was activated this turn (CR 606.3).
loyalty_ability_used :: proc(s: ^types.GameState, o: ^types.GameObject) -> bool {
	if o.abilities == nil do return false
	for &a, i in o.abilities^ {
		cost, has := a.cost.?
		if !has do continue
		parts := make([dynamic]types.AbilityCost, context.temp_allocator)
		cost_parts(cost, &parts)
		for part in parts do if _, loyalty := part.(types.AbilityCost_Loyalty); loyalty && activations(s.activated_abilities_this_turn, o, i) > 0 do return true
	}
	return false
}

// The properties a graveyard cost filter may have: "in your graveyard", and those object_matches reads off the
// battlefield.
@(private = "file")
graveyard_props_supported :: proc(f: types.TypedFilter) -> bool {
	for p in f.properties {
		#partial switch _ in p {
		case types.FilterProp_InZone:
		case types.FilterProp_Another, types.FilterProp_HasColor, types.FilterProp_NotColor, types.FilterProp_Named,
		     types.FilterProp_HasSupertype, types.FilterProp_NotSupertype, types.FilterProp_Cmc:
			if !property_supported(p) do return false
		case:
			return false
		}
	}
	return true
}

@(private = "file")
has_remove_counter :: proc(c: types.AbilityCost) -> bool {
	#partial switch x in c {
	case types.AbilityCost_RemoveCounter:
		return true
	case types.AbilityCost_Composite:
		for part in x.costs do if has_remove_counter(part) do return true
	}
	return false
}
