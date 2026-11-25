// Modal spells (CR 700.2): "Choose one —" and the like. Each mode is one of the card's spell abilities; the
// player chooses the mode(s) as they cast it (CR 601.2b, 700.2a), targets are chosen only for the chosen modes
// (CR 700.2c), and the chosen modes are carried out in the order written (CR 608.2c). On top of "choose N": entwine
// (CR 702.42), a cost for each mode (CR 700.2h: spree, CR 702.172; tiered, CR 702.183), the same mode more than once
// (CR 700.2d), and a larger number under a condition ("if you control a Wizard, you may choose two instead").
package game

import "core:slice"
import "core:strings"
import types "../types"

modal_supported :: proc(face: ^types.CardFace) -> bool {
	m, ok := face.modal.?
	if !mode_keywords_match(face) do return false
	if !ok do return true
	if m.dynamic_max_choices != nil do return false
	if _, you := m.chooser.(types.PlayerFilter_Controller); !you do return false
	if !mode_rules_supported(face, m) do return false
	modes := 0
	for a in face.abilities do if a.kind == .Spell {
		modes += 1
		if !spell_ability_supported(a) do return false
	}
	return modes == m.mode_count
}

// The rules for choosing the modes that this engine carries out: "choose N" (or "one or more"), and on top of that
// at most one of entwine, a cost for each mode, the same mode more than once, or a larger number under a condition.
// Shapes the card data can't say exactly stay unsupported.
@(private = "file")
mode_rules_supported :: proc(face: ^types.CardFace, m: types.ModalChoice) -> bool {
	extras := 0
	if m.entwine_cost != nil do extras += 1
	if len(m.mode_costs) > 0 do extras += 1
	if m.allow_repeat_modes do extras += 1
	if len(m.constraints) > 0 do extras += 1
	// Not carried out here: pawprint modes (rule 700.2i, "up to five {P} worth of modes", which may be none at all).
	if extras > 1 || len(m.mode_pawprints) > 0 do return false
	if m.min_choices < 1 || m.max_choices < m.min_choices || m.max_choices > m.mode_count do return false
	switch {
	case m.allow_repeat_modes:
		// CR 700.2d: "Choose three. You may choose the same mode more than once." Only an exact number, two or more:
		// the data gives "choose up to four" (of two modes) and "choose X" other numbers, so those stay unsupported.
		return m.min_choices == m.max_choices && m.min_choices >= 2
	case m.entwine_cost != nil:
		// CR 702.42a: "you may choose all modes of this spell instead of just the number specified": the data's
		// minimum is that number, its maximum all the modes. A mana entwine cost only.
		_, mana := entwine_cost(m)
		return mana && m.min_choices < m.mode_count && m.max_choices == m.mode_count
	case len(m.mode_costs) > 0:
		// CR 700.2h, 702.172a, 702.183a: each mode has its own additional mana cost.
		if len(m.mode_costs) != m.mode_count do return false
		for c in m.mode_costs {
			if _, is_cost := c.(types.ManaCost_Cost); !is_cost || has_x(c) do return false
		}
	case len(m.constraints) > 0:
		return conditional_max_supported(face, m)
	}
	return true
}

// Entwine, spree and tiered are rules of choosing the modes: the card data has each keyword's part on the modal
// choice too, and a keyword without it would go unheeded.
@(private = "file")
mode_keywords_match :: proc(face: ^types.CardFace) -> bool {
	m, modal := face.modal.?
	for k in face.keywords {
		#partial switch _ in k {
		case types.Keyword_Entwine:
			if !modal || m.entwine_cost == nil do return false
		case types.Keyword_Spree:
			// CR 702.172a: "Choose one or more modes", each with its cost.
			if !modal || len(m.mode_costs) == 0 || m.min_choices != 1 || m.max_choices != m.mode_count do return false
		case types.Keyword_Tiered:
			// CR 702.183a: "Choose one", with its cost.
			if !modal || len(m.mode_costs) == 0 || m.min_choices != 1 || m.max_choices != 1 do return false
		}
	}
	return true
}

