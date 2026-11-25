// Objects and zones (CR 400): finding objects, and moving them between zones.
package game

import "core:slice"
import "core:strconv"
import types "../types"

object :: proc(s: ^types.GameState, id: types.ObjectId) -> ^types.GameObject {
	return s.objects.inner[id]
}

player :: proc(s: ^types.GameState, p: types.PlayerId) -> ^types.Player {
	return &s.players[int(p)]
}

opponent :: proc(s: ^types.GameState, p: types.PlayerId) -> types.PlayerId {
	return types.PlayerId((int(p) + 1) % len(s.players))
}

is_type :: proc(o: ^types.GameObject, t: types.CoreType) -> bool {
	for c in o.card_types.core_types do if c == t do return true
	return false
}

// The ids in a persistent vector, as a slice the caller owns.
ids_of :: proc(v: types.PVec(types.ObjectId), allocator := context.temp_allocator) -> []types.ObjectId {
	out := make([]types.ObjectId, types.pvec_len(v), allocator)
	for i in 0 ..< len(out) do out[i] = types.pvec_get(v, i)
	return out
}

@(private = "file")
remove_id :: proc(v: ^types.PVec(types.ObjectId), id: types.ObjectId) -> bool {
	n := types.pvec_len(v^)
	for i in 0 ..< n do if types.pvec_get(v^, i) == id {
		rest := make([]types.ObjectId, n - i - 1, context.temp_allocator)
		for j in i + 1 ..< n do rest[j - i - 1] = types.pvec_get(v^, j)
		for _ in i ..< n do types.pvec_pop(v, copy_id)
		for x in rest do types.pvec_push(v, x, copy_id)
		return true
	}
	return false
}

// The list that holds a zone's objects: each player's own library, hand and graveyard, the shared others.
zone_list :: proc(s: ^types.GameState, zone: types.Zone, owner: types.PlayerId) -> ^types.PVec(types.ObjectId) {
	#partial switch zone {
	case .Library:
		return &player(s, owner).library
	case .Hand:
		return &player(s, owner).hand
	case .Graveyard:
		return &player(s, owner).graveyard
	case .Battlefield:
		return &s.battlefield
	case .Exile:
		return &s.exile
	case .Command:
		return &s.command_zone
	}
	return nil
}

