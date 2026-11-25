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
	case types.WaitingFor_EffectZoneChoice:
		if w.effect_kind == .ChangeZone {
			// Cards to move from its hand or graveyard: the first offered, as few as it must and at least one.
			n := min(max(w.min_count, 1), w.count, len(w.cards))
			some := make([dynamic]types.ObjectId, context.temp_allocator)
			append(&some, ..w.cards[:n])
			return types.GameAction_SelectCards{cards = some}, true
		}
		if w.effect_kind == .Attach {
			// Which Equipment to attach ("attach an Equipment you control to it"): the first offered.
			one := make([dynamic]types.ObjectId, context.temp_allocator)
			append(&one, w.cards[0])
			return types.GameAction_SelectCards{cards = one}, true
		}
		// What to sacrifice: the least valuable.
		return types.GameAction_SelectCards{cards = least_valuable(g, w.cards[:], w.count)}, true
	case types.WaitingFor_SearchChoice:
		// As many as allowed, the first ones found.
		cards := slice.clone(w.cards[:], context.temp_allocator)
		slice.sort_by(cards, proc(a, b: types.ObjectId) -> bool {return a < b})
		out := make([dynamic]types.ObjectId, context.temp_allocator)
		append(&out, ..cards[:min(w.count, len(cards))])
		return types.GameAction_SelectCards{cards = out}, true
	case types.WaitingFor_OptionalCostChoice:
		if choice, is_choice := w.cost.(types.AdditionalCost_Choice); is_choice {
			// The first cost it can pay.
			if o := object(&g.state, g.pending.object); o != nil do for _, i in choice._0 do if option_payable(&g.state, p, o, i) do return types.GameAction_DecideOptionalCost{index = i}, true
			return types.GameAction_CancelCast{}, true
		}
		// Kicked, since it can afford it; an optional cost that takes a permanent or weakens a creature, not.
		if cost, other := object_optional_cost(object(s, g.pending.object)); other {
			#partial switch _ in cost {
			case types.AbilityCost_Sacrifice, types.AbilityCost_Blight, types.AbilityCost_TapCreatures:
				return types.GameAction_DecideOptionalCost{index = 1}, true
			}
		}
		return types.GameAction_DecideOptionalCost{index = 0}, true
	case types.WaitingFor_ModeChoice:
		modes, _ := ai_modes(g, p, object(s, g.pending.object))
		return types.GameAction_SelectModes{indices = modes}, true
	case types.WaitingFor_ChooseXValue:
		return types.GameAction_ChooseX{value = w.max}, true // as much as it can pay
	case types.WaitingFor_ChooseManaColor:
		// The color its hand asks for most.
		if prompt, single := w.choice.(types.ManaChoicePrompt_SingleColor); single && len(prompt.options) > 0 {
			return types.GameAction_ChooseManaColor{choice = types.ManaChoice_SingleColor{ai_mana_color(g, p, prompt.options[:])}, count = 1}, true
		}
	case types.WaitingFor_BlightChoice:
		// The -1/-1 counters on a creature that survives them, the least valuable; else the least valuable.
		survivors := make([dynamic]types.ObjectId, context.temp_allocator)
		for id in w.creatures do if toughness_of(object(s, id)) > int(w.counters) do append(&survivors, id)
		from := survivors[:] if len(survivors) > 0 else w.creatures[:]
		return types.GameAction_SelectCards{cards = least_valuable(g, from, 1)}, true
	case types.WaitingFor_CostTypeChoice:
		// The counter it's best rid of: a -1/-1 or stun counter first; a +1/+1, shield or loyalty counter last.
		kinds, is_counters := w.choice_type.(types.ChoiceType_CounterKind)
		if !is_counters || len(w.options) == 0 do return types.GameAction_CancelCast{}, true
		best, best_rank := 0, max(int)
		for k, i in kinds.options {
			rank := 1
			#partial switch _ in k {
			case types.CounterType_Minus1Minus1, types.CounterType_Stun:
				rank = 0
			case types.CounterType_Plus1Plus1, types.CounterType_Shield, types.CounterType_Loyalty:
				rank = 2
			}
			if rank < best_rank && i < len(w.options) do best, best_rank = i, rank
		}
		return types.GameAction_ChooseOption{choice = w.options[best]}, true
	case types.WaitingFor_CollectEvidenceChoice:
		// The fewest cards: the highest mana values first, until the total is enough.
		Valued :: struct {
			id: types.ObjectId,
			mv: int,
		}
		cards := make([dynamic]Valued, context.temp_allocator)
		for id in w.cards do append(&cards, Valued{id, object_mana_value(object(s, id))})
		slice.sort_by(cards[:], proc(a, b: Valued) -> bool {return a.mv > b.mv || (a.mv == b.mv && a.id < b.id)})
		out := make([dynamic]types.ObjectId, context.temp_allocator)
		total := 0
		for c in cards {
			if total >= int(w.minimum_mana_value) do break
			append(&out, c.id)
			total += c.mv
		}
		return types.GameAction_SelectCards{cards = out}, true
	case types.WaitingFor_PayCost:
		if removal, removes := w.kind.(types.PayCostKind_RemoveCounter); removes && removal.selection == .AmongObjects {
			return types.GameAction_ChooseRemoveCounterCostDistribution{distribution = ai_counter_distribution(g, w, removal)}, true
		}
		// The least valuable: tokens first, then the lowest mana value. For a tap cost, permanents that make no
		// mana first, so the mana can still be paid (as additional_cost_payable checked).
		Ranked :: struct {
			id:    types.ObjectId,
			score: int,
		}
		_, taps := w.kind.(types.PayCostKind_TapCreatures)
		ranked := make([dynamic]Ranked, context.temp_allocator)
		for id in w.choices {
			o := object(s, id)
			score := -1 if o.is_token else mana_value(o.mana_cost)
			if taps && makes_mana(s, id) do score += 1000
			append(&ranked, Ranked{id, score})
		}
		slice.sort_by(ranked[:], proc(a, b: Ranked) -> bool {return a.score < b.score || (a.score == b.score && a.id < b.id)})
		out := make([dynamic]types.ObjectId, context.temp_allocator)
		for r in ranked[:min(w.count, len(ranked))] do append(&out, r.id)
		return types.GameAction_SelectCards{cards = out}, true
	case types.WaitingFor_TargetSelection:
		slot := w.selection.current_slot
		legal := affordable_targets(g, p, w.selection.current_legal_targets[:], slot + 1 == len(w.target_slots))
		if slot < len(w.target_slots) && w.target_slots[slot].optional {
			// "Up to two": another target only if it's a good one.
			t, good := chosen_target(g, p, legal, pending_ability(g))
			return types.GameAction_ChooseTarget{target = t if good else nil}, true
		}
		return types.GameAction_ChooseTarget{target = best_target(g, p, legal)}, true
	case types.WaitingFor_TriggerTargetSelection:
		a: ^types.AbilityDefinition
		if g.trigger_targets.definition != nil do a = g.trigger_targets.definition.execute
		t, good := chosen_target(g, p, w.selection.current_legal_targets[:], a)
		slot := w.selection.current_slot
		if !good && slot < len(w.target_slots) && w.target_slots[slot].optional do return types.GameAction_ChooseTarget{target = nil}, true
		if !good do t = w.selection.current_legal_targets[0]
		return types.GameAction_ChooseTarget{target = t}, true
	case types.WaitingFor_OptionalEffectChoice:
		return types.GameAction_DecideOptionalEffect{accept = true}, true
	case types.WaitingFor_DistributeAmong:
		return types.GameAction_DistributeAmong{distribution = ai_division(w)}, true
	case types.WaitingFor_ModalFaceChoice:
		// The front face: a modal double-faced card's main face (its back is often a land).
		return types.GameAction_ChooseModalFace{back_face = false}, true
	case types.WaitingFor_CastOffer:
		// The Adventure first: the creature can be cast from exile afterwards (CR 716.3d).
		return types.GameAction_ChooseAdventureFace{creature = false}, true
	case types.WaitingFor_UnlessPayment:
		return types.GameAction_PayUnlessCost{pay = true}, true // keep its spell (it's asked only when it can pay)
	case types.WaitingFor_AbilityModeChoice:
		// The first modes it can choose, as few as allowed.
		chosen := make([dynamic]int, context.temp_allocator)
		for i in 0 ..< w.modal.mode_count do if len(chosen) < w.modal.min_choices && !slice.contains(w.unavailable_modes[:], i) do append(&chosen, i)
		return types.GameAction_SelectModes{indices = chosen}, true
	case types.WaitingFor_ReturnAsAuraTarget:
		// What the returning Aura enchants: one of its own player's permanents if it can, else the first offered.
		for t in w.legal_targets do if id, ok := target_object(t); ok && object(s, id).controller == p do return types.GameAction_ChooseTarget{target = t}, true
		return types.GameAction_ChooseTarget{target = w.legal_targets[0]}, true
	case types.WaitingFor_CopyTargetChoice:
		// The biggest creature to copy.
		best: types.ObjectId
		for id in w.valid_targets do if best == 0 || power_of(object(s, id)) > power_of(object(s, best)) do best = id
		return types.GameAction_ChooseTarget{target = types.TargetRef_Object{best}}, true
	case types.WaitingFor_CrewVehicle:
		// The fewest creatures, weakest first, that add up to the crew power.
		ids := slice.clone(w.eligible_creatures[:], context.temp_allocator)
		slice.sort_by(ids, proc(a, b: types.ObjectId) -> bool {return a < b})
		chosen := make([dynamic]types.ObjectId, context.temp_allocator)
		total := 0
		for id in ids {
			if total >= int(w.crew_power) do break
			append(&chosen, id)
			total += max(crew_value(object(s, id)), 0) // as answer_crew counts it (crew.odin)
		}
		return types.GameAction_CrewVehicle{vehicle_id = w.vehicle_id, creature_ids = chosen}, true
	case types.WaitingFor_RevealChoice:
		// Reveal: the land enters untapped and the card stays in hand.
		one := make([dynamic]types.ObjectId)
		append(&one, w.cards[0])
		return types.GameAction_SelectCards{cards = one}, true
	case types.WaitingFor_ProliferateChoice:
		return types.GameAction_SelectTargets{targets = ai_proliferate(g, p, w)}, true
	case types.WaitingFor_NamedChoice:
		return types.GameAction_ChooseOption{choice = ai_entry_name(g, p, w)}, true
	case types.WaitingFor_ReplacementChoice:
		if len(w.candidates) > 0 {
			if r, ok := asked_entry_option(g, w.candidates[0].source_id); ok {
				// A shockland: pay the life while there's plenty of it, else let it enter tapped.
				if _, may_pay := entry_payment(r); may_pay do return types.GameAction_ChooseReplacement{index = 0 if player(s, p).life > 10 else 1}, true
			}
		}
		// Riot: the lasting +1/+1 counter.
		return types.GameAction_ChooseReplacement{index = 0}, true
	case types.WaitingFor_ChooseOneOfBranch:
		return types.GameAction_ChooseBranch{index = 0}, true
	case types.WaitingFor_ScryChoice:
		return types.GameAction_SelectCards{cards = ai_keep_on_top(g, p, w.cards[:])}, true
	case types.WaitingFor_DiscardChoice:
		return types.GameAction_SelectCards{cards = worst_cards(g, p, w.count)}, true
	case types.WaitingFor_DigChoice:
		// Take the most expensive castable-soon cards it may.
		picks: [dynamic]types.ObjectId
		for id in w.selectable_cards do if len(picks) < w.keep_count do append(&picks, id)
		return types.GameAction_SelectCards{cards = picks}, true
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
	if best != nil {
		if src, is_copy := best.prepared_copy_source.?; is_copy do return types.GameAction_CastPreparedCopy{source = src}
		return types.GameAction_CastSpell{object_id = best.id, card_id = best.card_id}
	}
	// Before combat, equip an unattached Equipment to its best creature.
	if s.active_player == p && s.phase == .PreCombatMain && types.pvec_len(s.stack) == 0 {
		for o in permanents_of(s, p) {
			if !has_subtype(o, "Equipment") || host_of(s, o) != nil || o.abilities == nil do continue
			for &a, i in o.abilities^ {
				if a.effect == nil do continue
				if _, attaches := a.effect^.(types.Effect_Attach); attaches && can_activate(g, p, o, i) {
					return types.GameAction_ActivateAbility{source_id = o.id, ability_index = i}
				}
			}
		}
	}
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
	if is_aura(o) {
		f, _ := enchant_filter(o)
		mine := aura_helps(o)
		for t in legal_targets(s, f, p, o.id) {
			if id, is_object := t.(types.TargetRef_Object); is_object && (object(s, id._0).controller == p) == mine do return sorcery_timing(s, p)
		}
		return false
	}
	if has_x(o.mana_cost) && max_x(s, p, o) == 0 do return false // an X spell for X = 0 does little
	if is_modal(o) {
		_, good := ai_modes(g, p, o)
		return good && sorcery_timing(s, p)
	}
	if is_permanent_card(o) do return sorcery_timing(s, p)
	a := spell_ability(o)
	if a == nil do return false
	for x := a; x != nil; x = x.sub_ability {
		if x.effect == nil do continue
		#partial switch e in x.effect^ {
		case types.Effect_GenericEffect:
			if !generic_helps(e) {
				// "Target creature can't block this turn": before its own attack.
				if s.active_player != p || s.phase != .PreCombatMain || types.pvec_len(s.stack) != 0 do return false
				continue
			}
			c, in_combat := s.combat.?
			if !in_combat || s.active_player != p || len(c.attackers) == 0 do return false
		case types.Effect_Pump:
			// A pump spell during its own combat, on an attacker.
			c, in_combat := s.combat.?
			if !in_combat || s.active_player != p || len(c.attackers) == 0 do return false
		case types.Effect_Draw, types.Effect_GainLife:
			if !sorcery_timing(s, p) do return false
		}
	}
	for slot in slot_list(a) {
		if slot.optional do continue
		_, good := chosen_target(g, p, legal_targets(s, slot.filter, p)[:], a)
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
			helps = generic_helps(e)
		case types.Effect_Attach:
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

// For the last target of a spell whose cost depends on its targets ("costs {3} less if it targets a tapped
// creature"), the targets it can still pay for (CR 601.2f); a choice it can't pay for would only reverse the cast.
affordable_targets :: proc(g: ^Game, p: types.PlayerId, legal: []types.TargetRef, last: bool) -> []types.TargetRef {
	o := object(&g.state, g.pending.object)
	if !last || o == nil || g.pending.ability_index >= 0 do return legal
	out := make([dynamic]types.TargetRef, context.temp_allocator)
	for t in legal {
		chosen := make([dynamic]types.TargetRef, context.temp_allocator)
		append(&chosen, ..g.pending.targets[:])
		append(&chosen, t)
		if spell_payable_with_targets(g, p, o, chosen[:]) do append(&out, t)
	}
	return out[:] if len(out) > 0 else legal
}

best_target :: proc(g: ^Game, p: types.PlayerId, legal: []types.TargetRef) -> types.TargetRef {
	s := &g.state
	a: ^types.AbilityDefinition
	if g.pending.object != 0 do a = pending_ability(g)
	if o := object(s, g.pending.object); o != nil && g.pending.ability_index < 0 && is_aura(o) {
		return aura_target(g, p, o, legal)
	}
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

// An activated ability worth its cost: no sacrifice, life payment or exiling of a permanent, and every effect a gain
// (a card, a creature, life, or damage or destruction with a good target).
ability_worth_using :: proc(g: ^Game, p: types.PlayerId, a: ^types.AbilityDefinition) -> bool {
	s := &g.state
	cost, _ := a.cost.?
	parts: []types.AbilityCost = {cost}
	if comp, ok := cost.(types.AbilityCost_Composite); ok do parts = comp.costs[:]
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Sacrifice, types.AbilityCost_PayLife:
			return false
		case types.AbilityCost_Exile:
			if x.zone == nil do return false // "exile this creature", "exile a creature you control"
		}
	}
	for x := a; x != nil; x = x.sub_ability {
		if x.effect == nil do continue
		#partial switch _ in x.effect^ {
		case types.Effect_Draw, types.Effect_Token, types.Effect_GainLife, types.Effect_DealDamage, types.Effect_Destroy:
		case:
			return false
		}
	}
	for slot in slot_list(a) {
		if slot.optional do continue
		_, good := chosen_target(g, p, legal_targets(s, slot.filter, p)[:], a)
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

// An Aura that adds power, toughness or keywords goes on its controller's best creature; one that restricts
// ("can't attack or block") or shrinks goes on the opponent's best.
aura_helps :: proc(o: ^types.GameObject) -> bool {
	if o.static_definitions == nil do return true
	for st in o.static_definitions^ {
		if rule_modes(st.mode) != {} do return false
		for m in st.modifications {
			#partial switch k in m {
			case types.ContinuousModification_AddPower:
				if k.value < 0 do return false
			case types.ContinuousModification_AddToughness:
				if k.value < 0 do return false
			}
		}
	}
	return true
}

