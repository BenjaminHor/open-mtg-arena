// Replacement effects (CR 614). Supported: a permanent's own replacement effects that modify how it enters (CR
// 614.1c, 614.12): "enters tapped", "enters with N counters", choices made as it enters (pay life or enter tapped,
// riot, "your choice of a deathtouch counter or a lifelink counter", "choose a color", "enter as a copy").
package game

import "core:reflect"
import "core:slice"
import "core:strings"
import types "../types"

replacement_supported :: proc(r: types.ReplacementDefinition) -> bool {
	if static_prevention_supported(r) do return true // prevention.odin
	if _, moved := r.event.(types.ReplacementEvent_Moved); !moved do return false
	if entry_option(r) do return true
	if _, copy := entry_copy_filter(r); copy do return true
	if _, choice := entry_choice(r); choice do return true
	if _, reveal := entry_reveal(r); reveal do return true
	return entering_replacement(r)
}

// Whether the replacement is about this permanent entering the battlefield (CR 614.12: one from the permanent
// itself affects only it).
@(private = "file")
enters_self :: proc(r: types.ReplacementDefinition) -> bool {
	if _, moved := r.event.(types.ReplacementEvent_Moved); !moved do return false
	if dest, has := r.destination_zone.?; !has || dest != .Battlefield do return false
	f, has := r.valid_card.?
	return has && is_self(f)
}

// A replacement that changes how the permanent enters with no choice to make: "this land enters tapped", "enters
// with two +1/+1 counters", "if it was kicked, it enters with ... and with haste", "enters tapped with three stun
// counters" (CR 614.1c), applied as it enters (apply_entering_replacements).
entering_replacement :: proc(r: types.ReplacementDefinition) -> bool {
	if _, mandatory := r.mode.(types.ReplacementMode_Mandatory); !mandatory || !enters_self(r) do return false
	if c, has := r.condition.?; has && !entry_condition_supported(c) do return false
	return entering_instructions_supported(r.execute)
}

// The instructions of an entry replacement, each one about the entering permanent itself, with no condition of its own.
entering_instructions_supported :: proc(a: ^types.AbilityDefinition) -> bool {
	if a == nil || a.effect == nil || a.condition != nil || a.cost != nil || a.optional || a.else_ability != nil do return false
	if a.player_scope != nil || a.repeat_for != nil || a.modal != nil do return false
	if !entering_instruction_supported(a.effect^) do return false
	return a.sub_ability == nil || entering_instructions_supported(a.sub_ability)
}

@(private = "file")
entering_instruction_supported :: proc(e: types.Effect) -> bool {
	#partial switch x in e {
	case types.Effect_SetTapState:
		return is_self(x.target) && x.state == .Tap && x.scope == .Single
	case types.Effect_BecomePrepared:
		return prepare_effect_supported(x.target, x.scope) // "this creature enters prepared" (CR 723.3a)
	case types.Effect_PutCounter:
		// A number, or an amount as it enters: "X +1/+1 counters" (the spell's X, CR 107.3m), "a counter for each".
		amount_ok := quantity_supported(x.count) && !quantity_reads_target(x.count)
		// Any counter this engine knows (counter_kind_supported): a Saga's lore counter (CR 715.3a), shield (CR 122.1c),
		// finality (CR 122.1h), stun (CR 122.1d), keyword counters (CR 122.1b), and counters with no rules meaning of
		// their own (oil, charge: CR 122.1).
		return amount_ok && is_self(x.target) && counter_kind_supported(x.counter_type)
	case types.Effect_GenericEffect:
		return self_effect_supported(x)
	}
	return false
}

