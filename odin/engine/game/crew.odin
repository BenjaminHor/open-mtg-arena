// Crew (CR 702.122): "Crew N" means "Tap any number of other untapped creatures you control with total power N or
// greater: This permanent becomes an artifact creature until end of turn." An activated ability: the player
// announces it, chooses the creatures (the cost, CR 602.2b), and it goes on the stack (CR 702.122a).
package game

import "core:slice"
import types "../types"

crew_power :: proc(o: ^types.GameObject) -> (n: int, ok: bool) {
	for k in o.keywords do if c, is_crew := k.(types.Keyword_Crew); is_crew && c.once_per_turn == nil do return int(c.power), true
	return
}

// The creatures that could crew it, and what each would add (its power, CR 702.122a).
crew_candidates :: proc(s: ^types.GameState, p: types.PlayerId, vehicle: ^types.GameObject) -> (ids: [dynamic]types.ObjectId, powers: [dynamic]i32, total: int) {
	for o in permanents_of(s, p) {
		if o.id == vehicle.id || o.tapped || !is_type(o, .Creature) do continue // "other untapped creatures"
		append(&ids, o.id)
		append(&powers, i32(power_of(o)))
		total += max(power_of(o), 0)
	}
	return
}

can_crew :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> bool {
	s := &g.state
	n, ok := crew_power(o)
	if !ok || o.zone != .Battlefield || o.controller != p || !object_supported(o, g.card_db) do return false
	_, _, total := crew_candidates(s, p, o)
	return total >= n
}

// CR 602.2: announcing the crew ability; the creatures to tap are chosen next.
start_crew :: proc(g: ^Game, p: types.PlayerId, vehicle_id: types.ObjectId) -> bool {
	s := &g.state
	o := object(s, vehicle_id)
	if o == nil || !can_crew(g, p, o) do return false
	n, _ := crew_power(o)
	ids, powers, _ := crew_candidates(s, p, o)
	s.waiting_for = types.WaitingFor_CrewVehicle{player = p, vehicle_id = vehicle_id, crew_power = u32(n), eligible_creatures = ids, contributions = powers}
	return true
}

// CR 602.2b, 702.122b: the chosen creatures are tapped to pay the cost; then the ability is on the stack.
answer_crew :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_CrewVehicle, chosen: []types.ObjectId) -> bool {
	s := &g.state
	if len(chosen) == 0 || has_duplicates(chosen) do return false
	total := 0
	for id in chosen {
		if !slice.contains(w.eligible_creatures[:], id) do return false
		o := object(s, id)
		if o == nil || o.tapped do return false
		total += max(power_of(o), 0)
	}
	if total < int(w.crew_power) do return false
	paid := make([dynamic]types.ObjectId)
	for id in chosen {
		tap_permanent(object(s, id))
		append(&paid, id)
	}
	id := types.ObjectId(s.next_object_id)
	s.next_object_id += 1
	kind := types.StackEntryKind_KeywordAction{action = types.KeywordAction_Crew{vehicle_id = w.vehicle_id, paid_creature_ids = paid}}
	types.pvec_push(&s.stack, types.StackEntry{id = id, source_id = w.vehicle_id, controller = p, kind = kind}, copy_entry)
	if v := object(s, w.vehicle_id); v != nil do g.stack_crews[id] = v.incarnation
	s.priority_passes = nil
	give_priority(g, p)
	return true
}

// The crew ability resolves: the Vehicle is an artifact creature until end of turn (CR 702.122a, 301.7b: with the
// power and toughness printed on it).
resolve_crew :: proc(g: ^Game, x: types.KeywordAction_Crew, stack_id: types.ObjectId) {
	o := object(&g.state, x.vehicle_id)
	incarnation, known := g.stack_crews[stack_id]
	delete_key(&g.stack_crews, stack_id)
	// Only the Vehicle it was activated from: one that has left and come back is a new object (CR 400.7, 113.7a).
	if o == nil || o.zone != .Battlefield || (known && o.incarnation != incarnation) do return
	mods := make([dynamic]types.ContinuousModification)
	append(&mods, types.ContinuousModification(types.ContinuousModification_AddType{core_type = .Artifact}))
	append(&mods, types.ContinuousModification(types.ContinuousModification_AddType{core_type = .Creature}))
	append(&g.temp_effects, Temp_Effect{object = o.id, incarnation = o.incarnation, modifications = mods[:]})
	apply_continuous_effects(g)
}
