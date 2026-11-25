// Copies of spells (CR 707.10): "Copy target instant or sorcery spell. You may choose new targets for the copy",
// "whenever you cast your first instant or sorcery spell each turn, copy that spell", "when you cast this spell, copy
// it". A copy is put onto the stack, not cast (no "whenever you cast" triggers, CR 707.10); it has the spell's
// characteristics and every decision made for it: modes, targets, X, additional costs paid (CR 707.10). Its
// controller, and owner, is the player who put it there. A copy of a spell outside the stack ceases to exist (CR
// 704.5e); a copy of a permanent spell becomes a token as it resolves (CR 707.10f, 608.3f).
package game

import "core:slice"
import types "../types"

// ---- What's supported ----------------------------------------------------------------------------------------

copy_spell_supported :: proc(x: types.Effect_CopySpell) -> bool {
	if x.copier != nil || x.starting_loyalty_from_casualty_sacrifice do return false
	if x.retarget != .KeepOriginalTargets && x.retarget != .MayChooseNewTargets do return false
	// "Except it isn't legendary", "except the copy is an artifct in addition to its other types": its copiable values
	// (CR 707.9b).
	for m in x.additional_modifications {
		#partial switch _ in m {
		case types.ContinuousModification_RemoveSupertype, types.ContinuousModification_AddType, types.ContinuousModification_AddSubtype,
		     types.ContinuousModification_SetPower, types.ContinuousModification_SetToughness:
		case:
			return false
		}
	}
	#partial switch _ in x.target {
	case types.TargetFilter_SelfRef:
		return true // "copy this spell": a cast trigger's own spell (the trigger's source)
	case types.TargetFilter_TriggeringSource:
		return filter_supported(x.target) // "copy that spell": the spell a cast trigger saw cast
	}
	// "Copy target instant or sorcery spell [you control]": a spell, not an ability.
	return spell_target_supported(x.target) && !names_ability(x.target)
}

@(private = "file")
names_ability :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_StackAbility:
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if names_ability(y) do return true
	case types.TargetFilter_And:
		for y in x.filters do if names_ability(y) do return true
	}
	return false
}

// ---- The spell copied --------------------------------------------------------------------------------------

// A spell as it was cast: kept for "copy that spell" after it has left the stack ("a copy is created even if the
// spell has been countered by the time that ability resolves", the copy using the spell's last known information,
// CR 608.2h). Kept for the turn.
Cast_Snapshot :: struct {
	object: types.GameObject,
	entry:  types.StackEntry,
}

note_cast_snapshot :: proc(g: ^Game, o: ^types.GameObject, entry: types.StackEntry) {
	g.cast_snapshots[o.id] = Cast_Snapshot{object = o^, entry = entry}
}

// The spell to copy: on the stack, or as it last was there.
@(private = "file")
spell_to_copy :: proc(g: ^Game, id: types.ObjectId) -> (types.GameObject, types.StackEntry, bool) {
	s := &g.state
	if e, on_stack := stack_entry_of(s, id); on_stack {
		if _, is_spell := e.kind.(types.StackEntryKind_Spell); is_spell {
			if o := object(s, id); o != nil do return o^, e, true
		}
		return {}, {}, false
	}
	if snap, kept := g.cast_snapshots[id]; kept do return snap.object, snap.entry, true
	return {}, {}, false
}

// ---- Copying ----------------------------------------------------------------------------------------------

// A copy waiting for its controller to choose new targets before it's put on the stack (CR 707.10c).
Copy_Retarget :: struct {
	copy:  types.ObjectId,
	entry: types.StackEntry,
	slots: [dynamic]Copy_Slot,
	next:  int,
}

Copy_Slot :: struct {
	node:   ^types.ResolvedAbility,
	index:  int,
	filter: types.TargetFilter,
}