aura_target :: proc(g: ^Game, p: types.PlayerId, aura: ^types.GameObject, legal: []types.TargetRef) -> types.TargetRef {
	s := &g.state
	mine := aura_helps(aura)
	best: types.TargetRef = legal[0]
	best_score := -1
	for t in legal {
		o, is_object := t.(types.TargetRef_Object)
		if !is_object do continue
		target := object(s, o._0)
		if (target.controller == p) != mine do continue
		score := power_of(target) + mana_value(target.mana_cost)
		if score > best_score do best, best_score = t, score
	}
	return best
}

// Whether an effect granting abilities or rules is meant for the player's own creatures: "can't be blocked" and
// "+2/+2 and flying" are; "can't block", "doesn't untap" and "-2/-0" are aimed at an opponent's.
generic_helps :: proc(e: types.Effect_GenericEffect) -> bool {
	for st in e.static_abilities {
		if rule_modes(st.mode) & {.Cant_Block, .Cant_Attack, .Cant_Untap, .Must_Attack} != {} do return false
		for m in st.modifications {
			#partial switch x in m {
			case types.ContinuousModification_AddPower:
				if x.value < 0 do return false
			case types.ContinuousModification_AddToughness:
				if x.value < 0 do return false
			case types.ContinuousModification_AddStaticMode:
				if rule_modes(x.mode) & {.Cant_Block, .Cant_Attack, .Cant_Untap, .Must_Attack} != {} do return false
			}
		}
	}
	return true
}

