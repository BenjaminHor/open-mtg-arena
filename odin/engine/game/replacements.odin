// Replacement effects (CR 614). Supported: a permanent's own "enters tapped" and "enters with N +1/+1 (or -1/-1)
// counters" (CR 614.1c, 614.12), which change how it enters rather than doing something after.
package game

import "core:reflect"
import "core:slice"
import "core:strings"
import types "../types"

replacement_supported :: proc(r: types.ReplacementDefinition) -> bool {
	if static_prevention_supported(r) do return true // prevention.odin
	if _, moved := r.event.(types.ReplacementEvent_Moved); !moved do return false
	if _, may_pay := entry_payment(r); may_pay do return true
	if _, copy := entry_copy_filter(r); copy do return true
	if _, choice := entry_choice(r); choice do return true
	if _, reveal := entry_reveal(r); reveal do return true
	if _, mandatory := r.mode.(types.ReplacementMode_Mandatory); !mandatory do return false
	if c, has := r.condition.?; has && !entry_condition_supported(c) do return false
	if r.execute == nil || r.execute.sub_ability != nil || r.execute.condition != nil do return false
	if dest, has := r.destination_zone.?; !has || dest != .Battlefield do return false
	f, has := r.valid_card.?
	if !has || !is_self(f) || r.execute.effect == nil do return false
	#partial switch e in r.execute.effect^ {
	case types.Effect_SetTapState:
		return is_self(e.target) && e.state == .Tap && e.scope == .Single
	case types.Effect_PutCounter:
		// A number, or an amount as it enters: "X +1/+1 counters" (the spell's X, CR 107.3m), "a counter for each".
		amount_ok := quantity_supported(e.count) && !quantity_reads_target(e.count)
		// Any counter this engine knows (counter_kind_supported): a Saga's lore counter (CR 715.3a), shield (CR 122.1c),
		// finality (CR 122.1h), and counters with no rules meaning of their own (oil, charge: CR 122.1).
		return amount_ok && is_self(e.target) && counter_kind_supported(e.counter_type)
	}
	return false
}

// "As this land enters, you may pay 2 life. If you don't, it enters tapped" (the shocklands): the life to pay.
entry_payment :: proc(r: types.ReplacementDefinition) -> (life: int, ok: bool) {
	m, may := r.mode.(types.ReplacementMode_MayCost)
	if !may || r.execute != nil || r.condition != nil || m.decline == nil do return
	if dest, has := r.destination_zone.?; !has || dest != .Battlefield do return
	if f, has := r.valid_card.?; !has || !is_self(f) do return
	pay, is_life := m.cost.(types.AbilityCost_PayLife)
	n, fixed := fixed_quantity(pay.amount)
	if !is_life || !fixed do return
	d := m.decline
	if d.sub_ability != nil || d.condition != nil || d.effect == nil do return
	tap, is_tap := d.effect^.(types.Effect_SetTapState)
	if !is_tap || !is_self(tap.target) || tap.state != .Tap || tap.scope != .Single do return
	return n, true
}

// CR 614.12, 616.1: the controller of a permanent entering with "as this enters, you may pay N life" chooses as it
// enters. The choice is asked before the next player would receive priority, the permanent still untapped until
// then (nothing can be done with it in between); declining taps it without its becoming tapped (it entered so).
ask_entry_payment :: proc(g: ^Game, after: types.PlayerId) -> bool {
	s := &g.state
	for len(g.entry_choices) > 0 {
		o := object(s, g.entry_choices[0])
		if o == nil || o.zone != .Battlefield {
			ordered_remove(&g.entry_choices, 0)
			continue
		}
		r, _ := entry_payment_of(o)
		g.entry_after = after
		cands := make([dynamic]types.ReplacementCandidateSummary)
		desc, _ := r.description.?
		append(&cands, types.ReplacementCandidateSummary{source_id = o.id, source_name = o.name, description = desc})
		append(&cands, types.ReplacementCandidateSummary{source_id = o.id, source_name = o.name, description = "Decline"})
		s.priority_player = o.controller
		s.waiting_for = types.WaitingFor_ReplacementChoice{player = o.controller, candidate_count = 2, candidates = cands, kind = .OptionalBranch}
		return true
	}
	return false
}

