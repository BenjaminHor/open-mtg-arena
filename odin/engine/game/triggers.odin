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
}

// A triggered ability waiting to be put on the stack (CR 603.3).
Pending_Trigger :: struct {
	source:     types.ObjectId,
	controller: types.PlayerId,
	definition: ^types.TriggerDefinition,
	lki:        ^types.GameObject, // a leaves-the-battlefield trigger's source as it last existed (CR 603.10a)
	amount:     int, // the event's amount, for "that much" (the damage dealt)
}

// A triggered ability on the stack whose intervening "if" is checked again as it resolves (CR 603.4).
Stack_Condition :: struct {
	definition: ^types.TriggerDefinition,
	lki:        ^types.GameObject,
}

// ---- What's supported --------------------------------------------------------------------------------------

trigger_supported :: proc(t: types.TriggerDefinition) -> bool {
	event_amount_defined = trigger_has_amount(t)
	defer event_amount_defined = false
	if t.execute == nil || !ability_supported(t.execute^) do return false
	// "That much" reads the event only in the first instruction: after another one ("discard your hand. If you do,
	// draw that many cards") it means what that instruction did, which isn't tracked yet.
	if t.execute.sub_ability != nil && event_amount_defined {
		event_amount_defined = false
		if !ability_supported(t.execute.sub_ability^) do return false
	}
	if c, has := t.condition.?; has && !trigger_condition_supported(c) do return false
	if t.unless_pay != nil || t.batched do return false
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
	#partial switch x in f {
	case types.TargetFilter_SelfRef:
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

// Whether the trigger's event has an amount its effect can call "that much": damage dealt to or by one object.
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
	for e in g.events {
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
				if _, attacks := t.mode.(types.TriggerMode_Attacks); attacks && trigger_supported(t^) do add_trigger(g, o.id, o.controller, t)
				if _, either := t.mode.(types.TriggerMode_EntersOrAttacks); either && trigger_supported(t^) do add_trigger(g, o.id, o.controller, t)
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
			o := object(s, e.object)
			if o == nil || o.zone != .Battlefield do continue
			for &entry in trigger_definitions(o) {
				t := &entry.definition
				if _, added := t.mode.(types.TriggerMode_CounterAdded); !added || !trigger_supported(t^) do continue
				cf := t.counter_filter.?
				if !same_counter(cf.counter_type, e.counter) do continue
				// CR 715.2b: a chapter (or "the Nth counter") triggers when the count was less than N and became at
				// least N.
				if n, has := cf.threshold.?; has && !(e.before < int(n) && e.before + e.amount >= int(n)) do continue
				if !turn_constraint_met(s, t^, o.controller) do continue
				add_trigger(g, o.id, o.controller, t)
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
					if !trigger_supported(t^) || !turn_constraint_met(s, t^, o.controller) do continue
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
zone_change_trigger :: proc(g: ^Game, source: ^types.GameObject, t: ^types.TriggerDefinition, e: Event, is_self: bool) {
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
	add_trigger(g, source.id, controller, t, e.lki if is_self && e.from == .Battlefield else nil)
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
		if is_self || source.zone != .Battlefield do return
		// The moved object as it was for the event (CR 603.10a: one that left, as it last existed on the
		// battlefield), with its controller then.
		as_was := e.lki^ if e.lki != nil else object(s, e.object)^
		as_was.controller = e.controller
		return controller, object_matches(s, &as_was, f._0, source.controller, source.id)
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

add_trigger :: proc(g: ^Game, source: types.ObjectId, controller: types.PlayerId, t: ^types.TriggerDefinition, lki: ^types.GameObject = nil, amount := 0) {
	// CR 603.4: with an intervening "if", the ability triggers only if the condition is true now.
	if c, has := t.condition.?; has && !condition_holds_as_was(&g.state, source, controller, c, lki) do return
	append(&g.pending_triggers, Pending_Trigger{source = source, controller = controller, definition = t, lki = lki, amount = amount})
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
		id := push_ability(g, pt.source, pt.controller, pt.definition.execute, targets[:], true, counts[:], pt.definition.description)
		if pt.definition.condition != nil do g.stack_conditions[id] = Stack_Condition{pt.definition, pt.lki}
		if pt.amount != 0 do g.stack_event_amounts[id] = pt.amount
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
push_ability :: proc(g: ^Game, source: types.ObjectId, controller: types.PlayerId, a: ^types.AbilityDefinition, targets: []types.TargetRef, triggered: bool, counts: []int = nil, description: Maybe(string) = nil) -> types.ObjectId {
	s := &g.state
	id := types.ObjectId(s.next_object_id)
	s.next_object_id += 1
	resolved := resolved_tree(s, a, targets, counts, controller, source)
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
	amount := g.stack_event_amounts[entry.id]
	delete_key(&g.stack_event_amounts, entry.id)
	// A "may" ability asks its controller as that instruction is carried out (CR 603.5, 608.2d).
	start_resolution(g, resolved, entry.controller, entry.source_id, stack_id = entry.id, event_amount = amount)
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
	// CR 508.4: entering attacking the defending player; only a creature (CR 506.3a), only the attacking player's
	// (CR 506.3b), only during combat.
	if c, in_combat := &s.combat.?; in_combat && e.enters_attacking && s.active_player == controller && is_type(o, .Creature) {
		append(&c.attackers, types.AttackerInfo{object_id = o.id, defending_player = opponent(s, controller), attack_target = types.AttackTarget_Player{opponent(s, controller)}})
	}
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
