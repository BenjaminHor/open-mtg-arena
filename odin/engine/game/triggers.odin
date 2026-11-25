// Triggered abilities (CR 603): events, the abilities they trigger, putting those on the stack and resolving them.
// Supported: "when/whenever [this or a kind of permanent] enters, dies, leaves, is put into a zone", "at the
// beginning of [your / each] [step]", and "whenever this attacks", with any effect this engine supports, with or
// without targets, optional ("may") or not.
package game

import "core:slice"
import "core:strings"
import types "../types"

Event_Kind :: enum {
	Zone_Change,
	Step_Begin,
	Attack,
	Spell_Cast,
	Damage,
	You_Attack, // a player attacked with one or more creatures (CR 508.3d)
	Life_Gained, // controller gained amount life (CR 119.9: never 0)
	Tapped, // object became tapped (CR 701.26a)
	Card_Drawn, // controller drew a card (CR 121.2: each card is its own draw)
	Sacrificed, // controller sacrificed object, a permanent moved from the battlefield to the graveyard (CR 701.21a)
	Counter_Added, // amount counters of kind counter put on object, which had before of them (CR 122.6)
	Became_Target, // object became a target of stack_entry, a spell or ability controller controls (CR 115.1)
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
	counter:    types.CounterType, // Counter_Added
	before:     int,
	group:      int, // zone changes with the same group happened at the same time (state-based actions, CR 704.3)
	incarnation: u64, // Counter_Added: the object as it was (CR 400.7)
	stack_entry: types.ObjectId, // Became_Target: the spell or ability that targets it
}

// What a triggered ability's trigger event was about, for its instructions: "that much damage", "that creature",
// "that player" (CR 603.2, 608.2c). "That creature" is the object as it was then: if it has since changed zones it's
// a new object, which the instruction doesn't affect (CR 400.7).
Trigger_Event :: struct {
	amount:            int,
	object:            types.ObjectId, // 0: the event is about no object
	incarnation:       u64,
	object_controller: types.PlayerId, // that object's controller then (its last known one, CR 608.2h)
	player:            Maybe(types.PlayerId),
}

// The event triggers are being collected for, while they are (collect_triggers).
@(thread_local)
collecting_event: Trigger_Event

// A triggered ability waiting to be put on the stack (CR 603.3).
Pending_Trigger :: struct {
	source:     types.ObjectId,
	controller: types.PlayerId,
	definition: ^types.TriggerDefinition,
	lki:        ^types.GameObject, // a leaves-the-battlefield trigger's source as it last existed (CR 603.10a)
	amount:     int, // the event's amount, for "that much" (the damage dealt)
	event:      Trigger_Event, // what the event was about
	delayed:    ^types.ResolvedAbility, // a delayed triggered ability (delayed.odin), its "it" already chosen
}

// A triggered ability on the stack whose intervening "if" is checked again as it resolves (CR 603.4).
Stack_Condition :: struct {
	definition: ^types.TriggerDefinition,
	lki:        ^types.GameObject,
	// The source as it was put on the stack, read instead if it has changed zones by the time it resolves (CR
	// 608.2h: "when this enters, if you cast it" with the permanent gone).
	snapshot:   ^types.GameObject,
}

// ---- What's supported --------------------------------------------------------------------------------------

