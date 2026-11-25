// Dividing an amount among targets, CR 601.2d: "deals 3 damage divided as you choose among one, two, or three
// targets", "distribute two +1/+1 counters among one or two target creatures". The player announces the division
// as the spell is cast (or the ability activated), after its targets; each target gets at least one. As it
// resolves, each legal target gets its share (an illegal one's share isn't dealt, CR 608.2b).
package game

import "core:slice"
import types "../types"

// Whether the engine can divide this instruction's amount: damage or counters, a fixed amount, among a fixed number
// of targets no larger than the amount (so each can get one).
distribute_supported :: proc(a: types.AbilityDefinition) -> bool {
	unit, has := a.distribute.?
	if !has do return true
	if a.effect == nil do return false
	m, multi := a.multi_target.?
	if !multi do return false
	most_q, has_max := m.max.?
	if !has_max do return false
	most, fixed_max := fixed_quantity(most_q)
	least, fixed_min := fixed_quantity(m.min)
	if !fixed_max || !fixed_min || least < 1 do return false
	#partial switch x in a.effect^ {
	case types.Effect_DealDamage:
		_, damage := unit.(types.DistributionUnit_Damage)
		n, fixed := fixed_quantity(x.amount)
		return damage && fixed && most <= n
	case types.Effect_PutCounter:
		_, counters := unit.(types.DistributionUnit_Counters)
		n, fixed := fixed_quantity(x.count)
		return counters && fixed && most <= n
	}
	return false
}

// The amount an instruction divides.
distributed_total :: proc(e: types.Effect) -> int {
	#partial switch x in e {
	case types.Effect_DealDamage:
		n, _ := fixed_quantity(x.amount)
		return n
	case types.Effect_PutCounter:
		n, _ := fixed_quantity(x.count)
		return n
	}
	return 0
}

// The instruction with that amount instead: one target's share.
with_share :: proc(e: types.Effect, n: int) -> types.Effect {
	#partial switch x in e {
	case types.Effect_DealDamage:
		y := x
		y.amount = types.QuantityExpr_Fixed{value = i32(n)}
		return y
	case types.Effect_PutCounter:
		y := x
		y.count = types.QuantityExpr_Fixed{value = i32(n)}
		return y
	}
	return e
}

// The dividing instruction of an ability, and the targets chosen for it among all of the ability's.
division_of :: proc(chain: ^types.AbilityDefinition, all_targets: []types.TargetRef, counts: []int) -> (node: ^types.AbilityDefinition, targets: []types.TargetRef) {
	group, start := 0, 0
	for x := chain; x != nil; x = x.sub_ability {
		if x != chain && is_reflexive(x) do break
		if x.effect == nil do continue
		if _, targets_one := instruction_target(x.effect^, x.target_choice_timing); !targets_one do continue // as slot_list counts them
		n := counts[group] if group < len(counts) else 1
		if x.distribute != nil {
			end := min(start + n, len(all_targets))
			return x, all_targets[min(start, end):end]
		}
		start += n
		group += 1
	}
	return nil, nil
}

// The dividing instruction of what's being cast or activated, and the targets chosen for it.
@(private = "file")
pending_division :: proc(g: ^Game) -> (node: ^types.AbilityDefinition, targets: []types.TargetRef) {
	o := object(&g.state, g.pending.object)
	chain: ^types.AbilityDefinition
	if g.pending.ability_index >= 0 do chain = activated_ability(o, g.pending.ability_index)
	else if is_modal(o) do chain = chosen_mode_chain(o, g.pending.modes[:])
	else do chain = spell_ability(o)
	return division_of(chain, g.pending.targets[:], g.pending.counts[:])
}

// CR 603.3d, 601.2d: a triggered ability being put on the stack divides too, once its targets are chosen. True while
// its controller decides.
ask_trigger_division :: proc(g: ^Game, controller: types.PlayerId, chain: ^types.AbilityDefinition, c: ^Trigger_Target_Choice) -> bool {
	if c.division_decided do return false
	node, targets := division_of(chain, c.targets[:], c.counts[:])
	if node == nil || len(targets) < 2 do return false
	c.dividing = true
	g.state.priority_player = controller
	g.state.waiting_for = types.WaitingFor_DistributeAmong {
		player  = controller,
		total   = u32(distributed_total(node.effect^)),
		targets = slice.clone_to_dynamic(targets),
		unit    = node.distribute.?,
		scope   = types.DistributionScope_AnnouncedTargets{},
	}
	return true
}

// CR 601.2d: asks for the division once the targets are chosen, when there's more than one target to divide among.
// True while the player decides.
ask_division :: proc(g: ^Game, p: types.PlayerId) -> bool {
	if g.pending.division_decided do return false
	node, targets := pending_division(g)
	if node == nil || len(targets) < 2 do return false
	g.state.priority_player = p
	g.state.waiting_for = types.WaitingFor_DistributeAmong {
		player  = p,
		total   = u32(distributed_total(node.effect^)),
		targets = slice.clone_to_dynamic(targets),
		unit    = node.distribute.?,
		scope   = types.DistributionScope_AnnouncedTargets{},
	}
	return true
}

// The player's division: every target once, each at least one, adding up to the total (CR 601.2d).
answer_division :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_DistributeAmong, division: []types.Tuple2(types.TargetRef, u32)) -> bool {
	if p != w.player || len(division) != len(w.targets) do return false
	shares := make([dynamic]u32)
	sum: u32 = 0
	for t in w.targets {
		found := false
		for d in division do if d._0 == t {
			if found || d._1 < 1 do return false
			append(&shares, d._1)
			sum += d._1
			found = true
		}
		if !found do return false
	}
	if sum != w.total do return false
	if g.trigger_targets.dividing {
		// A triggered ability's division: it's put on the stack with it (place_triggers).
		g.trigger_targets.division = shares
		g.trigger_targets.division_decided = true
		g.trigger_targets.dividing = false
		g.state.waiting_for = nil
		give_priority(g, priority_holder(g))
		return true
	}
	g.pending.division = shares
	g.pending.division_decided = true
	g.state.waiting_for = nil
	next_target_or_finish(g, p)
	return true
}

// The division as the stack object records it: each target of the dividing instruction with its share.
record_division :: proc(top: ^types.ResolvedAbility, shares: []u32) {
	if len(shares) == 0 do return
	for n := top; n != nil; n = n.sub_ability {
		if n.distribute == nil do continue
		pairs := make([dynamic]types.Tuple2(types.TargetRef, u32))
		for t, i in n.targets do if i < len(shares) do append(&pairs, types.Tuple2(types.TargetRef, u32){t, shares[i]})
		n.distribution = pairs
		return
	}
}

// The AI's division: one each, the rest to the first target (its best one, chosen first).
ai_division :: proc(w: types.WaitingFor_DistributeAmong) -> [dynamic]types.Tuple2(types.TargetRef, u32) {
	out := make([dynamic]types.Tuple2(types.TargetRef, u32), context.temp_allocator)
	for t, i in w.targets {
		n: u32 = 1
		if i == 0 do n = w.total - u32(len(w.targets) - 1)
		append(&out, types.Tuple2(types.TargetRef, u32){t, n})
	}
	return out
}
