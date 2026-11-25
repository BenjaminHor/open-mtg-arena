// Delayed triggered abilities (CR 603.7): "Sacrifice it at the beginning of the next end step", "At the beginning of
// your next upkeep, ...", "When that creature dies this turn, ...", "Whenever a creature dies this turn, ...".
// Created as a spell or ability resolves (CR 603.7a), kept in the game state (its delayed_triggers, as Rust keeps
// them) with the objects they're about, and triggered the next time their event happens (CR 603.7b): once, or, with
// a stated duration ("this turn"), each time until the duration ends.
package game

import "core:slice"
import "core:strings"
import types "../types"

// The card being checked (card_supported, card_gaps), for what its card data drops: whether "when that creature
// dies" says "this turn", whether "exile this, then return it" could be an Aura. Nil while the game runs: a card is
// checked before it's played.
@(thread_local)
checking_face: ^types.CardFace

// ---- What's supported --------------------------------------------------------------------------------------

// `after_target`: an instruction before it chose a target, which "it" can name (CR 608.2c); with none, an "it"
// would name nothing, so that's refused.
// `followed`: another instruction comes after it in the same ability.
delayed_trigger_supported :: proc(x: types.Effect_CreateDelayedTrigger, after_target: bool, followed := false) -> bool {
	if x.effect == nil do return false
	// "Those tokens" may name the tokens just made, for a delayed ability (zone_effects.odin's moves_cards).
	checking_delayed = true
	defer checking_delayed = false
	// "That creature", "that player" and "that much" inside the delayed ability are its own event's (none, for "at
	// the beginning of"), not those of a triggered ability that created it.
	object_defined, player_defined, amount_defined := event_object_defined, event_player_defined, event_amount_defined
	attack_defined, damaged_defined := event_attack_defined, event_damaged_defined
	event_object_defined, event_player_defined, event_amount_defined, event_attack_defined, event_damaged_defined = false, false, false, false, false
	defer event_object_defined, event_player_defined, event_amount_defined = object_defined, player_defined, amount_defined
	defer event_attack_defined, event_damaged_defined = attack_defined, damaged_defined
	#partial switch c in x.condition {
	case types.DelayedTriggerCondition_AtNextPhase:
		// "At the beginning of the next end step / upkeep", "at end of combat".
		#partial switch c.phase {
		case .End, .Upkeep, .EndCombat:
			return step_ability_supported(x, after_target)
		}
	case types.DelayedTriggerCondition_AtNextPhaseForPlayer:
		// "At the beginning of your next upkeep / end step"; "at the beginning of the end step on your next turn"
		// (waiting out this turn). The data's player is a placeholder for the ability's controller, bound as it's
		// created; other players ("its owner's next end step") aren't read yet.
		if c.binding != nil {
			if _, controller := c.binding.(types.DelayedTriggerPlayerBinding_Controller); !controller do return false
		}
		if _, fixed := c.gate.(types.TurnGate_After); fixed do return false
		#partial switch c.phase {
		case .End, .Upkeep:
			return step_ability_supported(x, after_target)
		}
	case types.DelayedTriggerCondition_WhenDies:
		return when_dies_supported(x, c, after_target)
	case types.DelayedTriggerCondition_WheneverEvent:
		// An instruction after "whenever ... this turn, [do something]" is the card data's split of that ability's
		// own instructions (Thunder of Unity's "and you gain 1 life", The Naked Time's "and it gains haste"), which
		// would be done once, now: refused.
		if followed do return false
		return whenever_supported(x, c, after_target)
	}
	return false
}

// Instructions with no condition ("if you do" there would read nothing done yet) and no targets of their own.
@(private = "file")
plain_instructions :: proc(a: ^types.AbilityDefinition) -> bool {
	for x := a; x != nil; x = x.sub_ability {
		if x.effect == nil || x.condition != nil || x.optional do return false
		if _, targets := effect_target(x.effect^); targets do return false
	}
	return true
}

