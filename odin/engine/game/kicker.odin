// Kicker (CR 702.33): "You may pay an additional [cost] as you cast this spell." The player announces it as they
// cast the spell (CR 601.2b) through the optional-cost prompt; a kicked spell (CR 702.33d) and the permanent it
// becomes remember it, for "if it was kicked" and "... instead". One mana kicker cost, paid once. An optional
// additional cost other than mana ("Kicker—Sacrifice an artifact", "you may collect evidence 6") is announced the
// same way and remembered the same way ("if evidence was collected"); spells.odin pays it (spell_additional_cost).
package game

import types "../types"

// The kicker (or other optional additional) mana cost, if the card has a supported one.
kicker_cost :: proc(face: ^types.CardFace) -> (types.ManaCost_Cost, bool) {
	a, has := face.additional_cost.?
	if !has do return {}, false
	cost: types.AbilityCost
	#partial switch x in a {
	case types.AdditionalCost_Kicker:
		if len(x.costs) != 1 || x.repeatability != .Once do return {}, false
		cost = x.costs[0]
	case types.AdditionalCost_Optional:
		if x.repeatability != .Once do return {}, false
		cost = x.cost
	case:
		return {}, false
	}
	m, is_mana := cost.(types.AbilityCost_Mana)
	if !is_mana do return {}, false
	c, ok := m.cost.(types.ManaCost_Cost)
	return c, ok && !has_x(m.cost)
}

object_kicker_cost :: proc(o: ^types.GameObject) -> (types.ManaCost_Cost, bool) {
	f := object_face(o)
	return kicker_cost(&f)
}

kicked :: proc(o: ^types.GameObject) -> bool {return o != nil && o.additional_cost_payment_count > 0}

// CR 601.2b: asks whether to pay the kicker cost (or other optional additional cost: "you may blight 1",
// "Kicker—Sacrifice an artifact or creature"), if the player could pay it (CR 701.59b, 701.68b).
ask_kicker :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> bool {
	if g.pending.kicker_decided do return false
	_, mana := object_kicker_cost(o)
	_, other := object_optional_cost(o)
	if !mana && !other do return false
	o.additional_cost_payment_count = 1
	affordable := additional_cost_payable(&g.state, p, o) // the cost other than mana, with the mana left to pay
	if affordable do _, affordable = plan_payment(&g.state, p, spell_cost(&g.state, o, p), 0, nil, Payment{o, true})
	o.additional_cost_payment_count = 0
	if !affordable {
		g.pending.kicker_decided = true
		return false
	}
	pending := new(types.PendingCast)
	pending.object_id = o.id
	pending.card_id = o.card_id
	pending.cost = o.mana_cost
	g.state.waiting_for = types.WaitingFor_OptionalCostChoice{player = p, cost = o.additional_cost.?, pending_cast = pending}
	return true
}

// The answer: index 0 pays the kicker cost, 1 declines (as the client sends it).
decide_kicker :: proc(g: ^Game, p: types.PlayerId, index: int) -> bool {
	if g.pending.object == 0 || index < 0 || index > 1 do return false
	o := object(&g.state, g.pending.object)
	o.additional_cost_payment_count = 1 if index == 0 else 0
	g.pending.kicker_decided = true
	continue_casting(g, p)
	return true
}

// The cost with the kicker added, when the spell is kicked (CR 601.2f).
add_kicker_cost :: proc(o: ^types.GameObject, c: ^types.ManaCost_Cost) {
	if !kicked(o) do return
	k, has := object_kicker_cost(o)
	if !has do return
	c.generic += k.generic
	shards := make([dynamic]types.ManaCostShard, context.temp_allocator)
	append(&shards, ..c.shards[:])
	append(&shards, ..k.shards[:])
	c.shards = shards
}