// The modes to choose, among the choices it may make and pay for: as many as it can of the modes whose required
// targets are good ones (or that need none and draw, make tokens or gain life), and as few others as it must.
// Good when every mode chosen is one of those.
ai_modes :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> (modes: [dynamic]int, good: bool) {
	s := &g.state
	unavailable := unavailable_modes(s, p, o)
	// Which modes do some good: each target slot has a good target, or it draws, makes tokens or gains life.
	helps := make([]bool, len(mode_abilities(o)), context.temp_allocator)
	for a, i in mode_abilities(o) {
		if slice.contains(unavailable[:], i) do continue
		ok := true
		targets := 0
		for slot in slot_list(a) do if !slot.optional {
			targets += 1
			if _, good := chosen_target(g, p, legal_targets(s, slot.filter, p, o.id)[:], a); !good do ok = false
		}
		if targets == 0 && a.effect != nil {
			#partial switch _ in a.effect^ {
			case types.Effect_Draw, types.Effect_Token, types.Effect_GainLife:
			case:
				ok = false
			}
		}
		helps[i] = ok
	}
	// Among the choices it may make and pay for (entwined, more spree modes, a mode again): the fewest modes that do
	// no good, then the most that do.
	best: []int
	best_useless, best_useful := max(int), -1
	for set in allowed_mode_sets(s, p, o, unavailable[:]) {
		useless, useful := 0, 0
		for i in set {
			if helps[i] do useful += 1
			else do useless += 1
		}
		if useless < best_useless || (useless == best_useless && useful > best_useful) do best, best_useless, best_useful = set, useless, useful
	}
	modes = make([dynamic]int)
	append(&modes, ..best)
	return modes, best != nil && best_useless == 0
}