entry_payment_of_ok :: proc(o: ^types.GameObject) -> bool {
	_, ok := entry_payment_of(o)
	return ok
}

entry_payment_of :: proc(o: ^types.GameObject) -> (types.ReplacementDefinition, bool) {
	if o.replacement_definitions == nil do return {}, false
	for r in (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^ do if _, ok := entry_payment(r); ok do return r, true
	return {}, false
}

// The answer: 0 pays the life (CR 119.4: only with at least that much life), 1 declines and it's tapped.
answer_entry_payment :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ReplacementChoice, index: int) -> bool {
	s := &g.state
	if p != w.player || index < 0 || index > 1 do return false
	if len(g.entry_choices) == 0 {
		// A restored game: the prompt in the state names the land; priority then goes to the active player.
		if len(w.candidates) == 0 do return false
		append(&g.entry_choices, w.candidates[0].source_id)
		g.entry_after = s.active_player
	}
	o := object(s, g.entry_choices[0])
	if o == nil || entry_payment_of_ok(o) == false do return false
	r, _ := entry_payment_of(o)
	life, _ := entry_payment(r)
	if index == 0 {
		if int(player(s, p).life) < life do return false
		lose_life(s, p, life)
	} else {
		o.tapped = true
	}
	ordered_remove(&g.entry_choices, 0)
	s.waiting_for = nil
	give_priority(g, g.entry_after)
	return true
}

// "You may have this creature enter as a copy of any creature on the battlefield" (Clone, CR 707.9): what it may
// copy. One with exceptions ("except it enters with X counters") isn't read yet.
entry_copy_filter :: proc(r: types.ReplacementDefinition) -> (types.TargetFilter, bool) {
	opt, optional := r.mode.(types.ReplacementMode_Optional)
	if !optional || opt.decline != nil || r.condition != nil || r.execute == nil || r.execute.effect == nil || r.execute.sub_ability != nil do return nil, false
	if dest, has := r.destination_zone.?; !has || dest != .Battlefield do return nil, false
	if f, has := r.valid_card.?; !has || !is_self(f) do return nil, false
	if d, has := r.description.?; has && strings.contains(d, "except") do return nil, false
	bc, is_copy := r.execute.effect^.(types.Effect_BecomeCopy)
	if !is_copy || bc.duration != nil || bc.mana_value_limit != nil || len(bc.additional_modifications) > 0 do return nil, false
	if !mass_filter_supported(bc.target) do return nil, false
	return bc.target, true
}

