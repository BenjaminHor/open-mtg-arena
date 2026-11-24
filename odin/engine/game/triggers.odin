// Triggered abilities (CR 603): events, the abilities they trigger, putting those on the stack and resolving them.
// Supported: "when/whenever [this or a kind of permanent] enters, dies, leaves, is put into a zone", "at the
// beginning of [your / each] [step]", and "whenever this attacks", with any effect this engine supports, with or
// without targets, optional ("may") or not.
package game

import types "../types"

Event_Kind :: enum {
	Zone_Change,
	Step_Begin,
	Attack,
}

// Something that happened that an ability may trigger on (CR 603.2).
Event :: struct {
	kind:       Event_Kind,
	object:     types.ObjectId,
	from, to:   types.Zone,
	controller: types.PlayerId, // the object's controller as it last existed (CR 603.10)
	step:       types.Phase,
}

// A triggered ability waiting to be put on the stack (CR 603.3).
Pending_Trigger :: struct {
	source:     types.ObjectId,
	controller: types.PlayerId,
	definition: ^types.TriggerDefinition,
}

// ---- What's supported --------------------------------------------------------------------------------------

trigger_supported :: proc(t: types.TriggerDefinition) -> bool {
	if t.execute == nil || !ability_supported(t.execute^) do return false
	if t.condition != nil || t.unless_pay != nil || t.valid_target != nil || t.valid_source != nil || t.batched do return false
	if len(t.origin_zones) > 0 || len(t.zone_change_clauses) > 0 || t.counter_filter != nil || t.saga_chapter != nil do return false
	if c, has := t.constraint.?; has {
		#partial switch _ in c {
		case types.TriggerConstraint_OnlyDuringYourTurn, types.TriggerConstraint_OnlyDuringOpponentsTurn:
		case:
			return false
		}
	}
	#partial switch _ in t.mode {
	case types.TriggerMode_ChangesZone:
		if f, has := t.valid_card.?; has do return subject_filter_supported(f)
		return false
	case types.TriggerMode_Phase:
		_, has := t.phase.?
		return has && t.valid_card == nil
	case types.TriggerMode_Attacks:
		f, has := t.valid_card.?
		_, self := f.(types.TargetFilter_SelfRef)
		return has && self && t.attack_target_filter == nil
	}
	return false
}

// The objects a trigger watches: itself, or permanents of a kind (and controller).
subject_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch _ in f {
	case types.TargetFilter_SelfRef:
		return true
	case types.TargetFilter_Typed:
		return filter_supported(f)
	}
	return false
}

// ---- Collecting ---------------------------------------------------------------------------------------------

trigger_definitions :: proc(o: ^types.GameObject) -> []types.TriggerEntry {
	if o.trigger_definitions == nil do return nil
	return o.trigger_definitions^[:]
}

has_zone :: proc(zones: []types.Zone, z: types.Zone) -> bool {
	for x in zones do if x == z do return true
	return false
}

// CR 603.2: whenever an event matches a trigger condition, the ability triggers. Called after each event-producing
// change; the abilities wait in the pending list until a player would receive priority.
collect_triggers :: proc(g: ^Game) {
	s := &g.state
	for e in g.events {
		switch e.kind {
		case .Zone_Change:
			moved := object(s, e.object)
			// The moved object's own abilities, as it is now (it entered) or as it last existed (it left): CR 603.6a,
			// 603.10a. Then every other permanent watching for such an event.
			for &entry in trigger_definitions(moved) do zone_change_trigger(g, moved, &entry.definition, e, true)
			for id in ids_of(s.battlefield) {
				if id == e.object do continue
				watcher := object(s, id)
				for &entry in trigger_definitions(watcher) do zone_change_trigger(g, watcher, &entry.definition, e, false)
			}
		case .Step_Begin:
			for id in ids_of(s.battlefield) {
				o := object(s, id)
				for &entry in trigger_definitions(o) {
					t := &entry.definition
					if _, phase := t.mode.(types.TriggerMode_Phase); !phase || !trigger_supported(t^) do continue
					step, _ := t.phase.?
					if step != e.step || !turn_constraint_met(s, t^, o.controller) do continue
					add_trigger(g, o.id, o.controller, t)
				}
			}
		case .Attack:
			o := object(s, e.object)
			for &entry in trigger_definitions(o) {
				t := &entry.definition
				if _, attacks := t.mode.(types.TriggerMode_Attacks); attacks && trigger_supported(t^) do add_trigger(g, o.id, o.controller, t)
			}
		}
	}
	clear(&g.events)
}