trigger_supported :: proc(t: types.TriggerDefinition) -> bool {
	// CR 107.3m: only an enters-the-battlefield ability of the permanent itself reads the X of the spell it was (0
	// when it wasn't cast with one).
	saved_x := x_defined
	x_defined = self_entering(t)
	defer x_defined = saved_x
	event_amount_defined = trigger_has_amount(t)
	defer event_amount_defined = false
	event_object_defined, event_player_defined = trigger_has_object(t), trigger_has_player(t)
	defer event_object_defined, event_player_defined = false, false
	if t.execute == nil do return false
	if t.execute.modal != nil {
		if !modal_trigger_supported(t.execute^) do return false
	} else if !ability_supported(t.execute^) do return false
	// "That much" reads the event only in the first instruction: after another one ("discard your hand. If you do,
	// draw that many cards") it means what that instruction did, which isn't tracked yet.
	if t.execute.sub_ability != nil && event_amount_defined {
		event_amount_defined = false
		if !ability_supported(t.execute.sub_ability^) do return false
	}
	if c, has := t.condition.?; has && !trigger_condition_supported(c) do return false
	if t.batched do return false
	if u, has := t.unless_pay.?; has {
		// "When this land enters, sacrifice it unless you pay {1}": carried by the ability (unless_ability).
		if t.execute == nil || t.execute.unless_pay != nil do return false
		a := t.execute^
		a.unless_pay = u
		if !unless_pay_supported(a) do return false
	}
	// "you" as the one acting is read only by spell-cast triggers ("whenever you cast").
	_, is_cast := t.mode.(types.TriggerMode_SpellCast)
	_, is_damage := t.mode.(types.TriggerMode_DamageDone)
	if _, batched := t.mode.(types.TriggerMode_DamageDoneOnceByController); batched do is_damage = true
	if _, received := t.mode.(types.TriggerMode_DamageReceived); received do is_damage = true
	// A zone-change trigger's valid_target is the parser's note of its effect's target ("When this enters, it deals 1
	// damage to target opponent"): the event is matched on the card alone, the target chosen by the effect.
	is_zone_change := false
	#partial switch _ in t.mode {
	case types.TriggerMode_ChangesZone, types.TriggerMode_LeavesBattlefield, types.TriggerMode_EntersOrAttacks, types.TriggerMode_Sacrificed:
		is_zone_change = true
	}
	// Other permanents' events are watched from the battlefield only: an ability that works from another zone
	// ("when you sacrifice a Clue, return this card from your graveyard") isn't watched there yet. An object's
	// own zone change is seen wherever it went (CR 603.6, 603.10a).
	if len(t.trigger_zones) > 0 && !has_zone(t.trigger_zones[:], .Battlefield) {
		f, has := t.valid_card.?
		if !has || !is_self(f) do return false
	}
	// "Whenever you gain life", "whenever you draw a card": the player is valid_target.
	is_player_event := false
	#partial switch _ in t.mode {
	case types.TriggerMode_LifeGained, types.TriggerMode_Drawn:
		is_player_event = true
	}
	if !is_cast && !is_damage && !is_zone_change && !is_player_event && t.valid_target != nil do return false
	if !is_damage && t.valid_source != nil do return false
	_, counter_mode := t.mode.(types.TriggerMode_CounterAdded)
	if len(t.origin_zones) > 0 || len(t.zone_change_clauses) > 0 do return false
	if !counter_mode && (t.counter_filter != nil || t.saga_chapter != nil) do return false
	if c, has := t.constraint.?; has {
		#partial switch x in c {
		case types.TriggerConstraint_OnlyDuringYourTurn, types.TriggerConstraint_OnlyDuringOpponentsTurn:
		case types.TriggerConstraint_NthSpellThisTurn:
			// "Whenever you cast your second spell each turn": the caster's count, any spell.
			if !is_cast || x.filter != nil do return false
		case types.TriggerConstraint_NthDrawThisTurn:
			// "Whenever you draw your second card each turn" (CR 121.2: each card drawn is its own event).
			if _, drawn := t.mode.(types.TriggerMode_Drawn); !drawn do return false
		case:
			return false
		}
	}
	#partial switch _ in t.mode {
	case types.TriggerMode_ChangesZone:
		if f, has := t.valid_card.?; has {
			// What it's attached to is watched only leaving the battlefield (zone_change_subject).
			if _, attached := f.(types.TargetFilter_AttachedTo); attached {
				if o, has_o := t.origin.?; !has_o || o != .Battlefield do return false
			}
			return subject_filter_supported(f)
		}
		return false
	case types.TriggerMode_Phase:
		_, has := t.phase.?
		return has && t.valid_card == nil
	case types.TriggerMode_Attacks:
		// "Whenever this creature attacks", "whenever equipped/enchanted creature attacks", "whenever a creature you
		// control attacks" (CR 508.3a: when it's declared as an attacker).
		f, has := t.valid_card.?
		if !has || t.attack_target_filter != nil do return false
		if _, attached := f.(types.TargetFilter_AttachedTo); attached do return true
		return subject_filter_supported(f)
	case types.TriggerMode_YouAttack:
		// "Whenever you attack": the plain form (CR 508.3d).
		return t.valid_card == nil && t.attack_target_filter == nil
	case types.TriggerMode_EntersOrAttacks:
		// "Whenever this creature enters or attacks" (CR 603.6a, 508.3a).
		f, has := t.valid_card.?
		return has && is_self(f) && t.attack_target_filter == nil
	case types.TriggerMode_CounterAdded:
		// "Whenever one or more +1/+1 counters are put on this creature"; a Saga's chapter abilities (CR 715.2b).
		// Who put them isn't tracked, so "whenever you put" (no counter kind in the data) isn't read.
		f, has := t.valid_card.?
		_, has_filter := t.counter_filter.?
		return has && is_self(f) && has_filter
	case types.TriggerMode_Sacrificed:
		// "Whenever you sacrifice a [kind of] permanent", "when you sacrifice this" (CR 701.21a, 603.10a).
		if f, has := t.valid_card.?; has do return subject_filter_supported(f)
		return false
	case types.TriggerMode_LeavesBattlefield:
		// "When this leaves the battlefield" (CR 603.6c, 603.10a).
		if dest, has := t.destination.?; has && dest == .Battlefield do return false
		if f, has := t.valid_card.?; has do return subject_filter_supported(f)
		return false
	case types.TriggerMode_Taps:
		// "Whenever this (or a creature you control) becomes tapped." One tapped by an opponent's effect isn't
		// told apart yet, so a filter on an opponent's permanents isn't read.
		// "Becomes tapped to pay a teamwork cost": the card data drops what it was tapped for; refused, not read
		// as any tapping.
		if d, has_d := t.description.?; has_d && strings.contains(d, "becomes tapped to ") do return false
		f, has := t.valid_card.?
		if !has do return false
		if is_self(f) do return true
		typed, ok := f.(types.TargetFilter_Typed)
		if !ok || !typed_supported(typed._0) do return false
		if c, has_c := typed._0.controller.?; has_c {
			if _, opp := c.(types.ControllerRef_Opponent); opp do return false
		}
		return true
	case types.TriggerMode_LifeGained, types.TriggerMode_Drawn:
		if t.valid_card != nil || t.life_amount != nil do return false
		if v, has := t.valid_target.?; has && !is_you(v) && !is_an_opponent(v) && !is_any_player(v) do return false
		return true
	case types.TriggerMode_DamageReceived:
		// "Whenever this creature is dealt damage" (CR 120.3).
		f, has := t.valid_card.?
		return has && is_self(f) && t.valid_source == nil && t.damage_amount == nil && t.damage_kind != .NoncombatOnly
	case types.TriggerMode_DamageDone, types.TriggerMode_DamageDoneOnceByController:
		// "Whenever [this / a creature you control / enchanted creature] deals [combat] damage to [a player / an
		// opponent / a creature / you]"; "whenever one or more creatures you control deal combat damage to a
		// player" (once per batch, CR 603.2c).
		if t.damage_kind == .NoncombatOnly || t.damage_amount != nil do return false
		src, has_src := t.valid_source.?
		if !has_src || !damage_source_supported(src) do return false
		if v, has := t.valid_target.?; has && !damage_recipient_supported(v) do return false
		return true
	case types.TriggerMode_SpellCast:
		// "Whenever you cast a [kind of] spell", or "when you cast this spell".
		if v, has := t.valid_target.?; has && !is_you(v) && !is_any_player(v) && !is_an_opponent(v) do return false
		f, has := t.valid_card.?
		return !has || spell_filter_supported(f)
	}
	return false
}

