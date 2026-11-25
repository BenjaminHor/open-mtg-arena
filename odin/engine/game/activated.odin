// Activated abilities (CR 602): "[cost]: [effect]" on permanents. Supported costs: mana (with "costs {1} less to
// activate for each ..." and power-up), {T}, life, loyalty, sacrificing, discarding, exiling, tapping untapped
// permanents, blighting, collecting evidence, removing counters, and combinations of them; "activate only as a
// sorcery". Mana abilities (CR 605) are in mana.odin.
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
		if c, has_cost := a.cost.?; has_cost && has_unnamed_remove_counter(c) do return false
	}
	// An activated ability that adds mana is a mana ability (CR 605.1a): it doesn't use the stack, and it's carried out
	// by mana.odin (mana_ability_option) or not at all.
	// Anywhere in it: "{T}: Put a charge counter on this. Add X mana of any one color" is one too.
	if adds_mana(a) do return false
	cost, has := a.cost.?
	if !has || !cost_supported(cost) do return false
	if a.activator_filter != nil || a.activation_mana_payment_restriction != nil do return false
	if r, reduced := a.cost_reduction.?; reduced && !cost_reduction_supported(a, r) do return false
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

// Whether an instruction of the ability adds mana: then it's a mana ability (CR 605.1a).
adds_mana :: proc(a: types.AbilityDefinition) -> bool {
	if _, mana := a.effect.(types.Effect_Mana); mana do return true
	for x := a.sub_ability; x != nil; x = x.sub_ability do if x.effect != nil do if _, mana := x.effect^.(types.Effect_Mana); mana do return true
	return false
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
		// "Discard a land card or Shrine card": any of several kinds.
		return each_typed_filter(f, proc(f: types.TypedFilter) -> bool {return typed_supported(f) && own_or_unrestricted(f)})
	case types.AbilityCost_PayLife:
		_, fixed := fixed_quantity(x.amount)
		return fixed
	case types.AbilityCost_Loyalty:
		return true // CR 606.4 (checked and paid below)
	case types.AbilityCost_RemoveCounter:
		if x.count < 1 do return false
		if t, has := x.target.?; has && !is_self(t) {
			if !sacrifice_filter_supported(t) do return false
			// "Remove three counters from among creatures you control": spread over any of them, of the kind named or
			// of any kind, as the player chooses.
			if x.selection == .AmongObjects {
				if kind, of_type := x.counter_type.(types.CounterMatch_OfType); of_type do return counter_kind_supported(kind._0)
				_, any_kind := x.counter_type.(types.CounterMatch_Any)
				return any_kind
			}
			// "Remove a +1/+1 counter from a creature you control": counters of one kind, from one permanent the
			// player chooses.
			kind, of_type := x.counter_type.(types.CounterMatch_OfType)
			return x.selection == .SingleObject && of_type && counter_kind_supported(kind._0)
		}
		if x.selection != .SingleObject do return false
		// "Remove two +1/+1 counters from this creature": counters of one kind from the ability's own permanent; or
		// "remove a counter from this creature", of any kind, the player choosing which when it has several kinds.
		#partial switch k in x.counter_type {
		case types.CounterMatch_OfType:
			return counter_kind_supported(k._0)
		case types.CounterMatch_Any:
			return true
		}
		return false
	case types.AbilityCost_Exile:
		f, has := x.filter.?
		zone, has_zone := x.zone.?
		if !has_zone {
			// "Exile this creature": the ability's own permanent, wherever it is; "exile a creature you control": a
			// permanent the player chooses.
			if !has do return false
			if is_self(f) do return x.count == 1
			return x.count >= 1 && x.count <= 10 && sacrifice_filter_supported(f)
		}
		// "Exile this card from your graveyard", or "exile N [kind of] cards from your graveyard" (chosen).
		if zone != .Graveyard do return false
		if !has do return x.count >= 1 && x.count <= 10 // "exile a card from your graveyard": any card
		if is_self(f) do return x.count == 1
		if x.count < 1 || x.count > 10 do return false
		// "Exile an instant or sorcery card from your graveyard": any of several kinds.
		return each_typed_filter(f, graveyard_card_filter_supported)
	case types.AbilityCost_TapCreatures:
		// "Tap three untapped creatures you control" (CR 701.26a): a number of them, not a total power.
		n, is_count := x.requirement.(types.TapCreaturesRequirement_Count)
		return is_count && n.count >= 1 && n.count <= 10 && sacrifice_filter_supported(x.filter)
	case types.AbilityCost_Blight:
		return x.count >= 1 // CR 701.68a
	case types.AbilityCost_CollectEvidence:
		return x.amount >= 1 // CR 701.59a
	case types.AbilityCost_ReturnToHand:
		// "Return an Elf you control to its owner's hand": permanents the player controls, chosen.
		if zone, has_zone := x.from_zone.?; has_zone && zone != .Battlefield do return false
		f, has := x.filter.?
		return has && !is_self(f) && x.count >= 1 && x.count <= 10 && sacrifice_filter_supported(f)
	case types.AbilityCost_EffectCost:
		// "Put a -1/-1 counter on this creature", "put a stun counter on it": counters on the ability's own permanent.
		// (Daniels, Temporal Agent's "put this card from your graveyard on the bottom of your library" comes without
		// the graveyard it works from: not read.)
		if x.effect == nil do return false
		put, is_put := x.effect^.(types.Effect_PutCounter)
		n, fixed := fixed_quantity(put.count)
		return is_put && is_self(put.target) && fixed && n >= 1 && counter_kind_supported(put.counter_type)
	case types.AbilityCost_Composite:
		// At most one part that has the player choose (object_cost asks for one).
		chosen := 0
		for part in x.costs {
			if !cost_supported(part) do return false
			if cost_part_chooses(part) do chosen += 1
		}
		return chosen <= 1
	}
	return false
}

