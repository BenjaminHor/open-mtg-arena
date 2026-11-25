// Objects an instruction acts on without targeting them, chosen as it resolves (CR 608.2d, 115.10): "put a +1/+1
// counter on a creature you control", "untap up to three lands", "it deals 2 damage to another creature you
// control". Only what the text calls "target" is a target (CR 115.10a), so these are chosen while the instruction
// is carried out, from what's on the battlefield then (the token the instruction before made included), and
// hexproof, shroud and protection don't stop the choice (CR 702.11a, 702.18a and 702.16b are about targets).
//
// "Enchanted creature", "equipped creature" are the same kind of instruction with nothing to choose: the permanent
// the ability's source is attached to (CR 301.5, 303.4), as the source last was if it has left the battlefield
// (CR 608.2h).
package game

import "core:slice"
import types "../types"

// An instruction whose object is chosen as it resolves rather than targeted: the card data marks it with the
// Resolution timing, and it names a permanent by a filter. The kinds this engine carries out that way.
chosen_as_it_resolves :: proc(e: types.Effect, timing: types.TargetChoiceTiming) -> bool {
	if timing != .Resolution do return false
	#partial switch x in e {
	case types.Effect_PutCounter, types.Effect_DealDamage:
	case types.Effect_SetTapState:
		if x.scope != .Single do return false
	case types.Effect_ChangeZone:
		// "Exile enchanted creature": a permanent named by what's attached to it. (A card chosen from a hand or a
		// graveyard is zone_effects.odin's.)
		if origin, has := x.origin.?; has && origin != .Battlefield do return false
		if !names_attachment(x.target) do return false
	case:
		return false
	}
	_, typed := effect_target_filter(e).(types.TargetFilter_Typed)
	return typed
}

// Whether this engine can carry out such an instruction: a filter of permanents it reads, chosen by the ability's
// controller (not "each player chooses"), one object or a fixed range of them ("up to three lands"), nothing divided
// or repeated, and no later "it" (which would mean the chosen object, not yet kept as one).
resolution_choice_supported :: proc(a: types.AbilityDefinition) -> bool {
	if a.effect == nil do return false
	typed, ok := effect_target_filter(a.effect^).(types.TargetFilter_Typed)
	if !ok || !typed_supported(typed._0) do return false
	if a.player_scope != nil || a.distribute != nil || a.repeat_for != nil || a.unless_pay != nil do return false
	if a.target_selection_mode == .Random || a.target_chooser != nil do return false
	#partial switch x in a.effect^ {
	case types.Effect_DealDamage:
		if x.damage_source != nil || x.excess != nil do return false
	}
	if names_attachment(typed) {
		if a.multi_target != nil do return false
		// "If equipped creature is a Vampire, put two +1/+1 counters on it instead": the condition reads the host
		// live, not as the source last was (attached_host), so the two could disagree once the source has left.
		if c, has := a.condition.?; has && condition_reads_attachment(c) do return false
		for y := a.sub_ability; y != nil; y = y.sub_ability {
			if c, has := y.condition.?; has && condition_reads_attachment(c) do return false
		}
	} else if m, multi := a.multi_target.?; multi {
		least, fixed_min := fixed_quantity(m.min)
		most_q, has_max := m.max.?
		if !fixed_min || !has_max do return false // "any number of": not read yet
		most, fixed_max := fixed_quantity(most_q)
		if !fixed_max || least < 0 || most < max(least, 1) || most > 10 do return false
		// Tapping and untapping ask with a minimum; the other prompt only "exactly N" or "up to N".
		if _, taps := a.effect^.(types.Effect_SetTapState); !taps && least != 0 && least != most do return false
	}
	// "Put a +1/+1 counter on equipped creature if it's blue": a condition about "it" reads a target, which this
	// instruction doesn't have.
	if c, has := a.condition.?; has && reads_targets(c) do return false
	for y := a.sub_ability; y != nil; y = y.sub_ability {
		if y.effect != nil && refers_to_parent_target(y.effect^) do return false
		if c, has := y.condition.?; has && reads_targets(c) do return false
	}
	return true
}

// Conditions that count "equipped creature" or "enchanted creature" ("if equipped creature is a Vampire").
@(private = "file")
condition_reads_attachment :: proc(c: types.AbilityCondition) -> bool {
	counts_attached :: proc(q: types.QuantityExpr) -> bool {
		ref, is_ref := q.(types.QuantityExpr_Ref)
		if !is_ref do return false
		count, counts := ref.qty.(types.QuantityRef_ObjectCount)
		return counts && names_attachment(count.filter)
	}
	#partial switch x in c {
	case types.AbilityCondition_QuantityCheck:
		return counts_attached(x.lhs) || counts_attached(x.rhs)
	case types.AbilityCondition_ConditionInstead:
		return x.inner != nil && condition_reads_attachment(x.inner^)
	case types.AbilityCondition_And:
		for y in x.conditions do if condition_reads_attachment(y) do return true
	case types.AbilityCondition_Or:
		for y in x.conditions do if condition_reads_attachment(y) do return true
	case types.AbilityCondition_Not:
		return x.condition != nil && condition_reads_attachment(x.condition^)
	}
	return false
}