@(private = "file")
zone_change_trigger :: proc(g: ^Game, source: ^types.GameObject, t: ^types.TriggerDefinition, e: Event, is_self: bool) {
	s := &g.state
	if _, zc := t.mode.(types.TriggerMode_ChangesZone); !zc || !trigger_supported(t^) do return
	if origin, has := t.origin.?; has && origin != e.from do return
	if dest, has := t.destination.?; has && dest != e.to do return
	subject, _ := t.valid_card.?
	controller := source.controller
	#partial switch f in subject {
	case types.TargetFilter_SelfRef:
		if !is_self do return
		// The ability works from the zone the object is in now (entering) or was in (dying, leaving).
		if !has_zone(t.trigger_zones[:], e.to) && !has_zone(t.trigger_zones[:], e.from) do return
		if e.from == .Battlefield do controller = e.controller
	case types.TargetFilter_Typed:
		if is_self || source.zone != .Battlefield do return
		moved := object(s, e.object)
		for tf in f._0.type_filters do if !matches_type(moved, tf) do return
		if c, has := f._0.controller.?; has {
			#partial switch _ in c {
			case types.ControllerRef_You:
				if e.controller != source.controller do return
			case types.ControllerRef_Opponent:
				if e.controller == source.controller do return
			}
		}
	case:
		return
	}
	if !turn_constraint_met(s, t^, controller) do return
	add_trigger(g, source.id, controller, t)
}

turn_constraint_met :: proc(s: ^types.GameState, t: types.TriggerDefinition, controller: types.PlayerId) -> bool {
	c, has := t.constraint.?
	if !has do return true
	#partial switch _ in c {
	case types.TriggerConstraint_OnlyDuringYourTurn:
		return s.active_player == controller
	case types.TriggerConstraint_OnlyDuringOpponentsTurn:
		return s.active_player != controller
	}
	return false
}

add_trigger :: proc(g: ^Game, source: types.ObjectId, controller: types.PlayerId, t: ^types.TriggerDefinition) {
	append(&g.pending_triggers, Pending_Trigger{source = source, controller = controller, definition = t})
}

// ---- Onto the stack (CR 603.3) ------------------------------------------------------------------------------

// CR 603.3b: the next time a player would receive priority, each player in APNAP order puts their triggered
// abilities on the stack (the active player's first, so they resolve last). Their targets are chosen then
// (CR 603.3d): when there's a real choice the player is asked, and the caller must wait. Returns false while a
// choice is pending.
place_triggers :: proc(g: ^Game) -> bool {
	s := &g.state
	collect_triggers(g)
	for len(g.pending_triggers) > 0 {
		index := next_trigger(g)
		pt := g.pending_triggers[index]
		slots := target_slots(pt.definition.execute)
		targets := make([dynamic]types.TargetRef)
		if g.trigger_targets.source == pt.source && g.trigger_targets.definition == pt.definition {
			append(&targets, ..g.trigger_targets.targets[:])
		}
		for len(targets) < len(slots) {
			legal := legal_targets(s, slots[len(targets)], pt.controller)
			if len(legal) == 0 do break
			if len(legal) == 1 {
				append(&targets, legal[0])
				continue
			}
			// A real choice: ask the controller.
			g.trigger_targets = Trigger_Target_Choice{source = pt.source, definition = pt.definition, targets = targets}
			ask_trigger_target(g, pt, slots[:], len(targets), legal)
			return false
		}
		g.trigger_targets = {}
		ordered_remove(&g.pending_triggers, index)
		// CR 603.3d: an ability that needs a target and has none legal is removed from the stack.
		if len(targets) < len(slots) do continue
		push_ability(g, pt.source, pt.controller, pt.definition.execute, targets[:], true)
	}
	return true
}

// APNAP: the active player's triggers first, then the others in turn order.
@(private = "file")
next_trigger :: proc(g: ^Game) -> int {
	s := &g.state
	for i in 0 ..< len(s.players) {
		p := types.PlayerId((int(s.active_player) + i) % len(s.players))
		for pt, index in g.pending_triggers do if pt.controller == p do return index
	}
	return 0
}