// Whether paying this part of a cost has the player choose something: objects to sacrifice, discard, exile, tap,
// blight or remove counters from, or which kinds of counters to remove.
@(private = "file")
cost_part_chooses :: proc(part: types.AbilityCost) -> bool {
	#partial switch y in part {
	case types.AbilityCost_Sacrifice:
		return !is_self(y._0.target)
	case types.AbilityCost_Discard:
		return y.self_scope != .SourceCard
	case types.AbilityCost_Exile:
		f, has := y.filter.?
		return !has || !is_self(f)
	case types.AbilityCost_TapCreatures, types.AbilityCost_Blight, types.AbilityCost_CollectEvidence, types.AbilityCost_ReturnToHand:
		return true
	case types.AbilityCost_RemoveCounter:
		t, has := y.target.?
		if has && !is_self(t) do return true
		_, any_kind := y.counter_type.(types.CounterMatch_Any)
		return any_kind
	}
	return false
}

// A filter of one kind ("an artifact card") or of any of several ("an instant or sorcery card"), each kind passing
// `check`.
each_typed_filter :: proc(f: types.TargetFilter, check: proc(f: types.TypedFilter) -> bool) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		return check(x._0)
	case types.TargetFilter_Or:
		for y in x.filters do if !each_typed_filter(y, check) do return false
		return len(x.filters) > 0
	}
	return false
}

// A kind of card in the player's own graveyard ("a creature card from your graveyard").
@(private = "file")
graveyard_card_filter_supported :: proc(f: types.TypedFilter) -> bool {
	if c, has_c := f.controller.?; has_c {
		if _, you := c.(types.ControllerRef_You); !you do return false
	}
	for p in f.properties do if z, in_zone := p.(types.FilterProp_InZone); in_zone && z.zone != .Graveyard do return false
	plain := f
	plain.controller = nil
	plain.properties = nil
	return typed_supported(plain) && graveyard_props_supported(f)
}

// Whether a card in the player's hand or graveyard is of the kind (or one of the kinds) a cost names: their own
// card, so "you control" isn't read off it.
cost_card_matches :: proc(s: ^types.GameState, f: types.TargetFilter, card: ^types.GameObject, p: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		typed := x._0
		typed.controller = nil
		return object_matches(s, card, typed, p, source)
	case types.TargetFilter_Or:
		for y in x.filters do if cost_card_matches(s, y, card, p, source) do return true
	}
	return false
}

// What may be sacrificed: a kind of permanent the player controls (CR 701.21a), or any of several kinds ("an
// artifact or creature"). Also what may be tapped for a spell's additional cost ("tap two untapped artifacts,
// creatures, and/or lands you control").
sacrifice_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		// "Sacrifice a token", "tap two untapped tokens you control": no type named, any permanent with the
		// properties (typed_supported reads a filter naming no type as a player's).
		typed := x._0
		if len(typed.type_filters) == 0 && len(typed.properties) > 0 {
			typed.type_filters = make([dynamic]types.TypeFilter, context.temp_allocator)
			append(&typed.type_filters, types.TypeFilter_Permanent{})
		}
		return typed_supported(typed) && own_or_unrestricted(typed)
	case types.TargetFilter_Or:
		for y in x.filters do if !sacrifice_filter_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

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

// A cost that has the player choose objects: "sacrifice a creature", "discard a card" (CR 601.2h, 602.2b). The
// kinds after Exile_From_Graveyard are paid only as a spell's additional cost (additional_cost_part_supported).
Object_Cost_Kind :: enum {
	Sacrifice,
	Discard,
	Exile_From_Graveyard,
	Tap, // "tap two untapped creatures you control" (CR 701.26a)
	Behold, // CR 701.4a: a permanent you control or a card revealed from your hand
	Reveal, // "reveal a Pirate card from your hand" (CR 701.20a)
	Blight, // CR 701.68a: the creature the -1/-1 counters go on
	Collect_Evidence, // CR 701.59a: cards from your graveyard, with total mana value N or greater
	Remove_Counter, // "remove a +1/+1 counter from a creature you control": the permanent the counters come off
	Return_To_Hand, // "return an Elf you control to its owner's hand"
	Exile_Permanent, // "exile a creature you control"
	Remove_Counters_Among, // "remove three counters from among creatures you control": how many from which
}

Object_Cost :: struct {
	kind:           Object_Cost_Kind,
	count:          int, // how many to choose (for evidence: none fixed)
	choices:        [dynamic]types.ObjectId,
	counters:       int, // Blight: the -1/-1 counters put on the chosen creature; Remove_Counter: those removed
	counter:        types.CounterType, // Remove_Counter: their kind
	any_counter:    types.CounterMatch, // Remove_Counters_Among: the kind named, or any
	min_mana_value: int, // Collect_Evidence: the total mana value the chosen cards need
}

// Whether the objects chosen for a cost of this kind can't also pay the cost's mana: tapped or gone by then
// (CR 601.2g-h). A beheld or revealed card, a creature that gets -1/-1 counters or loses counters, and cards exiled
// from a graveyard are no mana sources the cost takes away.
cost_objects_used_up :: proc(kind: Object_Cost_Kind) -> bool {
	#partial switch kind {
	case .Behold, .Reveal, .Blight, .Collect_Evidence, .Remove_Counter, .Remove_Counters_Among:
		return false
	}
	return true
}