// "It enters with haste" (Voidpouncer), riot's "it gains haste" (CR 702.136a): an effect on the entering permanent
// alone, for as long as it's on the battlefield.
@(private = "file")
self_effect_supported :: proc(e: types.Effect_GenericEffect) -> bool {
	if e.end_cost != nil || len(e.static_abilities) == 0 do return false
	if t, has := e.target.?; has && !is_self(t) do return false
	if d, has := e.duration.?; has {
		#partial switch _ in d {
		case types.Duration_Permanent, types.Duration_UntilHostLeavesPlay:
		case:
			return false
		}
	}
	for st in e.static_abilities {
		if _, continuous := st.mode.(types.StaticMode_Continuous); !continuous || st.condition != nil do return false
		affected, has := st.affected.?
		if !has || !is_self(affected) do return false
		for m in st.modifications do if !modification_supported(m) do return false
	}
	return true
}

// Carries out an entry replacement's instructions on the permanent entering (CR 614.1c, 614.12).
apply_entering_instructions :: proc(g: ^Game, o: ^types.GameObject, a: ^types.AbilityDefinition) {
	s := &g.state
	// CR 107.3m: an X in its replacement effects is the X of the spell it was.
	outer := x_defined
	x_defined = has_x(o.mana_cost)
	defer x_defined = outer
	for step := a; step != nil; step = step.sub_ability {
		#partial switch e in step.effect^ {
		case types.Effect_SetTapState:
			o.tapped = true // entering tapped isn't becoming tapped (CR 701.26a)
		case types.Effect_BecomePrepared:
			become_prepared(s, o)
		case types.Effect_PutCounter:
			n := quantity_value(s, e.count, o.controller, o.id, 0)
			if n > 0 do add_counters(o, e.counter_type, u32(n))
		case types.Effect_GenericEffect:
			// CR 611.2a: it lasts as long as this object is on the battlefield; leaving makes a new object (CR 400.7),
			// which the effect, kept for this incarnation, doesn't apply to. The layer pass applies it before anyone
			// gets priority.
			for st in e.static_abilities {
				mods := slice.clone(st.modifications[:])
				append(&g.temp_effects, Temp_Effect{object = o.id, incarnation = o.incarnation, modifications = mods, permanent = true, modes = rule_modes(st.mode)})
			}
		}
	}
}

// ---- Choices made as it enters (CR 614.12a), asked before the next player would receive priority -------------

// "As this land enters, you may pay 2 life. If you don't, it enters tapped" (the shocklands), riot ("you may have
// this permanent enter with an additional +1/+1 counter on it. If you don't, it gains haste", CR 702.136a), and
// "this creature enters with your choice of a deathtouch counter or a lifelink counter on it": a replacement whose
// controller picks one of its ways to enter.
entry_option :: proc(r: types.ReplacementDefinition) -> bool {
	if _, may_pay := entry_payment(r); may_pay do return true
	if !enters_self(r) do return false
	if c, has := r.condition.?; has && !entry_condition_supported(c) do return false
	#partial switch m in r.mode {
	case types.ReplacementMode_Optional:
		// "You may have it enter with ...; if you don't, ..." (no "if you don't" is fine: then it enters as it is).
		if !entering_instructions_supported(r.execute) do return false
		return m.decline == nil || entering_instructions_supported(m.decline)
	case types.ReplacementMode_Mandatory:
		_, ok := entry_branches(r)
		return ok
	}
	return false
}

// "Enters with your choice of a flying counter or a first strike counter": the ways to enter, each its own
// instructions.
entry_branches :: proc(r: types.ReplacementDefinition) -> ([]types.AbilityDefinition, bool) {
	branches, ok := branches_of(r)
	if !ok do return nil, false
	for &b in branches do if !entering_instructions_supported(&b) do return nil, false
	return branches, true
}

// The branches of a "your choice of" replacement (entry_branches has checked them).
@(private = "file")
branches_of :: proc(r: types.ReplacementDefinition) -> ([]types.AbilityDefinition, bool) {
	if r.execute == nil || r.execute.effect == nil || r.execute.sub_ability != nil || r.execute.condition != nil do return nil, false
	c, is_choice := r.execute.effect^.(types.Effect_ChooseOneOf)
	if !is_choice || c.kind != .Ordinary || len(c.branches) < 2 do return nil, false
	if _, you := c.chooser.(types.PlayerFilter_Controller); !you do return nil, false
	return c.branches[:], true
}

