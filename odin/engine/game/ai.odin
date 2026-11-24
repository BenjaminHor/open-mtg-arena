// A simple AI opponent: it plays a land, casts what it can (most expensive first), attacks when it's safe or
// lethal, blocks to trade or survive, and aims removal at the biggest threat. It sees only what its player could
// see: its own hand, and the battlefield.
package game

import "core:slice"
import types "../types"

ai_action :: proc(g: ^Game, p: types.PlayerId) -> (types.GameAction, bool) {
	s := &g.state
	if !is_deciding(s, p) do return nil, false
	#partial switch w in s.waiting_for {
	case types.WaitingFor_MulliganDecision:
		// Keep a hand with two to five lands, else take one mulligan.
		lands := 0
		for id in ids_of(player(s, p).hand) do if is_type(object(s, id), .Land) do lands += 1
		count: u8
		for e in w.pending do if e.player == p do count = e.mulligan_count
		if (lands < 2 || lands > 5) && count == 0 {
			return types.GameAction_MulliganDecision{choice = types.MulliganChoice_Mulligan{}}, true
		}
		return types.GameAction_MulliganDecision{choice = types.MulliganChoice_Keep{}}, true
	case types.WaitingFor_OpeningHandBottomCards:
		for e in w.pending do if e.player == p do return types.GameAction_SelectCards{cards = worst_cards(g, p, int(e.count))}, true
	case types.WaitingFor_DiscardToHandSize:
		return types.GameAction_SelectCards{cards = worst_cards(g, p, w.count)}, true
	case types.WaitingFor_TargetSelection:
		return types.GameAction_ChooseTarget{target = best_target(g, p, w.selection.current_legal_targets[:])}, true
	case types.WaitingFor_TriggerTargetSelection:
		a: ^types.AbilityDefinition
		if g.trigger_targets.definition != nil do a = g.trigger_targets.definition.execute
		t, good := chosen_target(g, p, w.selection.current_legal_targets[:], a)
		if !good do t = w.selection.current_legal_targets[0]
		return types.GameAction_ChooseTarget{target = t}, true
	case types.WaitingFor_OptionalEffectChoice:
		return types.GameAction_DecideOptionalEffect{accept = true}, true
	case types.WaitingFor_ScryChoice:
		return types.GameAction_SelectCards{cards = ai_keep_on_top(g, p, w.cards[:])}, true
	case types.WaitingFor_SurveilChoice:
		return types.GameAction_SelectCards{cards = ai_keep_on_top(g, p, w.cards[:])}, true
	case types.WaitingFor_AssignCombatDamage:
		return ai_damage_division(g, w), true
	case types.WaitingFor_DeclareAttackers:
		return types.GameAction_DeclareAttackers{attacks = choose_attacks(g, p)}, true
	case types.WaitingFor_DeclareBlockers:
		return types.GameAction_DeclareBlockers{assignments = choose_blocks(g, p)}, true
	case types.WaitingFor_Priority:
		return priority_action(g, p), true
	}
	return nil, false
}

priority_action :: proc(g: ^Game, p: types.PlayerId) -> types.GameAction {
	s := &g.state
	hand := ids_of(player(s, p).hand)
	for id in hand {
		o := object(s, id)
		if can_play_land(g, p, o) && object_supported(o, g.card_db) do return types.GameAction_PlayLand{object_id = id, card_id = o.card_id}
	}
	// Only spells cast on its own turn's main phase, or burn aimed at a creature it can kill; it doesn't hold tricks.
	best: ^types.GameObject
	for id in castable_zone_ids(s, p) {
		o := object(s, id)
		if !castable(s, p, o, g.card_db) || !worth_casting(g, p, o) do continue
		if best == nil || mana_value(o.mana_cost) > mana_value(best.mana_cost) do best = o
	}
	if best != nil do return types.GameAction_CastSpell{object_id = best.id, card_id = best.card_id}
	// After combat on its own turn, use abilities that make cards, creatures or a good kill.
	if s.active_player == p && s.phase == .PostCombatMain && types.pvec_len(s.stack) == 0 {
		for o in permanents_of(s, p) {
			if o.abilities == nil do continue
			for &a, i in o.abilities^ do if can_activate(g, p, o, i) && ability_worth_using(g, p, &a) {
				return types.GameAction_ActivateAbility{source_id = o.id, ability_index = i}
			}
		}
	}
	return types.GameAction_PassPriority{}
}

// A creature or other permanent is always worth casting; a spell only if it has a good target.
worth_casting :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> bool {
	s := &g.state
	if is_permanent_card(o) do return sorcery_timing(s, p)
	a := spell_ability(o)
	if a == nil do return false
	for x := a; x != nil; x = x.sub_ability {
		if x.effect == nil do continue
		#partial switch e in x.effect^ {
		case types.Effect_Pump, types.Effect_GenericEffect:
			// A pump spell during its own combat, on an attacker.
			c, in_combat := s.combat.?
			if !in_combat || s.active_player != p || len(c.attackers) == 0 do return false
		case types.Effect_Draw, types.Effect_GainLife:
			if !sorcery_timing(s, p) do return false
		}
	}
	for f in target_slots(a) {
		_, good := chosen_target(g, p, legal_targets(s, f, p)[:], a)
		if !good do return false
	}
	return true
}