object_cost :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, a: ^types.AbilityDefinition) -> (Object_Cost, bool) {
	cost, has := a.cost.?
	if !has do return {}, false
	return object_cost_of(&g.state, p, o, cost)
}

object_cost_of :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, cost: types.AbilityCost) -> (Object_Cost, bool) {
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts(cost, &parts)
	taps_self := false
	for part in parts do if _, tap := part.(types.AbilityCost_Tap); tap do taps_self = true
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Sacrifice:
			if is_self(x._0.target) do continue
			c := Object_Cost{kind = .Sacrifice, count = int(x._0.requirement.(types.SacrificeRequirement_Count).count)}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			for perm in permanents_of(s, p) do if sacrifice_filter_matches(s, x._0.target, perm, p, o.id) do append(&c.choices, perm.id)
			return c, true
		case types.AbilityCost_ReturnToHand:
			c := Object_Cost{kind = .Return_To_Hand, count = int(x.count)}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			for perm in permanents_of(s, p) do if sacrifice_filter_matches(s, x.filter.?, perm, p, o.id) do append(&c.choices, perm.id)
			return c, true
		case types.AbilityCost_Exile:
			if f, has := x.filter.?; has && is_self(f) do continue // "exile this card": no choice
			zone, has_zone := x.zone.?
			if !has_zone {
				// "Exile a creature you control": from the battlefield.
				c := Object_Cost{kind = .Exile_Permanent, count = int(x.count)}
				c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
				for perm in permanents_of(s, p) do if sacrifice_filter_matches(s, x.filter.?, perm, p, o.id) do append(&c.choices, perm.id)
				return c, true
			}
			if zone != .Graveyard do continue
			// "Exile a [creature] card from your graveyard": the player's own graveyard (CR 404.1), the source excluded.
			c := Object_Cost{kind = .Exile_From_Graveyard, count = int(x.count)}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			f, has_filter := x.filter.?
			for id in ids_of(player(s, p).graveyard) {
				if id == o.id do continue
				if has_filter && !cost_card_matches(s, f, object(s, id), p, o.id) do continue
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
				if has && !cost_card_matches(s, f, object(s, id), p, o.id) do continue
				append(&c.choices, id)
			}
			return c, true
		case types.AbilityCost_TapCreatures:
			// "Tap two untapped creatures and/or lands you control": only untapped ones can be tapped (CR 118.3,
			// 701.26a). Unlike a {T} ability, the summoning sickness rule (CR 302.6) doesn't limit it, so a creature
			// can tap itself for "tap three untapped creatures you control"; but not when {T} taps it too ("{T}, tap
			// an untapped creature you control"): it can be tapped only once.
			c := Object_Cost{kind = .Tap, count = int(x.requirement.(types.TapCreaturesRequirement_Count).count)}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			for perm in permanents_of(s, p) {
				if perm.tapped || (taps_self && perm.id == o.id) do continue
				if sacrifice_filter_matches(s, x.filter, perm, p, o.id) do append(&c.choices, perm.id)
			}
			return c, true
		case types.AbilityCost_RemoveCounter:
			// "Remove a +1/+1 counter from a creature you control": one permanent that has them (CR 118.3).
			t, has := x.target.?
			if !has || is_self(t) do continue // from this permanent: no object chosen
			if x.selection == .AmongObjects {
				// From among them: any permanent of the kind with a counter that fits (CR 118.3).
				c := Object_Cost{kind = .Remove_Counters_Among, count = int(x.count), counters = int(x.count), any_counter = x.counter_type}
				c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
				for perm in permanents_of(s, p) do if removable_counters(perm, x.counter_type) > 0 && sacrifice_filter_matches(s, t, perm, p, o.id) do append(&c.choices, perm.id)
				return c, true
			}
			kind := x.counter_type.(types.CounterMatch_OfType)._0
			c := Object_Cost{kind = .Remove_Counter, count = 1, counters = int(x.count), counter = kind}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			for perm in permanents_of(s, p) do if counter_count(perm, kind) >= x.count && sacrifice_filter_matches(s, t, perm, p, o.id) do append(&c.choices, perm.id)
			return c, true
		case types.AbilityCost_Behold:
			// CR 701.4a: "reveal a [quality] card from your hand or choose a [quality] permanent you control". The spell
			// being cast isn't one of the cards in the hand (CR 601.2a: it's on the stack).
			c := Object_Cost{kind = .Behold, count = int(x.count)}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			f := x.filter.(types.TargetFilter_Typed)._0
			f.controller = nil
			for perm in permanents_of(s, p) do if object_matches(s, perm, f, p, o.id) do append(&c.choices, perm.id)
			for id in ids_of(player(s, p).hand) do if id != o.id && object_matches(s, object(s, id), f, p, o.id) do append(&c.choices, id)
			return c, true
		case types.AbilityCost_Reveal:
			// "Reveal a Pirate card from your hand" (CR 701.20a): not the spell itself.
			n, _ := fixed_quantity(x.count)
			c := Object_Cost{kind = .Reveal, count = n}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			f := x.filter.?.(types.TargetFilter_Typed)._0
			f.controller = nil
			for id in ids_of(player(s, p).hand) do if id != o.id && object_matches(s, object(s, id), f, p, o.id) do append(&c.choices, id)
			return c, true
		case types.AbilityCost_Blight:
			// CR 701.68a: N -1/-1 counters on one creature you control.
			c := Object_Cost{kind = .Blight, count = 1, counters = int(x.count)}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			for perm in permanents_of(s, p) do if is_type(perm, .Creature) do append(&c.choices, perm.id)
			return c, true
		case types.AbilityCost_CollectEvidence:
			// CR 701.59a: any number of cards from your graveyard with total mana value N or greater; not the spell
			// itself, when it's cast from there.
			c := Object_Cost{kind = .Collect_Evidence, min_mana_value = int(x.amount)}
			c.choices = make([dynamic]types.ObjectId, context.temp_allocator)
			for id in ids_of(player(s, p).graveyard) do if id != o.id do append(&c.choices, id)
			return c, true
		}
	}
	return {}, false
}

