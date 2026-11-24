// Triggered abilities (CR 603): events, the abilities they trigger, putting those on the stack and resolving them.
// Supported: "when/whenever [this or a kind of permanent] enters, dies, leaves, is put into a zone", "at the
// beginning of [your / each] [step]", and "whenever this attacks", with any effect this engine supports, with or
// without targets, optional ("may") or not.
package game

import "core:slice"
import types "../types"

Event_Kind :: enum {
	Zone_Change,
	Step_Begin,
	Attack,
	Spell_Cast,
	Damage,
}

// Something that happened that an ability may trigger on (CR 603.2).
Event :: struct {
	kind:       Event_Kind,
	object:     types.ObjectId,
	from, to:   types.Zone,
	controller: types.PlayerId, // the object's controller as it last existed (CR 603.10)
	step:       types.Phase,
	target:     types.TargetRef, // Damage: what was dealt damage
	amount:     int,
	combat:     bool,
	lki:        ^types.GameObject, // Zone_Change from the battlefield: the permanent as it last existed (CR 608.2h)
}

// A triggered ability waiting to be put on the stack (CR 603.3).
Pending_Trigger :: struct {
	source:     types.ObjectId,
	controller: types.PlayerId,
	definition: ^types.TriggerDefinition,
	lki:        ^types.GameObject, // a leaves-the-battlefield trigger's source as it last existed (CR 603.10a)
}

// A triggered ability on the stack whose intervening "if" is checked again as it resolves (CR 603.4).
Stack_Condition :: struct {
	definition: ^types.TriggerDefinition,
	lki:        ^types.GameObject,
}

// ---- What's supported --------------------------------------------------------------------------------------

trigger_supported :: proc(t: types.TriggerDefinition) -> bool {
	if t.execute == nil || !ability_supported(t.execute^) do return false
	if c, has := t.condition.?; has && !trigger_condition_supported(c) do return false
	if t.unless_pay != nil || t.batched do return false
	// "you" as the one acting is read only by spell-cast triggers ("whenever you cast").
	_, is_cast := t.mode.(types.TriggerMode_SpellCast)
	_, is_damage := t.mode.(types.TriggerMode_DamageDone)
	if !is_cast && !is_damage && t.valid_target != nil do return false
	if !is_damage && t.valid_source != nil do return false
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
	case types.TriggerMode_DamageDone:
		// "Whenever [this / a creature you control] deals [combat] damage to [a player / an opponent / a creature]".
		if t.damage_kind == .NoncombatOnly || t.damage_amount != nil do return false
		src, has_src := t.valid_source.?
		if !has_src do return false
		#partial switch x in src {
		case types.TargetFilter_SelfRef:
		case types.TargetFilter_Typed:
			if !typed_supported(x._0) do return false
		case:
			return false
		}
		if v, has := t.valid_target.?; has && !damage_recipient_supported(v) do return false
		return true
	case types.TriggerMode_SpellCast:
		// "Whenever you cast a [kind of] spell", or "when you cast this spell".
		if v, has := t.valid_target.?; has && !is_you(v) do return false
		f, has := t.valid_card.?
		return !has || spell_filter_supported(f)
	}
	return false
}

damage_recipient_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Player, types.TargetFilter_Opponent:
		return true
	case types.TargetFilter_Typed:
		// No types and an opponent controller: "an opponent".
		if len(x._0.type_filters) == 0 && len(x._0.properties) == 0 {
			c, has := x._0.controller.?
			_, opp := c.(types.ControllerRef_Opponent)
			return has && opp
		}
		return typed_supported(x._0)
	}
	return false
}

damage_recipient_matches :: proc(s: ^types.GameState, f: types.TargetFilter, recipient: types.TargetRef, watcher: ^types.GameObject) -> bool {
	switch r in recipient {
	case types.TargetRef_Player:
		#partial switch x in f {
		case types.TargetFilter_Player:
			return true
		case types.TargetFilter_Opponent:
			return r._0 != watcher.controller
		case types.TargetFilter_Typed:
			return len(x._0.type_filters) == 0 && r._0 != watcher.controller
		}
	case types.TargetRef_Object:
		if x, typed := f.(types.TargetFilter_Typed); typed && len(x._0.type_filters) > 0 {
			return object_matches(s, object(s, r._0), x._0, watcher.controller, watcher.id)
		}
	}
	return false
}