entry_copy_of :: proc(o: ^types.GameObject) -> (types.TargetFilter, bool) {
	if o.replacement_definitions == nil do return nil, false
	for r in (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^ do if f, ok := entry_copy_filter(r); ok do return f, true
	return nil, false
}

// CR 707.9, 614.12: its controller chooses what it copies (or nothing) as it enters, asked before the next player
// would receive priority.
ask_entry_copy :: proc(g: ^Game, after: types.PlayerId) -> bool {
	s := &g.state
	for len(g.entry_copies) > 0 {
		o := object(s, g.entry_copies[0])
		f: types.TargetFilter
		ok := false
		if o != nil do f, ok = entry_copy_of(o)
		if !ok || o.zone != .Battlefield {
			ordered_remove(&g.entry_copies, 0)
			continue
		}
		valid := make([dynamic]types.ObjectId)
		// A token's copiable values come from what made it (CR 111.3); copying a token isn't supported yet, so only
		// card-backed creatures are offered.
		for p in affected_permanents(s, f, o.controller, o.id) do if p.id != o.id && !(p.is_token && p.printed_ref == nil) do append(&valid, p.id)
		if len(valid) == 0 {
			ordered_remove(&g.entry_copies, 0) // nothing to copy: it enters as itself
			continue
		}
		g.entry_after = after
		s.priority_player = o.controller
		s.waiting_for = types.WaitingFor_CopyTargetChoice{player = o.controller, source_id = o.id, valid_targets = valid, purpose = .BecomeCopy}
		return true
	}
	return false
}

// The answer: a creature to copy, or none (it stays itself). CR 707.2: the copy takes the copiable values, the
// card's printed characteristics (copy effects on that creature aren't carried yet); it keeps its own counters and
// status, as it's the same object.
answer_entry_copy :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_CopyTargetChoice, target: Maybe(types.TargetRef)) -> bool {
	s := &g.state
	if p != w.player do return false
	o := object(s, w.source_id)
	if o == nil do return false
	if t, has := target.?; has {
		id, is_object := target_object(t)
		if !is_object || !slice.contains(w.valid_targets[:], id) do return false
		original := object(s, id)
		card: ^types.CardExportEntry
		if g.card_db != nil && !(original.is_token && original.printed_ref == nil) do card = g.card_db(original.base_name if original.base_name != "" else original.name)
		if card == nil do return false
		become_copy(o, &card.face)
		// CR 707.5, 707.6: the copied card's "as this enters" and "enters with" abilities apply to it as it enters
		// (enters tapped, with counters), and its controller makes their choices.
		apply_entering_replacements(s, o)
		if _, may_pay := entry_payment_of(o); may_pay do append(&g.entry_choices, o.id)
		if _, names := entry_choice_of(o); names do append(&g.entry_names, o.id)
		if _, reveals := entry_reveal_of(o); reveals do append(&g.entry_reveals, o.id)
		apply_continuous_effects(g)
	}
	after := s.active_player // a restored game: the prompt alone, priority to the active player
	if len(g.entry_copies) > 0 && g.entry_copies[0] == w.source_id {
		ordered_remove(&g.entry_copies, 0)
		after = g.entry_after
	}
	s.waiting_for = nil
	give_priority(g, after)
	return true
}

// CR 707.2: the object's values become the copied card's, the values the layer pass starts from while it's on the
// battlefield (the copy is a layer 1 effect, CR 613.1a, that lasts as long as this object does). Which card it is
// stays in base_printed_ref: once it leaves the battlefield it's a new object with that card's values again
// (CR 400.7; move_object rebuilds it).
become_copy :: proc(o: ^types.GameObject, face: ^types.CardFace) {
	own := o.base_printed_ref
	set_card_characteristics(o, face)
	o.base_printed_ref = own
}

// Whether the object has a copy's values over its own card's (become_copy), and that card's name.
copying :: proc(o: ^types.GameObject) -> (own_card: string, is_copy: bool) {
	if o.is_token do return "", false
	own, has_own := o.base_printed_ref.?
	now, has_now := o.printed_ref.?
	if !has_own || !has_now || own.face_name == now.face_name do return "", false
	return own.face_name, true
}

// "Enters tapped unless ...": the conditions lands check as they enter.
entry_condition_supported :: proc(c: types.ReplacementCondition) -> bool {
	#partial switch x in c {
	case types.ReplacementCondition_CastViaKicker:
		return x.variant == nil && x.kicker_cost == nil // the one kicker cost
	case types.ReplacementCondition_OnlyIfQuantity:
		// "Enters with a +1/+1 counter if an opponent lost life this turn" (CR 614.1c).
		return x.active_player_req == nil && quantity_supported(x.lhs) && quantity_supported(x.rhs)
	case types.ReplacementCondition_UnlessControlsSubtype, types.ReplacementCondition_UnlessPlayerLifeAtMost,
	     types.ReplacementCondition_UnlessMultipleOpponents, types.ReplacementCondition_UnlessYourTurn,
	     types.ReplacementCondition_YouAttackedThisTurn:
		return true
	case types.ReplacementCondition_UnlessControlsOtherLeq:
		return typed_supported(x.filter)
	case types.ReplacementCondition_UnlessControlsMatching:
		return mass_filter_supported(x.filter)
	case types.ReplacementCondition_UnlessControlsCountMatching:
		return mass_filter_supported(x.filter)
	}
	return false
}