// Conditions that read the instruction before's target ("if that creature is attacking").
@(private = "file")
reads_targets :: proc(c: types.AbilityCondition) -> bool {
	#partial switch x in c {
	case types.AbilityCondition_HasObjectTarget, types.AbilityCondition_TargetMatchesFilter:
		return true
	case types.AbilityCondition_And:
		for y in x.conditions do if reads_targets(y) do return true
	case types.AbilityCondition_Or:
		for y in x.conditions do if reads_targets(y) do return true
	case types.AbilityCondition_Not:
		return x.condition != nil && reads_targets(x.condition^)
	}
	return false
}

// How many objects the instruction acts on: exactly one, or the card data's fixed range ("up to three").
@(private = "file")
choice_bounds :: proc(x: ^types.ResolvedAbility) -> (least, most: int) {
	least, most = 1, 1
	if m, multi := x.multi_target.?; multi {
		least, _ = fixed_quantity(m.min)
		if q, has := m.max.?; has do most, _ = fixed_quantity(q)
	}
	return
}

// The permanents the instruction can act on now, for its controller to choose from (CR 608.2d): every permanent the
// filter describes, not only those that could be targeted (CR 115.10a).
resolution_choices :: proc(g: ^Game, x: ^types.ResolvedAbility, controller: types.PlayerId, source: types.ObjectId) -> [dynamic]types.ObjectId {
	s := &g.state
	out := make([dynamic]types.ObjectId, context.temp_allocator)
	typed, ok := effect_target_filter(x.effect).(types.TargetFilter_Typed)
	if !ok do return out
	if names_attachment(typed) {
		// "Enchanted creature": the source's host, if it's still the kind of permanent named (an Aura that enchants
		// a creature that has stopped being one names no creature).
		if host := attached_host(g, source); host != nil && object_matches(s, host, without_attachment(typed._0), controller, source) do append(&out, host.id)
		return out
	}
	for id in ids_of(s.battlefield) {
		if object_matches(s, object(s, id), typed._0, controller, source) do append(&out, id)
	}
	return out
}

// The filter without "enchanted by / equipped by this": the host is found by attached_host, which reads the source
// as it last was when it has left the battlefield.
@(private = "file")
without_attachment :: proc(f: types.TypedFilter) -> types.TypedFilter {
	plain := f
	plain.properties = make([dynamic]types.FilterProp, context.temp_allocator)
	for p in f.properties {
		#partial switch _ in p {
		case types.FilterProp_EnchantedBy, types.FilterProp_EquippedBy, types.FilterProp_AttachedTo:
			continue
		}
		append(&plain.properties, p)
	}
	return plain
}

// The permanent the resolving ability's source is attached to. CR 608.2h: while the source is still on the
// battlefield (the same object, CR 400.7), what it's attached to now; once it has left (an Aura sacrificed to pay
// for its own ability, or destroyed in response), what it was attached to as it last existed there, while that's
// still the same object.
attached_host :: proc(g: ^Game, source: types.ObjectId) -> ^types.GameObject {
	s := &g.state
	if src := same_source(g, source); src != nil && src.zone == .Battlefield {
		host := host_of(s, src)
		if host != nil && host.zone == .Battlefield do return host
		return nil
	}
	r := &g.resolution
	if r.stack_id == 0 do return nil
	h, known := g.stack_hosts[r.stack_id]
	if !known do return nil
	host := object(s, h.id)
	if host == nil || host.zone != .Battlefield || host.incarnation != h.incarnation do return nil
	return host
}

// What an ability's source is attached to as the ability goes on the stack, for attached_host to find once the
// source has left: an Aura sacrificed as part of its ability's cost leaves after the ability is put on the stack
// (activated.odin), so it's still attached here. One that already left during this action (put into a graveyard by
// a state-based action before its triggered ability went on the stack) as it last existed (CR 608.2h).
remember_attached_host :: proc(g: ^Game, stack_id: types.ObjectId, source: types.ObjectId, was: ^types.GameObject = nil) {
	s := &g.state
	if _, known := g.stack_hosts[stack_id]; known do return
	src := object(s, source)
	if src == nil do return
	host := host_of(s, src)
	if host == nil && src.zone != .Battlefield {
		// The trigger's own record of its source as it left ("when this Equipment is put into a graveyard, exile
		// equipped creature"), else this action's.
		last := was if was != nil else last_known(source)
		if last != nil do host = host_of(s, last)
	}
	if host == nil || host.zone != .Battlefield do return
	g.stack_hosts[stack_id] = Same_Object{host.id, host.incarnation}
}

Same_Object :: struct {
	id:          types.ObjectId,
	incarnation: u64,
}

// Whether a "you may" instruction of this kind can be carried out: enough permanents to choose (CR 608.2d: an
// impossible option can't be chosen).
resolution_choice_possible :: proc(g: ^Game, x: ^types.ResolvedAbility, controller: types.PlayerId, source: types.ObjectId) -> bool {
	least, _ := choice_bounds(x)
	return len(resolution_choices(g, x, controller, source)) >= max(least, 1)
}

