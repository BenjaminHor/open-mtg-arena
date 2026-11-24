// Objects and zones (CR 400): finding objects, and moving them between zones.
package game

import "core:slice"
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
move_object :: proc(g: ^Game, id: types.ObjectId, to: types.Zone) {
	s := &g.state
	o := object(s, id)
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
	lki: ^types.GameObject
	if from == .Battlefield {
		// CR 608.2h: its last known information, kept for abilities that look back at it.
		lki = new(types.GameObject)
		lki^ = o^
		lki.counters = slice.clone_to_dynamic(o.counters[:])
		lki.attachments = slice.clone_to_dynamic(o.attachments[:])
	}
	o.zone = to
	o.incarnation += 1
	o.tapped = false
	o.damage_marked = 0
	o.dealt_deathtouch_damage = false
	clear(&o.counters)
	clear(&o.attachments)
	o.attached_to = nil
	reset_characteristics(o)
	// CR 107.3a: X, announced as the spell is cast, stays with it on the stack; CR 107.3m: the enters abilities of
	// the permanent it becomes use that X too. Anywhere else, X is gone.
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
	} else {
		o.entered_battlefield_turn = nil
	}
	if to != .Stack {
		list := zone_list(s, to, o.owner)
		types.pvec_push(list, id, copy_id)
	}
	// CR 603.2, 603.6: a zone change is an event abilities can trigger on.
	append(&g.events, Event{kind = .Zone_Change, object = id, from = from, to = to, controller = last_controller, lki = lki})
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