Trigger_Target_Choice :: struct {
	source:     types.ObjectId,
	definition: ^types.TriggerDefinition,
	targets:    [dynamic]types.TargetRef,
}

@(private = "file")
ask_trigger_target :: proc(g: ^Game, pt: Pending_Trigger, slots: []types.TargetFilter, slot: int, legal: [dynamic]types.TargetRef) {
	s := &g.state
	slot_list: [dynamic]types.TargetSelectionSlot
	for f in slots do append(&slot_list, types.TargetSelectionSlot{legal_targets = legal_targets(s, f, pt.controller)})
	selected: [dynamic]Maybe(types.TargetRef)
	for t in g.trigger_targets.targets do append(&selected, t)
	s.priority_player = pt.controller
	s.waiting_for = types.WaitingFor_TriggerTargetSelection {
		player = pt.controller,
		trigger_controller = pt.controller,
		target_slots = slot_list,
		selection = {current_slot = slot, selected_slots = selected, current_legal_targets = legal},
		source_id = pt.source,
		description = pt.definition.description,
	}
}

// The controller's target for the trigger being put on the stack.
choose_trigger_target :: proc(g: ^Game, p: types.PlayerId, t: types.TargetRef) -> bool {
	s := &g.state
	w := s.waiting_for.(types.WaitingFor_TriggerTargetSelection)
	legal := false
	for l in w.selection.current_legal_targets do if l == t do legal = true
	if !legal do return false
	append(&g.trigger_targets.targets, t)
	give_priority(g, s.active_player)
	return true
}

// Puts an ability on the stack: a new stack object (CR 113.7a) whose definition the game keeps to resolve it.
push_ability :: proc(g: ^Game, source: types.ObjectId, controller: types.PlayerId, a: ^types.AbilityDefinition, targets: []types.TargetRef, triggered: bool) {
	s := &g.state
	id := types.ObjectId(s.next_object_id)
	s.next_object_id += 1
	resolved := new(types.ResolvedAbility)
	resolved.source_id = source
	resolved.controller = controller
	if a.effect != nil do resolved.effect = a.effect^
	for t in targets do append(&resolved.targets, t)
	g.stack_abilities[id] = a
	src := object(s, source)
	kind: types.StackEntryKind
	if triggered {
		kind = types.StackEntryKind_TriggeredAbility{source_id = source, ability = resolved, source_name = src.name if src != nil else ""}
	} else {
		kind = types.StackEntryKind_ActivatedAbility{source_id = source, ability = resolved}
	}
	types.pvec_push(&s.stack, types.StackEntry{id = id, source_id = source, controller = controller, kind = kind}, copy_entry)
}

// ---- Resolving (CR 608.2) -----------------------------------------------------------------------------------

// Resolves an ability from the stack. CR 603.5: an optional ("may") ability asks its controller as it resolves.
resolve_ability :: proc(g: ^Game, entry: types.StackEntry, resolved: ^types.ResolvedAbility) {
	a := g.stack_abilities[entry.id]
	if a == nil do return // a restored game: its abilities on the stack aren't known to this engine
	if a.optional && !g.optional_accepted {
		g.optional_entry = entry
		s := &g.state
		s.priority_player = entry.controller
		s.waiting_for = types.WaitingFor_OptionalEffectChoice{player = entry.controller, source_id = entry.source_id, description = a.description}
		return
	}
	g.optional_accepted = false
	run_ability(g, a, entry.controller, entry.source_id, resolved.targets[:])
	delete_key(&g.stack_abilities, entry.id)
}

// CR 603.5: the controller decides whether to carry out a "may" ability.
decide_optional :: proc(g: ^Game, p: types.PlayerId, accept: bool) -> bool {
	s := &g.state
	entry := g.optional_entry
	if entry.controller != p do return false
	resolved: ^types.ResolvedAbility
	#partial switch k in entry.kind {
	case types.StackEntryKind_TriggeredAbility:
		resolved = k.ability
	case types.StackEntryKind_ActivatedAbility:
		resolved = k.ability
	}
	if accept {
		g.optional_accepted = true
		resolve_ability(g, entry, resolved)
	} else {
		delete_key(&g.stack_abilities, entry.id)
	}
	g.optional_entry = {}
	s.waiting_for = nil
	after_resolution(g)
	return true
}