damage_source_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_SelfRef, types.TargetFilter_AttachedTo:
		return true
	case types.TargetFilter_Typed:
		return typed_supported(x._0)
	case types.TargetFilter_Or:
		for y in x.filters do if !damage_source_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

// Whether the object that dealt damage is what the trigger watches: itself, a kind of permanent, or the permanent
// its watcher is attached to ("enchanted creature", "equipped creature").
damage_source_matches :: proc(s: ^types.GameState, f: types.TargetFilter, dealer: ^types.GameObject, watcher: ^types.GameObject) -> bool {
	#partial switch x in f {
	case types.TargetFilter_SelfRef:
		return dealer.id == watcher.id
	case types.TargetFilter_AttachedTo:
		host := host_of(s, watcher)
		return host != nil && host.id == dealer.id
	case types.TargetFilter_Typed:
		return object_matches(s, dealer, x._0, watcher.controller, watcher.id)
	case types.TargetFilter_Or:
		for y in x.filters do if damage_source_matches(s, y, dealer, watcher) do return true
	}
	return false
}

damage_recipient_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Player, types.TargetFilter_Opponent, types.TargetFilter_Controller:
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if !damage_recipient_supported(y) do return false
		return len(x.filters) > 0
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
		case types.TargetFilter_Controller:
			return r._0 == watcher.controller // "deals damage to you"
		case types.TargetFilter_Or:
			for y in x.filters do if damage_recipient_matches(s, y, recipient, watcher) do return true
		case types.TargetFilter_Opponent:
			return r._0 != watcher.controller
		case types.TargetFilter_Typed:
			return len(x._0.type_filters) == 0 && r._0 != watcher.controller
		}
	case types.TargetRef_Object:
		if either, is_or := f.(types.TargetFilter_Or); is_or {
			for y in either.filters do if damage_recipient_matches(s, y, recipient, watcher) do return true
			return false
		}
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
	case types.TargetFilter_And:
		// "A creature spell that has an Adventure": each part.
		for y in x.filters do if !spell_filter_supported(y) || is_self(y) do return false
		return len(x.filters) > 0
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
	case types.TargetFilter_And:
		for y in x.filters do if !spell_matches(s, spell, y, watcher) do return false
		return true
	}
	return false
}

// The objects a trigger watches: itself, or permanents of a kind (and controller).
subject_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_SelfRef, types.TargetFilter_AttachedTo:
		return true
	case types.TargetFilter_Typed:
		return filter_supported(f)
	case types.TargetFilter_Or:
		// "Whenever this creature or another creature you control enters".
		for y in x.filters do if !subject_filter_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

// Whether the attacking creature is what an attack trigger watches: the watcher itself, what it's attached to, or a
// creature of the described kind from the watcher's point of view.
attack_subject_matches :: proc(s: ^types.GameState, f: types.TargetFilter, attacker, watcher: ^types.GameObject) -> bool {
	#partial switch x in f {
	case types.TargetFilter_SelfRef:
		return attacker.id == watcher.id
	case types.TargetFilter_AttachedTo:
		host := host_of(s, watcher)
		return host != nil && host.id == attacker.id
	case types.TargetFilter_Typed:
		return object_matches(s, attacker, x._0, watcher.controller, watcher.id)
	case types.TargetFilter_Or:
		for y in x.filters do if attack_subject_matches(s, y, attacker, watcher) do return true
	}
	return false
}

// Whether the trigger's event has an amount its effect can call "that much": damage dealt to or by one object.
// What an event is about: its object ("that creature", "that spell") and player ("that player": the caster, the
// damaged player, the one who gained life or drew, the active player at the start of a step, the controller of what
// changed zones), as Rust's engine reads them.
event_about :: proc(s: ^types.GameState, e: Event) -> Trigger_Event {
	out: Trigger_Event
	#partial switch e.kind {
	case .Zone_Change, .Spell_Cast, .Damage, .Attack, .Tapped, .Counter_Added, .Sacrificed:
		if o := object(s, e.object); o != nil {
			out.object, out.incarnation, out.object_controller = o.id, o.incarnation, o.controller
			if e.kind == .Zone_Change || e.kind == .Sacrificed do out.object_controller = e.controller // as it last existed
		}
	}
	if e.kind == .Became_Target {
		// "That spell or ability" and "that player": the targeting stack object and its controller.
		out.object = e.stack_entry
		if o := object(s, e.stack_entry); o != nil do out.incarnation = o.incarnation
		out.player = e.controller
		return out
	}
	#partial switch e.kind {
	case .Spell_Cast, .Life_Gained, .Card_Drawn, .Zone_Change, .Sacrificed, .Attack:
		out.player = e.controller
	case .Step_Begin:
		out.player = s.active_player
	case .Damage:
		if pid, is_player := target_player(e.target); is_player do out.player = pid
		else if id, is_object := target_object(e.target); is_object {
			if o := object(s, id); o != nil do out.player = o.controller
		}
	}
	return out
}

// Whether a trigger's event names an object or a player its instructions can refer to, checked with the trigger.
@(thread_local)
event_object_defined: bool
@(thread_local)
event_player_defined: bool

trigger_has_object :: proc(t: types.TriggerDefinition) -> bool {
	#partial switch _ in t.mode {
	case types.TriggerMode_ChangesZone, types.TriggerMode_LeavesBattlefield, types.TriggerMode_SpellCast,
	     types.TriggerMode_DamageDone, types.TriggerMode_Taps, types.TriggerMode_Attacks, types.TriggerMode_Sacrificed,
	     types.TriggerMode_CounterAdded, types.TriggerMode_EntersOrAttacks:
		return true
	}
	return false
}

trigger_has_player :: proc(t: types.TriggerDefinition) -> bool {
	#partial switch _ in t.mode {
	case types.TriggerMode_SpellCast, types.TriggerMode_DamageDone, types.TriggerMode_DamageReceived,
	     types.TriggerMode_LifeGained, types.TriggerMode_Drawn, types.TriggerMode_Phase, types.TriggerMode_ChangesZone,
	     types.TriggerMode_LeavesBattlefield, types.TriggerMode_Sacrificed, types.TriggerMode_Attacks:
		return true
	}
	return false
}