// Whether the player has what the cost asks them to choose: enough objects, or (collecting evidence) cards with
// enough total mana value (CR 118.3, 701.59b, 701.68b). Kinds that use their objects up also leave the mana payable
// without them (cost_objects_leave_mana). `exclude`: a permanent that can't pay the mana either ({T} taps it).
cost_objects_available :: proc(s: ^types.GameState, p: types.PlayerId, c: Object_Cost, mana: types.ManaCost, paying: Payment = {}, exclude: types.ObjectId = 0) -> bool {
	if c.kind == .Collect_Evidence {
		total := 0
		for id in c.choices do total += object_mana_value(object(s, id))
		return total >= c.min_mana_value
	}
	if c.kind == .Remove_Counters_Among {
		total := 0
		for id in c.choices do total += removable_counters(object(s, id), c.any_counter)
		return total >= c.counters
	}
	if !cost_objects_used_up(c.kind) do return len(c.choices) >= c.count
	return cost_objects_leave_mana(s, p, c.choices[:], c.count, mana, exclude, paying)
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
			if t, has := x.target.?; has && !is_self(t) do continue // from a chosen permanent (object_cost)
			// CR 118.3: counters it doesn't have can't be removed to pay.
			if self_counters_removable(o, x.counter_type) < x.count do return refuse("not enough counters")
		}
	}
	if !slots_fillable(s, slot_list(a)[:], p, o.id) do return refuse("no legal targets")
	mana, reducible := activation_mana_cost(s, p, o, a)
	if !reducible do return refuse("cost reduction not supported for it")
	if c, has := object_cost(g, p, o, a); has && !cost_objects_available(s, p, c, mana, Payment{o, false}, o.id if taps_self else 0) do return refuse("cost objects unavailable")
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
	if ask_counter_kind(g, p, o, a) do return
	if c, has := object_cost(g, p, o, a); has && !g.pending.cost_chosen {
		ask_cost_objects(g, p, c)
		return
	}
	finish_activation(g, p, g.pending.object, g.pending.ability_index, g.pending.targets[:])
	g.pending = {}
}

// "Remove a counter from this creature", of any kind: the player chooses which kind for each counter, when the
// permanent has more than one kind to remove (CR 601.2h by 602.2b). The kinds chosen so far are kept until the cost
// is paid. Whether a choice was asked for.
@(private = "file")
ask_counter_kind :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, a: ^types.AbilityDefinition) -> bool {
	part, has := any_counter_removal(a^)
	if !has do return false
	for len(g.pending.counter_kinds) < int(part.count) {
		left := int(part.count) - len(g.pending.counter_kinds)
		kinds := counter_kinds_left(o, g.pending.counter_kinds[:])
		total := 0
		for k in kinds do total += k.n
		if total < left do return false // can_activate saw enough; nothing more to choose from
		// No choice: one kind left, or exactly as many counters left as are to be removed.
		if len(kinds) == 1 || total == left {
			for k in kinds do for _ in 0 ..< k.n do if len(g.pending.counter_kinds) < int(part.count) do append(&g.pending.counter_kinds, k.kind)
			continue
		}
		options := make([dynamic]types.CounterType)
		names := make([dynamic]string)
		for k in kinds {
			append(&options, k.kind)
			append(&names, counter_kind_name(k.kind))
		}
		g.state.waiting_for = types.WaitingFor_CostTypeChoice{player = p, choice_type = types.ChoiceType_CounterKind{options = options}, options = names, pending_cast = cost_pending_cast(g)}
		return true
	}
	return false
}

// The answer: one of the kinds offered, for the next counter removed.
answer_counter_kind :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_CostTypeChoice, choice: string) -> bool {
	kinds, is_counters := w.choice_type.(types.ChoiceType_CounterKind)
	if !is_counters || g.pending.object == 0 || g.pending.ability_index < 0 do return false
	for name, i in w.options do if name == choice && i < len(kinds.options) {
		append(&g.pending.counter_kinds, kinds.options[i])
		pay_activation(g, p)
		return true
	}
	return false
}

// The ability's "remove N counters from this", of any kind, if it has one.
@(private = "file")
any_counter_removal :: proc(a: types.AbilityDefinition) -> (types.AbilityCost_RemoveCounter, bool) {
	cost, has := a.cost.?
	if !has do return {}, false
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts(cost, &parts)
	for part in parts {
		x, removes := part.(types.AbilityCost_RemoveCounter)
		if !removes do continue
		if t, named := x.target.?; named && !is_self(t) do continue
		if _, any_kind := x.counter_type.(types.CounterMatch_Any); any_kind do return x, true
	}
	return {}, false
}