spell_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_SelfRef:
		return true
	case types.TargetFilter_Typed:
		// With no card type named, any spell ("a spell with mana value 4 or greater").
		if len(x._0.type_filters) == 0 {
			if x._0.controller != nil do return false
			for p in x._0.properties do if !property_supported(p) do return false
			return true
		}
		return typed_supported(x._0)
	case types.TargetFilter_Or:
		for y in x.filters do if !spell_filter_supported(y) || is_self(y) do return false
		return true
	}
	return false
}

spell_matches :: proc(s: ^types.GameState, spell: ^types.GameObject, f: types.TargetFilter, watcher: ^types.GameObject) -> bool {
	#partial switch x in f {
	case types.TargetFilter_SelfRef:
		return spell.id == watcher.id
	case types.TargetFilter_Typed:
		return object_matches(s, spell, x._0, watcher.controller, watcher.id)
	case types.TargetFilter_Or:
		for y in x.filters do if spell_matches(s, spell, y, watcher) do return true
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
		case .Spell_Cast:
			// CR 601.2i: abilities that trigger on casting trigger once the spell is cast.
			spell := object(s, e.object)
			watchers := make([dynamic]^types.GameObject, context.temp_allocator)
			append(&watchers, spell)
			for id in ids_of(s.battlefield) do append(&watchers, object(s, id))
			for w in watchers {
				for &entry in trigger_definitions(w) {
					t := &entry.definition
					if _, is_cast := t.mode.(types.TriggerMode_SpellCast); !is_cast || !trigger_supported(t^) do continue
					f, has := t.valid_card.?
					if w.id == spell.id && !(has && is_self(f)) do continue // a spell's own triggers are "this spell" ones
					if has && !spell_matches(s, spell, f, w) do continue
					if _, you := t.valid_target.?; you && e.controller != w.controller do continue
					add_trigger(g, w.id, w.controller, t)
				}
			}
		case .Damage:
			source := object(s, e.object)
			watchers := make([dynamic]^types.GameObject, context.temp_allocator)
			append(&watchers, source)
			for id in ids_of(s.battlefield) do if id != e.object do append(&watchers, object(s, id))
			for w in watchers {
				for &entry in trigger_definitions(w) {
					t := &entry.definition
					if _, dmg := t.mode.(types.TriggerMode_DamageDone); !dmg || !trigger_supported(t^) do continue
					if t.damage_kind == .CombatOnly && !e.combat do continue
					src, _ := t.valid_source.?
					#partial switch x in src {
					case types.TargetFilter_SelfRef:
						if w.id != source.id do continue
					case types.TargetFilter_Typed:
						if !object_matches(s, source, x._0, w.controller, w.id) do continue
					}
					if v, has := t.valid_target.?; has && !damage_recipient_matches(s, v, e.target, w) do continue
					add_trigger(g, w.id, w.controller, t)
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
		// The moved object as it was for the event: its controller then (CR 603.10).
		as_was := moved^
		as_was.controller = e.controller
		if !object_matches(s, &as_was, f._0, source.controller, source.id) do return
	case:
		return
	}
	if !turn_constraint_met(s, t^, controller) do return
	// CR 603.10a: a leaves-the-battlefield ability looks back at the permanent as it last existed.
	add_trigger(g, source.id, controller, t, e.lki if is_self && e.from == .Battlefield else nil)
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

add_trigger :: proc(g: ^Game, source: types.ObjectId, controller: types.PlayerId, t: ^types.TriggerDefinition, lki: ^types.GameObject = nil) {
	// CR 603.4: with an intervening "if", the ability triggers only if the condition is true now.
	if c, has := t.condition.?; has && !condition_holds_as_was(&g.state, source, controller, c, lki) do return
	append(&g.pending_triggers, Pending_Trigger{source = source, controller = controller, definition = t, lki = lki})
}

// The condition, read from the source as it last existed when it has left the battlefield (CR 603.10a, 608.2h).
condition_holds_as_was :: proc(s: ^types.GameState, source: types.ObjectId, controller: types.PlayerId, c: types.TriggerCondition, lki: ^types.GameObject) -> bool {
	if lki != nil {
		now := s.objects.inner[source]
		s.objects.inner[source] = lki
		defer s.objects.inner[source] = now
		return trigger_condition_holds(s, source, controller, c)
	}
	return trigger_condition_holds(s, source, controller, c)
}

// ---- Intervening "if" conditions (CR 603.4) -----------------------------------------------------------------

trigger_condition_supported :: proc(c: types.TriggerCondition) -> bool {
	#partial switch x in c {
	case types.TriggerCondition_QuantityComparison:
		return quantity_supported(x.lhs) && quantity_supported(x.rhs)
	case types.TriggerCondition_HasCounters:
		#partial switch m in x.counters {
		case types.CounterMatch_Any:
			return true
		case types.CounterMatch_OfType:
			return counter_kind_supported(m._0)
		}
	case types.TriggerCondition_SourceInZone:
		return true
	case types.TriggerCondition_And:
		for y in x.conditions do if !trigger_condition_supported(y) do return false
		return true
	case types.TriggerCondition_Or:
		for y in x.conditions do if !trigger_condition_supported(y) do return false
		return true
	case types.TriggerCondition_Not:
		return x.condition != nil && trigger_condition_supported(x.condition^)
	}
	return false
}