// The target this player would pick, and whether it's a good one.
chosen_target :: proc(g: ^Game, p: types.PlayerId, legal: []types.TargetRef, a: ^types.AbilityDefinition) -> (types.TargetRef, bool) {
	s := &g.state
	helps := false
	damage := 0
	if a != nil && a.effect != nil {
		#partial switch e in a.effect^ {
		case types.Effect_Pump:
			// +N/+N helps its target; -N/-N is removal.
			pw, _ := e.power.(types.PtValue_Fixed)
			tg, _ := e.toughness.(types.PtValue_Fixed)
			helps = pw._0 + tg._0 >= 0
			if !helps do damage = int(-tg._0)
		case types.Effect_GenericEffect:
			helps = true
		case types.Effect_ChangeZone:
			// Getting a card back is good for its owner; exiling or bouncing a permanent is aimed at an opponent's.
			origin, _ := e.origin.?
			helps = origin == .Graveyard && (e.destination == .Hand || e.destination == .Battlefield)
		case types.Effect_DealDamage:
			damage, _ = fixed_quantity(e.amount)
		}
	}
	best: types.TargetRef
	best_score := -1
	for t in legal {
		score := -1
		switch x in t {
		case types.TargetRef_Player:
			if x._0 != p && !helps do score = 1 + (20 - int(player(s, x._0).life)) // burn to the face when nothing better
		case types.TargetRef_Object:
			o := object(s, x._0)
			mine := o.controller == p
			if helps == mine {
				score = 10 + power_of(o) + mana_value(o.mana_cost)
				// Damage only counts when it kills.
				if damage > 0 && toughness_of(o) - int(o.damage_marked) > damage do score = -1
			}
		}
		if score > best_score {
			best, best_score = t, score
		}
	}
	return best, best_score >= 0
}

best_target :: proc(g: ^Game, p: types.PlayerId, legal: []types.TargetRef) -> types.TargetRef {
	s := &g.state
	a: ^types.AbilityDefinition
	if g.pending.object != 0 do a = pending_ability(g)
	t, good := chosen_target(g, p, legal, a)
	if !good && len(legal) > 0 do return legal[0]
	return t
}

// The cards it would rather not have: the most expensive spells, or extra lands when it has plenty.
worst_cards :: proc(g: ^Game, p: types.PlayerId, n: int) -> [dynamic]types.ObjectId {
	s := &g.state
	hand := slice.clone(ids_of(player(s, p).hand), context.temp_allocator)
	slice.sort_by(hand, proc(a, b: types.ObjectId) -> bool {return a > b})
	lands := 0
	for id in hand do if is_type(object(s, id), .Land) do lands += 1
	Ranked :: struct {
		id:    types.ObjectId,
		score: int,
	}
	ranked := make([dynamic]Ranked, context.temp_allocator)
	for id in hand {
		o := object(s, id)
		score := mana_value(o.mana_cost)
		if is_type(o, .Land) do score = lands > 3 ? 4 : -10
		append(&ranked, Ranked{id, score})
	}
	slice.sort_by(ranked[:], proc(a, b: Ranked) -> bool {return a.score > b.score})
	out: [dynamic]types.ObjectId
	for r in ranked[:min(n, len(ranked))] do append(&out, r.id)
	return out
}

// Attack with every creature that can't be blocked profitably, or with everything when it's lethal.
choose_attacks :: proc(g: ^Game, p: types.PlayerId) -> [dynamic]types.Tuple2(types.ObjectId, types.AttackTarget) {
	s := &g.state
	defender := opponent(s, p)
	attackers := make([dynamic]^types.GameObject, context.temp_allocator)
	for o in permanents_of(s, p) do if can_attack(g, o) do append(&attackers, o)
	blockers := make([dynamic]^types.GameObject, context.temp_allocator)
	for o in permanents_of(s, defender) do if is_type(o, .Creature) && !o.tapped do append(&blockers, o)
	total := 0
	for a in attackers do total += power_of(a)
	all_in := len(blockers) == 0 || total >= int(player(s, defender).life) + blocking_power(blockers[:])
	out: [dynamic]types.Tuple2(types.ObjectId, types.AttackTarget)
	for a in attackers {
		if power_of(a) <= 0 do continue
		safe := true
		for b in blockers do if can_block(g, b, a) && power_of(b) >= toughness_of(a) && toughness_of(b) > power_of(a) do safe = false
		if all_in || safe || has_rule(g, a, .Must_Attack) do append(&out, types.Tuple2(types.ObjectId, types.AttackTarget){a.id, types.AttackTarget_Player{defender}})
	}
	return out
}