// "Choose one. If you control a Wizard as you cast this spell, you may choose two instead." The data gives the
// larger number but no minimum for it, so only the wordings that keep the minimum are supported: "you may choose ...
// instead" and "choose one or more instead", not "choose both instead" (both then a must). Nor a condition on an
// additional cost paid ("if this spell was kicked, choose any number instead"): kicker is announced after the modes
// (CR 601.2b).
@(private = "file")
conditional_max_supported :: proc(face: ^types.CardFace, m: types.ModalChoice) -> bool {
	if len(m.constraints) != 1 do return false
	c, conditional := m.constraints[0].(types.ModalSelectionConstraint_ConditionalMaxChoices)
	if !conditional do return false
	st, is_static := c.condition.(types.ModalSelectionCondition_Static)
	if !is_static || !condition_supported(st.condition) do return false
	if c.otherwise_max_choices != m.max_choices || c.max_choices <= c.otherwise_max_choices || c.max_choices > m.mode_count do return false
	text := face.oracle_text.? or_else ""
	return strings.contains(text, "you may choose") || strings.contains(text, "choose one or more instead")
}

is_modal :: proc(o: ^types.GameObject) -> bool {
	return o.modal != nil
}

modal_of :: proc(o: ^types.GameObject) -> types.ModalChoice {
	return o.modal.?
}

// The spell abilities that are the modes, in printed order.
mode_abilities :: proc(o: ^types.GameObject) -> [dynamic]^types.AbilityDefinition {
	out := make([dynamic]^types.AbilityDefinition, context.temp_allocator)
	if o.abilities == nil do return out
	for &a in o.abilities^ do if a.kind == .Spell do append(&out, &a)
	return out
}

// CR 700.2a: a mode that couldn't have its targets chosen can't be chosen.
unavailable_modes :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) -> [dynamic]int {
	out: [dynamic]int
	for a, i in mode_abilities(o) do if !slots_fillable(s, slot_list(a)[:], p, o.id) do append(&out, i)
	return out
}

// The most modes the player may choose now: the printed number, or the larger one while its condition holds ("if
// you control a Wizard as you cast this spell": as the modes are chosen, CR 601.2b).
max_modes :: proc(s: ^types.GameState, o: ^types.GameObject) -> int {
	m := modal_of(o)
	for c in m.constraints {
		x, conditional := c.(types.ModalSelectionConstraint_ConditionalMaxChoices)
		if !conditional do continue
		st, is_static := x.condition.(types.ModalSelectionCondition_Static)
		if is_static && condition_holds(s, o, st.condition) do return x.max_choices
		return x.otherwise_max_choices
	}
	return m.max_choices
}

// CR 601.2b, 700.2: whether these modes are a choice the player may make, costs aside: each one available
// (CR 700.2a), none twice unless the card says so (CR 700.2d), and as many as the card says: with entwine, the
// number specified or all of them (CR 702.42a).
modes_allowed :: proc(s: ^types.GameState, o: ^types.GameObject, indices: []int, unavailable: []int) -> bool {
	m := modal_of(o)
	for i in indices do if i < 0 || i >= m.mode_count || slice.contains(unavailable, i) do return false
	if !m.allow_repeat_modes && has_duplicate_ints(indices) do return false
	n := len(indices)
	if m.entwine_cost != nil do return n == m.min_choices || n == m.mode_count
	return n >= m.min_choices && n <= max_modes(s, o)
}

// Whether the cost to cast it depends on the modes chosen (CR 700.2h, 702.42a).
mode_costs_vary :: proc(o: ^types.GameObject) -> bool {
	m := modal_of(o)
	return m.entwine_cost != nil || len(m.mode_costs) > 0
}

// CR 601.2f-h: whether the player could pay the total cost with these modes chosen (with the best case of a cost
// that reads the targets, as they aren't chosen yet).
modes_affordable :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, indices: []int) -> bool {
	if !mode_costs_vary(o) do return true
	saved := o.chosen_modes
	defer o.chosen_modes = saved
	o.chosen_modes = slice.clone_to_dynamic(indices, context.temp_allocator)
	_, payable := plan_payment(s, p, spell_cost(s, o, p), 0, nil, Payment{o, true})
	return payable
}

// Every choice of modes the player may make now and can pay for, each in printed order (CR 608.2c): sets of
// different modes or, where the same mode may be chosen more than once, multisets (CR 700.2d).
allowed_mode_sets :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, unavailable: []int) -> [dynamic][]int {
	m := modal_of(o)
	available := make([dynamic]int, context.temp_allocator)
	for i in 0 ..< m.mode_count do if !slice.contains(unavailable, i) do append(&available, i)
	candidates := make([dynamic][]int, context.temp_allocator)
	mode_sets(&candidates, available[:], 0, nil, m.min_choices, max_modes(s, o), m.allow_repeat_modes)
	out := make([dynamic][]int, context.temp_allocator)
	for set in candidates do if modes_allowed(s, o, set, unavailable) && modes_affordable(s, p, o, set) do append(&out, set)
	return out
}