trigger_condition_holds :: proc(s: ^types.GameState, source: types.ObjectId, controller: types.PlayerId, c: types.TriggerCondition) -> bool {
	src := object(s, source)
	#partial switch x in c {
	case types.TriggerCondition_QuantityComparison:
		return compare(quantity_value(s, x.lhs, controller, source, 0), x.comparator, quantity_value(s, x.rhs, controller, source, 0))
	case types.TriggerCondition_HasCounters:
		n: u32
		if src != nil do for k in src.counters {
			#partial switch m in x.counters {
			case types.CounterMatch_Any:
				n += k._1
			case types.CounterMatch_OfType:
				if same_counter(k._0, m._0) do n += k._1
			}
		}
		if most, has := x.maximum.?; has && n > most do return false
		return n >= x.minimum
	case types.TriggerCondition_SourceInZone:
		return src != nil && src.zone == x.zone
	case types.TriggerCondition_And:
		for y in x.conditions do if !trigger_condition_holds(s, source, controller, y) do return false
		return true
	case types.TriggerCondition_Or:
		for y in x.conditions do if trigger_condition_holds(s, source, controller, y) do return true
		return false
	case types.TriggerCondition_Not:
		return !trigger_condition_holds(s, source, controller, x.condition^)
	}
	return false
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
		slots := slot_list(pt.definition.execute)
		if g.trigger_targets.source != pt.source || g.trigger_targets.definition != pt.definition {
			g.trigger_targets = Trigger_Target_Choice{source = pt.source, definition = pt.definition}
		}
		c := &g.trigger_targets.choice
		for {
			settle_choice(s, slots[:], c, pt.controller, pt.source)
			if c.slot >= len(slots) do break
			legal := slot_legal(s, slots[:], c, pt.controller, pt.source)
			if len(legal) == 0 do break // a required target with none legal
			if len(legal) == 1 && !slots[c.slot].optional {
				take_target(slots[:], c, legal[0])
				continue
			}
			// A real choice: ask the controller.
			ask_trigger_target(g, pt, slots[:], c.slot, legal)
			return false
		}
		complete := c.slot >= len(slots)
		targets, counts := c.targets, c.counts
		g.trigger_targets = {}
		ordered_remove(&g.pending_triggers, index)
		// CR 603.3d: an ability that needs a target and has none legal is removed from the stack.
		if !complete do continue
		id := push_ability(g, pt.source, pt.controller, pt.definition.execute, targets[:], true, counts[:])
		if pt.definition.condition != nil do g.stack_conditions[id] = Stack_Condition{pt.definition, pt.lki}
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
	source:       types.ObjectId,
	definition:   ^types.TriggerDefinition,
	using choice: Target_Choice,
}

@(private = "file")
ask_trigger_target :: proc(g: ^Game, pt: Pending_Trigger, slots: []Target_Slot, slot: int, legal: [dynamic]types.TargetRef) {
	s := &g.state
	selected: [dynamic]Maybe(types.TargetRef)
	for t in g.trigger_targets.targets do append(&selected, t)
	s.priority_player = pt.controller
	s.waiting_for = types.WaitingFor_TriggerTargetSelection {
		player = pt.controller,
		trigger_controller = pt.controller,
		target_slots = selection_slots(s, slots, pt.controller, pt.source),
		selection = {current_slot = slot, selected_slots = selected, current_legal_targets = legal},
		source_id = pt.source,
		description = pt.definition.description,
	}
}

// The controller's target for the trigger being put on the stack.
choose_trigger_target :: proc(g: ^Game, p: types.PlayerId, t: types.TargetRef) -> bool {
	s := &g.state
	w := s.waiting_for.(types.WaitingFor_TriggerTargetSelection)
	if g.trigger_targets.definition == nil || !slice.contains(w.selection.current_legal_targets[:], t) do return false
	take_target(slot_list(g.trigger_targets.definition.execute)[:], &g.trigger_targets.choice, t)
	give_priority(g, s.active_player)
	return true
}