// "As this land enters, you may pay 2 life. If you don't, it enters tapped" (the shocklands): the life to pay.
entry_payment :: proc(r: types.ReplacementDefinition) -> (life: int, ok: bool) {
	m, may := r.mode.(types.ReplacementMode_MayCost)
	if !may || r.execute != nil || r.condition != nil || m.decline == nil || !enters_self(r) do return
	pay, is_life := m.cost.(types.AbilityCost_PayLife)
	n, fixed := fixed_quantity(pay.amount)
	if !is_life || !fixed do return
	d := m.decline
	if d.sub_ability != nil || d.condition != nil || d.effect == nil do return
	tap, is_tap := d.effect^.(types.Effect_SetTapState)
	if !is_tap || !is_self(tap.target) || tap.state != .Tap || tap.scope != .Single do return
	return n, true
}

// A choice still to make as a permanent entered: which of its replacement definitions.
Entry_Option :: struct {
	object:      types.ObjectId,
	replacement: int,
}

// Queues each of the permanent's own entry choices (move_object, and a copy taking another card's, CR 707.6):
// the CR 616.1 order among them is fixed here (copy first, then the options in printed order, then names and
// reveals).
queue_entry_choices :: proc(g: ^Game, o: ^types.GameObject) {
	if o.replacement_definitions == nil do return
	outer := x_defined
	x_defined = has_x(o.mana_cost) // CR 107.3m
	defer x_defined = outer
	for r, i in (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^ {
		if entry_option(r) do append(&g.entry_choices, Entry_Option{o.id, i})
	}
	if _, names := entry_choice_of(o); names do append(&g.entry_names, o.id)
	if _, reveals := entry_reveal_of(o); reveals do append(&g.entry_reveals, o.id)
}

@(private = "file")
option_of :: proc(o: ^types.GameObject, index: int) -> (types.ReplacementDefinition, bool) {
	if o == nil || o.replacement_definitions == nil do return {}, false
	outer := x_defined
	x_defined = has_x(o.mana_cost) // CR 107.3m
	defer x_defined = outer
	defs := (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^
	if index < 0 || index >= len(defs) || !entry_option(defs[index]) do return {}, false
	return defs[index], true
}

// The first of the permanent's entry options (a restored game's prompt names only the permanent).
@(private = "file")
first_option_of :: proc(o: ^types.GameObject) -> (int, bool) {
	if o == nil || o.replacement_definitions == nil do return 0, false
	outer := x_defined
	x_defined = has_x(o.mana_cost) // CR 107.3m
	defer x_defined = outer
	for r, i in (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^ do if entry_option(r) do return i, true
	return 0, false
}

// CR 614.12, 616.1: the controller of the permanent entering chooses as it enters. The choice is asked before the
// next player would receive priority, the permanent as it is until then (nothing can be done with it in between).
// A replacement whose condition doesn't hold isn't asked about (CR 614.12: it doesn't apply).
ask_entry_payment :: proc(g: ^Game, after: types.PlayerId) -> bool {
	s := &g.state
	for len(g.entry_choices) > 0 {
		next := g.entry_choices[0]
		o := object(s, next.object)
		r, ok := option_of(o, next.replacement)
		if !ok || o.zone != .Battlefield {
			ordered_remove(&g.entry_choices, 0)
			continue
		}
		if c, has := r.condition.?; has && !entry_condition_holds(s, o, c) {
			ordered_remove(&g.entry_choices, 0)
			continue
		}
		g.entry_after = after
		s.priority_player = o.controller
		if branches, one_of := branches_of(r); one_of {
			descriptions := make([dynamic]string)
			for b in branches do append(&descriptions, b.description.? or_else "")
			s.waiting_for = types.WaitingFor_ChooseOneOfBranch{player = o.controller, controller = o.controller, source_id = o.id, branches = slice.clone_to_dynamic(branches), branch_descriptions = descriptions}
			return true
		}
		cands := make([dynamic]types.ReplacementCandidateSummary)
		accept := r.description.? or_else ""
		if r.execute != nil do if d, has := r.execute.description.?; has do accept = d // riot: "enters with an additional +1/+1 counter"
		decline := "Decline"
		if m, optional := r.mode.(types.ReplacementMode_Optional); optional && m.decline != nil {
			if d, has := m.decline.description.?; has do decline = d
		}
		append(&cands, types.ReplacementCandidateSummary{source_id = o.id, source_name = o.name, description = accept})
		append(&cands, types.ReplacementCandidateSummary{source_id = o.id, source_name = o.name, description = decline})
		s.waiting_for = types.WaitingFor_ReplacementChoice{player = o.controller, candidate_count = 2, candidates = cands, kind = .OptionalBranch}
		return true
	}
	return false
}

// The entry option being asked: the queue's first, or, in a restored game (the prompt alone, `queued` false), the
// first of the permanent the prompt names, priority then going to the active player.
@(private = "file")
current_entry_option :: proc(g: ^Game, subject: types.ObjectId) -> (o: ^types.GameObject, r: types.ReplacementDefinition, after: types.PlayerId, queued: bool, ok: bool) {
	s := &g.state
	o = object(s, subject)
	if len(g.entry_choices) > 0 {
		if g.entry_choices[0].object != subject do return nil, {}, 0, false, false
		r, ok = option_of(o, g.entry_choices[0].replacement)
		return o, r, g.entry_after, true, ok
	}
	i, has := first_option_of(o)
	if !has do return nil, {}, 0, false, false
	r, ok = option_of(o, i)
	return o, r, s.active_player, false, ok
}

// The entry option a prompt about `subject` asks, without answering it (the actions a player could take).
asked_entry_option :: proc(g: ^Game, subject: types.ObjectId) -> (types.ReplacementDefinition, bool) {
	o := object(&g.state, subject)
	if len(g.entry_choices) > 0 {
		if g.entry_choices[0].object != subject do return {}, false
		return option_of(o, g.entry_choices[0].replacement)
	}
	i, has := first_option_of(o)
	if !has do return {}, false
	return option_of(o, i)
}

// Whether the player can take the option's first way (CR 119.4: paying life needs at least that much life).
entry_option_acceptable :: proc(s: ^types.GameState, p: types.PlayerId, r: types.ReplacementDefinition) -> bool {
	if life, may_pay := entry_payment(r); may_pay do return int(player(s, p).life) >= life
	return true
}

// The answer to "pay or enter tapped" or "counter or haste": 0 takes the first way (pays the life, puts the counter
// on), 1 declines (it enters tapped, it gains haste).
answer_entry_payment :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ReplacementChoice, index: int) -> bool {
	s := &g.state
	if p != w.player || index < 0 || index > 1 || len(w.candidates) == 0 do return false
	o, r, after, queued, ok := current_entry_option(g, w.candidates[0].source_id)
	if !ok do return false
	if index == 0 && !entry_option_acceptable(s, p, r) do return false
	#partial switch m in r.mode {
	case types.ReplacementMode_MayCost:
		if index == 0 do lose_life(s, p, entry_payment_life(r))
		else do apply_entering_instructions(g, o, m.decline)
	case types.ReplacementMode_Optional:
		if index == 0 do apply_entering_instructions(g, o, r.execute)
		else if m.decline != nil do apply_entering_instructions(g, o, m.decline)
	case:
		return false
	}
	if queued do ordered_remove(&g.entry_choices, 0)
	s.waiting_for = nil
	give_priority(g, after)
	return true
}

@(private = "file")
entry_payment_life :: proc(r: types.ReplacementDefinition) -> int {
	life, _ := entry_payment(r)
	return life
}

// The answer to "your choice of a deathtouch counter or a lifelink counter": the branch it enters with.
answer_entry_branch :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ChooseOneOfBranch, index: int) -> bool {
	s := &g.state
	if p != w.player do return false
	o, r, after, queued, ok := current_entry_option(g, w.source_id)
	if !ok do return false
	branches, one_of := branches_of(r)
	if !one_of || index < 0 || index >= len(branches) do return false
	apply_entering_instructions(g, o, &branches[index])
	if queued do ordered_remove(&g.entry_choices, 0)
	s.waiting_for = nil
	apply_continuous_effects(g)
	give_priority(g, after)
	return true
}