// "At the beginning of the next end step": an instruction this engine carries out on "it" (the object the
// instruction before named), on "those cards" or "that token" (what it moved or made), or on no object.
@(private = "file")
step_ability_supported :: proc(x: types.Effect_CreateDelayedTrigger, after_target: bool) -> bool {
	if !plain_instructions(x.effect) do return false
	top := x.effect.effect^
	// "Sacrifice that token / exile that token at the beginning of the next end step": the token(s) the instruction
	// just before made, read as "those tokens" (CR 603.7c).
	if names_last_created(top) {
		if x.effect.sub_ability != nil || previous_instruction == nil || !makes_tokens(previous_instruction^) do return false
		as_tracked := with_tracked_target(top)
		a := x.effect^
		a.effect = &as_tracked
		return ability_supported(a, after_target = after_target, previous = previous_instruction, before_previous = instruction_before_previous)
	}
	// "Exile this creature. Return it to the battlefield under its owner's control at the beginning of the next end
	// step": "it" is the card the exile moved, a new object (CR 400.7) the delayed ability still finds (CR 603.7c):
	// its "this" is the source as the delayed ability was created, just after the exile (resolved_tree's source
	// incarnation, same_source), and nothing once that card has moved again.
	if x.uses_tracked_set && returns_exiled_self(x.effect) do return ability_supported(x.effect^, after_target = after_target)
	// "Return those cards at the beginning of the next end step": the cards the instruction before moved, kept by
	// the delayed ability (only a zone change reading them, after an instruction that moves cards).
	// (The data sometimes names them as the earlier target, "it", which is the same card.)
	if x.uses_tracked_set && !(previous_instruction != nil && moves_cards(previous_instruction^) && (reads_tracked_set(top) || refers_to_parent_target(top))) do return false
	if x.uses_tracked_set do return ability_supported(x.effect^, after_target = after_target, previous = previous_instruction, before_previous = instruction_before_previous)
	return ability_supported(x.effect^, after_target = after_target)
}

// "Sacrifice that token", "exile that token": the token the instruction before made (LastCreated).
@(private = "file")
names_last_created :: proc(e: types.Effect) -> bool {
	#partial switch x in e {
	case types.Effect_Sacrifice:
		_, last := x.target.(types.TargetFilter_LastCreated)
		return last
	case types.Effect_ChangeZone:
		_, last := x.target.(types.TargetFilter_LastCreated)
		origin, has_origin := x.origin.?
		return last && (!has_origin || origin == .Battlefield)
	}
	return false
}

@(private = "file")
makes_tokens :: proc(e: types.Effect) -> bool {
	#partial switch _ in e {
	case types.Effect_Token, types.Effect_CopyTokenOf:
		return true
	}
	return false
}

// The same instruction about "those cards" (the tracked set): what the instruction before moved or made.
@(private = "file")
with_tracked_target :: proc(e: types.Effect) -> types.Effect {
	out := e
	#partial switch &x in out {
	case types.Effect_Sacrifice:
		x.target = types.TargetFilter_TrackedSet{}
	case types.Effect_ChangeZone:
		x.target = types.TargetFilter_TrackedSet{}
	}
	return out
}

// "Exile this creature. Return it to the battlefield at ...": a return of "this" from exile right after the
// instruction that exiled it. An Aura returned would need what it enchants chosen as it enters (CR 303.4f): not yet.
@(private = "file")
returns_exiled_self :: proc(a: ^types.AbilityDefinition) -> bool {
	back, is_zone := a.effect^.(types.Effect_ChangeZone)
	if !is_zone || !is_self(back.target) || back.destination != .Battlefield || a.sub_ability != nil do return false
	if origin, has := back.origin.?; has && origin != .Exile do return false
	if previous_instruction == nil do return false
	out, exiled := previous_instruction^.(types.Effect_ChangeZone)
	if !exiled || !is_self(out.target) || out.destination != .Exile do return false
	if checking_face != nil && slice.contains(checking_face.card_type.subtypes[:], "Aura") do return false
	return true
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

// "When that creature dies this turn, ..." (CR 700.4: put into a graveyard from the battlefield): the permanent the
// instruction before targeted.
@(private = "file")
when_dies_supported :: proc(x: types.Effect_CreateDelayedTrigger, c: types.DelayedTriggerCondition_WhenDies, after_target: bool) -> bool {
	if _, parent := c.filter.(types.TargetFilter_ParentTarget); !parent || !after_target do return false
	// The card data drops "this turn" (The Deck of Many Things' "when that creature dies, its owner loses the game"
	// has the same shape and lasts for good): read only with the Oracle text saying so.
	if checking_face != nil && !strings.contains(checking_face.oracle_text.? or_else "", " dies this turn") do return false
	if !plain_instructions(x.effect) do return false
	// "Deals 3 damage to the creature's controller": its controller as it last existed (CR 608.2h). Anything else
	// about it would name the card it became in the graveyard (CR 400.7), which isn't read.
	for a := x.effect; a != nil; a = a.sub_ability {
		if !refers_to_parent_target(a.effect^) do continue
		if !names_parent_controller(a.effect^) do return false
	}
	return ability_supported(x.effect^, after_target = true)
}

// "Deals damage to / loses life: the creature's controller".
@(private = "file")
names_parent_controller :: proc(e: types.Effect) -> bool {
	#partial switch x in e {
	case types.Effect_DealDamage:
		_, controller := x.target.(types.TargetFilter_ParentTargetController)
		return controller && x.damage_source == nil
	case types.Effect_LoseLife:
		t, has := x.target.?
		_, controller := t.(types.TargetFilter_ParentTargetController)
		return has && controller
	}
	return false
}