do_copy_spell :: proc(g: ^Game, x: types.Effect_CopySpell, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> bool {
	s := &g.state
	id := source // "copy this spell": the cast trigger's source
	if t, has := target_object(target); has do id = t
	orig, orig_entry, found := spell_to_copy(g, id)
	if !found do return false
	card := g.card_db(orig.name) if g.card_db != nil else nil
	if card == nil do return false
	// CR 707.10: the copy's characteristics, its controller's (and owner's), and the decisions made for the spell.
	c := new_card_object(s, card, controller, .Stack)
	c.is_copy = true
	c.is_token = true // no card (CR 707.10): it can't move out of the stack, and so ceases to exist there (CR 704.5e)
	c.chosen_modes = orig.chosen_modes
	c.cost_x_paid = orig.cost_x_paid
	c.additional_cost_payment_count = orig.additional_cost_payment_count
	c.additional_cost_payments = slice.clone_to_dynamic(orig.additional_cost_payments[:])
	for m in x.additional_modifications do apply_copy_exception(c, m) // CR 707.9b
	if len(x.additional_modifications) > 0 {
		g.copy_exceptions[c.id] = Copy_Exceptions{incarnation = c.incarnation, modifications = slice.clone_to_dynamic(x.additional_modifications[:])}
	}
	spell := orig_entry.kind.(types.StackEntryKind_Spell)
	tree := copy_tree(g, c, spell.ability, controller)
	entry := types.StackEntry{id = c.id, source_id = c.id, controller = controller, kind = types.StackEntryKind_Spell{card_id = c.card_id, ability = tree, casting_variant = types.CastingVariant_Normal{}}}
	report(types.GameEvent_SpellCopied{card_id = c.card_id, controller = controller, object_id = c.id, original_id = orig.id})
	if x.retarget == .MayChooseNewTargets {
		r := Copy_Retarget{copy = c.id, entry = entry, slots = copy_slots(c, tree)}
		if len(r.slots) > 0 {
			g.copy_retarget = r
			ask_copy_target(g, controller)
			return true
		}
	}
	put_copy_on_stack(g, entry)
	return false
}

// The copy's own instructions, with the spell's targets (CR 707.10) and the division announced for them.
@(private = "file")
copy_tree :: proc(g: ^Game, c: ^types.GameObject, original: ^types.ResolvedAbility, controller: types.PlayerId) -> ^types.ResolvedAbility {
	s := &g.state
	targets := make([dynamic]types.TargetRef, context.temp_allocator)
	incarnations := make([dynamic]types.ObjectIncarnationRef, context.temp_allocator)
	counts := make([dynamic]int, context.temp_allocator)
	shares := make([dynamic]u32, context.temp_allocator)
	for n := original; n != nil; n = n.sub_ability {
		append(&targets, ..n.targets[:])
		for _, i in n.targets do append(&incarnations, n.target_incarnations[i] if i < len(n.target_incarnations) else types.ObjectIncarnationRef{})
		if _, targets_one := instruction_target(n.effect, n.target_choice_timing); targets_one do append(&counts, len(n.targets))
		if division, divided := n.distribution.?; divided do for d in division do append(&shares, d._1)
	}
	chain := chosen_mode_chain(c, c.chosen_modes[:]) if is_modal(c) else spell_ability(c)
	tree := resolved_tree(s, chain, targets[:], counts[:], controller, c.id)
	record_division(tree, shares[:])
	// CR 707.10c: a target kept is the object the spell targeted: one that has since changed zones stays illegal (CR
	// 400.7), as it was for the spell.
	k := 0
	for n := tree; n != nil; n = n.sub_ability {
		for _, i in n.targets {
			if k < len(incarnations) && i < len(n.target_incarnations) && incarnations[k].object_id != 0 do n.target_incarnations[i] = incarnations[k]
			k += 1
		}
	}
	return tree
}

// Each target of the copy, with what may be chosen in its place.
@(private = "file")
copy_slots :: proc(c: ^types.GameObject, tree: ^types.ResolvedAbility) -> [dynamic]Copy_Slot {
	slots := make([dynamic]Copy_Slot)
	for n := tree; n != nil; n = n.sub_ability {
		f, targets_one := instruction_target(n.effect, n.target_choice_timing)
		fight, is_fight := n.effect.(types.Effect_Fight)
		for _, i in n.targets {
			filter := f
			if is_fight && i == 0 && fight_subject_targeted(fight) do filter = fight.subject
			else if is_fight do filter = fight.target
			if !targets_one && n == tree {
				// An Aura spell's target, from its enchant ability (CR 303.4a).
				if ef, aura := enchant_filter(c); aura do filter = ef
			}
			if filter == nil do continue
			append(&slots, Copy_Slot{node = n, index = i, filter = filter})
		}
	}
	return slots
}

// The legal new targets for a slot: legal for the copy, and not another target of the same instruction (CR 115.3).
@(private = "file")
slot_alternatives :: proc(g: ^Game, slot: Copy_Slot, controller: types.PlayerId, copy: types.ObjectId) -> [dynamic]types.TargetRef {
	out := make([dynamic]types.TargetRef)
	for t in legal_targets(&g.state, slot.filter, controller, copy) {
		taken := false
		for other, j in slot.node.targets do if j != slot.index && other == t do taken = true
		if !taken do append(&out, t)
	}
	return out
}

// CR 707.10c: the copy's controller may change any of its targets, one target at a time.
@(private = "file")
ask_copy_target :: proc(g: ^Game, p: types.PlayerId) {
	r := &g.copy_retarget
	slots := make([dynamic]types.CopyTargetSlot)
	for slot in r.slots {
		append(&slots, types.CopyTargetSlot{current = slot.node.targets[slot.index], legal_alternatives = slot_alternatives(g, slot, p, r.copy), can_keep = true})
	}
	g.state.priority_player = p
	g.state.waiting_for = types.WaitingFor_CopyRetarget {
		player = p,
		controller = p,
		copy_id = r.copy,
		target_slots = slots,
		effect_kind = .CopySpell,
		current_slot = r.next,
		mode = .Retarget,
		can_keep_rest = true,
	}
}

// The answer for the current target: keep it (nil), or a new legal one.
answer_copy_target :: proc(g: ^Game, p: types.PlayerId, target: Maybe(types.TargetRef)) -> bool {
	r := &g.copy_retarget
	if r.copy == 0 || r.next >= len(r.slots) do return false
	slot := r.slots[r.next]
	if t, changes := target.?; changes {
		if !slice.contains(slot_alternatives(g, slot, p, r.copy)[:], t) do return false
		slot.node.targets[slot.index] = t
		if slot.index < len(slot.node.target_incarnations) {
			inc: types.ObjectIncarnationRef
			if id, is_object := t.(types.TargetRef_Object); is_object && object(&g.state, id._0) != nil {
				inc = types.ObjectIncarnationRef{object_id = id._0, incarnation = object(&g.state, id._0).incarnation}
			}
			slot.node.target_incarnations[slot.index] = inc
		}
	}
	r.next += 1
	if r.next < len(r.slots) {
		ask_copy_target(g, p)
		return true
	}
	finish_copy_targets(g)
	return true
}

// "Keep the current targets": every target not yet changed stays.
keep_copy_targets :: proc(g: ^Game, p: types.PlayerId) -> bool {
	if g.copy_retarget.copy == 0 do return false
	finish_copy_targets(g)
	return true
}

@(private = "file")
finish_copy_targets :: proc(g: ^Game) {
	r := g.copy_retarget
	g.copy_retarget = {}
	put_copy_on_stack(g, r.entry)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
}

// CR 707.10c: once its targets are decided, the copy is put onto the stack.
@(private = "file")
put_copy_on_stack :: proc(g: ^Game, entry: types.StackEntry) {
	types.pvec_push(&g.state.stack, entry, copy_entry)
	spell := entry.kind.(types.StackEntryKind_Spell)
	ids := make([dynamic]types.TargetRef, context.temp_allocator)
	for n := spell.ability; n != nil; n = n.sub_ability do append(&ids, ..n.targets[:])
	note_targeted(g, entry.id, entry.controller, ids[:]) // CR 115.1: it targets them, and ward sees it
}

// CR 608.3f: a copy of a permanent spell becomes a token as it's put onto the battlefield. `entered`: once it has.
become_token_from_copy :: proc(g: ^Game, o: ^types.GameObject, entered: bool) {
	if !entered {
		o.is_token = false // a copy on the stack is no token; it moves like a spell (move_object)
		return
	}
	o.is_token = true
	o.is_copy = false
	if rec, has := &g.copy_exceptions[o.id]; has do rec.incarnation = o.incarnation // its copiable values (CR 707.9b)
}

// The AI's choice for a copy's target: a player or permanent of its own changed to one of an opponent's, if the copy
// harms its target; otherwise kept.
ai_copy_target :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_CopyRetarget) -> types.GameAction {
	s := &g.state
	if w.current_slot >= len(w.target_slots) do return types.GameAction_KeepAllCopyTargets{}
	slot := w.target_slots[w.current_slot]
	mine :: proc(s: ^types.GameState, t: types.TargetRef, p: types.PlayerId) -> bool {
		switch x in t {
		case types.TargetRef_Player:
			return x._0 == p
		case types.TargetRef_Object:
			o := object(s, x._0)
			return o != nil && o.controller == p
		}
		return false
	}
	current, has := slot.current.?
	if !has || !mine(s, current, p) do return types.GameAction_ChooseTarget{}
	// Aimed at its own side: was the original meant to help (a pump on its creature)? Keep it then.
	r := g.copy_retarget
	if r.next < len(r.slots) {
		#partial switch e in r.slots[r.next].node.effect {
		case types.Effect_Pump, types.Effect_GenericEffect, types.Effect_GainLife, types.Effect_Draw, types.Effect_PutCounter:
			return types.GameAction_ChooseTarget{}
		}
	}
	for t in slot.legal_alternatives do if !mine(s, t, p) do return types.GameAction_ChooseTarget{target = t}
	return types.GameAction_ChooseTarget{}
}