// "You may have this creature enter as a copy of any creature on the battlefield" (Clone, CR 707.9), "... of any
// creature card in a graveyard" (Body Double), "you may have this land enter tapped as a copy of any land card in a
// graveyard, except it's a Cave in addition to its other types" (Echoing Deeps): what it may copy, and how.
Entry_Copy :: struct {
	filter: types.TargetFilter,
	copy:   types.Effect_BecomeCopy,
	tapped: bool, // "enter tapped as a copy": tapped only if it does copy something
}

entry_copy_filter :: proc(r: types.ReplacementDefinition) -> (Entry_Copy, bool) {
	opt, optional := r.mode.(types.ReplacementMode_Optional)
	if !optional || opt.decline != nil || r.condition != nil || !enters_self(r) do return {}, false
	a := r.execute
	if a == nil || a.effect == nil || a.condition != nil do return {}, false
	out: Entry_Copy
	if tap, is_tap := a.effect^.(types.Effect_SetTapState); is_tap {
		// "Enter tapped as a copy": the tapping, then the copy.
		if !is_self(tap.target) || tap.state != .Tap || tap.scope != .Single do return {}, false
		out.tapped = true
		a = a.sub_ability
		if a == nil || a.effect == nil || a.condition != nil do return {}, false
	}
	if a.sub_ability != nil do return {}, false // "when you do, exile that card": not yet
	bc, is_copy := a.effect^.(types.Effect_BecomeCopy)
	if !is_copy || bc.duration != nil do return {}, false // "become a copy ... until end of turn": not yet
	if _, this := bc.recipient.(types.CopyRecipient_Source); bc.recipient != nil && !this do return {}, false
	if !copy_words_read(r, bc) do return {}, false
	for m in bc.additional_modifications do if !copy_exception_supported(m) do return {}, false
	if _, in_graveyard := graveyard_filter(bc.target); !in_graveyard && !mass_filter_supported(bc.target) do return {}, false
	out.filter = bc.target
	out.copy = bc
	return out, true
}