// "Whenever [an event] this turn, ...", "until your next turn, whenever ...": a triggered ability for a while, its
// event read as a permanent's would be, from its controller's point of view (CR 603.7d-e).
@(private = "file")
whenever_supported :: proc(x: types.Effect_CreateDelayedTrigger, c: types.DelayedTriggerCondition_WheneverEvent, after_target: bool) -> bool {
	if c.trigger == nil do return false
	#partial switch e in c.expiry {
	case types.WheneverEventExpiry_UntilControllersNextTurn:
		if _, after := e.after.(types.TurnGate_AfterCreationTurn); !after do return false
	}
	if !plain_instructions(x.effect) do return false
	// Its own instructions about the earlier target ("whenever that creature deals combat damage, exile it") aren't
	// read yet.
	for a := x.effect; a != nil; a = a.sub_ability do if refers_to_parent_target(a.effect^) do return false
	t := c.trigger^
	// Conditions and limits on the event, and batches ("one or more"), aren't read for these yet.
	if t.condition != nil || t.constraint != nil || t.batched || t.unless_pay != nil do return false
	#partial switch _ in t.mode {
	case types.TriggerMode_SpellCast:
		// "Whenever you cast a [kind of] spell this turn".
		f, has := t.valid_card.?
		if has && (is_self(f) || !spell_filter_supported(f)) do return false
	case types.TriggerMode_ChangesZone:
		// "Whenever a creature dies this turn", "whenever a creature you control enters this turn".
		f, has := t.valid_card.?
		if !has || !delayed_filter_supported(f) do return false
	case types.TriggerMode_Attacks:
		// "Whenever a creature attacks this turn".
		f, has := t.valid_card.?
		if !has || !delayed_filter_supported(f) || t.attack_target_filter != nil do return false
	case types.TriggerMode_DamageDone:
		// "Whenever [this creature / a creature you control] deals combat damage to a player this turn".
		f, has := t.valid_source.?
		if !has do return false
		#partial switch _ in f {
		case types.TargetFilter_ParentTarget:
			if !after_target do return false
			t.valid_source = types.TargetFilter(types.TargetFilter_SelfRef{}) // checked as "this" is; bound as it's created
		case types.TargetFilter_SelfRef:
		case:
			if !delayed_filter_supported(f) do return false
		}
	case types.TriggerMode_Taps:
		// "Whenever a creature becomes tapped".
		f, has := t.valid_card.?
		if !has || !delayed_filter_supported(f) do return false
	case:
		return false
	}
	t.execute = x.effect
	return trigger_supported(t)
}

// Kinds of objects ("a creature you control", "an Elf"), read from the delayed ability's controller's view.
@(private = "file")
delayed_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		for p in x._0.properties {
			// What's attached to its source: a spell's source in a graveyard has nothing attached.
			#partial switch _ in p {
			case types.FilterProp_EnchantedBy, types.FilterProp_EquippedBy, types.FilterProp_AttachedTo:
				return false
			}
		}
		return filter_supported(f)
	case types.TargetFilter_Or:
		for y in x.filters do if !delayed_filter_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

// ---- Creating ----------------------------------------------------------------------------------------------

// Where each delayed ability created since the triggers were last collected began in the event list: events before
// it don't trigger it (CR 603.7a). Kept beside the state: it's emptied whenever the events are.
Delayed_Mark :: struct {
	ability: ^types.ResolvedAbility,
	events:  int,
}