Counter_Kind_Count :: struct {
	kind: types.CounterType,
	n:    int,
}

// The kinds of counters on the permanent and how many of each, less those already chosen to be removed. Loyalty
// counters are kept apart from the others (add_counters).
counter_kinds_left :: proc(o: ^types.GameObject, chosen: []types.CounterType) -> [dynamic]Counter_Kind_Count {
	out := make([dynamic]Counter_Kind_Count, context.temp_allocator)
	if l := int(o.loyalty.? or_else 0); l > 0 do append(&out, Counter_Kind_Count{types.CounterType_Loyalty{}, l})
	for c in o.counters do if c._1 > 0 do append(&out, Counter_Kind_Count{c._0, int(c._1)})
	for k in chosen do for &e in out do if same_counter(e.kind, k) do e.n -= 1
	left := make([dynamic]Counter_Kind_Count, context.temp_allocator)
	for e in out do if e.n > 0 do append(&left, e)
	return left
}

// How many counters a "remove N counters from this" cost can take off the permanent: of the kind it names, or of any.
@(private = "file")
self_counters_removable :: proc(o: ^types.GameObject, m: types.CounterMatch) -> u32 {
	return u32(removable_counters(o, m))
}

// How many counters of the kind named, or of any kind, the permanent has.
removable_counters :: proc(o: ^types.GameObject, m: types.CounterMatch) -> int {
	if k, of_type := m.(types.CounterMatch_OfType); of_type do return int(counter_count(o, k._0))
	total := 0
	for k in counter_kinds_left(o, nil) do total += k.n
	return total
}

// The player's answer to "remove N counters from among ...": how many of which kind off which permanent, N in all,
// each a permanent offered, with that many counters of a kind the cost allows (CR 118.3).
answer_counter_distribution :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_PayCost, distribution: []types.CounterCostChoice) -> bool {
	kind, removes := w.kind.(types.PayCostKind_RemoveCounter)
	if !removes || kind.selection != .AmongObjects || g.pending.object == 0 || g.pending.ability_index < 0 do return false
	s := &g.state
	total: u32 = 0
	for r, i in distribution {
		if r.count == 0 || !slice.contains(w.choices[:], r.object_id) do return false
		if k, of_type := kind.counter_type.(types.CounterMatch_OfType); of_type && !same_counter(k._0, r.counter_type) do return false
		asked := r.count
		for e in distribution[:i] do if e.object_id == r.object_id && same_counter(e.counter_type, r.counter_type) do asked += e.count
		if counter_count(object(s, r.object_id), r.counter_type) < asked do return false
		total += r.count
	}
	if total != kind.count do return false
	g.pending.counter_removals = make([dynamic]types.CounterCostChoice)
	append(&g.pending.counter_removals, ..distribution)
	g.pending.cost_objects = make([dynamic]types.ObjectId)
	for r in distribution do append(&g.pending.cost_objects, r.object_id)
	g.pending.cost_chosen = true
	pay_activation(g, p)
	return true
}

// A counter kind as the player is shown it: "+1/+1", "-1/-1", "stun". Kept with the prompt that offers it, so not
// in the temporary allocator (freed after each call into the engine).
counter_kind_name :: proc(k: types.CounterType) -> string {
	switch x in k {
	case types.CounterType_Plus1Plus1:
		return "+1/+1"
	case types.CounterType_Minus1Minus1:
		return "-1/-1"
	case types.CounterType_PowerToughness:
		return fmt.aprintf("%+d/%+d", x.power, x.toughness)
	case types.CounterType_Loyalty:
		return "loyalty"
	case types.CounterType_Defense:
		return "defense"
	case types.CounterType_Stun:
		return "stun"
	case types.CounterType_Lore:
		return "lore"
	case types.CounterType_Time:
		return "time"
	case types.CounterType_Fade:
		return "fade"
	case types.CounterType_Age:
		return "age"
	case types.CounterType_Shield:
		return "shield"
	case types.CounterType_Finality:
		return "finality"
	case types.CounterType_Keyword:
		return strings.to_lower(fmt.tprintf("%v", x._0))
	case types.CounterType_Generic:
		return strings.clone(x._0)
	}
	return "counter"
}

// The player's choice of what to sacrifice or discard for the cost: exactly the number asked, from the choices.
answer_cost_choice :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_PayCost, chosen: []types.ObjectId) -> bool {
	if g.pending.object == 0 || len(chosen) != w.count || has_duplicates(chosen) do return false
	if g.pending.cost_kind == .Remove_Counters_Among do return false // answered with how many from each (answer_counter_distribution)
	for id in chosen do if !slice.contains(w.choices[:], id) do return false
	// CR 601.2h: the rest of the cost must still be payable (without what's tapped or sacrificed for it).
	if cost_objects_used_up(g.pending.cost_kind) && !cost_choice_leaves_mana(g, p, chosen) do return false
	take_cost_objects(g, p, chosen)
	return true
}

// CR 701.68a: the creature a spell's blight cost puts its -1/-1 counters on.
answer_blight_choice :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_BlightChoice, chosen: []types.ObjectId) -> bool {
	if g.pending.object == 0 || len(chosen) != 1 || !slice.contains(w.creatures[:], chosen[0]) do return false
	take_cost_objects(g, p, chosen)
	return true
}