trigger_has_amount :: proc(t: types.TriggerDefinition) -> bool {
	#partial switch _ in t.mode {
	case types.TriggerMode_DamageDone, types.TriggerMode_DamageReceived, types.TriggerMode_LifeGained:
		return true
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
	fired := make([dynamic]^types.TriggerDefinition, context.temp_allocator) // batched triggers already triggered
	defer collecting_event = {}
	for e, index in g.events {
		collecting_event = event_about(s, e)
		switch e.kind {
		case .Zone_Change, .Sacrificed:
			moved := object(s, e.object)
			// The moved object's own abilities, as it is now (it entered) or as it last existed (it left): CR 603.6a,
			// 603.10a. Then every other permanent watching for such an event.
			for &entry in trigger_definitions(moved) do zone_change_trigger(g, moved, &entry.definition, e, true)
			for id in ids_of(s.battlefield) {
				if id == e.object do continue
				watcher := object(s, id)
				for &entry in trigger_definitions(watcher) do zone_change_trigger(g, watcher, &entry.definition, e, false)
			}
			// Permanents that were on the battlefield for the event but have left since, or left at the same time
			// (CR 603.10a: leaves-the-battlefield abilities look back; "whenever another creature dies" sees one
			// that dies with it). Their abilities as they last existed.
			for f, later in g.events {
				if f.kind != .Zone_Change || f.from != .Battlefield || f.lki == nil || f.object == e.object do continue
				if later <= index && !(f.group == e.group && e.from == .Battlefield) do continue
				for &entry in trigger_definitions(f.lki) do zone_change_trigger(g, f.lki, &entry.definition, e, false, f.lki)
			}
		case .Step_Begin:
			trigger_delayed(g, e.step)
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
					// Whose spell: "you cast", "an opponent casts", "a player casts".
					if v, has := t.valid_target.?; has {
						if is_you(v) && e.controller != w.controller do continue
						if is_an_opponent(v) && e.controller == w.controller do continue
					}
					if c, has := t.constraint.?; has {
						if nth, is_nth := c.(types.TriggerConstraint_NthSpellThisTurn); is_nth {
							if !compare(spells_cast_this_turn_by(s, e.controller), nth.comparator, int(nth.n)) do continue
						} else if !turn_constraint_met(s, t^, w.controller) do continue
					}
					add_trigger(g, w.id, w.controller, t)
				}
			}
			prowess_triggers(g, spell, e.controller) // CR 702.108a
		case .Became_Target:
			ward_triggers(g, e) // CR 702.21a
		case .Damage:
			source := object(s, e.object)
			watchers := make([dynamic]^types.GameObject, context.temp_allocator)
			append(&watchers, source)
			for id in ids_of(s.battlefield) do if id != e.object do append(&watchers, object(s, id))
			for w in watchers {
				for &entry in trigger_definitions(w) {
					t := &entry.definition
					_, dmg := t.mode.(types.TriggerMode_DamageDone)
					_, batched := t.mode.(types.TriggerMode_DamageDoneOnceByController)
					if (!dmg && !batched) || !trigger_supported(t^) do continue
					if t.damage_kind == .CombatOnly && !e.combat do continue
					src, _ := t.valid_source.?
					if !damage_source_matches(s, src, source, w) do continue
					if v, has := t.valid_target.?; has && !damage_recipient_matches(s, v, e.target, w) do continue
					// "One or more ... deal combat damage": once for the batch (CR 603.2c).
					if batched {
						if slice.contains(fired[:], t) do continue
						append(&fired, t)
					}
					add_trigger(g, w.id, w.controller, t, nil, 0 if batched else e.amount)
				}
			}
		case .You_Attack:
			for o in permanents_of(s, e.controller) {
				for &entry in trigger_definitions(o) {
					t := &entry.definition
					if _, yours := t.mode.(types.TriggerMode_YouAttack); yours && trigger_supported(t^) && turn_constraint_met(s, t^, o.controller) do add_trigger(g, o.id, o.controller, t)
				}
			}
		case .Attack:
			o := object(s, e.object)
			for &entry in trigger_definitions(o) {
				t := &entry.definition
				if _, either := t.mode.(types.TriggerMode_EntersOrAttacks); either && trigger_supported(t^) do add_trigger(g, o.id, o.controller, t)
			}
			decayed_triggers(g, o) // CR 702.147a
			// "Whenever [this / equipped creature / a creature you control] attacks": each permanent watching.
			for id in ids_of(s.battlefield) {
				w := object(s, id)
				for &entry in trigger_definitions(w) {
					t := &entry.definition
					if _, attacks := t.mode.(types.TriggerMode_Attacks); !attacks || !trigger_supported(t^) do continue
					if attack_subject_matches(s, t.valid_card.?, o, w) do add_trigger(g, w.id, w.controller, t)
				}
			}
		case .Tapped:
			tapped := object(s, e.object)
			for id in ids_of(s.battlefield) {
				w := object(s, id)
				for &entry in trigger_definitions(w) {
					t := &entry.definition
					if _, taps := t.mode.(types.TriggerMode_Taps); !taps || !trigger_supported(t^) do continue
					f, _ := t.valid_card.?
					if is_self(f) {
						if w.id != tapped.id do continue
					} else if !object_matches(s, tapped, f.(types.TargetFilter_Typed)._0, w.controller, w.id) do continue
					if !turn_constraint_met(s, t^, w.controller) do continue
					add_trigger(g, w.id, w.controller, t)
				}
			}
		case .Counter_Added:
			// The permanent the counters were put on (CR 400.7): if it has left since, its abilities as it last existed.
			o := object(s, e.object)
			if o == nil do continue
			if o.zone != .Battlefield || o.incarnation != e.incarnation {
				o = nil
				for f in g.events do if f.kind == .Zone_Change && f.object == e.object && f.lki != nil && f.lki.incarnation == e.incarnation do o = f.lki
				if o == nil do continue
			}
			for &entry in trigger_definitions(o) {
				t := &entry.definition
				if _, added := t.mode.(types.TriggerMode_CounterAdded); !added || !trigger_supported(t^) do continue
				cf := t.counter_filter.?
				if !same_counter(cf.counter_type, e.counter) do continue
				// CR 715.2b: a chapter (or "the Nth counter") triggers when the count was less than N and became at
				// least N.
				if n, has := cf.threshold.?; has && !(e.before < int(n) && e.before + e.amount >= int(n)) do continue
				if !turn_constraint_met(s, t^, o.controller) do continue
				// "Whenever one or more counters are put" triggers once for the event; "whenever a counter is put",
				// once for each counter (CR 603.2c).
				times := 1
				if _, has := cf.threshold.?; !has {
					if d, has_d := t.description.?; has_d && !strings.contains(d, "one or more") do times = e.amount
				}
				for _ in 0 ..< times do add_trigger(g, o.id, o.controller, t)
			}
		case .Life_Gained, .Card_Drawn:
			for id in ids_of(s.battlefield) {
				o := object(s, id)
				for &entry in trigger_definitions(o) {
					t := &entry.definition
					#partial switch _ in t.mode {
					case types.TriggerMode_LifeGained:
						if e.kind != .Life_Gained do continue
					case types.TriggerMode_Drawn:
						if e.kind != .Card_Drawn do continue
					case:
						continue
					}
					if !trigger_supported(t^) do continue
					if c, has := t.constraint.?; has {
						if nth, is_nth := c.(types.TriggerConstraint_NthDrawThisTurn); is_nth {
							// This card is the drawer's (before + 1)th this turn.
							if !compare(e.before + 1, nth.comparator, int(nth.n)) do continue
						} else if !turn_constraint_met(s, t^, o.controller) do continue
					}
					// Whose: "you", "an opponent", or any player.
					if v, has := t.valid_target.?; has {
						if is_you(v) && e.controller != o.controller do continue
						if is_an_opponent(v) && e.controller == o.controller do continue
					}
					add_trigger(g, o.id, o.controller, t, nil, e.amount)
				}
			}
		}
		if e.kind == .Damage {
			// "Whenever this creature is dealt damage": the recipient's own trigger, with the amount.
			if id, is_object := target_object(e.target); is_object {
				if o := object(s, id); o != nil && o.zone == .Battlefield {
					for &entry in trigger_definitions(o) {
						t := &entry.definition
						if _, received := t.mode.(types.TriggerMode_DamageReceived); !received || !trigger_supported(t^) do continue
						if t.damage_kind == .CombatOnly && !e.combat do continue
						add_trigger(g, o.id, o.controller, t, nil, e.amount)
					}
				}
			}
		}
	}
	clear(&g.events)
}