// Whether the card data holds every part of the words: "You may have ~ enter as a copy ..." with nothing before it
// (Protean Raider's "Raid — If you attacked this turn" is lost from its data), and exceptions this engine carries
// out ("it's a Shapeshifter Rogue in addition to its other types", "it has flying"), not ones the data lost or
// that depend on what's copied ("if it's a creature", "its power and toughness are equal to ...").
@(private = "file")
copy_words_read :: proc(r: types.ReplacementDefinition, bc: types.Effect_BecomeCopy) -> bool {
	d, has := r.description.?
	if !has do return false
	if i := strings.index(d, " — "); i >= 0 do d = d[i + len(" — "):] // an ability word or flavor word (CR 207.2c)
	if !strings.has_prefix(d, "You may have ~ enter ") do return false
	i := strings.index(d, "except")
	if i < 0 do return len(bc.additional_modifications) == 0
	exception := d[i:]
	for words in ([]string{" if ", "power", "toughness", "copy", "color", "name", "counter", "isn't", "loses", "mana"}) {
		if strings.contains(exception, words) do return false
	}
	return len(bc.additional_modifications) > 0
}

// The exceptions to the copying process that become part of its copiable values (CR 707.9a-b).
@(private = "file")
copy_exception_supported :: proc(m: types.ContinuousModification) -> bool {
	#partial switch x in m {
	case types.ContinuousModification_AddSubtype, types.ContinuousModification_AddType:
		return true
	case types.ContinuousModification_AddKeyword:
		return keyword_grantable(x.keyword)
	case types.ContinuousModification_GrantTrigger:
		return x.trigger != nil && trigger_supported(x.trigger^)
	}
	return false
}

