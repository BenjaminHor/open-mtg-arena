// Discard and cycling triggers (CR 701.9, 702.29): "whenever you discard a card", "whenever an opponent discards a
// creature card", "when you discard this card", "when you cycle this card", "whenever you cycle another card",
// "whenever you cycle or discard a card" and "whenever you discard one or more cards". The Discarded events come
// from discard_card (zones.odin).
package game

import "core:strings"
import types "../types"

// Simultaneous events a "one or more" ability triggers on once (CR 603.2c): its definition, the event group (zone
// changes made at the same time, zones.odin) and, for discards, the player who discarded.
Batch_Key :: struct {
	definition: ^types.TriggerDefinition,
	group:      int,
	player:     types.PlayerId,
}

discard_trigger_supported :: proc(t: types.TriggerDefinition) -> bool {
	_, all := t.mode.(types.TriggerMode_DiscardedAll)
	if all != t.batched do return false
	f, has := t.valid_card.?
	// Whose discard: "you", "an opponent", or any player. "When you discard this card" is its owner's (CR 701.9a);
	// there the data's valid_target may be the effect's own target ("target player loses life", Gempalm Polluter).
	if v, has_v := t.valid_target.?; has_v && !(has && is_self(f)) && !is_you(v) && !is_an_opponent(v) && !is_any_player(v) do return false
	if !has do return true // any card
	if is_self(f) {
		// "When you discard / cycle this card": it triggers from the zone the card went to (CR 702.29c, 113.6k).
		#partial switch _ in t.mode {
		case types.TriggerMode_Discarded, types.TriggerMode_Cycled:
			return len(t.trigger_zones) > 0 && !has_zone(t.trigger_zones[:], .Battlefield)
		}
		return false
	}
	// "A creature card", "a noncreature, nonland card", "another card": the discarded card as it is in the graveyard.
	typed, ok := f.(types.TargetFilter_Typed)
	if !ok || typed._0.controller != nil do return false
	for tf in typed._0.type_filters do if !type_filter_supported(tf) do return false
	for p in typed._0.properties {
		if _, in_zone := p.(types.FilterProp_InZone); in_zone || !property_supported(p) do return false
	}
	return true
}

// Whether a discard (or cycle) is one the ability watches, apart from batching.
@(private = "file")
discard_matches :: proc(s: ^types.GameState, t: ^types.TriggerDefinition, e: Event, card, watcher: ^types.GameObject) -> bool {
	#partial switch _ in t.mode {
	case types.TriggerMode_Discarded, types.TriggerMode_DiscardedAll:
	case types.TriggerMode_Cycled:
		if !e.cycled do return false
	case types.TriggerMode_CycledOrDiscarded:
		// CR 702.29d: "cycles or discards" triggers once for a card that's cycled (one discard event).
	case:
		return false
	}
	if !trigger_supported(t^) do return false
	self := false
	if f, has := t.valid_card.?; has do self = is_self(f)
	if v, has := t.valid_target.?; has && !self {
		if is_you(v) && e.controller != watcher.controller do return false
		if is_an_opponent(v) && e.controller == watcher.controller do return false
	}
	if f, has := t.valid_card.?; has {
		if is_self(f) {
			if card.id != watcher.id do return false
		} else if !object_matches(s, card, f.(types.TargetFilter_Typed)._0, watcher.controller, watcher.id) do return false
	}
	return turn_constraint_met(s, t^, watcher.controller)
}

// "For the first time each turn" (CR 603.2): read from the turn's count of the event, not from this ability's
// record, as the card data's "only once each turn" would (they differ when the ability wasn't there the first time).
// Read for cycles and batches of discards; refused elsewhere (first_time_readable).
@(private = "file")
says_first_time :: proc(t: ^types.TriggerDefinition) -> bool {
	d, has := t.description.?
	return has && strings.contains(d, "first time each turn")
}

// CR 603.2: the abilities a discard (or cycle, CR 702.29c) triggers: the card's own, from the zone it went to, and
// those of permanents watching for discards. `batches`: the "one or more" abilities already triggered this check.
discard_triggers :: proc(g: ^Game, e: Event, batches: ^[dynamic]Batch_Key) {
	s := &g.state
	card := object(s, e.object)
	if card == nil do return
	// The card's own "when you discard / cycle this card": it works from the zone the card went to (CR 702.29c).
	for &entry in trigger_definitions(card) {
		t := &entry.definition
		f, has := t.valid_card.?
		if !has || !is_self(f) || !has_zone(t.trigger_zones[:], e.to) do continue
		if !discard_matches(s, t, e, card, card) do continue
		add_trigger(g, card.id, e.controller, t)
	}
	for id in ids_of(s.battlefield) {
		w := object(s, id)
		for &entry in trigger_definitions(w) {
			t := &entry.definition
			if f, has := t.valid_card.?; has && is_self(f) do continue
			if !discard_matches(s, t, e, card, w) do continue
			if _, all := t.mode.(types.TriggerMode_DiscardedAll); all {
				// "Whenever you discard one or more cards": once for the cards a player discarded together, with
				// "that many" the number of them that fit (CR 603.2c).
				key := Batch_Key{t, e.group, e.controller}
				seen := false
				for b in batches do if b == key do seen = true
				if seen do continue
				append(batches, key)
				count, first := 0, false
				for f in g.events {
					if f.kind != .Discarded || f.group != e.group || f.controller != e.controller do continue
					other := object(s, f.object)
					if other == nil || !discard_matches(s, t, f, other, w) do continue
					count += 1
					if f.before == 0 do first = true
				}
				if says_first_time(t) && !first do continue
				add_trigger(g, w.id, w.controller, t, nil, count)
				continue
			}
			// "Whenever you cycle another card for the first time each turn": the first cycle of the turn.
			if says_first_time(t) && e.cycles_before > 0 do continue
			add_trigger(g, w.id, w.controller, t)
		}
	}
}

// Whether the ability's "for the first time each turn", if it says that, is read: as the turn's count of the event
// for cycles and batches of discards (discard_triggers); for the other modes the data's "only once each turn" isn't
// the same thing, so those are refused. Modes this engine read before are left as they were.
first_time_readable :: proc(t: types.TriggerDefinition) -> bool {
	d, has := t.description.?
	if !has || !strings.contains(d, "first time each turn") do return true
	#partial switch _ in t.mode {
	case types.TriggerMode_Cycled:
		// The count is of every card the player cycled: "a card" or "another card" (any card cycled from the hand is
		// another than the permanent), not a kind of card.
		f, has := t.valid_card.?
		if !has do return true
		typed, ok := f.(types.TargetFilter_Typed)
		if !ok || len(typed._0.type_filters) > 0 || typed._0.controller != nil do return false
		for p in typed._0.properties do if _, another := p.(types.FilterProp_Another); !another do return false
		return true
	case types.TriggerMode_DiscardedAll:
		// The count is of all the cards the player discarded: "one or more artifact cards for the first time" isn't.
		return t.valid_card == nil
	case types.TriggerMode_Discarded, types.TriggerMode_CycledOrDiscarded, types.TriggerMode_ChangesZoneAll, types.TriggerMode_BecomesTarget:
		return false
	}
	return true
}
