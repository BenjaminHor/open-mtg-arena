// Delayed triggered abilities (CR 603.7): "Sacrifice it at the beginning of the next end step." Created as a spell or
// ability resolves, kept in the game state (its delayed_triggers, as Rust keeps them) with the object "it" names, and
// triggered once, the next time the step begins (CR 603.7b).
package game

import types "../types"

// "At the beginning of the next end step / upkeep / end of combat", with an instruction this engine carries out on
// "it" (the object the instruction before named) and no targets of its own.
// `after_target`: an instruction before it chose a target, which "it" can name (CR 608.2c); with none, an "it"
// would name nothing, so that's refused.
delayed_trigger_supported :: proc(x: types.Effect_CreateDelayedTrigger, after_target: bool) -> bool {
	if x.effect == nil do return false
	// "Those tokens" may name the tokens just made, for a delayed ability (zone_effects.odin's moves_cards).
	checking_delayed = true
	defer checking_delayed = false
	// "Return those cards at the beginning of the next end step": the cards the instruction before moved, kept by
	// the delayed ability (only a zone change reading them, after an instruction that moves cards).
	// (The data sometimes names them as the earlier target, "it", which is the same card.)
	if x.uses_tracked_set && !(previous_instruction != nil && moves_cards(previous_instruction^) && (reads_tracked_set(x.effect.effect^) || refers_to_parent_target(x.effect.effect^))) do return false
	c, at_next := x.condition.(types.DelayedTriggerCondition_AtNextPhase)
	if !at_next do return false
	#partial switch c.phase {
	case .End, .Upkeep, .EndCombat:
	case:
		return false
	}
	for a := x.effect; a != nil; a = a.sub_ability {
		if a.effect == nil || a.condition != nil do return false // "if you do" there would read nothing done yet
		if _, targets := effect_target(a.effect^); targets do return false
	}
	if x.uses_tracked_set do return ability_supported(x.effect^, after_target = after_target, previous = previous_instruction, before_previous = instruction_before_previous)
	return ability_supported(x.effect^, after_target = after_target)
}

// A zone change or sacrifice of "those cards" (the tracked set an earlier instruction made).
reads_tracked_set :: proc(e: types.Effect) -> bool {
	#partial switch x in e {
	case types.Effect_ChangeZone:
		_, tracked := x.target.(types.TargetFilter_TrackedSet)
		return tracked
	case types.Effect_Sacrifice:
		_, tracked := x.target.(types.TargetFilter_TrackedSet)
		return tracked
	}
	return false
}

// CR 603.7a, 603.7d: the ability exists from now, controlled by the resolving spell or ability's controller; "it"
// is the object the instruction before acted on, as it is now (CR 603.7c: in its zone, the same object).
create_delayed_trigger :: proc(g: ^Game, x: types.Effect_CreateDelayedTrigger, controller: types.PlayerId, source: types.ObjectId) {
	s := &g.state
	top := resolved_tree(s, x.effect, nil, nil, controller, source)
	if refers_to_parent_target(top.effect) {
		append(&top.targets, ..g.resolution.last_targets[:])
		record_target_incarnations(s, top)
	} else if x.uses_tracked_set && reads_tracked_set(top.effect) {
		// "Those cards": what the instruction before moved, each as the object it is now (CR 603.7c, 400.7j).
		for id in g.resolution.moved do append(&top.targets, types.TargetRef(types.TargetRef_Object{id}))
		record_target_incarnations(s, top)
	}
	append(&s.delayed_triggers, types.DelayedTrigger{condition = x.condition, ability = top, controller = controller, source_id = source, one_shot = true})
}

// A step began: the delayed abilities waiting for it trigger, and are gone (CR 603.7b).
trigger_delayed :: proc(g: ^Game, step: types.Phase) {
	s := &g.state
	for i := 0; i < len(s.delayed_triggers); {
		d := s.delayed_triggers[i]
		c, at_next := d.condition.(types.DelayedTriggerCondition_AtNextPhase)
		if !at_next || c.phase != step || d.ability == nil {
			i += 1
			continue
		}
		append(&g.pending_triggers, Pending_Trigger{source = d.source_id, controller = d.controller, delayed = d.ability})
		ordered_remove(&s.delayed_triggers, i)
	}
}