// CR 400.7: an object that moves from one zone to another becomes a new object with no memory of its previous
// existence: it enters untapped, without damage, counters or attachments, and with its printed characteristics.
// (The id stays, with the incarnation counting the new object, so the client can follow the card.)
move_object :: proc(g: ^Game, id: types.ObjectId, destination: types.Zone) {
	s := &g.state
	o := object(s, id)
	to := destination
	// CR 614.6: "if it would die, exile it instead" changes where it goes.
	if o.zone == .Battlefield && to == .Graveyard && exiled_instead(g, o) do to = .Exile
	// CR 122.1h: finality counters make one replacement effect, "if this permanent would be put into a graveyard
	// from the battlefield, exile it instead".
	if o.zone == .Battlefield && to == .Graveyard && counter_count(o, types.CounterType_Finality{}) > 0 do to = .Exile
	// CR 111.8: a token that has left the battlefield can't move to another zone or come back.
	if o.is_token && o.zone != .Battlefield do return
	if o.zone != .Stack {
		if list := zone_list(s, o.zone, o.owner); list != nil do remove_id(list, id)
	}
	from := o.zone
	if from == .Battlefield {
		remove_from_combat(s, id) // CR 506.4
		detach_all_from(s, o)
		unattach(s, o)
	}
	last_controller := o.controller // CR 603.10: a leaves-the-battlefield trigger looks back at the object as it was
	record_zone_change(s, o, from, to)
	lki: ^types.GameObject
	if from == .Battlefield {
		// CR 608.2h: its last known information, kept for abilities that look back at it.
		lki = new(types.GameObject)
		lki^ = o^
		lki.counters = slice.clone_to_dynamic(o.counters[:])
		lki.attachments = slice.clone_to_dynamic(o.attachments[:])
	}
	if from == .Exile do clear(&o.casting_permissions) // CR 400.7: a new object, without the permission
	o.zone = to
	o.incarnation += 1
	o.tapped = false
	o.damage_marked = 0
	o.dealt_deathtouch_damage = false
	clear(&o.counters)
	clear(&o.attachments)
	clear(&o.chosen_attributes) // CR 400.7: the new object hasn't made the old one's choices
	o.attached_to = nil
	if from == .Battlefield && o.transformed do turn_front_face_up(g, o) // CR 712.6a
	if from == .Stack && showing_adventure(o) do show_creature(g.card_db, o) // CR 716.4
	if o.modal_back_face && to != .Stack && to != .Battlefield do mdfc_front_up(g.card_db, o) // CR 712.6a
	if own, is_copy := copying(o); is_copy && from == .Battlefield && g.card_db != nil {
		// A copy that leaves the battlefield is a new object with its own card's values again (CR 400.7, 707.2).
		if card := g.card_db(own); card != nil do set_card_characteristics(o, &card.face)
	}
	reset_characteristics(o)
	// CR 107.3a: X, announced as the spell is cast, stays with it on the stack; CR 107.3m: the enters abilities of
	// the permanent it becomes use that X too. Anywhere else, X is gone.
	// A spell that resolves into a permanent remembers it was cast, and from where ("when this enters, if you cast
	// it", CR 603.4); anywhere else that's forgotten (CR 400.7).
	if to != .Stack && !(from == .Stack && to == .Battlefield) {
		o.cast_from_zone = nil
		o.mana_spent_to_cast, o.mana_spent_to_cast_amount, o.colors_spent_to_cast = false, 0, {}
	}
	if to != .Stack && !(from == .Stack && to == .Battlefield) {
		o.cost_x_paid = nil
		o.additional_cost_payment_count = 0 // CR 702.33d: "kicked" belongs to the spell and the permanent it became
	}
	// A permanent is controlled by whoever put it onto the battlefield; elsewhere its owner (CR 108.4, 110.2).
	o.controller = o.owner
	if to == .Battlefield {
		o.entered_battlefield_turn = s.turn_number
		o.summoning_sick = true
		o.timestamp = s.next_timestamp
		s.next_timestamp += 1
		apply_entering_replacements(s, o) // CR 614.12
		// CR 306.5b: a planeswalker enters with loyalty counters equal to its printed loyalty.
		if is_type(o, .Planeswalker) && g.card_db != nil {
			if card := g.card_db(o.base_name if o.base_name != "" else o.name); card != nil {
				if l, has := card.face.loyalty.?; has do if n, ok := strconv.parse_int(l); ok && n >= 0 do o.loyalty = u32(n)
			}
		}
		if _, may_pay := entry_payment_of(o); may_pay do append(&g.entry_choices, id)
		if _, copies := entry_copy_of(o); copies do append(&g.entry_copies, id)
		if _, names := entry_choice_of(o); names do append(&g.entry_names, id)
		if _, reveals := entry_reveal_of(o); reveals do append(&g.entry_reveals, id)
	} else {
		o.entered_battlefield_turn = nil
	}
	if to != .Stack {
		list := zone_list(s, to, o.owner)
		types.pvec_push(list, id, copy_id)
	}
	// CR 603.2, 603.6: a zone change is an event abilities can trigger on.
	if !moving_together do event_group += 1
	append(&g.events, Event{kind = .Zone_Change, object = id, from = from, to = to, controller = last_controller, lki = lki, group = event_group})
}

// CR 701.21a: to sacrifice a permanent, its controller moves it from the battlefield to its owner's graveyard. That
// is an event of its own, which "whenever you sacrifice" abilities trigger on, looking back at the permanent as it
// last existed (CR 603.10a).
sacrifice_permanent :: proc(g: ^Game, id: types.ObjectId) {
	o := object(&g.state, id)
	if o == nil || o.zone != .Battlefield do return
	move_object(g, id, .Graveyard)
	moved := g.events[len(g.events) - 1]
	if moved.kind != .Zone_Change || moved.object != id do return
	moved.kind = .Sacrificed
	append(&g.events, moved)
}