// CR 115.6: declining an optional target of a triggered ability.
decline_trigger_target :: proc(g: ^Game, p: types.PlayerId) -> bool {
	if g.trigger_targets.definition == nil do return false
	slots := slot_list(g.trigger_targets.definition.execute)
	c := &g.trigger_targets.choice
	if c.slot >= len(slots) || !slots[c.slot].optional do return false
	skip_group(slots[:], c)
	give_priority(g, g.state.active_player)
	return true
}

// Puts an ability on the stack: a new stack object (CR 113.7a) whose definition the game keeps to resolve it.
push_ability :: proc(g: ^Game, source: types.ObjectId, controller: types.PlayerId, a: ^types.AbilityDefinition, targets: []types.TargetRef, triggered: bool, counts: []int = nil) -> types.ObjectId {
	s := &g.state
	id := types.ObjectId(s.next_object_id)
	s.next_object_id += 1
	resolved := resolved_tree(s, a, targets, counts, controller, source)
	g.stack_abilities[id] = a
	src := object(s, source)
	kind: types.StackEntryKind
	if triggered {
		kind = types.StackEntryKind_TriggeredAbility{source_id = source, ability = resolved, source_name = src.name if src != nil else ""}
	} else {
		kind = types.StackEntryKind_ActivatedAbility{source_id = source, ability = resolved}
	}
	types.pvec_push(&s.stack, types.StackEntry{id = id, source_id = source, controller = controller, kind = kind}, copy_entry)
	return id
}

// ---- Resolving (CR 608.2) -----------------------------------------------------------------------------------

// Resolves an ability from the stack. CR 603.5: an optional ("may") ability asks its controller as it resolves.
resolve_ability :: proc(g: ^Game, entry: types.StackEntry, resolved: ^types.ResolvedAbility) {
	// CR 603.4: the intervening "if" is checked again as the ability resolves; if false, it does nothing.
	if t, has := g.stack_conditions[entry.id]; has {
		delete_key(&g.stack_conditions, entry.id)
		if !condition_holds_as_was(&g.state, entry.source_id, entry.controller, t.definition.condition.?, t.lki) {
			delete_key(&g.stack_abilities, entry.id)
			return
		}
	}
	if resolved == nil do return
	if resolved.optional && !g.optional_accepted {
		g.optional_entry = entry
		s := &g.state
		s.priority_player = entry.controller
		s.waiting_for = types.WaitingFor_OptionalEffectChoice{player = entry.controller, source_id = entry.source_id, description = resolved.description}
		return
	}
	g.optional_accepted = false
	start_resolution(g, resolved, entry.controller, entry.source_id, stack_id = entry.id)
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
	s.waiting_for = nil
	if accept {
		g.optional_accepted = true
		resolve_ability(g, entry, resolved)
	} else {
		delete_key(&g.stack_abilities, entry.id)
	}
	g.optional_entry = {}
	if g.resolution.active do return true // the ability asked for another choice
	s.waiting_for = nil
	after_resolution(g)
	return true
}

// ---- Tokens (CR 111) ----------------------------------------------------------------------------------------

// CR 111.1-111.4: a token is created with the characteristics the effect gives it, under its creator's control.
create_token :: proc(g: ^Game, e: types.Effect_Token, controller: types.PlayerId, source: types.ObjectId = 0) {
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
	pt :: proc(s: ^types.GameState, v: types.PtValue, controller: types.PlayerId, source: types.ObjectId) -> Maybe(i32) {
		#partial switch x in v {
		case types.PtValue_Fixed:
			return x._0
		case types.PtValue_Quantity:
			return i32(quantity_value(s, x._0, controller, source, 0))
		}
		return nil
	}
	o.power = pt(s, e.power, controller, source)
	o.toughness = pt(s, e.toughness, controller, source)
	statics := new([dynamic]types.StaticDefinition)
	append(statics, ..e.static_abilities[:])
	o.static_definitions = types.Definitions_StaticDefinition(statics)
	o.base_static_definitions = statics
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

// "You", written as the controller or as a player filter with no types and "you" as the controller.
is_you :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Controller:
		return true
	case types.TargetFilter_Typed:
		c, has := x._0.controller.?
		_, you := c.(types.ControllerRef_You)
		return has && you && len(x._0.type_filters) == 0 && len(x._0.properties) == 0
	}
	return false
}