@(private = "file")
zone_change_trigger :: proc(g: ^Game, source: ^types.GameObject, t: ^types.TriggerDefinition, e: Event, is_self: bool, watcher_gone: Maybe(^types.GameObject) = nil) {
	s := &g.state
	// A sacrifice is also a zone change (CR 701.21a); a sacrifice trigger sees only the sacrifice event, the others
	// only the zone change.
	_, sacrifice_mode := t.mode.(types.TriggerMode_Sacrificed)
	if sacrifice_mode != (e.kind == .Sacrificed) do return
	#partial switch _ in t.mode {
	case types.TriggerMode_Sacrificed:
	case types.TriggerMode_ChangesZone:
		if origin, has := t.origin.?; has && origin != e.from do return
		if dest, has := t.destination.?; has && dest != e.to do return
	case types.TriggerMode_LeavesBattlefield:
		if e.from != .Battlefield do return
		if dest, has := t.destination.?; has && dest != e.to do return
	case types.TriggerMode_EntersOrAttacks:
		if !is_self || e.to != .Battlefield do return
	case:
		return
	}
	if !trigger_supported(t^) do return
	subject, _ := t.valid_card.?
	controller, matched := zone_change_subject(g, source, t, subject, e, is_self)
	if !matched do return
	if !turn_constraint_met(s, t^, controller) do return
	// CR 603.10a: a leaves-the-battlefield ability looks back at the permanent as it last existed.
	lki := e.lki if is_self && e.from == .Battlefield else nil
	if gone, has := watcher_gone.?; has && !is_self do lki = gone
	add_trigger(g, source.id, controller, t, lki)
}

// Whether the moved object is what the trigger watches, and who controls the ability.
@(private = "file")
zone_change_subject :: proc(g: ^Game, source: ^types.GameObject, t: ^types.TriggerDefinition, subject: types.TargetFilter, e: Event, is_self: bool) -> (controller: types.PlayerId, matched: bool) {
	s := &g.state
	controller = source.controller
	#partial switch f in subject {
	case types.TargetFilter_SelfRef:
		if !is_self do return
		// The ability works from the zone the object is in now (entering) or was in (dying, leaving).
		if !has_zone(t.trigger_zones[:], e.to) && !has_zone(t.trigger_zones[:], e.from) do return
		if e.from == .Battlefield do controller = e.controller
		return controller, true
	case types.TargetFilter_Typed:
		// The permanent sees its own entering ("whenever a creature enters", CR 603.6a) and, looking back, its own
		// leaving ("whenever you sacrifice a permanent", CR 603.10a); any other object only from the battlefield.
		if is_self {
			if e.from != .Battlefield && e.to != .Battlefield do return
			if e.from == .Battlefield do controller = e.controller
		} else if source.zone != .Battlefield do return
		// The moved object as it was for the event (CR 603.10a: one that left, as it last existed on the
		// battlefield), with its controller then.
		as_was := e.lki^ if e.lki != nil else object(s, e.object)^
		as_was.controller = e.controller
		return controller, object_matches(s, &as_was, f._0, controller, source.id)
	case types.TargetFilter_AttachedTo:
		// "Whenever enchanted / equipped creature dies": the permanent this was attached to as it left the
		// battlefield (CR 603.10a, looking back: the creature's last known attachments, or this Aura's own last
		// known host when it left at the same time).
		if is_self || e.from != .Battlefield do return
		if e.lki != nil && slice.contains(e.lki.attachments[:], source.id) do return controller, true
		if at, attached := source.attached_to.?; attached {
			if h, on_object := at.(types.AttachTarget_Object); on_object && h._0 == e.object do return controller, true
		}
	case types.TargetFilter_Or:
		for y in f.filters do if c, ok := zone_change_subject(g, source, t, y, e, is_self); ok do return c, true
	}
	return
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