// CR 603.7a, 603.7d-e: the ability exists from now, controlled by the resolving spell or ability's controller; "it"
// is the object the instruction before acted on, as it is now (CR 603.7c: in its zone, the same object).
create_delayed_trigger :: proc(g: ^Game, x: types.Effect_CreateDelayedTrigger, controller: types.PlayerId, source: types.ObjectId) {
	s := &g.state
	r := &g.resolution
	top := resolved_tree(s, x.effect, nil, nil, controller, source)
	condition := x.condition
	#partial switch &c in condition {
	case types.DelayedTriggerCondition_AtNextPhaseForPlayer:
		// "Your next upkeep": this player; "your next turn": a turn after this one.
		c.player = controller
		if _, after := c.gate.(types.TurnGate_AfterCreationTurn); after do c.gate = types.TurnGate_After{s.turn_number}
	case types.DelayedTriggerCondition_WhenDies:
		// "When that creature dies this turn": the one permanent the instruction before targeted, while it's that
		// object; if it has already left the battlefield, the event can't happen (CR 603.7a).
		watched, ok := parent_permanent(g)
		if !ok do return
		c.filter = types.TargetFilter_SpecificObject{watched}
		// "The creature's controller": its controller as it last existed, the trigger event's (CR 608.2h).
		for n := top; n != nil; n = n.sub_ability do controller_from_event(&n.effect)
	case types.DelayedTriggerCondition_WheneverEvent:
		t := new(types.TriggerDefinition)
		t^ = c.trigger^
		// "Whenever this creature / that creature deals combat damage this turn": that permanent, as the object it is
		// now; once it leaves the battlefield the event can't happen (CR 400.7, 603.7a).
		if f, has := t.valid_source.?; has {
			watched: types.ObjectId
			ok := true
			#partial switch _ in f {
			case types.TargetFilter_SelfRef:
				o := same_source(g, source)
				ok = o != nil && o.zone == .Battlefield
				if ok do watched = o.id
			case types.TargetFilter_ParentTarget:
				watched, ok = parent_permanent(g)
			}
			if !ok do return
			if watched != 0 do t.valid_source = types.TargetFilter(types.TargetFilter_SpecificObject{watched})
		}
		if e, until := c.expiry.(types.WheneverEventExpiry_UntilControllersNextTurn); until {
			if _, after := e.after.(types.TurnGate_AfterCreationTurn); after do c.expiry = types.WheneverEventExpiry_UntilControllersNextTurn{after = types.TurnGate_After{s.turn_number}}
		}
		c.trigger = t
	}
	#partial switch _ in condition {
	case types.DelayedTriggerCondition_AtNextPhase, types.DelayedTriggerCondition_AtNextPhaseForPlayer:
		if names_last_created(top.effect) {
			// "That token": what the instruction before made, as the objects they are now (CR 603.7c).
			top.effect = with_tracked_target(top.effect)
			for id in r.moved do if o := object(s, id); o != nil && o.is_token && o.zone == .Battlefield do append(&top.targets, types.TargetRef(types.TargetRef_Object{id}))
			record_target_incarnations(s, top)
		} else if x.uses_tracked_set && is_self(effect_target_filter(top.effect)) {
			// "Exile this. Return it at ...": only the card this ability's exile moved (CR 400.7); one exiled some
			// other way isn't "it", and there's nothing to return.
			if !slice.contains(r.moved[:], source) do return
		} else if refers_to_parent_target(top.effect) {
			append(&top.targets, ..r.last_targets[:])
			record_target_incarnations(s, top)
		} else if x.uses_tracked_set && reads_tracked_set(top.effect) {
			// "Those cards": what the instruction before moved, each as the object it is now (CR 603.7c, 400.7j).
			for id in r.moved do append(&top.targets, types.TargetRef(types.TargetRef_Object{id}))
			record_target_incarnations(s, top)
		}
	}
	_, repeats := condition.(types.DelayedTriggerCondition_WheneverEvent) // "whenever ... this turn": each time
	append(&s.delayed_triggers, types.DelayedTrigger{condition = condition, ability = top, controller = controller, source_id = source, one_shot = !repeats})
	append(&g.delayed_marks, Delayed_Mark{ability = top, events = len(g.events)})
}

// "That creature": the single permanent the latest targeting instruction targeted, still the object it was.
@(private = "file")
parent_permanent :: proc(g: ^Game) -> (types.ObjectId, bool) {
	r := &g.resolution
	if len(r.last_targets) != 1 do return 0, false
	id, is_object := target_object(r.last_targets[0])
	if !is_object do return 0, false
	o := object(&g.state, id)
	if o == nil || o.zone != .Battlefield do return 0, false
	// The same object it was when targeted (CR 400.7).
	for n := r.top; n != nil; n = n.sub_ability {
		for t, i in n.targets do if t == r.last_targets[0] && !same_object_as_chosen(&g.state, n, i) do return 0, false
	}
	return id, true
}