// Carries out an ability's effects in order, each on its target if it has one. CR 608.2b: with every target illegal
// the ability does nothing; an illegal target alone is left unaffected.
run_ability :: proc(g: ^Game, a: ^types.AbilityDefinition, controller: types.PlayerId, source: types.ObjectId, targets: []types.TargetRef) {
	s := &g.state
	slots := target_slots(a)
	legal := make([]bool, len(targets), context.temp_allocator)
	any_legal := len(slots) == 0
	for t, i in targets do if i < len(slots) && target_still_legal(s, t, slots[i], controller) {
		legal[i] = true
		any_legal = true
	}
	if !any_legal do return
	slot := 0
	for x := a; x != nil; x = x.sub_ability {
		if x.effect == nil do continue
		target: Maybe(types.TargetRef)
		if _, targets_one := effect_target(x.effect^); targets_one {
			if slot < len(targets) && legal[slot] do target = targets[slot]
			slot += 1
			if target == nil do continue
		}
		do_effect(g, x, controller, source, target)
	}
}

// ---- Tokens (CR 111) ----------------------------------------------------------------------------------------

// CR 111.1-111.4: a token is created with the characteristics the effect gives it, under its creator's control.
create_token :: proc(g: ^Game, e: types.Effect_Token, controller: types.PlayerId) {
	s := &g.state
	o := new(types.GameObject)
	o.id = types.ObjectId(s.next_object_id)
	s.next_object_id += 1
	o.card_id = types.CardId(o.id)
	o.owner, o.controller, o.base_controller = controller, controller, controller
	o.is_token = true
	o.incarnation = 1
	o.phase_status = types.PhaseStatus_PhasedIn{}
	o.name = e.name
	for t in e.types {
		if core, is_core := core_type_named(t); is_core do append(&o.card_types.core_types, core)
		else do append(&o.card_types.subtypes, t)
	}
	append(&o.card_types.supertypes, ..e.supertypes[:])
	append(&o.color, ..e.colors[:])
	append(&o.keywords, ..e.keywords[:])
	if p, ok := e.power.(types.PtValue_Fixed); ok do o.power = p._0
	if t, ok := e.toughness.(types.PtValue_Fixed); ok do o.toughness = t._0
	o.layer_base_power, o.layer_base_toughness = o.power, o.toughness
	o.tapped = e.tapped
	abilities := new([dynamic]types.AbilityDefinition)
	o.abilities = abilities
	o.base_name, o.base_card_types, o.base_keywords, o.base_color = o.name, o.card_types, o.keywords, o.color
	o.base_power, o.base_toughness, o.base_abilities = o.power, o.toughness, o.abilities
	o.base_characteristics_initialized = true
	o.zone = .Battlefield
	o.entered_battlefield_turn = s.turn_number
	o.summoning_sick = true
	o.timestamp = s.next_timestamp
	s.next_timestamp += 1
	s.objects.inner[o.id] = o
	types.pvec_push(&s.battlefield, o.id, copy_id)
	// CR 111.10 (and 603.6a): a token entering the battlefield is an event like any other.
	append(&g.events, Event{kind = .Zone_Change, object = o.id, from = .Command, to = .Battlefield, controller = controller})
}

core_type_named :: proc(name: string) -> (types.CoreType, bool) {
	for t in types.CoreType do if name == fmt_core(t) do return t, true
	return {}, false
}

@(private = "file")
fmt_core :: proc(t: types.CoreType) -> string {
	#partial switch t {
	case .Artifact:
		return "Artifact"
	case .Creature:
		return "Creature"
	case .Enchantment:
		return "Enchantment"
	case .Land:
		return "Land"
	case .Planeswalker:
		return "Planeswalker"
	case .Battle:
		return "Battle"
	}
	return ""
}

// CR 111.7, 704.5d: a token that has left the battlefield ceases to exist when state-based actions are checked.
remove_departed_tokens :: proc(g: ^Game) -> bool {
	s := &g.state
	removed := false
	for &p in s.players {
		for list in ([?]^types.PVec(types.ObjectId){&p.hand, &p.graveyard, &p.library}) {
			keep := make([dynamic]types.ObjectId, context.temp_allocator)
			gone := false
			for id in ids_of(list^) {
				if object(s, id).is_token do gone = true
				else do append(&keep, id)
			}
			if gone {
				list^ = {}
				for id in keep do types.pvec_push(list, id, copy_id)
				removed = true
			}
		}
	}
	return removed
}