add_trigger :: proc(g: ^Game, source: types.ObjectId, controller: types.PlayerId, trigger: ^types.TriggerDefinition, lki: ^types.GameObject = nil, amount := 0) {
	t := unless_ability(trigger)
	// CR 603.4: with an intervening "if", the ability triggers only if the condition is true now.
	if c, has := t.condition.?; has && !condition_holds_as_was(&g.state, source, controller, c, lki) do return
	append(&g.pending_triggers, Pending_Trigger{source = source, controller = controller, definition = t, lki = lki, amount = amount, event = collecting_event})
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

// Set while a triggered ability's condition is checked again as it resolves (CR 603.4): conditions that belong to
// the trigger event alone (EventTime, "attacks alone") were settled when it triggered.
@(thread_local)
rechecking_on_resolution: bool

trigger_condition_supported :: proc(c: types.TriggerCondition) -> bool {
	#partial switch x in c {
	case types.TriggerCondition_MinCoAttackers:
		return x.filter == nil // "attacks with at least N other creatures" (battalion); "alone" is Not of 1
	case types.TriggerCondition_EventTime:
		return x.condition != nil && trigger_condition_supported(x.condition^)
	case types.TriggerCondition_WasCast:
		// "If you cast it": the caster is the permanent's controller as it enters; "from your hand" also its owner.
		if ctl, has := x.controller.?; has {
			if _, you := ctl.(types.ControllerRef_You); !you do return false
		}
		if own, has := x.owner.?; has {
			if _, you := own.(types.ControllerRef_You); !you do return false
		}
		return true
	case types.TriggerCondition_QuantityComparison:
		return quantity_supported(x.lhs) && quantity_supported(x.rhs)
	case types.TriggerCondition_HasCounters:
		#partial switch m in x.counters {
		case types.CounterMatch_Any:
			return true
		case types.CounterMatch_OfType:
			return counter_kind_supported(m._0)
		}
	case types.TriggerCondition_SourceInZone, types.TriggerCondition_SourceIsTapped:
		return true
	case types.TriggerCondition_ControlsType:
		return mass_filter_supported(x.filter)
	case types.TriggerCondition_ControlsNone:
		return mass_filter_supported(x.filter)
	case types.TriggerCondition_AdditionalCostPaid:
		// "When this enters, if it was kicked" (CR 702.33d).
		return x.source != .NonKicker && x.origin == nil && x.variant == nil && x.kicker_cost == nil && x.min_count <= 1
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
	case types.TriggerCondition_MinCoAttackers:
		// CR 508.1: the other creatures declared as attackers with it.
		if rechecking_on_resolution do return true
		combat, in_combat := s.combat.?
		if !in_combat do return false
		others := 0
		for a in combat.attackers do if a.object_id != collecting_event.object do others += 1
		if collecting_event.object == 0 do others -= 1 // not while collecting: the source itself attacks
		return others >= int(x.minimum)
	case types.TriggerCondition_EventTime:
		if rechecking_on_resolution do return true
		return trigger_condition_holds(s, source, controller, x.condition^)
	case types.TriggerCondition_WasCast:
		// "If you cast it (from your hand)": the permanent came from a spell its controller cast.
		if src == nil do return false
		z, was_cast := src.cast_from_zone.?
		if !was_cast do return false
		if want, has := x.zone.?; has && z != want do return false
		if _, has := x.owner.?; has && src.owner != controller do return false
		return true
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
	case types.TriggerCondition_SourceIsTapped:
		// "If this is tapped" (CR 603.4: checked as it triggers and again as it resolves).
		return src != nil && src.zone == .Battlefield && src.tapped
	case types.TriggerCondition_ControlsType:
		// "If you control an artifact": the filter names the controller (CR 603.4).
		return len(affected_permanents(s, x.filter, controller, source)) > 0
	case types.TriggerCondition_ControlsNone:
		return len(affected_permanents(s, x.filter, controller, source)) == 0
	case types.TriggerCondition_AdditionalCostPaid:
		return kicked(src)
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
		if pt.delayed != nil {
			// CR 603.7: put on the stack like any triggered ability; it has no targets to choose.
			ordered_remove(&g.pending_triggers, index)
			push_resolved_trigger(g, pt.source, pt.controller, pt.delayed)
			continue
		}
		if a := pt.definition.execute; a != nil && a.modal != nil {
			// CR 603.3c: a modal triggered ability's modes are chosen as it's put on the stack, before its targets.
			// With fewer modes it can choose than it must (a mode needs a target and none is legal, CR 700.2b),
			// none is chosen and the ability is removed.
			m := a.modal.?
			if m.mode_count - len(trigger_unavailable_modes(s, pt.controller, pt.source, a)) < max(m.min_choices, 1) {
				ordered_remove(&g.pending_triggers, index)
				continue
			}
			ask_trigger_modes(g, pt)
			return false
		}
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
		if complete && ask_trigger_division(g, pt.controller, pt.definition.execute, &g.trigger_targets) do return false // CR 603.3d, 601.2d
		targets, counts, division := c.targets, c.counts, g.trigger_targets.division
		g.trigger_targets = {}
		ordered_remove(&g.pending_triggers, index)
		// CR 603.3d: an ability that needs a target and has none legal is removed from the stack.
		if !complete do continue
		id := push_ability(g, pt.source, pt.controller, pt.definition.execute, targets[:], true, counts[:], pt.definition.description, division[:])
		if pt.definition.condition != nil {
			snapshot: ^types.GameObject
			if src := object(s, pt.source); src != nil && pt.lki == nil {
				snapshot = new(types.GameObject)
				snapshot^ = src^
				snapshot.counters = slice.clone_to_dynamic(src.counters[:])
			}
			g.stack_conditions[id] = Stack_Condition{pt.definition, pt.lki, snapshot}
		}
		event := pt.event
		event.amount = pt.amount
		if event != {} do g.stack_events[id] = event
	}
	return true
}