@(private = "file")
mode_sets :: proc(out: ^[dynamic][]int, available: []int, from: int, chosen: []int, least, most: int, repeat: bool) {
	if len(chosen) >= least do append(out, chosen)
	if len(chosen) == most do return
	for i in from ..< len(available) {
		next := make([]int, len(chosen) + 1, context.temp_allocator)
		copy(next, chosen)
		next[len(chosen)] = available[i]
		mode_sets(out, available, i if repeat else i + 1, next, least, most, repeat)
	}
}

// Whether the player has a choice of modes they may make and pay for.
modes_castable :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) -> bool {
	unavailable := unavailable_modes(s, p, o)
	if !mode_costs_vary(o) {
		// The cost is the same whatever the modes: enough of them available is enough.
		m := modal_of(o)
		available := m.mode_count - len(unavailable)
		return available >= (1 if m.allow_repeat_modes else m.min_choices)
	}
	return len(allowed_mode_sets(s, p, o, unavailable[:])) > 0
}

// The chosen modes' instructions as one chain, in printed order: each mode follows the last as an independent
// instruction. A mode chosen more than once is there that many times in a row (CR 700.2d).
chosen_mode_chain :: proc(o: ^types.GameObject, modes: []int) -> ^types.AbilityDefinition {
	abilities := mode_abilities(o)
	first, last: ^types.AbilityDefinition
	for i in modes {
		for x := abilities[i]; x != nil; x = x.sub_ability {
			c := new(types.AbilityDefinition, context.temp_allocator)
			c^ = x^
			c.sub_ability = nil
			if x == abilities[i] do c.sub_link = .SequentialSibling
			if first == nil do first = c
			else do last.sub_ability = c
			last = c
		}
	}
	return first
}

// ---- The costs the modes add (CR 601.2f) ---------------------------------------------------------------------

// A mana entwine cost.
entwine_cost :: proc(m: types.ModalChoice) -> (types.ManaCost_Cost, bool) {
	if m.entwine_cost == nil do return {}, false
	mana, is_mana := m.entwine_cost^.(types.AbilityCost_Mana)
	if !is_mana || has_x(mana.cost) do return {}, false
	c, ok := mana.cost.(types.ManaCost_Cost)
	return c, ok
}

// CR 702.42a: all the modes of a spell with entwine are chosen, so its entwine cost is paid.
entwined :: proc(o: ^types.GameObject) -> bool {
	if !is_modal(o) do return false
	m := modal_of(o)
	return m.entwine_cost != nil && m.min_choices < m.mode_count && len(o.chosen_modes) == m.mode_count
}

// The total cost with what the chosen modes add: each chosen mode's own cost (CR 700.2h; spree, CR 702.172a;
// tiered, CR 702.183a), and the entwine cost when all of them are chosen (CR 702.42a). These are additional costs:
// the mana value stays the mana cost's (CR 202.3).
add_mode_costs :: proc(o: ^types.GameObject, c: ^types.ManaCost_Cost) {
	if !is_modal(o) || len(o.chosen_modes) == 0 do return
	m := modal_of(o)
	shards := make([dynamic]types.ManaCostShard, context.temp_allocator)
	append(&shards, ..c.shards[:])
	if len(m.mode_costs) == m.mode_count {
		for i in o.chosen_modes {
			mode_cost, is_cost := m.mode_costs[i].(types.ManaCost_Cost)
			if !is_cost do continue
			c.generic += mode_cost.generic
			append(&shards, ..mode_cost.shards[:])
		}
	}
	if entwined(o) {
		e, _ := entwine_cost(m)
		c.generic += e.generic
		append(&shards, ..e.shards[:])
	}
	c.shards = shards
}

ask_modes :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) {
	pending := new(types.PendingCast)
	pending.object_id = o.id
	pending.card_id = o.card_id
	pending.cost = o.mana_cost
	modal := modal_of(o)
	modal.max_choices = max_modes(&g.state, o) // the larger number while its condition holds
	g.state.waiting_for = types.WaitingFor_ModeChoice{player = p, modal = modal, pending_cast = pending, unavailable_modes = unavailable_modes(&g.state, p, o)}
}

