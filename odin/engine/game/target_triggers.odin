// "Becomes the target" triggers (CR 115.1, 603.2): "whenever this creature becomes the target of a spell",
// "whenever a creature you control becomes the target of a spell or ability an opponent controls". A permanent
// becomes a target as the spell or ability targeting it is put on the stack (note_targeted, ward.odin).
package game

import "core:strings"
import types "../types"

becomes_target_supported :: proc(t: types.TriggerDefinition) -> bool {
	// "Whenever you become the target", "a player or permanent": players becoming targets aren't events yet. A
	// valid_target is also how the data notes the effect's own target (Venerated Rotpriest), so it isn't read.
	if t.valid_target != nil || t.valid_subject_player != nil do return false
	f, has := t.valid_card.?
	if !has do return false
	#partial switch x in f {
	case types.TargetFilter_SelfRef:
	case types.TargetFilter_Typed:
		if !typed_supported(x._0) do return false
	case:
		// "A creature you control or a creature spell you control" (Surrak, Elusive Hunter) loses its spell half in
		// the data: an Or isn't read.
		return false
	}
	if src, has_src := t.valid_source.?; has_src && !targeting_source_supported(src) do return false
	// "Becomes the target of a spell you control" (Stormchaser Drake) where the data's source names no controller:
	// the controller was lost, so it isn't read as any spell.
	if d, has_d := t.description.?; has_d {
		if i := strings.index(d, "target of "); i >= 0 {
			rest := d[i:]
			if (strings.contains(rest, "you control") || strings.contains(rest, "opponent controls")) && !names_controller(t.valid_source) do return false
		}
	}
	return true
}

@(private = "file")
names_controller :: proc(f: Maybe(types.TargetFilter)) -> bool {
	x, has := f.?
	if !has do return false
	#partial switch y in x {
	case types.TargetFilter_StackAbility:
		return y.controller != nil
	case types.TargetFilter_Typed:
		return y._0.controller != nil
	case types.TargetFilter_And:
		for z in y.filters do if names_controller(z) do return true
	case types.TargetFilter_Or:
		// Each alternative: "a spell or ability an opponent controls".
		for z in y.filters do if !names_controller(z) do return false
		return len(y.filters) > 0
	}
	return false
}

// What targets it: "a spell", "an ability", "a spell or ability [you / an opponent] control(s)".
@(private = "file")
targeting_source_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_StackSpell:
		return true
	case types.TargetFilter_StackAbility:
		// "A backup ability", "an activated ability": the kind of ability isn't recorded.
		return x.tag == nil && x.kind == nil && controller_ref_supported(x.controller)
	case types.TargetFilter_Typed:
		// Beside StackSpell in an And: "a spell an opponent controls", the controller alone.
		return len(x._0.type_filters) == 0 && len(x._0.properties) == 0 && x._0.controller != nil && controller_ref_supported(x._0.controller)
	case types.TargetFilter_And:
		for y in x.filters do if !targeting_source_supported(y) do return false
		return len(x.filters) > 0
	case types.TargetFilter_Or:
		for y in x.filters do if !targeting_source_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

@(private = "file")
controller_ref_supported :: proc(c: Maybe(types.ControllerRef)) -> bool {
	ref, has := c.?
	if !has do return true
	#partial switch _ in ref {
	case types.ControllerRef_You, types.ControllerRef_Opponent:
		return true
	}
	return false
}

@(private = "file")
targeting_source_matches :: proc(f: types.TargetFilter, e: Event, watcher: ^types.GameObject) -> bool {
	controlled :: proc(c: Maybe(types.ControllerRef), e: Event, watcher: ^types.GameObject) -> bool {
		ref, has := c.?
		if !has do return true
		#partial switch _ in ref {
		case types.ControllerRef_You:
			return e.controller == watcher.controller
		case types.ControllerRef_Opponent:
			return e.controller != watcher.controller
		}
		return false
	}
	#partial switch x in f {
	case types.TargetFilter_StackSpell:
		return e.by_spell
	case types.TargetFilter_StackAbility:
		return !e.by_spell && controlled(x.controller, e, watcher)
	case types.TargetFilter_Typed:
		return controlled(x._0.controller, e, watcher)
	case types.TargetFilter_And:
		for y in x.filters do if !targeting_source_matches(y, e, watcher) do return false
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if targeting_source_matches(y, e, watcher) do return true
	}
	return false
}

// CR 603.2: the abilities of permanents watching a permanent become the target of a spell or ability.
became_target_triggers :: proc(g: ^Game, e: Event) {
	s := &g.state
	targeted := object(s, e.object)
	if targeted == nil || targeted.zone != .Battlefield do return
	for id in ids_of(s.battlefield) {
		w := object(s, id)
		for &entry in trigger_definitions(w) {
			t := &entry.definition
			if _, becomes := t.mode.(types.TriggerMode_BecomesTarget); !becomes || !trigger_supported(t^) do continue
			f := t.valid_card.?
			if is_self(f) {
				if targeted.id != w.id do continue
			} else if !object_matches(s, targeted, f.(types.TargetFilter_Typed)._0, w.controller, w.id) do continue
			if src, has := t.valid_source.?; has && !targeting_source_matches(src, e, w) do continue
			if !turn_constraint_met(s, t^, w.controller) do continue
			add_trigger(g, w.id, w.controller, t)
		}
	}
}