// Tokens first, then the lowest mana value.
least_valuable :: proc(g: ^Game, cards: []types.ObjectId, n: int) -> [dynamic]types.ObjectId {
	s := &g.state
	Ranked :: struct {
		id:    types.ObjectId,
		score: int,
	}
	ranked := make([dynamic]Ranked, context.temp_allocator)
	for id in cards {
		o := object(s, id)
		append(&ranked, Ranked{id, -1 if o.is_token else object_mana_value(o)})
	}
	slice.sort_by(ranked[:], proc(a, b: Ranked) -> bool {return a.score < b.score || (a.score == b.score && a.id < b.id)})
	out := make([dynamic]types.ObjectId, context.temp_allocator)
	for r in ranked[:min(n, len(ranked))] do append(&out, r.id)
	return out
}

// The color the cards in its hand ask for most, among those offered.
ai_mana_color :: proc(g: ^Game, p: types.PlayerId, options: []types.ManaType) -> types.ManaType {
	s := &g.state
	best, best_n := options[0], -1
	for c in options {
		n := 0
		for id in ids_of(player(s, p).hand) do for col in object(s, id).color do if types.ManaType(col) == c do n += 1
		if n > best_n do best, best_n = c, n
	}
	return best
}

// "Remove three counters from among creatures you control": the counters it's best rid of first (-1/-1 and stun
// counters), +1/+1, shield and loyalty counters last, from the permanents in the order offered.
@(private = "file")
ai_counter_distribution :: proc(g: ^Game, w: types.WaitingFor_PayCost, removal: types.PayCostKind_RemoveCounter) -> [dynamic]types.CounterCostChoice {
	out: [dynamic]types.CounterCostChoice
	left := int(removal.count)
	rank :: proc(k: types.CounterType) -> int {
		#partial switch _ in k {
		case types.CounterType_Minus1Minus1, types.CounterType_Stun:
			return 0
		case types.CounterType_Plus1Plus1, types.CounterType_Shield, types.CounterType_Loyalty:
			return 2
		}
		return 1
	}
	for pass in 0 ..= 2 {
		for id in w.choices {
			if left == 0 do return out
			o := object(&g.state, id)
			for k in counter_kinds_left(o, nil) {
				if left == 0 || rank(k.kind) != pass do continue
				if named, of_type := removal.counter_type.(types.CounterMatch_OfType); of_type && !same_counter(named._0, k.kind) do continue
				n := min(k.n, left)
				append(&out, types.CounterCostChoice{object_id = id, counter_type = k.kind, count = u32(n)})
				left -= n
			}
		}
	}
	return out
}
