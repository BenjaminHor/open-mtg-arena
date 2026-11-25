// Countering spells (CR 701.6): "Counter target spell", "Counter target creature spell", "Counter target
// noncreature spell". The target is a spell on the stack (not the counterspell itself, CR 115.5); countering
// removes it from the stack into its owner's graveyard (CR 701.6a), unless it can't be countered (CR 101.2).
package game

import types "../types"

// "Target spell", optionally of a kind: StackSpell, StackSpell and [typed], or either of such.
spell_target_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_StackSpell:
		return true
	case types.TargetFilter_And:
		has_stack := false
		for y in x.filters {
			#partial switch z in y {
			case types.TargetFilter_StackSpell:
				has_stack = true
			case types.TargetFilter_Typed:
				if !typed_supported(z._0) || z._0.controller != nil do return false
			case:
				return false
			}
		}
		return has_stack
	case types.TargetFilter_Or:
		for y in x.filters do if !spell_target_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

is_spell_target :: proc(f: types.TargetFilter) -> bool {
	#partial switch _ in f {
	case types.TargetFilter_StackSpell, types.TargetFilter_And:
		return true
	case types.TargetFilter_Or:
		return spell_target_supported(f)
	}
	return false
}

// The spells on the stack that fit, other than `source` itself.
spell_targets :: proc(s: ^types.GameState, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId, out: ^[dynamic]types.TargetRef) {
	for i in 0 ..< types.pvec_len(s.stack) {
		e := types.pvec_get(s.stack, i)
		if _, is_spell := e.kind.(types.StackEntryKind_Spell); !is_spell || e.id == source do continue
		o := object(s, e.id)
		if o != nil && spell_fits(s, o, f, controller, source) do append(out, types.TargetRef_Object{e.id})
	}
}

@(private = "file")
spell_fits :: proc(s: ^types.GameState, o: ^types.GameObject, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_StackSpell:
		return true
	case types.TargetFilter_Typed:
		return object_matches(s, o, x._0, controller, source)
	case types.TargetFilter_And:
		for y in x.filters do if !spell_fits(s, o, y, controller, source) do return false
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if spell_fits(s, o, y, controller, source) do return true
	}
	return false
}

counter_supported :: proc(x: types.Effect_Counter) -> bool {
	return x.source_rider == nil && x.countered_spell_zone == nil && spell_target_supported(x.target)
}

// CR 701.6a: the spell leaves the stack for its owner's graveyard and doesn't resolve.
counter_spell :: proc(g: ^Game, id: types.ObjectId) {
	s := &g.state
	o := object(s, id)
	if o == nil {
		// CR 701.6a: a countered ability is removed from the stack (ward counters abilities too).
		if _, on_stack := stack_entry_of(s, id); !on_stack do return
		kept: types.PVec(types.StackEntry)
		for i in 0 ..< types.pvec_len(s.stack) {
			e := types.pvec_get(s.stack, i)
			if e.id != id do types.pvec_push(&kept, e, copy_entry)
		}
		s.stack = kept
		delete_key(&g.stack_abilities, id)
		delete_key(&g.stack_events, id)
		delete_key(&g.stack_conditions, id)
		delete_key(&g.stack_transforms, id)
		return
	}
	if o.zone != .Stack || has_rule(g, o, .Cant_Be_Countered) do return
	kept: types.PVec(types.StackEntry)
	for i in 0 ..< types.pvec_len(s.stack) {
		e := types.pvec_get(s.stack, i)
		if e.id != id do types.pvec_push(&kept, e, copy_entry)
	}
	s.stack = kept
	spell_leaves_stack(g, id) // its owner's graveyard, or exile after flashback (CR 702.34a)
}