// APNAP: the active player's triggers first, then the others in turn order.
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
	dividing:     bool, // asked to divide its damage or counters (distribute.odin)...
	division:     [dynamic]u32, // ...each target's share...
	division_decided: bool, // ...once answered
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
	give_priority(g, priority_holder(g)) // CR 117.3c
	return true
}

// CR 115.6: declining an optional target of a triggered ability.
decline_trigger_target :: proc(g: ^Game, p: types.PlayerId) -> bool {
	if g.trigger_targets.definition == nil do return false
	slots := slot_list(g.trigger_targets.definition.execute)
	c := &g.trigger_targets.choice
	if c.slot >= len(slots) || !slots[c.slot].optional do return false
	skip_group(slots[:], c)
	give_priority(g, priority_holder(g)) // CR 117.3c
	return true
}

// Puts an ability on the stack: a new stack object (CR 113.7a) whose definition the game keeps to resolve it.
push_ability :: proc(g: ^Game, source: types.ObjectId, controller: types.PlayerId, a: ^types.AbilityDefinition, targets: []types.TargetRef, triggered: bool, counts: []int = nil, description: Maybe(string) = nil, division: []u32 = nil) -> types.ObjectId {
	s := &g.state
	id := types.ObjectId(s.next_object_id)
	s.next_object_id += 1
	resolved := resolved_tree(s, a, targets, counts, controller, source)
	record_division(resolved, division)
	defer note_targeted(g, id, controller, targets) // CR 115.1: its targets become targets as it's put on the stack
	if src := object(s, source); src != nil && src.back_face != nil do g.stack_transforms[id] = src.transformation_count
	g.stack_abilities[id] = a
	src := object(s, source)
	kind: types.StackEntryKind
	if triggered {
		kind = types.StackEntryKind_TriggeredAbility{source_id = source, ability = resolved, source_name = src.name if src != nil else "", description = description}
	} else {
		kind = types.StackEntryKind_ActivatedAbility{source_id = source, ability = resolved}
	}
	types.pvec_push(&s.stack, types.StackEntry{id = id, source_id = source, controller = controller, kind = kind}, copy_entry)
	return id
}

// A triggered ability whose instructions are already worked out (a delayed one): onto the stack as it is.
push_resolved_trigger :: proc(g: ^Game, source: types.ObjectId, controller: types.PlayerId, ability: ^types.ResolvedAbility) {
	s := &g.state
	id := types.ObjectId(s.next_object_id)
	s.next_object_id += 1
	src := object(s, source)
	kind := types.StackEntryKind_TriggeredAbility{source_id = source, ability = ability, source_name = src.name if src != nil else ""}
	types.pvec_push(&s.stack, types.StackEntry{id = id, source_id = source, controller = controller, kind = kind}, copy_entry)
}

// ---- Resolving (CR 608.2) -----------------------------------------------------------------------------------

// Resolves an ability from the stack. CR 603.5: an optional ("may") ability asks its controller as it resolves.
resolve_ability :: proc(g: ^Game, entry: types.StackEntry, resolved: ^types.ResolvedAbility) {
	// CR 603.4: the intervening "if" is checked again as the ability resolves; if false, it does nothing.
	if t, has := g.stack_conditions[entry.id]; has {
		delete_key(&g.stack_conditions, entry.id)
		rechecking_on_resolution = true
		lki := t.lki
		if src := object(&g.state, entry.source_id); lki == nil && t.snapshot != nil && (src == nil || src.incarnation != t.snapshot.incarnation) do lki = t.snapshot
		holds := condition_holds_as_was(&g.state, entry.source_id, entry.controller, t.definition.condition.?, lki)
		rechecking_on_resolution = false
		if !holds {
			delete_key(&g.stack_abilities, entry.id)
			return
		}
	}
	if resolved == nil do return
	event := g.stack_events[entry.id]
	delete_key(&g.stack_events, entry.id)
	// A "may" ability asks its controller as that instruction is carried out (CR 603.5, 608.2d).
	start_resolution(g, resolved, entry.controller, entry.source_id, stack_id = entry.id, event = event)
}

// CR 603.5: the controller decides whether to carry out a "may" ability.
decide_optional :: proc(g: ^Game, p: types.PlayerId, accept: bool) -> bool {
	if g.resolution.active && g.resolution.asked != nil do return answer_optional(g, p, accept)
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
	own_abilities: [dynamic]types.AbilityDefinition
	own_triggers := new([dynamic]types.TriggerEntry)
	for st in e.static_abilities {
		if !own_grant(st) {
			append(statics, st)
			continue
		}
		for m in st.modifications {
			#partial switch x in m {
			case types.ContinuousModification_GrantAbility:
				append(&own_abilities, x.definition^)
			case types.ContinuousModification_GrantTrigger:
				append(own_triggers, types.TriggerEntry{definition = x.trigger^})
			}
		}
	}
	o.static_definitions = types.Definitions_StaticDefinition(statics)
	o.base_static_definitions = statics
	o.trigger_definitions = types.Definitions_TriggerEntry(own_triggers)
	o.layer_base_power, o.layer_base_toughness = o.power, o.toughness
	o.tapped = e.tapped
	abilities := new([dynamic]types.AbilityDefinition)
	abilities^ = predefined_abilities(predefined_kind(o.card_types.subtypes[:])) // CR 111.10
	append(abilities, ..own_abilities[:])
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
	if e.enters_attacking do enter_attacking(s, o)
	// CR 111.10 (and 603.6a): a token entering the battlefield is an event like any other.
	append(&g.events, Event{kind = .Zone_Change, object = o.id, from = .Command, to = .Battlefield, controller = controller})
}

