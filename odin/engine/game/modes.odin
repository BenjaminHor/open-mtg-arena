// Modal spells (CR 700.2): "Choose one —" and the like. Each mode is one of the card's spell abilities; the
// player chooses the mode(s) as they cast it (CR 601.2b, 700.2a), targets are chosen only for the chosen modes
// (CR 700.2c), and the chosen modes are carried out in the order written (CR 608.2c).
package game

import "core:slice"
import types "../types"

modal_supported :: proc(face: ^types.CardFace) -> bool {
	m, ok := face.modal.?
	if !ok do return true
	if m.dynamic_max_choices != nil || len(m.constraints) > 0 || len(m.mode_costs) > 0 || m.entwine_cost != nil || m.allow_repeat_modes do return false
	if _, you := m.chooser.(types.PlayerFilter_Controller); !you do return false
	if m.min_choices < 1 || m.max_choices < m.min_choices || m.max_choices > m.mode_count do return false
	modes := 0
	for a in face.abilities do if a.kind == .Spell {
		modes += 1
		if !spell_ability_supported(a) do return false
	}
	return modes == m.mode_count
}

is_modal :: proc(o: ^types.GameObject) -> bool {
	e, ok := card_entry_of(o)
	return ok && e.face.modal != nil
}

modal_of :: proc(o: ^types.GameObject) -> types.ModalChoice {
	e, _ := card_entry_of(o)
	return e.face.modal.?
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

modes_castable :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) -> bool {
	m := modal_of(o)
	return len(mode_abilities(o)) - len(unavailable_modes(s, p, o)) >= m.min_choices
}

// The chosen modes' instructions as one chain, in printed order: each mode follows the last as an independent
// instruction.
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

ask_modes :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) {
	pending := new(types.PendingCast)
	pending.object_id = o.id
	pending.card_id = o.card_id
	pending.cost = o.mana_cost
	g.state.waiting_for = types.WaitingFor_ModeChoice{player = p, modal = modal_of(o), pending_cast = pending, unavailable_modes = unavailable_modes(&g.state, p, o)}
}

// CR 601.2b, 700.2: the player's choice of modes: between the minimum and maximum, each once, none unavailable.
select_modes :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ModeChoice, indices: []int) -> bool {
	if g.pending.object == 0 || len(indices) < w.modal.min_choices || len(indices) > w.modal.max_choices || has_duplicate_ints(indices) do return false
	for i in indices do if i < 0 || i >= w.modal.mode_count || slice.contains(w.unavailable_modes[:], i) do return false
	g.pending.modes = make([dynamic]int)
	append(&g.pending.modes, ..indices)
	slice.sort(g.pending.modes[:]) // CR 608.2c: carried out in the order written
	g.pending.modes_chosen = true
	continue_casting(g, p) // then kicker, X, targets (CR 601.2b-c)
	return true
}

@(private = "file")
has_duplicate_ints :: proc(xs: []int) -> bool {
	for x, i in xs do for y in xs[i + 1:] do if x == y do return true
	return false
}