// "The creature's controller" in a "when that creature dies" ability: the controller of what died, as it last
// existed (the trigger event's, resolution.odin's event_reference).
@(private = "file")
controller_from_event :: proc(e: ^types.Effect) {
	#partial switch &x in e {
	case types.Effect_DealDamage:
		if _, parent := x.target.(types.TargetFilter_ParentTargetController); parent do x.target = types.TargetFilter_TriggeringSourceController{}
	case types.Effect_LoseLife:
		if t, has := x.target.?; has {
			if _, parent := t.(types.TargetFilter_ParentTargetController); parent do x.target = types.TargetFilter(types.TargetFilter_TriggeringSourceController{})
		}
	}
}

// ---- Triggering ----------------------------------------------------------------------------------------------

// A step began: the delayed abilities waiting for it trigger, and are gone (CR 603.7b).
trigger_delayed :: proc(g: ^Game, step: types.Phase) {
	s := &g.state
	for i := 0; i < len(s.delayed_triggers); {
		d := s.delayed_triggers[i]
		waiting := false
		#partial switch c in d.condition {
		case types.DelayedTriggerCondition_AtNextPhase:
			waiting = c.phase == step
		case types.DelayedTriggerCondition_AtNextPhaseForPlayer:
			// "Your next upkeep": a step of that player's turn (CR 603.7b); "on your next turn": not this one.
			waiting = c.phase == step && s.active_player == c.player
			if after, gated := c.gate.(types.TurnGate_After); gated && s.turn_number <= after._0 do waiting = false
		}
		if !waiting || d.ability == nil {
			i += 1
			continue
		}
		append(&g.pending_triggers, Pending_Trigger{source = d.source_id, controller = d.controller, delayed = d.ability})
		ordered_remove(&s.delayed_triggers, i)
	}
}

// An event happened: the delayed abilities waiting for such an event trigger (CR 603.7b: "when", once; "whenever ...
// this turn", each time), and those about a permanent that has left the battlefield end, their event impossible now
// (CR 400.7, 603.7a). `index`: the event's place in the event list, for CR 603.7a.
delayed_event_triggers :: proc(g: ^Game, e: Event, index: int) {
	s := &g.state
	for i := 0; i < len(s.delayed_triggers); {
		d := s.delayed_triggers[i]
		if d.ability == nil || index < delayed_mark(g, d.ability) {
			i += 1
			continue
		}
		fires, ends, amount := false, false, 0
		#partial switch c in d.condition {
		case types.DelayedTriggerCondition_WhenDies:
			watched := c.filter.(types.TargetFilter_SpecificObject).id
			if e.kind == .Zone_Change && e.object == watched && e.from == .Battlefield {
				fires = e.to == .Graveyard // CR 700.4
				ends = true
			}
		case types.DelayedTriggerCondition_WheneverEvent:
			fires, amount = whenever_event_matches(g, d, c.trigger, e)
			if f, has := c.trigger.valid_source.?; has {
				if w, specific := f.(types.TargetFilter_SpecificObject); specific && e.kind == .Zone_Change && e.object == w.id && e.from == .Battlefield do ends = true
			}
		}
		if fires {
			// Each time it triggers, an ability of its own on the stack (CR 603.7b); "when", once.
			ability := d.ability if ends else clone_resolved(d.ability)
			append(&g.pending_triggers, Pending_Trigger{source = d.source_id, controller = d.controller, delayed = ability, event = collecting_event, amount = amount})
		}
		if ends {
			ordered_remove(&s.delayed_triggers, i)
			continue
		}
		i += 1
	}
}

@(private = "file")
delayed_mark :: proc(g: ^Game, a: ^types.ResolvedAbility) -> int {
	for m in g.delayed_marks do if m.ability == a do return m.events
	return 0
}