// CR 601.2b, 700.2: the player's choice of modes (modes_allowed), with the costs they add payable (CR 601.2f-h).
select_modes :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ModeChoice, indices: []int) -> bool {
	if g.pending.object == 0 do return false
	o := object(&g.state, g.pending.object)
	if !modes_allowed(&g.state, o, indices, w.unavailable_modes[:]) do return false
	if !modes_affordable(&g.state, p, o, indices) do return refuse("the costs of those modes can't be paid")
	g.pending.modes = make([dynamic]int)
	append(&g.pending.modes, ..indices)
	slice.sort(g.pending.modes[:]) // CR 608.2c: carried out in the order written
	o.chosen_modes = slice.clone_to_dynamic(g.pending.modes[:]) // for the costs they add (add_mode_costs)
	g.pending.modes_chosen = true
	continue_casting(g, p) // then kicker, X, targets (CR 601.2b-c)
	return true
}

@(private = "file")
has_duplicate_ints :: proc(xs: []int) -> bool {
	for x, i in xs do for y in xs[i + 1:] do if x == y do return true
	return false
}

// ---- Modal triggered abilities (CR 700.2b, 603.3c) -------------------------------------------------------------

// "At the beginning of your end step, choose one -": the modes are its mode_abilities; the controller chooses as
// the ability is put on the stack (CR 603.3c).
modal_trigger_supported :: proc(a: types.AbilityDefinition) -> bool {
	m, ok := a.modal.?
	if !ok do return false
	if m.dynamic_max_choices != nil || len(m.constraints) > 0 || len(m.mode_costs) > 0 || m.entwine_cost != nil || m.allow_repeat_modes do return false
	if _, you := m.chooser.(types.PlayerFilter_Controller); !you do return false
	if m.min_choices < 1 || m.max_choices < m.min_choices || m.max_choices > m.mode_count || len(a.mode_abilities) != m.mode_count do return false
	if a.sub_ability != nil || a.condition != nil do return false
	for mode in a.mode_abilities do if !ability_supported(mode) do return false
	return true
}

// CR 700.2a: the modes whose targets couldn't be chosen.
trigger_unavailable_modes :: proc(s: ^types.GameState, p: types.PlayerId, source: types.ObjectId, a: ^types.AbilityDefinition) -> [dynamic]int {
	out: [dynamic]int
	for &mode, i in a.mode_abilities do if !slots_fillable(s, slot_list(&mode)[:], p, source) do append(&out, i)
	return out
}

// The chosen modes as one chain, in printed order (CR 700.2): a new definition for the trigger to put on the stack.
trigger_mode_chain :: proc(a: ^types.AbilityDefinition, modes: []int) -> ^types.AbilityDefinition {
	first, last: ^types.AbilityDefinition
	for i in modes {
		mode := &a.mode_abilities[i]
		for x := mode; x != nil; x = x.sub_ability {
			c := new(types.AbilityDefinition)
			c^ = x^
			c.sub_ability = nil
			if x == mode do c.sub_link = .SequentialSibling
			if first == nil do first = c
			else do last.sub_ability = c
			last = c
		}
	}
	return first
}

ask_trigger_modes :: proc(g: ^Game, pt: Pending_Trigger) {
	s := &g.state
	a := pt.definition.execute
	s.priority_player = pt.controller
	s.waiting_for = types.WaitingFor_AbilityModeChoice{player = pt.controller, modal = a.modal.?, source_id = pt.source, mode_abilities = a.mode_abilities, unavailable_modes = trigger_unavailable_modes(s, pt.controller, pt.source, a)}
}

// The controller's modes for the modal trigger next in line: it's put on the stack with them (CR 603.3c).
select_trigger_modes :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_AbilityModeChoice, indices: []int) -> bool {
	if w.is_activated || len(g.pending_triggers) == 0 do return false
	if len(indices) < w.modal.min_choices || len(indices) > w.modal.max_choices || has_duplicate_ints(indices) do return false
	for i in indices do if i < 0 || i >= w.modal.mode_count || slice.contains(w.unavailable_modes[:], i) do return false
	index := next_trigger(g)
	pt := &g.pending_triggers[index]
	if pt.source != w.source_id || pt.controller != p || pt.definition.execute == nil || pt.definition.execute.modal == nil do return false
	sorted := slice.clone(indices, context.temp_allocator)
	slice.sort(sorted) // CR 608.2c: carried out in the order written
	t := new(types.TriggerDefinition)
	t^ = pt.definition^
	t.execute = trigger_mode_chain(pt.definition.execute, sorted)
	pt.definition = t
	g.state.waiting_for = nil
	give_priority(g, priority_holder(g)) // CR 117.3c
	return true
}