entry_copy_of :: proc(o: ^types.GameObject) -> (Entry_Copy, bool) {
	if o.replacement_definitions == nil do return {}, false
	for r in (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^ do if c, ok := entry_copy_filter(r); ok do return c, true
	return {}, false
}

// CR 707.9, 614.12: its controller chooses what it copies (or nothing) as it enters, asked before the next player
// would receive priority.
ask_entry_copy :: proc(g: ^Game, after: types.PlayerId) -> bool {
	s := &g.state
	for len(g.entry_copies) > 0 {
		o := object(s, g.entry_copies[0])
		c: Entry_Copy
		ok := false
		if o != nil do c, ok = entry_copy_of(o)
		if !ok || o.zone != .Battlefield {
			ordered_remove(&g.entry_copies, 0)
			continue
		}
		valid := entry_copy_choices(s, o, c)
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

// What it may copy: permanents, or cards in graveyards ("any creature card in a graveyard": not targeted, CR
// 115.10). A token's copiable values come from what made it (CR 111.3); copying a token isn't supported yet, so
// only card-backed permanents are offered.
@(private = "file")
entry_copy_choices :: proc(s: ^types.GameState, o: ^types.GameObject, c: Entry_Copy) -> [dynamic]types.ObjectId {
	valid := make([dynamic]types.ObjectId)
	if gf, in_graveyard := graveyard_filter(c.filter); in_graveyard {
		cards := make([dynamic]types.TargetRef, context.temp_allocator)
		graveyard_targets(s, gf, o.controller, o.id, &cards)
		for t in cards do if id, is_object := target_object(t); is_object do append(&valid, id)
	} else {
		for p in affected_permanents(s, c.filter, o.controller, o.id) do if p.id != o.id && !(p.is_token && p.printed_ref == nil) do append(&valid, p.id)
	}
	// "With mana value less than or equal to the amount of mana spent to cast this creature" (Mockingbird; none was
	// spent if it wasn't cast).
	if limit, has := c.copy.mana_value_limit.?; has && limit == .AmountSpentToCastSource {
		for i := len(valid) - 1; i >= 0; i -= 1 {
			if object_mana_value(object(s, valid[i])) > int(o.mana_spent_to_cast_amount) do ordered_remove(&valid, i)
		}
	}
	return valid
}

// The answer: a permanent or card to copy, or none (it stays itself). CR 707.2: the copy takes the copiable values:
// the card's printed characteristics, as modified by the copy effect that made a copied permanent a copy, with its
// exceptions (CR 707.9b; other copy effects aren't carried yet). It keeps its own counters and status, as it's the
// same object.
answer_entry_copy :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_CopyTargetChoice, target: Maybe(types.TargetRef)) -> bool {
	s := &g.state
	if p != w.player do return false
	o := object(s, w.source_id)
	if o == nil do return false
	if t, has := target.?; has {
		c, copies := entry_copy_of(o)
		if !copies do return false
		id, is_object := target_object(t)
		if !is_object || !slice.contains(w.valid_targets[:], id) do return false
		original := object(s, id)
		card: ^types.CardExportEntry
		if g.card_db != nil && !(original.is_token && original.printed_ref == nil) do card = g.card_db(original.base_name if original.base_name != "" else original.name)
		if card == nil do return false
		exceptions := make([dynamic]types.ContinuousModification)
		if rec, recorded := g.copy_exceptions[original.id]; recorded && rec.incarnation == original.incarnation && original.zone == .Battlefield {
			append(&exceptions, ..rec.modifications[:])
		}
		append(&exceptions, ..c.copy.additional_modifications[:])
		become_copy(o, &card.face)
		delete_key(&g.copy_exceptions, o.id) // an earlier copy's exceptions (CR 707.9e: a later copy effect replaces it)
		for m in exceptions do apply_copy_exception(o, m)
		if len(exceptions) > 0 do g.copy_exceptions[o.id] = Copy_Exceptions{incarnation = o.incarnation, modifications = exceptions}
		if c.tapped do o.tapped = true
		// CR 707.5, 707.6: the copied card's "as this enters" and "enters with" abilities apply to it as it enters
		// (enters tapped, with counters), and its controller makes their choices, a copy among them (CR 707.9e).
		apply_entering_replacements(g, o)
		if _, copies_again := entry_copy_of(o); copies_again do append(&g.entry_copies, o.id)
		queue_entry_choices(g, o)
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

// The exceptions a copy was made with, for a copy of that copy to take too (CR 707.9b: they're part of its copiable
// values). Kept by object, for this object (incarnation) only.
Copy_Exceptions :: struct {
	incarnation:   u64,
	modifications: [dynamic]types.ContinuousModification,
}

// CR 707.9a-b: the exception changes the copy's values themselves (its printed values here), not a continuous
// effect on top of them. The arrays are cloned: the copied card's own stay as they are. CR 707.9d: an exception
// that gives a characteristic a specific value ("except it's a 1/1 green Frog") isn't joined by the copied
// object's characteristic-defining ability for it (drop_defining_abilities).
apply_copy_exception :: proc(o: ^types.GameObject, m: types.ContinuousModification) {
	#partial switch x in m {
	case types.ContinuousModification_SetPower:
		o.power, o.base_power, o.layer_base_power = x.value, x.value, x.value
		drop_defining_abilities(o, .Power_Toughness)
	case types.ContinuousModification_SetToughness:
		o.toughness, o.base_toughness, o.layer_base_toughness = x.value, x.value, x.value
		drop_defining_abilities(o, .Power_Toughness)
	case types.ContinuousModification_SetColor:
		o.color = slice.clone_to_dynamic(x.colors[:])
		o.base_color = o.color
		drop_defining_abilities(o, .Color)
	case types.ContinuousModification_AddColor:
		if slice.contains(o.color[:], x.color) do return
		colors := slice.clone_to_dynamic(o.color[:])
		append(&colors, x.color)
		o.color, o.base_color = colors, colors
	case types.ContinuousModification_RemoveSupertype:
		supertypes := make([dynamic]types.Supertype)
		for t in o.card_types.supertypes do if t != x.supertype do append(&supertypes, t)
		o.card_types.supertypes = supertypes
	case types.ContinuousModification_RemoveAllSubtypes:
		// "It's a Frog" (with the creature types the exception gives it next): no creature types of its own,
		// changeling's included (CR 707.9d, 702.73a).
		subtypes := make([dynamic]string)
		for t in o.card_types.subtypes do if !subtype_in_set(t, x.set) do append(&subtypes, t)
		o.card_types.subtypes = subtypes
		if x.set == .Creature do drop_defining_abilities(o, .Creature_Types)
	case types.ContinuousModification_AddSubtype:
		if slice.contains(o.card_types.subtypes[:], x.subtype) do return
		subtypes := slice.clone_to_dynamic(o.card_types.subtypes[:])
		append(&subtypes, x.subtype)
		o.card_types.subtypes = subtypes
	case types.ContinuousModification_AddType:
		if slice.contains(o.card_types.core_types[:], x.core_type) do return
		core := slice.clone_to_dynamic(o.card_types.core_types[:])
		append(&core, x.core_type)
		o.card_types.core_types = core
	case types.ContinuousModification_AddKeyword:
		keywords := slice.clone_to_dynamic(o.keywords[:])
		append(&keywords, x.keyword)
		o.keywords = keywords
		o.base_keywords = keywords
	case types.ContinuousModification_GrantTrigger:
		append((^[dynamic]types.TriggerEntry)(o.trigger_definitions), types.TriggerEntry{definition = x.trigger^})
	}
	o.base_card_types = o.card_types
}

Defined_Characteristic :: enum {
	Power_Toughness,
	Color,
	Creature_Types,
}

// CR 707.9d: the copied object's characteristic-defining abilities (CR 604.3) for a characteristic the exception
// sets aren't copied ("its power is equal to ...", devoid's colorlessness, changeling's creature types).
@(private = "file")
drop_defining_abilities :: proc(o: ^types.GameObject, c: Defined_Characteristic) {
	defines :: proc(st: types.StaticDefinition, c: Defined_Characteristic) -> bool {
		if !st.characteristic_defining do return false
		for m in st.modifications {
			#partial switch _ in m {
			case types.ContinuousModification_SetDynamicPower, types.ContinuousModification_SetDynamicToughness,
			     types.ContinuousModification_SetPower, types.ContinuousModification_SetToughness:
				if c == .Power_Toughness do return true
			case types.ContinuousModification_SetColor:
				if c == .Color do return true
			case types.ContinuousModification_AddAllCreatureTypes:
				if c == .Creature_Types do return true
			}
		}
		return false
	}
	if o.static_definitions != nil {
		kept := new([dynamic]types.StaticDefinition)
		for st in o.static_definitions^ do if !defines(st, c) do append(kept, st)
		o.static_definitions = types.Definitions_StaticDefinition(kept)
		o.base_static_definitions = kept
	}
	keywords := make([dynamic]types.Keyword)
	for k in o.keywords {
		#partial switch _ in k {
		case types.Keyword_Changeling:
			if c == .Creature_Types do continue
		case types.Keyword_Devoid:
			if c == .Color do continue
		}
		append(&keywords, k)
	}
	o.keywords, o.base_keywords = keywords, keywords
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
	case types.ReplacementCondition_IfControlsMatching:
		// "If you control two or more other lands, this land enters tapped."
		return mass_filter_supported(x.filter)
	case types.ReplacementCondition_UnlessQuantity:
		// "Unless two or more colors of mana were spent to cast it"; "unless it's your first, second, or third turn
		// of the game" (only on your turn).
		if req, has := x.active_player_req.?; has {
			if _, you := req.(types.ControllerRef_You); !you do return false
		}
		return quantity_supported(x.lhs) && quantity_supported(x.rhs)
	case types.ReplacementCondition_CastFromZone:
		return true // "if you cast it from your hand" (CR 601.2a: where it was cast from)
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
	case types.ReplacementCondition_IfControlsMatching:
		return count_matching(s, o, x.filter) >= int(x.minimum)
	case types.ReplacementCondition_UnlessQuantity:
		// CR 614.12: read as it's about to enter. "Unless it's your first ... turn": the exception needs your turn.
		if _, has := x.active_player_req.?; has && s.active_player != o.controller do return true
		return !compare(quantity_value(s, x.lhs, o.controller, o.id, 0), x.comparator, quantity_value(s, x.rhs, o.controller, o.id, 0))
	case types.ReplacementCondition_CastFromZone:
		// A permanent that entered without being cast (put onto the battlefield) wasn't cast from anywhere.
		z, was_cast := o.cast_from_zone.?
		return was_cast && z == x.zone
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

// CR 614.12: as the permanent enters, its own replacement effects that need no choice apply (the choices are asked
// before the next player would receive priority: ask_entry_payment and the others).
apply_entering_replacements :: proc(g: ^Game, o: ^types.GameObject) {
	if o.replacement_definitions == nil do return
	outer := x_defined
	x_defined = has_x(o.mana_cost) // CR 107.3m: read as the card_supported check read them
	defer x_defined = outer
	for r in (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^ {
		if !entering_replacement(r) do continue
		if c, has := r.condition.?; has && !entry_condition_holds(&g.state, o, c) do continue
		apply_entering_instructions(g, o, r.execute)
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