// Whether the event is the one a "whenever ..." delayed ability waits for, and its amount ("that many").
@(private = "file")
whenever_event_matches :: proc(g: ^Game, d: types.DelayedTrigger, t: ^types.TriggerDefinition, e: Event) -> (bool, int) {
	s := &g.state
	// The delayed ability's point of view: its controller (CR 603.7d-e) and its source.
	viewer := types.GameObject{id = d.source_id, controller = d.controller}
	#partial switch _ in t.mode {
	case types.TriggerMode_SpellCast:
		if e.kind != .Spell_Cast do return false, 0
		if f, has := t.valid_card.?; has && !spell_matches(s, object(s, e.object), f, &viewer) do return false, 0
		if v, has := t.valid_target.?; has {
			if is_you(v) && e.controller != d.controller do return false, 0
			if is_an_opponent(v) && e.controller == d.controller do return false, 0
		}
		return true, 0
	case types.TriggerMode_ChangesZone:
		if e.kind != .Zone_Change do return false, 0
		if origin, has := t.origin.?; has && origin != e.from do return false, 0
		if dest, has := t.destination.?; has && dest != e.to do return false, 0
		// As it was for the event (CR 603.10a: one that left, as it last existed), with its controller then.
		now := object(s, e.object)
		if e.lki == nil && now == nil do return false, 0
		as_was := e.lki^ if e.lki != nil else now^
		as_was.controller = e.controller
		return delayed_filter_matches(s, t.valid_card.?, &as_was, d), 0
	case types.TriggerMode_Attacks:
		if e.kind != .Attack do return false, 0
		return delayed_filter_matches(s, t.valid_card.?, object(s, e.object), d), 0
	case types.TriggerMode_Taps:
		if e.kind != .Tapped do return false, 0
		return delayed_filter_matches(s, t.valid_card.?, object(s, e.object), d), 0
	case types.TriggerMode_DamageDone:
		if e.kind != .Damage do return false, 0
		if t.damage_kind == .CombatOnly && !e.combat do return false, 0
		dealer := object(s, e.object)
		if dealer == nil || !delayed_filter_matches(s, t.valid_source.?, dealer, d) do return false, 0
		if v, has := t.valid_target.?; has && !damage_recipient_matches(s, v, e.target, &viewer) do return false, 0
		return true, e.amount
	}
	return false, 0
}

// Whether the object is what the delayed ability's filter names: the particular permanent it watches, or a kind of
// object from its controller's point of view.
@(private = "file")
delayed_filter_matches :: proc(s: ^types.GameState, f: types.TargetFilter, o: ^types.GameObject, d: types.DelayedTrigger) -> bool {
	if o == nil do return false
	#partial switch x in f {
	case types.TargetFilter_SpecificObject:
		return o.id == x.id
	case types.TargetFilter_Typed:
		return object_matches(s, o, x._0, d.controller, d.source_id)
	case types.TargetFilter_Or:
		for y in x.filters do if delayed_filter_matches(s, y, o, d) do return true
	}
	return false
}

// A copy of a delayed ability's instructions, for one time it triggers: each copy on the stack resolves on its own.
@(private = "file")
clone_resolved :: proc(a: ^types.ResolvedAbility) -> ^types.ResolvedAbility {
	if a == nil do return nil
	out := new(types.ResolvedAbility)
	out^ = a^
	out.targets = slice.clone_to_dynamic(a.targets[:])
	out.target_incarnations = slice.clone_to_dynamic(a.target_incarnations[:])
	out.illegal_target_slots = slice.clone_to_dynamic(a.illegal_target_slots[:])
	out.sub_ability = clone_resolved(a.sub_ability)
	return out
}

// ---- Ending --------------------------------------------------------------------------------------------------

// CR 514.2: "this turn" ends in the cleanup step: "whenever ... this turn" and "when that creature dies this turn"
// abilities that haven't triggered are gone.
end_this_turn_delayed_triggers :: proc(g: ^Game) {
	s := &g.state
	for i := 0; i < len(s.delayed_triggers); {
		ends := false
		#partial switch c in s.delayed_triggers[i].condition {
		case types.DelayedTriggerCondition_WhenDies:
			ends = true
		case types.DelayedTriggerCondition_WheneverEvent:
			_, until_next_turn := c.expiry.(types.WheneverEventExpiry_UntilControllersNextTurn)
			ends = !until_next_turn
		}
		if ends do ordered_remove(&s.delayed_triggers, i)
		else do i += 1
	}
}

// A turn began: "until your next turn" abilities of its active player end as it begins.
end_until_next_turn_delayed_triggers :: proc(g: ^Game) {
	s := &g.state
	for i := 0; i < len(s.delayed_triggers); {
		d := s.delayed_triggers[i]
		ends := false
		if c, whenever := d.condition.(types.DelayedTriggerCondition_WheneverEvent); whenever {
			if e, until := c.expiry.(types.WheneverEventExpiry_UntilControllersNextTurn); until {
				after, gated := e.after.(types.TurnGate_After)
				ends = d.controller == s.active_player && (!gated || s.turn_number > after._0)
			}
		}
		if ends do ordered_remove(&s.delayed_triggers, i)
		else do i += 1
	}
}