// Whether the replacement applies to the entering permanent `o`. CR 614.12: it's checked as the permanent would
// enter, so the permanent itself isn't among those its controller already controls.
entry_condition_holds :: proc(s: ^types.GameState, o: ^types.GameObject, c: types.ReplacementCondition) -> bool {
	count :: proc(s: ^types.GameState, o: ^types.GameObject, f: types.TypedFilter) -> int {
		n := 0
		for perm in permanents_of(s, o.controller) do if perm.id != o.id && object_matches(s, perm, f, o.controller, o.id) do n += 1
		return n
	}
	count_matching :: proc(s: ^types.GameState, o: ^types.GameObject, f: types.TargetFilter) -> int {
		n := 0
		for perm in permanents_of(s, o.controller) do if perm.id != o.id && mass_filter_matches(s, perm, f, o.controller, o.id) do n += 1
		return n
	}
	#partial switch x in c {
	case types.ReplacementCondition_UnlessControlsSubtype:
		for perm in permanents_of(s, o.controller) do if perm.id != o.id {
			for name in x.subtypes do if has_subtype(perm, name) do return false
		}
		return true
	case types.ReplacementCondition_UnlessControlsOtherLeq:
		return count(s, o, x.filter) > int(x.count)
	case types.ReplacementCondition_UnlessControlsMatching:
		return count_matching(s, o, x.filter) == 0
	case types.ReplacementCondition_UnlessControlsCountMatching:
		return count_matching(s, o, x.filter) < int(x.minimum)
	case types.ReplacementCondition_UnlessPlayerLifeAtMost:
		for &p in s.players do if p.life <= i32(x.amount) do return false
		return true
	case types.ReplacementCondition_UnlessMultipleOpponents:
		return len(s.players) <= 2 // a two-player game has one opponent
	case types.ReplacementCondition_UnlessYourTurn:
		return s.active_player != o.controller
	case types.ReplacementCondition_YouAttackedThisTurn:
		// Raid: "enters with a +1/+1 counter if you attacked this turn" (CR 508.1).
		for rec in s.attacker_declarations_this_turn do if rec.lki.controller == o.controller do return true
		return false
	case types.ReplacementCondition_OnlyIfQuantity:
		// CR 614.12: read as it's about to enter; it isn't among the permanents counted (not yet on the battlefield).
		return compare(quantity_value(s, x.lhs, o.controller, o.id, 0), x.comparator, quantity_value(s, x.rhs, o.controller, o.id, 0))
	case types.ReplacementCondition_CastViaKicker:
		return kicked(o) // "if it was kicked, it enters with ..." (CR 702.33d)
	}
	return true
}

// CR 614.12: as the permanent enters, its own replacement effects apply.
apply_entering_replacements :: proc(s: ^types.GameState, o: ^types.GameObject) {
	if o.replacement_definitions == nil do return
	// CR 107.3m: an X in its replacement effects is the X of the spell it was.
	x_defined = has_x(o.mana_cost)
	defer x_defined = false
	for r in (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^ {
		if !replacement_supported(r) || r.execute == nil do continue // "you may pay": asked later (ask_entry_payment)
		if c, has := r.condition.?; has && !entry_condition_holds(s, o, c) do continue
		#partial switch e in r.execute.effect^ {
		case types.Effect_SetTapState:
			o.tapped = true
		case types.Effect_PutCounter:
			n := quantity_value(s, e.count, o.controller, o.id, 0)
			if n > 0 do add_counters(o, e.counter_type, u32(n))
		}
	}
}

