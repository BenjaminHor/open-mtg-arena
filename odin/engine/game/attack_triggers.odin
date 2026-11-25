// "Whenever you attack" and its batched forms: "whenever you attack with one or more Goblins" (CR 508.3c),
// "whenever one or more creatures you control attack a player" (CR 508.3e), "whenever one or more creatures attack",
// "whenever you attack with three or more creatures". Each triggers once for a declaration of attackers (CR 508.3d,
// 603.2c), if the creatures declared as attackers fit; creatures put onto the battlefield attacking were never
// declared, so they don't count (CR 508.3a, 508.4).
package game

import types "../types"

// Set while a "... attack a player" trigger's condition is checked: "two or more creatures you control attack a
// player" counts only the creatures attacking a player (CR 508.3e).
@(thread_local)
counting_player_attackers: bool

you_attack_supported :: proc(t: types.TriggerDefinition) -> bool {
	// Whose attack: "you attack", "creatures you control attack" (the data's valid_target is you, or the creature
	// filter says "you control"), or any player's ("one or more creatures attack": valid_target any player).
	any_player := false
	if v, has := t.valid_target.?; has {
		if is_any_player(v) do any_player = true
		else if !is_you(v) do return false
	}
	if a, has := t.attack_target_filter.?; has {
		if _, player := a.(types.AttackTargetFilter_Player); !player do return false
	}
	if f, has := t.valid_card.?; has {
		// "One or more [kind of] creatures": a batch (CR 603.2c).
		if !t.batched || !attacker_filter_supported(f) do return false
		// Neither "you" nor "any player" said: whose attack isn't known.
		if t.valid_target == nil && !filter_says_you(f) do return false
	} else if any_player {
		return false // "whenever a player attacks" with no creature named: not seen in the card data
	}
	return true
}

// A filter on the attacking creatures: a kind of creature, with or without "you control".
@(private = "file")
attacker_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		if c, has := x._0.controller.?; has {
			if _, you := c.(types.ControllerRef_You); !you do return false
		}
		return typed_supported(x._0)
	case types.TargetFilter_Or:
		// "One or more Goblins and/or Orcs".
		for y in x.filters do if !attacker_filter_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

@(private = "file")
filter_says_you :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		c, has := x._0.controller.?
		_, you := c.(types.ControllerRef_You)
		return has && you
	case types.TargetFilter_Or:
		for y in x.filters do if !filter_says_you(y) do return false
		return len(x.filters) > 0
	}
	return false
}

// "If you attacked with three or more creatures", "two or more creatures you control attack", "if a Pirate ...
// attacked this combat": the creatures the trigger's controller declared as attackers, of a kind.
attackers_declared_supported :: proc(x: types.TriggerCondition_AttackersDeclaredCount) -> bool {
	c, is_controller := x.subject.(types.AttackersDeclaredCountSubject_Controller)
	if !is_controller do return false
	if _, you := c.scope.(types.ControllerRef_You); !you do return false
	if f, has := c.filter.?; has && !attacker_filter_supported(f) do return false
	return true
}

// Whether the trigger's controller declared enough attackers of the kind in this declaration (CR 508.1).
attackers_declared_count :: proc(s: ^types.GameState, x: types.TriggerCondition_AttackersDeclaredCount, source: types.ObjectId, controller: types.PlayerId) -> bool {
	c := x.subject.(types.AttackersDeclaredCountSubject_Controller)
	n := 0
	if combat, in_combat := &s.combat.?; in_combat {
		for a in combat.attackers {
			o := object(s, a.object_id)
			if o == nil || o.controller != controller do continue
			if _, at_player := a.attack_target.(types.AttackTarget_Player); counting_player_attackers && !at_player do continue
			if f, has := c.filter.?; has && !attacker_matches(s, f, o, controller, source) do continue
			n += 1
		}
	}
	return compare(n, x.comparator, int(x.count))
}

@(private = "file")
attacker_matches :: proc(s: ^types.GameState, f: types.TargetFilter, o: ^types.GameObject, controller: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		return object_matches(s, o, x._0, controller, source)
	case types.TargetFilter_Or:
		for y in x.filters do if attacker_matches(s, y, o, controller, source) do return true
	}
	return false
}

// CR 508.3c-e, 603.2c: a declaration of attackers by e.controller triggers each "whenever you attack" ability whose
// creatures are among those declared: once, however many there are.
you_attack_triggers :: proc(g: ^Game, e: Event) {
	s := &g.state
	combat, in_combat := &s.combat.?
	if !in_combat do return
	for id in ids_of(s.battlefield) {
		w := object(s, id)
		for &entry in trigger_definitions(w) {
			t := &entry.definition
			if _, yours := t.mode.(types.TriggerMode_YouAttack); !yours || !trigger_supported(t^) do continue
			any_player := false
			if v, has := t.valid_target.?; has do any_player = is_any_player(v)
			if !any_player && e.controller != w.controller do continue
			_, at_players := t.attack_target_filter.?
			f, filtered := t.valid_card.?
			if filtered || at_players {
				fits := false
				for a in combat.attackers {
					o := object(s, a.object_id)
					if o == nil || o.controller != e.controller do continue
					if _, at_player := a.attack_target.(types.AttackTarget_Player); at_players && !at_player do continue
					if filtered && !attacker_matches(s, f, o, w.controller, w.id) do continue
					fits = true
				}
				if !fits do continue
			}
			if !turn_constraint_met(s, t^, w.controller) do continue
			counting_player_attackers = at_players
			add_trigger(g, w.id, w.controller, t)
			counting_player_attackers = false
		}
	}
}