// CR 701.59a: the cards collected as evidence: any number of them, with total mana value N or greater.
answer_evidence_choice :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_CollectEvidenceChoice, chosen: []types.ObjectId) -> bool {
	if g.pending.object == 0 || has_duplicates(chosen) do return false
	total := 0
	for id in chosen {
		if !slice.contains(w.cards[:], id) do return false
		total += object_mana_value(object(&g.state, id))
	}
	if total < int(w.minimum_mana_value) do return false
	take_cost_objects(g, p, chosen)
	return true
}

// The objects chosen for the cost, kept until it's paid; then the casting or activation goes on.
@(private = "file")
take_cost_objects :: proc(g: ^Game, p: types.PlayerId, chosen: []types.ObjectId) {
	g.pending.cost_objects = make([dynamic]types.ObjectId)
	append(&g.pending.cost_objects, ..chosen)
	g.pending.cost_chosen = true
	if g.pending.ability_index >= 0 do pay_activation(g, p)
	else do next_target_or_finish(g, p) // a spell's additional cost (CR 601.2h)
}

// The prompt for a cost that has the player choose objects: PayCost, or blight's and evidence's own.
ask_cost_objects :: proc(g: ^Game, p: types.PlayerId, c: Object_Cost) {
	g.pending.cost_kind = c.kind
	choices := make([dynamic]types.ObjectId)
	append(&choices, ..c.choices[:])
	kind: types.PayCostKind
	switch c.kind {
	case .Sacrifice:
		kind = types.PayCostKind_Sacrifice{}
	case .Discard:
		kind = types.PayCostKind_Discard{}
	case .Exile_From_Graveyard:
		kind = types.PayCostKind_ExileFromZone{zone = .Graveyard}
	case .Tap:
		kind = types.PayCostKind_TapCreatures{mode = types.TapCreaturesSelectionMode_Fixed{}}
	case .Behold:
		kind = types.PayCostKind_Behold{action = .ChooseOrReveal}
	case .Reveal:
		kind = types.PayCostKind_Reveal{}
	case .Return_To_Hand:
		kind = types.PayCostKind_ReturnToHand{}
	case .Exile_Permanent:
		kind = types.PayCostKind_ExilePermanent{}
	case .Remove_Counters_Among:
		kind = types.PayCostKind_RemoveCounter{counter_type = c.any_counter, count = u32(c.counters), selection = .AmongObjects}
	case .Remove_Counter:
		kind = types.PayCostKind_RemoveCounter{counter_type = types.CounterMatch_OfType{c.counter}, count = u32(c.counters), selection = .SingleObject}
	case .Blight:
		g.state.waiting_for = types.WaitingFor_BlightChoice{player = p, counters = u32(c.counters), creatures = choices, pending_cast = cost_pending_cast(g)}
		return
	case .Collect_Evidence:
		resume := new(types.CollectEvidenceResume)
		resume^ = types.CollectEvidenceResume_Casting{pending_cast = cost_pending_cast(g), source = .Other}
		g.state.waiting_for = types.WaitingFor_CollectEvidenceChoice{player = p, minimum_mana_value = u32(c.min_mana_value), cards = choices, resume = resume}
		return
	}
	g.state.waiting_for = types.WaitingFor_PayCost{player = p, kind = kind, choices = choices, count = c.count, min_count = c.count, resume = types.CostResume_Resolution{}}
}

// The spell being cast, as a prompt names it.
@(private = "file")
cost_pending_cast :: proc(g: ^Game) -> ^types.PendingCast {
	o := object(&g.state, g.pending.object)
	pending := new(types.PendingCast)
	pending.object_id = o.id
	pending.card_id = o.card_id
	pending.cost = o.mana_cost
	return pending
}

// CR 602.2b, 601.2h: the costs are paid; the ability is activated and its controller gets priority (CR 117.3c).
finish_activation :: proc(g: ^Game, p: types.PlayerId, source: types.ObjectId, index: int, targets: []types.TargetRef) {
	s := &g.state
	o := object(s, source)
	a := activated_ability(o, index)
	// CR 601.2f: the total cost is worked out, and locked in, before any of it is paid ("costs {1} less for each
	// creature card in your graveyard" counts before a creature is sacrificed for it).
	mana, _ := activation_mana_cost(s, p, o, a)
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost, _ := a.cost.?
	cost_parts(cost, &parts)
	taps_self := false
	for part in parts do if _, tap := part.(types.AbilityCost_Tap); tap do taps_self = true
	// Mana first (CR 601.2g lets mana abilities be activated before the costs are paid, so a land tapped for mana can
	// still be sacrificed), but not from what the rest of the cost taps or takes away (CR 601.2h).
	others := g.pending.cost_objects[:] if cost_objects_used_up(g.pending.cost_kind) else nil
	if mana != nil do pay_mana(g, p, mana, source if taps_self else 0, others, Payment{o, false})
	for part in parts {
		#partial switch x in part {
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
			// CR 602.2b, 601.2h: off this permanent, of the kind named or of the kinds the player chose. (From another
			// permanent: paid with the chosen objects below.)
			if t, named := x.target.?; named && !is_self(t) do continue
			if kind, of_type := x.counter_type.(types.CounterMatch_OfType); of_type do remove_counters(o, kind._0, x.count)
			else do for k in g.pending.counter_kinds do remove_counters(o, k, 1)
		case types.AbilityCost_EffectCost:
			// "Put a stun counter on this creature" (CR 601.2h).
			if put, is_put := x.effect^.(types.Effect_PutCounter); is_put {
				n, _ := fixed_quantity(put.count)
				add_counters(o, put.counter_type, u32(n))
			}
		}
	}
	pay_cost_objects(g, p, cost)
	push_ability(g, source, p, a, targets, false, g.pending.counts[:], division = g.pending.division[:])
	record_activation(&s.activated_abilities_this_turn, o, index)
	record_activation(&s.activated_abilities_this_game, o, index)
	// Sacrificing it last: the ability on the stack is independent of its source (CR 113.7a).
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Sacrifice:
			if is_self(x._0.target) do sacrifice_permanent(g, source)
		case types.AbilityCost_Discard:
			// "Discard this card" (CR 702.29a); for a cycling or typecycling ability, that card is cycled (CR 702.29c,
			// 702.29f), which "when you cycle" abilities trigger on.
			tag, tagged := a.ability_tag.?
			if x.self_scope == .SourceCard do discard_card(g, source, cycling = tagged && tag == .Cycling)
		case types.AbilityCost_Exile:
			if f, has := x.filter.?; has && is_self(f) do move_object(g, source, .Exile) // "exile this card from your graveyard" (CR 701.13a)
		}
	}
	s.priority_passes = nil
	give_priority(g, p)
}