// Carries out the instruction on the permanents its controller chooses: at once when there's no choice to make (as
// many as it takes, or none), else asks. True while the player chooses.
start_resolution_choice :: proc(g: ^Game, x: ^types.ResolvedAbility) -> bool {
	s := &g.state
	r := &g.resolution
	eligible := resolution_choices(g, x, r.controller, r.source)
	least, most := choice_bounds(x)
	// CR 609.3: as much as possible; with fewer permanents than it asks for, those there are.
	least, most = min(least, len(eligible)), min(most, len(eligible))
	if most == 0 do return false
	if least == len(eligible) {
		act_on_chosen(g, x, eligible[:])
		return false
	}
	cards := make([dynamic]types.ObjectId)
	append(&cards, ..eligible[:])
	r.choosing = x
	s.priority_player = r.controller
	if tap, taps := x.effect.(types.Effect_SetTapState); taps {
		// The tap/untap prompt (CR 701.26).
		kind: types.EffectKind = .Tap if tap.state == .Tap else .Untap
		s.waiting_for = types.WaitingFor_EffectZoneChoice{player = r.controller, cards = cards, count = most, min_count = least, up_to = least < most, source_id = r.source, effect_kind = kind, zone = .Battlefield}
	} else {
		// "Exactly N" or "up to N" (resolution_choice_supported).
		s.waiting_for = types.WaitingFor_ChooseFromZoneChoice{player = r.controller, cards = cards, count = most, up_to = least < most, source_id = r.source}
	}
	return true
}

// The instruction, carried out on each chosen permanent at the same time (CR 603.2c: one event).
@(private = "file")
act_on_chosen :: proc(g: ^Game, x: ^types.ResolvedAbility, chosen: []types.ObjectId) {
	r := &g.resolution
	together := begin_together()
	for id in chosen do do_effect(g, x.effect, x.duration, r.controller, r.source, types.TargetRef(types.TargetRef_Object{id}))
	end_together(together)
}

// The controller's answer: the instruction is carried out on what they chose, and the resolution goes on.
answer_resolution_choice :: proc(g: ^Game, p: types.PlayerId, offered: []types.ObjectId, least, most: int, chosen: []types.ObjectId) -> bool {
	r := &g.resolution
	x := r.choosing
	if !r.active || x == nil || p != r.controller do return false
	if len(chosen) < least || len(chosen) > most || has_duplicates(chosen) do return false
	for id in chosen do if !slice.contains(offered, id) do return false
	r.choosing = nil
	g.state.waiting_for = nil
	// What the instruction reads as it's carried out, as continue_resolution sets it ("that much", "X").
	event_amount = r.event.amount
	event_object_now = r.event.object
	source_was_now = r.source_was
	moved_now = &r.moved
	act_on_chosen(g, x, chosen)
	moved_now = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// The choice the AI makes: for an instruction that harms what it acts on (tapping, damage, -1/-1 or stun counters,
// exile), the opponents' most valuable permanents first, then its own least valuable; for one that helps (untapping,
// other counters), its own most valuable first (for untapping, its tapped ones), then the rest. As few as it must for
// a harmful one it would aim at its own permanents; as many as it may otherwise.
ai_resolution_choice :: proc(g: ^Game, p: types.PlayerId, offered: []types.ObjectId, least, most: int) -> [dynamic]types.ObjectId {
	s := &g.state
	x := g.resolution.choosing
	harms := true
	if x != nil {
		#partial switch e in x.effect {
		case types.Effect_SetTapState:
			harms = e.state == .Tap
		case types.Effect_PutCounter:
			#partial switch _ in e.counter_type {
			case types.CounterType_Minus1Minus1, types.CounterType_Stun:
			case:
				harms = false
			}
		}
	}
	Ranked :: struct {
		id:    types.ObjectId,
		score: int,
		good:  bool, // worth choosing for its own sake
	}
	ranked := make([dynamic]Ranked, context.temp_allocator)
	for id in offered {
		o := object(s, id)
		value := mana_value(o.mana_cost)
		if is_type(o, .Creature) do value += power_of(o)
		mine := o.controller == p
		r := Ranked{id = id}
		if harms {
			r.good = !mine
			r.score = value if !mine else -value
		} else {
			r.good = mine && (o.tapped || !untaps(x)) // untapping an untapped land does nothing
			r.score = value if mine else -value
		}
		append(&ranked, r)
	}
	slice.sort_by(ranked[:], proc(a, b: Ranked) -> bool {
		if a.good != b.good do return a.good
		return a.score > b.score || (a.score == b.score && a.id < b.id)
	})
	out := make([dynamic]types.ObjectId, context.temp_allocator)
	for r in ranked {
		if len(out) >= most do break
		if len(out) >= least && !r.good do break
		append(&out, r.id)
	}
	return out
}

@(private = "file")
untaps :: proc(x: ^types.ResolvedAbility) -> bool {
	if x == nil do return false
	tap, taps := x.effect.(types.Effect_SetTapState)
	return taps && tap.state == .Untap
}
