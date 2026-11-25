// Choosing targets (CR 601.2c, 115). Each targeting instruction is one use of the word "target"; it takes one
// target, a fixed number ("two target creatures"), or up to a number ("up to two target creatures", the extra
// ones optional, CR 115.6). Targets are chosen one slot at a time; declining an optional slot ends that
// instruction's choices.
package game

import "core:slice"
import types "../types"

Target_Slot :: struct {
	filter:   types.TargetFilter,
	optional: bool,
	group:    int, // which targeting instruction it belongs to, in order
	part:     int, // within one instruction, which of its different targets (a fight's two creatures)
}

// Progress through the slots: the targets chosen so far and how many each instruction took.
Target_Choice :: struct {
	slot:    int,
	targets: [dynamic]types.TargetRef,
	counts:  [dynamic]int,
}

// The slots of an ability's instructions, in order.
slot_list :: proc(a: ^types.AbilityDefinition) -> [dynamic]Target_Slot {
	out := make([dynamic]Target_Slot, context.temp_allocator)
	group := 0
	for x := a; x != nil; x = x.sub_ability {
		if x != a && is_reflexive(x) do break // its targets are chosen when it triggers (CR 603.12)
		if x.effect == nil do continue
		if fight, is_fight := x.effect^.(types.Effect_Fight); is_fight && !is_self(fight.subject) {
			// "Target creature you control fights target creature you don't control": two targets, one instruction.
			append(&out, Target_Slot{filter = fight.subject, group = group})
			append(&out, Target_Slot{filter = fight.target, group = group, part = 1})
			group += 1
			continue
		}
		f, ok := effect_target(x.effect^)
		if !ok do continue
		least, most := 1, 1
		if m, multi := x.multi_target.?; multi {
			least, _ = fixed_quantity(m.min)
			most, _ = fixed_quantity(m.max.?)
		}
		for i in 0 ..< most do append(&out, Target_Slot{filter = f, optional = i >= least, group = group})
		group += 1
	}
	return out
}

// "Up to N target ..." that the engine can carry out: fixed numbers, and an effect that acts on each target
// without asking anyone anything.
multi_target_supported :: proc(a: types.AbilityDefinition) -> bool {
	m, multi := a.multi_target.?
	if !multi do return true
	least, fixed_min := fixed_quantity(m.min)
	most_q, has_max := m.max.?
	if !has_max || !fixed_min do return false
	most, fixed_max := fixed_quantity(most_q)
	if !fixed_max || least < 0 || most < max(least, 1) || most > 10 || a.effect == nil do return false
	#partial switch _ in a.effect^ {
	case types.Effect_DealDamage, types.Effect_Destroy, types.Effect_Pump, types.Effect_GenericEffect, types.Effect_ChangeZone,
	     types.Effect_Bounce, types.Effect_PutCounter, types.Effect_SetTapState:
		return true
	}
	return false
}

// The legal choices for the current slot: CR 115.3, not one already chosen for the same instruction.
slot_legal :: proc(s: ^types.GameState, slots: []Target_Slot, c: ^Target_Choice, controller: types.PlayerId, source: types.ObjectId) -> [dynamic]types.TargetRef {
	out := make([dynamic]types.TargetRef)
	if c.slot >= len(slots) do return out
	group := slots[c.slot].group
	taken := c.counts[group] if group < len(c.counts) else 0
	same := c.targets[len(c.targets) - taken:]
	for t in legal_targets(s, slots[c.slot].filter, controller, source) do if !slice.contains(same, t) do append(&out, t)
	return out
}

take_target :: proc(slots: []Target_Slot, c: ^Target_Choice, t: types.TargetRef) {
	group := slots[c.slot].group
	for len(c.counts) <= group do append(&c.counts, 0)
	append(&c.targets, t)
	c.counts[group] += 1
	c.slot += 1
}

// Declining an optional slot: the instruction takes no more targets.
skip_group :: proc(slots: []Target_Slot, c: ^Target_Choice) {
	if c.slot >= len(slots) do return
	group := slots[c.slot].group
	for len(c.counts) <= group do append(&c.counts, 0)
	for c.slot < len(slots) && slots[c.slot].group == group do c.slot += 1
}

// Skips optional slots that have nothing left to choose.
settle_choice :: proc(s: ^types.GameState, slots: []Target_Slot, c: ^Target_Choice, controller: types.PlayerId, source: types.ObjectId) {
	for c.slot < len(slots) && slots[c.slot].optional && len(slot_legal(s, slots, c, controller, source)) == 0 do skip_group(slots, c)
}

// CR 601.2c, 115.3: whether every required target can be chosen (each instruction's required ones distinct).
slots_fillable :: proc(s: ^types.GameState, slots: []Target_Slot, controller: types.PlayerId, source: types.ObjectId) -> bool {
	for slot, i in slots {
		if slot.optional do continue
		// The required slots of an instruction come first; the n-th needs n distinct legal targets.
		n := 1
		for j := i - 1; j >= 0 && slots[j].group == slot.group; j -= 1 do if slots[j].part == slot.part do n += 1
		if len(legal_targets(s, slot.filter, controller, source)) < n do return false
	}
	return true
}

// The slot list as the client's prompt shows it.
selection_slots :: proc(s: ^types.GameState, slots: []Target_Slot, controller: types.PlayerId, source: types.ObjectId) -> [dynamic]types.TargetSelectionSlot {
	out: [dynamic]types.TargetSelectionSlot
	for slot in slots do append(&out, types.TargetSelectionSlot{legal_targets = legal_targets(s, slot.filter, controller, source), optional = slot.optional})
	return out
}