// CR 707.2, 111.1: a token that's a copy of an object has its copiable values: for a card, the card's printed
// characteristics (copy effects on the original aren't copied yet); for a token, the values it was created with.
// It enters the battlefield like any permanent (its enters-with replacements apply, CR 614.12), owned and
// controlled by its creator (CR 111.2).
create_copy_token :: proc(g: ^Game, original: ^types.GameObject, controller: types.PlayerId, tapped: bool) {
	s := &g.state
	o: ^types.GameObject
	card: ^types.CardExportEntry
	name := original.base_name if original.base_name != "" else original.name
	// CR 707.8a: a copy of a double-faced permanent is a double-faced token, made from its front face and turned to
	// the face the original has up.
	if front, has := original.back_face.?; has && original.transformed do name = front.name
	if !(original.is_token && original.printed_ref == nil) && g.card_db != nil do card = g.card_db(name)
	back_up := original.transformed
	if card != nil {
		o = new_card_object(s, card, controller, .Command)
	} else {
		o = new(types.GameObject)
		o^ = original^
		o.id = types.ObjectId(s.next_object_id)
		s.next_object_id += 1
		o.card_id = types.CardId(o.id)
		o.counters = {}
		o.attachments = {}
		o.attached_to = nil
		o.damage_marked = 0
		o.tapped = false
		o.zone = .Command
		reset_characteristics(o)
		s.objects.inner[o.id] = o
	}
	o.owner, o.controller, o.base_controller = controller, controller, controller
	move_object(g, o.id, .Battlefield)
	o.is_token = true
	o.controller = controller
	if tapped do o.tapped = true
	if back_up && card != nil && !o.transformed do transform_permanent(g, o) // enters with its back face up (707.8a)
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
		for list in ([?]^types.PVec(types.ObjectId){&p.hand, &p.graveyard, &p.library, &s.exile}) {
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

is_any_player :: proc(f: types.TargetFilter) -> bool {
	_, ok := f.(types.TargetFilter_Player)
	return ok
}

// "An opponent", written as a player filter with no types and an opponent as the controller, or as Opponent.
is_an_opponent :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Opponent:
		return true
	case types.TargetFilter_Typed:
		c, has := x._0.controller.?
		_, opp := c.(types.ControllerRef_Opponent)
		return has && opp && len(x._0.type_filters) == 0 && len(x._0.properties) == 0
	}
	return false
}

// A token "with '[ability]'" (CR 111.4: the effect sets the token's characteristics): a static on itself that only
// grants it an activated ability or a trigger is simply that ability of the token.
own_grant :: proc(st: types.StaticDefinition) -> bool {
	if _, continuous := st.mode.(types.StaticMode_Continuous); !continuous || st.condition != nil || len(st.modifications) == 0 do return false
	aff, has := st.affected.?
	if !has || !is_self(aff) do return false
	for m in st.modifications {
		#partial switch _ in m {
		case types.ContinuousModification_GrantAbility, types.ContinuousModification_GrantTrigger:
		case:
			return false
		}
	}
	return true
}

own_grant_supported :: proc(st: types.StaticDefinition) -> bool {
	if !own_grant(st) do return false
	for m in st.modifications {
		#partial switch x in m {
		case types.ContinuousModification_GrantAbility:
			if x.definition == nil do return false
			a := x.definition^
			if _, _, mana := tap_mana_ability(a); !mana && !activated_supported(a) do return false
		case types.ContinuousModification_GrantTrigger:
			if x.trigger == nil || !trigger_supported(x.trigger^) do return false
		}
	}
	return true
}

// A Saga's final chapter number: the greatest of its chapter abilities' (CR 715.2d). 0 for anything else.
final_chapter :: proc(o: ^types.GameObject) -> int {
	if !has_subtype(o, "Saga") do return 0
	final := 0
	for &entry in trigger_definitions(o) do if n, has := entry.definition.saga_chapter.?; has do final = max(final, int(n))
	return final
}

// Whether one of the Saga's chapter abilities has triggered and not yet left the stack (CR 704.5s).
chapter_waiting :: proc(g: ^Game, o: ^types.GameObject) -> bool {
	for pt in g.pending_triggers do if pt.source == o.id && pt.definition.saga_chapter != nil do return true
	for i in 0 ..< types.pvec_len(g.state.stack) {
		entry := types.pvec_get(g.state.stack, i)
		t, triggered := entry.kind.(types.StackEntryKind_TriggeredAbility)
		if !triggered || t.source_id != o.id do continue
		// This Saga, not an earlier object with its id (CR 400.7).
		if t.ability != nil {
			if inc, has := t.ability.source_incarnation.?; has && inc != o.incarnation do continue
		}
		a := g.stack_abilities[entry.id]
		for &def in trigger_definitions(o) {
			if def.definition.saga_chapter == nil do continue
			if a != nil && a == def.definition.execute do return true
			d, has := def.definition.description.?
			td, has_t := t.description.?
			if has && has_t && d == td do return true
		}
	}
	return false
}

// "When this enters": the permanent's own enters-the-battlefield trigger.
self_entering :: proc(t: types.TriggerDefinition) -> bool {
	if _, zc := t.mode.(types.TriggerMode_ChangesZone); !zc do return false
	d, has_d := t.destination.?
	f, has_f := t.valid_card.?
	return has_d && d == .Battlefield && has_f && is_self(f)
}

// A trigger whose "unless [a player pays]" the card data keeps on the trigger: the same trigger with it on its
// ability, where resolution reads it (CR 118.12a).
unless_ability :: proc(t: ^types.TriggerDefinition) -> ^types.TriggerDefinition {
	u, has := t.unless_pay.?
	if !has || t.execute == nil do return t
	a := new(types.AbilityDefinition)
	a^ = t.execute^
	a.unless_pay = u
	moved := new(types.TriggerDefinition)
	moved^ = t^
	moved.execute = a
	moved.unless_pay = nil
	return moved
}