// CR 601.2h (and 602.2b): the objects the player chose for the cost pay it, as the cost's kind says: sacrificed,
// discarded or exiled (pay_with_object), tapped, revealed or beheld, given the blight's -1/-1 counters, or the
// counters removed from them. At once ("sacrifice two creatures").
pay_cost_objects :: proc(g: ^Game, p: types.PlayerId, cost: types.AbilityCost) {
	s := &g.state
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts(cost, &parts)
	together := begin_together()
	switch g.pending.cost_kind {
	case .Sacrifice, .Discard, .Exile_From_Graveyard, .Collect_Evidence:
		for id in g.pending.cost_objects do pay_with_object(g, id) // evidence: exiled from the graveyard (CR 701.59a)
	case .Tap:
		for id in g.pending.cost_objects do tap_permanent(object(s, id)) // CR 701.26a
	case .Return_To_Hand:
		for id in g.pending.cost_objects do move_object(g, id, .Hand) // to its owner's hand
	case .Exile_Permanent:
		for id in g.pending.cost_objects do move_object(g, id, .Exile) // CR 701.13a
	case .Behold, .Reveal:
		// CR 701.20a: a card from the hand is shown to all players and stays where it is (701.20b); a permanent
		// beheld is only chosen (CR 701.4a).
		revealed := make([dynamic]types.ObjectId)
		names := make([dynamic]string)
		for id in g.pending.cost_objects do if c := object(s, id); c.zone == .Hand {
			append(&revealed, id)
			append(&names, c.name)
		}
		if len(revealed) > 0 do report(types.GameEvent_CardsRevealed{player = p, card_ids = revealed, card_names = names})
	case .Blight:
		// CR 701.68a: N -1/-1 counters on the chosen creature.
		for part in parts do if b, ok := part.(types.AbilityCost_Blight); ok {
			for id in g.pending.cost_objects do add_counters(object(s, id), types.CounterType_Minus1Minus1{}, b.count)
		}
	case .Remove_Counters_Among:
		// As many of each kind off each permanent as the player said (answer_counter_distribution).
		for r in g.pending.counter_removals do remove_counters(object(s, r.object_id), r.counter_type, r.count)
	case .Remove_Counter:
		// "Remove a +1/+1 counter from a creature you control": off the chosen permanent.
		for part in parts do if r, ok := part.(types.AbilityCost_RemoveCounter); ok {
			if t, named := r.target.?; !named || is_self(t) do continue
			for id in g.pending.cost_objects do remove_counters(object(s, id), r.counter_type.(types.CounterMatch_OfType)._0, r.count)
		}
	}
	end_together(together)
}

// CR 601.2f, 602.2b: the mana the ability costs to activate now: its activation cost's mana, less its own "this
// ability costs {1} less to activate for each ..." or power-up reduction. Nil when the cost has no mana. Not ok when
// the reduction can't be worked out for this permanent (power-up with a mana cost of hybrid symbols).
activation_mana_cost :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, a: ^types.AbilityDefinition) -> (types.ManaCost, bool) {
	cost, has := a.cost.?
	if !has do return nil, true
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts(cost, &parts)
	printed: types.ManaCost
	for part in parts do if m, is_mana := part.(types.AbilityCost_Mana); is_mana do printed = m.cost
	r, reduced := a.cost_reduction.?
	if !reduced || printed == nil do return printed, true
	mana, plain := printed.(types.ManaCost_Cost)
	if !plain do return printed, false
	c := mana
	shards := make([dynamic]types.ManaCostShard, context.temp_allocator)
	append(&shards, ..mana.shards[:])
	c.shards = shards
	if tag, tagged := a.ability_tag.?; tagged && tag == .PowerUp {
		// CR 702.193a: "If this permanent entered this turn, this ability's cost is reduced by this permanent's mana
		// cost."
		if o.entered_battlefield_turn != s.turn_number do return c, true
		by, plain := plain_mana_cost(o.mana_cost)
		if !plain do return c, false
		reduce_by_mana_cost(&c, by)
		return c, true
	}
	if cond, has := r.condition.?; has && !reduction_condition_holds(s, p, o, cond) do return c, true
	// CR 118.7a: generic mana off the generic part only; CR 601.2f: not below {0}.
	n := int(r.amount_per) * quantity_value(s, r.count, p, o.id, 0)
	c.generic = u32(max(int(c.generic) - max(n, 0), 0))
	return c, true
}