blocking_power :: proc(blockers: []^types.GameObject) -> int {
	n := 0
	for b in blockers do n += toughness_of(b)
	return n
}

// Block to kill an attacker without losing the blocker, or to trade with a bigger one; chump only to survive.
choose_blocks :: proc(g: ^Game, p: types.PlayerId) -> [dynamic]types.Tuple2(types.ObjectId, types.ObjectId) {
	s := &g.state
	out: [dynamic]types.Tuple2(types.ObjectId, types.ObjectId)
	combat, ok := s.combat.?
	if !ok do return out
	used := make(map[types.ObjectId]bool, context.temp_allocator)
	incoming := 0
	for a in combat.attackers do incoming += power_of(object(s, a.object_id))
	life := int(player(s, p).life)
	for a in combat.attackers {
		attacker := object(s, a.object_id)
		if has_keyword(attacker, types.Keyword_Menace) do continue
		pick: ^types.GameObject
		for b in permanents_of(s, p) {
			if used[b.id] || !can_block(g, b, attacker) do continue
			kills := power_of(b) >= toughness_of(attacker)
			survives := toughness_of(b) > power_of(attacker)
			trade := kills && mana_value(attacker.mana_cost) >= mana_value(b.mana_cost)
			chump := incoming >= life
			if (kills && survives) || trade || (chump && pick == nil) do pick = b
			if kills && survives do break
		}
		if pick != nil {
			used[pick.id] = true
			incoming -= power_of(attacker)
			append(&out, types.Tuple2(types.ObjectId, types.ObjectId){pick.id, attacker.id})
		}
	}
	return out
}

// An activated ability worth its cost: no sacrifice or life payment, and every effect a gain (a card, a creature,
// life, or damage or destruction with a good target).
ability_worth_using :: proc(g: ^Game, p: types.PlayerId, a: ^types.AbilityDefinition) -> bool {
	s := &g.state
	cost, _ := a.cost.?
	if comp, ok := cost.(types.AbilityCost_Composite); ok {
		for part in comp.costs {
			#partial switch _ in part {
			case types.AbilityCost_Sacrifice, types.AbilityCost_PayLife:
				return false
			}
		}
	}
	#partial switch _ in cost {
	case types.AbilityCost_Sacrifice, types.AbilityCost_PayLife:
		return false
	}
	for x := a; x != nil; x = x.sub_ability {
		if x.effect == nil do continue
		#partial switch _ in x.effect^ {
		case types.Effect_Draw, types.Effect_Token, types.Effect_GainLife, types.Effect_DealDamage, types.Effect_Destroy:
		case:
			return false
		}
	}
	for f in target_slots(a) {
		_, good := chosen_target(g, p, legal_targets(s, f, p)[:], a)
		if !good do return false
	}
	return true
}

// Kill the most valuable blockers it can, then (trample) hit the player, else pile the rest on the first blocker.
ai_damage_division :: proc(g: ^Game, w: types.WaitingFor_AssignCombatDamage) -> types.GameAction {
	s := &g.state
	slots := make([dynamic]types.DamageSlot, context.temp_allocator)
	append(&slots, ..w.blockers[:])
	context.user_ptr = s
	slice.sort_by(slots[:], proc(a, b: types.DamageSlot) -> bool {
		s := (^types.GameState)(context.user_ptr)
		return mana_value(object(s, a.blocker_id).mana_cost) > mana_value(object(s, b.blocker_id).mana_cost)
	})
	left := w.total_damage
	out: [dynamic]types.Tuple2(types.ObjectId, u32)
	for slot in slots {
		give := min(left, slot.lethal_minimum)
		append(&out, types.Tuple2(types.ObjectId, u32){slot.blocker_id, give})
		left -= give
	}
	all_lethal := true
	for x, i in out do if x._1 < slots[i].lethal_minimum do all_lethal = false
	trample: u32
	if w.trample != nil && all_lethal {
		trample = left
	} else if len(out) > 0 {
		out[0]._1 += left
	}
	return types.GameAction_AssignCombatDamage{mode = .Normal, assignments = out, trample_damage = trample}
}

// Keep lands while it has fewer than five, and spells it could cast within a turn or two; the rest go away.
ai_keep_on_top :: proc(g: ^Game, p: types.PlayerId, cards: []types.ObjectId) -> [dynamic]types.ObjectId {
	s := &g.state
	lands := 0
	for o in permanents_of(s, p) do if is_type(o, .Land) do lands += 1
	keep: [dynamic]types.ObjectId
	for id in cards {
		o := object(s, id)
		if is_type(o, .Land) {
			if lands < 5 do append(&keep, id)
		} else if mana_value(o.mana_cost) <= lands + 2 {
			append(&keep, id)
		}
	}
	return keep
}
