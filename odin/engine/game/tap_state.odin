// Tapping and untapping several permanents (CR 701.26): "tap all creatures your opponents control", "untap all lands
// you control", "tap all creatures target opponent controls", and "creatures you control get +1/+1 until end of turn.
// Untap those creatures", where "those" are the permanents the instruction before acted on, kept as it resolved (CR
// 608.2c, 611.2c), not looked up again.
package game

import types "../types"

// CR 701.26a: only an untapped permanent can be tapped; CR 701.26b: only a tapped one untapped.
set_tap_state :: proc(o: ^types.GameObject, state: types.TapStateChange) {
	if o == nil || o.zone != .Battlefield do return
	if state == .Tap do tap_permanent(o)
	else do untap(o) // CR 122.1d: a stun counter removed instead
}

// Keeps what a mass instruction ("creatures you control get +1/+1", "put a +1/+1 counter on each creature you
// control") acted on, as those objects (CR 400.7), for "untap those creatures" after it.
note_mass_affected :: proc(g: ^Game, objects: []^types.GameObject) {
	r := &g.resolution
	if !r.active do return
	if r.mass_affected == nil do r.mass_affected = make([dynamic]Same_Object)
	clear(&r.mass_affected)
	for o in objects do append(&r.mass_affected, Same_Object{o.id, o.incarnation})
}

// Those permanents, the ones still the same objects on the battlefield.
mass_affected_now :: proc(g: ^Game) -> [dynamic]^types.GameObject {
	s := &g.state
	out := make([dynamic]^types.GameObject, context.temp_allocator)
	for m in g.resolution.mass_affected {
		o := object(s, m.id)
		if o != nil && o.zone == .Battlefield && o.incarnation == m.incarnation do append(&out, o)
	}
	return out
}

// Whether the instruction before is one that notes what it acted on (note_mass_affected), so "those creatures" can
// be read: "creatures you control get +1/+1 [and gain lifelink]", "put a +1/+1 counter on each creature you control".
after_mass_instruction :: proc() -> bool {
	if previous_instruction == nil do return false
	#partial switch x in previous_instruction^ {
	case types.Effect_PumpAll, types.Effect_PutCounterAll:
		return true
	case types.Effect_GenericEffect:
		// One change to the objects a filter describes (not "this", not a target, not rules for later arrivals).
		if x.target != nil || len(x.static_abilities) != 1 do return false
		st := x.static_abilities[0]
		affected, has := st.affected.?
		if !has do return false
		_, typed := affected.(types.TargetFilter_Typed)
		return typed && !rules_only(st)
	}
	return false
}

// "Tap all creatures target opponent controls": the instruction targets the opponent (CR 115.1) and acts on that
// player's permanents of the kind named. The card data writes the player as the filter's controller; for "target
// player" it writes "that player" the same way (Nature's Will: "tap all lands that player controls", the player dealt
// damage, not a target), so only "target opponent" is read as a target. The filter without that controller.
mass_tap_of_target_opponent :: proc(x: types.Effect_SetTapState) -> (types.TypedFilter, bool) {
	if x.scope != .All do return {}, false
	typed, ok := x.target.(types.TargetFilter_Typed)
	if !ok do return {}, false
	c, has := typed._0.controller.?
	if !has do return {}, false
	if _, opponent := c.(types.ControllerRef_TargetOpponent); !opponent do return {}, false
	f := typed._0
	f.controller = nil
	return f, true
}