// Puts counters on an object: an event abilities trigger on ("whenever one or more +1/+1 counters are put on",
// a Saga's chapters), including the counters a permanent enters with (CR 122.6).
add_counters :: proc(o: ^types.GameObject, kind: types.CounterType, n: u32) {
	if n == 0 do return
	before := counter_count(o, kind)
	report(types.GameEvent_CounterAdded{object_id = o.id, counter_type = kind, count = n, actor = o.controller})
	if action_events != nil do append(action_events, Event{kind = .Counter_Added, object = o.id, controller = o.controller, counter = kind, amount = int(n), before = int(before), incarnation = o.incarnation})
	// Loyalty counters are kept as the permanent's loyalty (CR 306.5b, 209.1), the number its abilities' costs,
	// damage and CR 704.5i read.
	if _, loyalty := kind.(types.CounterType_Loyalty); loyalty {
		o.loyalty = (o.loyalty.? or_else 0) + n
		return
	}
	for &c in o.counters do if same_counter(c._0, kind) {
		c._1 += n
		return
	}
	append(&o.counters, types.Tuple2(types.CounterType, u32){kind, n})
}

// Whether two counters are of the same kind (CR 122.1): the same kind of counter, and for keyword and named
// counters the same keyword or name.
same_counter :: proc(a, b: types.CounterType) -> bool {
	if reflect.union_variant_typeid(a) != reflect.union_variant_typeid(b) do return false
	#partial switch x in a {
	case types.CounterType_Keyword:
		return x._0 == b.(types.CounterType_Keyword)._0
	case types.CounterType_Generic:
		return x._0 == b.(types.CounterType_Generic)._0
	case types.CounterType_PowerToughness:
		y := b.(types.CounterType_PowerToughness)
		return x.power == y.power && x.toughness == y.toughness
	}
	return true
}

counter_count :: proc(o: ^types.GameObject, kind: types.CounterType) -> u32 {
	if _, loyalty := kind.(types.CounterType_Loyalty); loyalty do return o.loyalty.? or_else 0
	for c in o.counters do if same_counter(c._0, kind) do return c._1
	return 0
}

remove_counters :: proc(o: ^types.GameObject, kind: types.CounterType, n: u32) {
	if _, loyalty := kind.(types.CounterType_Loyalty); loyalty {
		l := o.loyalty.? or_else 0
		o.loyalty = l - min(l, n)
		return
	}
	for c, i in o.counters do if same_counter(c._0, kind) {
		if c._1 <= n do ordered_remove(&o.counters, i)
		else do o.counters[i]._1 -= n
		return
	}
}

// Tapping a permanent (CR 701.26a: only an untapped one can be): an event abilities trigger on ("whenever this
// becomes tapped"). Entering tapped isn't becoming tapped.
tap_permanent :: proc(o: ^types.GameObject) {
	if o.tapped do return
	o.tapped = true
	report(types.GameEvent_PermanentTapped{object_id = o.id})
	if action_events != nil do append(action_events, Event{kind = .Tapped, object = o.id, controller = o.controller})
}

// Untapping a permanent (CR 701.26b). CR 122.1d: with a stun counter on it, a stun counter is removed instead.
untap :: proc(o: ^types.GameObject) {
	if !o.tapped do return
	if counter_count(o, types.CounterType_Stun{}) > 0 {
		remove_counters(o, types.CounterType_Stun{}, 1)
		return
	}
	o.tapped = false
	report(types.GameEvent_PermanentUntapped{object_id = o.id})
}

// The keyword a keyword counter gives (CR 122.1b), of those this engine carries out.
keyword_of_counter :: proc(k: types.KeywordKind) -> (types.Keyword, bool) {
	#partial switch k {
	case .Flying:
		return types.Keyword_Flying{}, true
	case .FirstStrike:
		return types.Keyword_FirstStrike{}, true
	case .DoubleStrike:
		return types.Keyword_DoubleStrike{}, true
	case .Trample:
		return types.Keyword_Trample{}, true
	case .Deathtouch:
		return types.Keyword_Deathtouch{}, true
	case .Lifelink:
		return types.Keyword_Lifelink{}, true
	case .Vigilance:
		return types.Keyword_Vigilance{}, true
	case .Haste:
		return types.Keyword_Haste{}, true
	case .Reach:
		return types.Keyword_Reach{}, true
	case .Menace:
		return types.Keyword_Menace{}, true
	case .Indestructible:
		return types.Keyword_Indestructible{}, true
	case .Hexproof:
		return types.Keyword_Hexproof{}, true
	}
	return nil, false
}