// A permanent or card chosen to pay a cost goes to the graveyard: sacrificed from the battlefield, discarded from
// the hand (CR 701.21a, 701.9a).
pay_with_object :: proc(g: ^Game, id: types.ObjectId) {
	if o := object(&g.state, id); o != nil && o.zone == .Battlefield do sacrifice_permanent(g, id)
	else do move_object(g, id, .Graveyard)
}

// The zone changes of the turn, each with the object as it was (CR 603.10, 608.2h): "if a creature died this turn".
record_zone_change :: proc(s: ^types.GameState, o: ^types.GameObject, from, to: types.Zone) {
	r := types.ZoneChangeRecord {
		object_id            = o.id,
		name                 = o.name,
		core_types           = slice.clone_to_dynamic(o.card_types.core_types[:]),
		subtypes             = slice.clone_to_dynamic(o.card_types.subtypes[:]),
		supertypes           = slice.clone_to_dynamic(o.card_types.supertypes[:]),
		colors               = slice.clone_to_dynamic(o.color[:]),
		power                = o.power,
		toughness            = o.toughness,
		mana_value           = u32(object_mana_value(o)),
		controller           = o.controller,
		owner                = o.owner,
		from_zone            = from,
		to_zone              = to,
		is_token             = o.is_token,
		recorded_turn_number = s.turn_number,
		turn_zone_change_index = types.pvec_len(s.zone_changes_this_turn),
	}
	types.pvec_push(&s.zone_changes_this_turn, r, proc(x: types.ZoneChangeRecord) -> types.ZoneChangeRecord {return x})
}

// Back to the printed characteristics (CR 613: no continuous effects apply to the new object yet).
reset_characteristics :: proc(o: ^types.GameObject) {
	o.name = o.base_name
	o.card_types = o.base_card_types
	o.mana_cost = o.base_mana_cost
	o.keywords = o.base_keywords
	o.color = o.base_color
	o.power = o.base_power
	o.toughness = o.base_toughness
}

// The permanents a player controls.
permanents_of :: proc(s: ^types.GameState, p: types.PlayerId) -> [dynamic]^types.GameObject {
	out := make([dynamic]^types.GameObject, context.temp_allocator)
	for id in ids_of(s.battlefield) {
		o := object(s, id)
		if o.controller == p do append(&out, o)
	}
	return out
}

// CR 506.4: a permanent that leaves the battlefield is removed from combat; an attacker it blocked stays blocked
// (CR 509.1h), and a blocker whose attacker is gone deals no combat damage (CR 510.1d).
remove_from_combat :: proc(s: ^types.GameState, id: types.ObjectId) {
	c, in_combat := &s.combat.?
	if !in_combat do return
	for a, i in c.attackers do if a.object_id == id {
		ordered_remove(&c.attackers, i)
		break
	}
	delete_key(&c.blocker_assignments, id)
	for attacker, &blockers in c.blocker_assignments {
		for b, i in blockers do if b == id {
			ordered_remove(&blockers, i)
			break
		}
		_ = attacker
	}
	delete_key(&c.blocker_to_attacker, id)
	for _, &attackers in c.blocker_to_attacker {
		for a, i in attackers do if a == id {
			ordered_remove(&attackers, i)
			break
		}
	}
}

// Zone changes that happen at the same time (CR 704.3: state-based actions; "sacrifice two creatures") share a
// group, so that abilities of permanents leaving together see each other leave (CR 603.10a).
@(thread_local)
event_group: int
@(thread_local)
moving_together: bool

// Starts a group of simultaneous zone changes; end it with end_together.
begin_together :: proc() -> bool {
	outer := moving_together
	if !outer do event_group += 1
	moving_together = true
	return outer
}

end_together :: proc(outer: bool) {
	moving_together = outer
}

// The events of the action being carried out, for last known information (CR 608.2h) where only the state is at hand.
@(thread_local)
action_events: ^[dynamic]Event

// The object as it last existed on the battlefield, if it left during this action (CR 608.2h); nil otherwise.
last_known :: proc(id: types.ObjectId) -> ^types.GameObject {
	if action_events == nil do return nil
	#reverse for e in action_events^ do if e.kind == .Zone_Change && e.object == id && e.lki != nil do return e.lki
	return nil
}