// The activation cost's mana part, when it's a plain cost (no {X}).
@(private = "file")
activation_mana_part :: proc(a: types.AbilityDefinition) -> (types.ManaCost_Cost, bool) {
	cost, has := a.cost.?
	if !has do return {}, false
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts(cost, &parts)
	for part in parts do if m, ok := part.(types.AbilityCost_Mana); ok {
		c, is_cost := m.cost.(types.ManaCost_Cost)
		return c, is_cost
	}
	return {}, false
}

// "This ability costs {1} less to activate for each Town you control", "costs {2} less if you control a legendary
// creature", "during your turn" (CR 602.2b, 601.2f); and power-up (CR 702.193a). Not yet: a reduction that reads the
// ability's targets ("if it targets a creature with power 3 or less"), which would be worked out after they're
// chosen.
cost_reduction_supported :: proc(a: types.AbilityDefinition, r: types.CostReduction) -> bool {
	if r.mode != .Reduce do return false
	mana, has_mana := activation_mana_part(a)
	if !has_mana do return false
	if tag, tagged := a.ability_tag.?; tagged && tag == .PowerUp {
		// CR 702.193b: the permanent's colored mana reduces the same colored mana of the cost; a cost of plain symbols
		// only, so which symbol it reduces is never a choice (the permanent's own mana cost is checked by
		// power_up_supported).
		if _, plain := plain_mana_cost(mana); !plain do return false
		cond, has := r.condition.?
		if !has do return false
		_, entered := cond.(types.ParsedCondition_SourceEnteredThisTurn)
		return entered
	}
	if r.amount_per < 1 || !quantity_supported(r.count) || quantity_reads_target(r.count) do return false
	if c, has := r.condition.?; has && !reduction_condition_supported(c) do return false
	return true
}

// A card's power-up abilities: its mana cost is what they're reduced by (CR 702.193b), so it must be one of plain
// symbols (a hybrid symbol's half is the player's choice, CR 118.7e: not yet).
power_up_supported :: proc(face: ^types.CardFace) -> bool {
	for a in face.abilities {
		tag, tagged := a.ability_tag.?
		if a.kind != .Activated || !tagged || tag != .PowerUp || a.cost_reduction == nil do continue
		if _, plain := plain_mana_cost(face.mana_cost); !plain do return false
	}
	return true
}

// A mana cost of generic mana and colored or colorless symbols only.
@(private = "file")
plain_mana_cost :: proc(m: types.ManaCost) -> (types.ManaCost_Cost, bool) {
	c, is_cost := m.(types.ManaCost_Cost)
	if !is_cost do return {}, false
	for shard in c.shards {
		#partial switch shard {
		case .White, .Blue, .Black, .Red, .Green, .Colorless:
		case:
			return {}, false
		}
	}
	return c, true
}

// CR 702.193b, 118.7b-c: generic mana reduces generic mana; each colored or colorless symbol reduces one of the same
// type, or else that much generic mana. Never below {0} (CR 601.2f).
@(private = "file")
reduce_by_mana_cost :: proc(c: ^types.ManaCost_Cost, by: types.ManaCost_Cost) {
	generic := int(c.generic) - int(by.generic)
	shards := make([dynamic]types.ManaCostShard, context.temp_allocator)
	append(&shards, ..c.shards[:])
	for shard in by.shards {
		if i, found := slice.linear_search(shards[:], shard); found do ordered_remove(&shards, i)
		else do generic -= 1
	}
	c.shards = shards
	c.generic = u32(max(generic, 0))
}

// The conditions a reduction may have: "if you control a legendary creature" (an amount compared), "during your
// turn".
@(private = "file")
reduction_condition_supported :: proc(c: types.ParsedCondition) -> bool {
	#partial switch x in c {
	case types.ParsedCondition_QuantityComparison:
		return quantity_supported(x.lhs) && quantity_supported(x.rhs) && !quantity_reads_target(x.lhs) && !quantity_reads_target(x.rhs)
	case types.ParsedCondition_IsYourTurn, types.ParsedCondition_IsOpponentsTurn:
		return true
	}
	return false
}

@(private = "file")
reduction_condition_holds :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, c: types.ParsedCondition) -> bool {
	#partial switch x in c {
	case types.ParsedCondition_QuantityComparison:
		return compare(quantity_value(s, x.lhs, p, o.id, 0), x.comparator, quantity_value(s, x.rhs, p, o.id, 0))
	case types.ParsedCondition_IsYourTurn:
		return s.active_player == p
	case types.ParsedCondition_IsOpponentsTurn:
		return s.active_player != p
	}
	return false
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

// Whether the permanent has a mana ability: one that paying a cost with it may take away from the mana.
makes_mana :: proc(s: ^types.GameState, id: types.ObjectId) -> bool {
	o := object(s, id)
	if o.abilities == nil do return false
	for a in o.abilities^ do if _, ok := mana_ability_option(a); ok do return true
	return false
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
	for part in parts do if _, tap := part.(types.AbilityCost_Tap); tap do taps_self = true
	mana, _ := activation_mana_cost(s, p, o, a)
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

// A remove-counter cost that names no object (read as "from this").
@(private = "file")
has_unnamed_remove_counter :: proc(c: types.AbilityCost) -> bool {
	#partial switch x in c {
	case types.AbilityCost_RemoveCounter:
		return x.target == nil
	case types.AbilityCost_Composite:
		for part in x.costs do if has_unnamed_remove_counter(part) do return true
	}
	return false
}
