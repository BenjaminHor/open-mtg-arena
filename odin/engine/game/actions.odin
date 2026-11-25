// Players' actions: what each decision accepts, and the actions a player could take now.
package game

import "core:slice"
import rng "../rng"
import types "../types"

// The player the game waits on (the first of them, when several decide at once).
acting_player :: proc(s: ^types.GameState) -> (types.PlayerId, bool) {
	#partial switch w in s.waiting_for {
	case types.WaitingFor_Priority:
		return w.player, true
	case types.WaitingFor_MulliganDecision:
		if len(w.pending) > 0 do return w.pending[0].player, true
	case types.WaitingFor_OpeningHandBottomCards:
		if len(w.pending) > 0 do return w.pending[0].player, true
	case types.WaitingFor_DeclareAttackers:
		return w.player, true
	case types.WaitingFor_DeclareBlockers:
		return w.player, true
	case types.WaitingFor_TargetSelection:
		return w.player, true
	case types.WaitingFor_DiscardToHandSize:
		return w.player, true
	case types.WaitingFor_TriggerTargetSelection:
		return w.player, true
	case types.WaitingFor_OptionalEffectChoice:
		return w.player, true
	case types.WaitingFor_ReplacementChoice:
		return w.player, true
	case types.WaitingFor_CrewVehicle:
		return w.player, true
	case types.WaitingFor_CopyTargetChoice:
		return w.player, true
	case types.WaitingFor_AbilityModeChoice:
		return w.player, true
	case types.WaitingFor_AssignCombatDamage:
		return w.player, true
	case types.WaitingFor_ScryChoice:
		return w.player, true
	case types.WaitingFor_DiscardChoice:
		return w.player, true
	case types.WaitingFor_DigChoice:
		return w.player, true
	case types.WaitingFor_SurveilChoice:
		return w.player, true
	case types.WaitingFor_PayCost:
		return w.player, true
	case types.WaitingFor_ChooseXValue:
		return w.player, true
	case types.WaitingFor_ChooseManaColor:
		return w.player, true
	case types.WaitingFor_ModeChoice:
		return w.player, true
	case types.WaitingFor_SearchChoice:
		return w.player, true
	case types.WaitingFor_EffectZoneChoice:
		return w.player, true
	case types.WaitingFor_OptionalCostChoice:
		return w.player, true
	}
	return 0, false
}

// Applies one action from a player. False (and nothing changed) when it isn't legal now.
apply :: proc(g: ^Game, p: types.PlayerId, action: types.GameAction) -> bool {
	rejection, rejection_object = "", 0
	action_events = &g.events
	defer action_events = nil
	ok := apply_action(g, p, action)
	if ok {
		apply_continuous_effects(g)
		sync_decider(&g.state)
	}
	return ok
}

// The client reads whose decision it is from the priority player, for every decision a single player makes (the
// attacker, the defender declaring blockers, a player choosing targets or discarding), so it follows the decision.
sync_decider :: proc(s: ^types.GameState) {
	#partial switch _ in s.waiting_for {
	case types.WaitingFor_MulliganDecision, types.WaitingFor_OpeningHandBottomCards, types.WaitingFor_GameOver:
		return
	}
	if who, ok := acting_player(s); ok do s.priority_player = who
}

apply_action :: proc(g: ^Game, p: types.PlayerId, action: types.GameAction) -> bool {
	s := &g.state
	if game_over(s) do return false
	// A player's own settings (where to stop, passing preferences, the order of their hand) change no game state
	// here: the client keeps them, and the engine doesn't auto-pass for anyone.
	#partial switch a in action {
	case types.GameAction_SetPhaseStops, types.GameAction_SetAutoPass, types.GameAction_CancelAutoPass,
	     types.GameAction_SetPriorityPassingMode, types.GameAction_SetPriorityYield, types.GameAction_SetMayTriggerAutoChoice,
	     types.GameAction_SetTriggerOrderTemplate, types.GameAction_SetReplacementAutoChoice, types.GameAction_ReorderHand,
	     types.GameAction_UnAction:
		return true
	case types.GameAction_Concede:
		// CR 104.3a: a player may concede at any time; they leave the game and lose. Only for themselves.
		if a.player_id != p do return false
		player(s, a.player_id).is_eliminated = true
		other := opponent(s, a.player_id)
		s.waiting_for = types.WaitingFor_GameOver{winner = other}
		return true
	}
	// CR 103.5: the mulligan declarations are made by every player still deciding, in any order here.
	if w, deciding := &s.waiting_for.(types.WaitingFor_MulliganDecision); deciding {
		a, ok := action.(types.GameAction_MulliganDecision)
		if !ok do return false
		for e, i in w.pending do if e.player == p do return mulligan_decision(g, p, i, a.choice)
		return false
	}
	if _, bottoming := s.waiting_for.(types.WaitingFor_OpeningHandBottomCards); bottoming {
		a, ok := action.(types.GameAction_SelectCards)
		return ok && bottom_cards(g, p, a.cards[:])
	}
	if who, ok := acting_player(s); !ok || who != p do return false
	#partial switch w in s.waiting_for {
	case types.WaitingFor_Priority:
		#partial switch a in action {
		case types.GameAction_PassPriority:
			pass_priority(g, p)
			return true
		case types.GameAction_PlayLand:
			return play_land(g, p, a.object_id)
		case types.GameAction_CastSpell:
			targets := make([dynamic]types.TargetRef, context.temp_allocator)
			for t in a.targets do append(&targets, types.TargetRef_Object{t})
			return cast_spell(g, p, a.object_id, targets[:])
		case types.GameAction_ActivateAbility:
			return activate_ability(g, p, a.source_id, a.ability_index)
		case types.GameAction_CrewVehicle:
			return start_crew(g, p, a.vehicle_id)
		}
	case types.WaitingFor_CrewVehicle:
		#partial switch a in action {
		case types.GameAction_CrewVehicle:
			return answer_crew(g, p, w, a.creature_ids[:])
		case types.GameAction_CancelCast:
			// CR 602.2b: nothing was paid yet; back to priority.
			s.waiting_for = types.WaitingFor_Priority{player = p}
			return true
		}
	case types.WaitingFor_TargetSelection:
		#partial switch a in action {
		case types.GameAction_ChooseTarget:
			t, ok := a.target.?
			if !ok do return decline_target(g, p) // CR 115.6
			return choose_target(g, p, t)
		case types.GameAction_CancelCast:
			if o := object(s, g.pending.object); o != nil {
				o.cost_x_paid = nil // CR 601.2: the cast is undone
				o.additional_cost_payment_count = 0
			}
			withdraw_spell(s, g.pending.object) // CR 734: the cast is reversed
			g.pending = {}
			give_priority(g, p)
			return true
		}
	case types.WaitingFor_TriggerTargetSelection:
		a, ok := action.(types.GameAction_ChooseTarget)
		if !ok do return false
		t, has := a.target.?
		if !has do return decline_trigger_target(g, p) // CR 115.6
		return choose_trigger_target(g, p, t)
	case types.WaitingFor_OptionalEffectChoice:
		a, ok := action.(types.GameAction_DecideOptionalEffect)
		return ok && decide_optional(g, p, a.accept)
	case types.WaitingFor_DeclareAttackers:
		a, ok := action.(types.GameAction_DeclareAttackers)
		return ok && declare_attackers(g, a.attacks[:])
	case types.WaitingFor_DeclareBlockers:
		a, ok := action.(types.GameAction_DeclareBlockers)
		return ok && declare_blockers(g, a.assignments[:])
	case types.WaitingFor_AssignCombatDamage:
		a, ok := action.(types.GameAction_AssignCombatDamage)
		return ok && assign_combat_damage(g, p, a)
	case types.WaitingFor_ScryChoice:
		a, ok := action.(types.GameAction_SelectCards)
		return ok && answer_scry(g, p, w.cards[:], a.cards[:], false)
	case types.WaitingFor_DiscardChoice:
		a, ok := action.(types.GameAction_SelectCards)
		return ok && answer_discard(g, p, w, a.cards[:])
	case types.WaitingFor_DigChoice:
		a, ok := action.(types.GameAction_SelectCards)
		return ok && answer_dig(g, p, w, a.cards[:])
	case types.WaitingFor_SurveilChoice:
		a, ok := action.(types.GameAction_SelectCards)
		return ok && answer_scry(g, p, w.cards[:], a.cards[:], true)
	case types.WaitingFor_OptionalCostChoice:
		#partial switch a in action {
		case types.GameAction_DecideOptionalCost:
			return decide_kicker(g, p, a.index)
		case types.GameAction_CancelCast:
			if o := object(s, g.pending.object); o != nil do o.additional_cost_payment_count = 0
			withdraw_spell(s, g.pending.object) // CR 734: the cast is reversed
			g.pending = {}
			give_priority(g, p)
			return true
		}
	case types.WaitingFor_EffectZoneChoice:
		a, ok := action.(types.GameAction_SelectCards)
		if !ok do return false
		if w.effect_kind == .ChangeZone do return answer_hand_choice(g, p, w, a.cards[:])
		if w.effect_kind == .Bounce do return answer_bounce(g, p, w, a.cards[:])
		return answer_sacrifice(g, p, w, a.cards[:])
	case types.WaitingFor_SearchChoice:
		a, ok := action.(types.GameAction_SelectCards)
		return ok && answer_search(g, p, w, a.cards[:])
	case types.WaitingFor_ModeChoice:
		#partial switch a in action {
		case types.GameAction_SelectModes:
			return select_modes(g, p, w, a.indices[:])
		case types.GameAction_CancelCast:
			withdraw_spell(s, g.pending.object) // CR 734: the cast is reversed
			g.pending = {}
			give_priority(g, p)
			return true
		}
	case types.WaitingFor_CopyTargetChoice:
		a, ok := action.(types.GameAction_ChooseTarget)
		return ok && answer_entry_copy(g, p, w, a.target)
	case types.WaitingFor_ReplacementChoice:
		a, ok := action.(types.GameAction_ChooseReplacement)
		return ok && answer_entry_payment(g, p, w, a.index)
	case types.WaitingFor_AbilityModeChoice:
		a, ok := action.(types.GameAction_SelectModes)
		return ok && select_trigger_modes(g, p, w, a.indices[:])
	case types.WaitingFor_ChooseManaColor:
		a, ok := action.(types.GameAction_ChooseManaColor)
		return ok && choose_mana_color(g, p, w, a.choice)
	case types.WaitingFor_ChooseXValue:
		#partial switch a in action {
		case types.GameAction_ChooseX:
			return choose_x(g, p, w, a.value)
		case types.GameAction_CancelCast:
			if o := object(s, g.pending.object); o != nil do o.cost_x_paid = nil
			withdraw_spell(s, g.pending.object) // CR 734: the cast is reversed
			g.pending = {}
			give_priority(g, p)
			return true
		}
	case types.WaitingFor_PayCost:
		#partial switch a in action {
		case types.GameAction_SelectCards:
			return answer_cost_choice(g, p, w, a.cards[:])
		case types.GameAction_CancelCast:
			// CR 734.1: an activation or cast that can't be finished is reversed entirely.
			withdraw_spell(s, g.pending.object)
			if o := object(s, g.pending.object); o != nil && g.pending.ability_index < 0 {
				o.cost_x_paid = nil
				o.additional_cost_payment_count = 0
			}
			g.pending = {}
			give_priority(g, p)
			return true
		}
	case types.WaitingFor_DiscardToHandSize:
		a, ok := action.(types.GameAction_SelectCards)
		if !ok || len(a.cards) != w.count || has_duplicates(a.cards[:]) do return false
		for id in a.cards do if !slice.contains(w.cards[:], id) do return false
		for id in a.cards do move_object(g, id, .Graveyard)
		cleanup(g)
		return true
	}
	return false
}

// CR 103.5: a player keeps their hand, or takes a mulligan: shuffles their hand into their library and draws a new
// seven (the London mulligan; they put that many cards on the bottom once everyone keeps).
mulligan_decision :: proc(g: ^Game, p: types.PlayerId, index: int, choice: types.MulliganChoice) -> bool {
	s := &g.state
	w := &s.waiting_for.(types.WaitingFor_MulliganDecision)
	entry := w.pending[index]
	#partial switch _ in choice {
	case types.MulliganChoice_Keep:
		ordered_remove(&w.pending, index)
		if entry.mulligan_count > 0 do append(&g.bottoms, types.MulliganBottomEntry{player = p, count = entry.mulligan_count})
	case types.MulliganChoice_Mulligan:
		if int(entry.mulligan_count) >= STARTING_HAND_SIZE do return false
		pl := player(s, p)
		for id in ids_of(pl.hand) do move_object(g, id, .Library)
		library := ids_of(pl.library)
		rng.shuffle(&g.rng, library)
		pl.library = {}
		for id in library do types.pvec_push(&pl.library, id, copy_id)
		for _ in 0 ..< STARTING_HAND_SIZE do draw_card(s, pl)
		ordered_remove(&w.pending, index)
		entry.mulligan_count += 1
		append(&w.pending, entry) // declares again after the others
	case:
		return false
	}
	if len(w.pending) > 0 do return true
	if len(g.bottoms) > 0 {
		pending: [dynamic]types.MulliganBottomEntry
		append(&pending, ..g.bottoms[:])
		clear(&g.bottoms)
		s.waiting_for = types.WaitingFor_OpeningHandBottomCards{pending = pending}
		return true
	}
	begin_first_turn(g)
	return true
}

// CR 103.5: a player who took mulligans puts that many cards from their hand on the bottom of their library.
bottom_cards :: proc(g: ^Game, p: types.PlayerId, cards: []types.ObjectId) -> bool {
	s := &g.state
	w := &s.waiting_for.(types.WaitingFor_OpeningHandBottomCards)
	index := -1
	for e, i in w.pending do if e.player == p do index = i
	if index < 0 || len(cards) != int(w.pending[index].count) || has_duplicates(cards) do return false
	pl := player(s, p)
	hand := ids_of(pl.hand)
	for id in cards do if !slice.contains(hand, id) do return false
	for id in cards do move_object(g, id, .Library)
	// The library's top is its end, so the bottom is the front: rebuild with these first.
	rest := make([dynamic]types.ObjectId, context.temp_allocator)
	for id in ids_of(pl.library) do if !slice.contains(cards, id) do append(&rest, id)
	pl.library = {}
	for id in cards do types.pvec_push(&pl.library, id, copy_id)
	for id in rest do types.pvec_push(&pl.library, id, copy_id)
	ordered_remove(&w.pending, index)
	if len(w.pending) == 0 do begin_first_turn(g)
	return true
}

// CR 305.2, 505.6b: on their own turn, in a main phase with an empty stack, a player may play a land if they haven't
// played their land for the turn.
can_play_land :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> bool {
	s := &g.state
	mode, from_exile := exile_permission(o, p)
	if o.owner != p || !is_type(o, .Land) do return false
	if o.zone != .Hand && !(from_exile && mode == .Play) do return false // "you may play that card" (CR 305.1)
	// CR 305.2: one land a turn, plus one for each effect allowing an additional land.
	allowed := int(s.max_lands_per_turn) + player_rule_count(g, p, .Extra_Land)
	return sorcery_timing(s, p) && int(player(s, p).lands_played_this_turn) < allowed
}

// CR 305.1: playing a land puts it onto the battlefield; it doesn't use the stack.
play_land :: proc(g: ^Game, p: types.PlayerId, id: types.ObjectId) -> bool {
	s := &g.state
	o := object(s, id)
	if o == nil || !can_play_land(g, p, o) || !object_supported(o, g.card_db) do return false
	move_object(g, id, .Battlefield)
	player(s, p).lands_played_this_turn += 1
	s.lands_played_this_turn += 1
	s.priority_passes = nil
	give_priority(g, p)
	return true
}

// The actions a player could take now, for the client's buttons and highlights.
legal_actions :: proc(g: ^Game, p: types.PlayerId) -> [dynamic]types.GameAction {
	s := &g.state
	out := make([dynamic]types.GameAction, context.temp_allocator)
	if !is_deciding(s, p) do return out
	#partial switch w in s.waiting_for {
	case types.WaitingFor_MulliganDecision:
		append(&out, types.GameAction_MulliganDecision{choice = types.MulliganChoice_Keep{}})
		append(&out, types.GameAction_MulliganDecision{choice = types.MulliganChoice_Mulligan{}})
	case types.WaitingFor_Priority:
		append(&out, types.GameAction_PassPriority{})
		for id in castable_zone_ids(s, p) {
			o := object(s, id)
			if can_play_land(g, p, o) && object_supported(o, g.card_db) {
				append(&out, types.GameAction_PlayLand{object_id = id, card_id = o.card_id})
			} else if castable(s, p, o, g.card_db) {
				append(&out, types.GameAction_CastSpell{object_id = id, card_id = o.card_id})
			}
		}
		for o in permanents_of(s, p) do if can_crew(g, p, o) do append(&out, types.GameAction_CrewVehicle{vehicle_id = o.id})
		for o in permanents_of(s, p) {
			if o.abilities == nil do continue
			for &a, i in o.abilities^ {
				if can_activate(g, p, o, i) {
					append(&out, types.GameAction_ActivateAbility{source_id = o.id, ability_index = i})
				} else if option, is_mana := mana_ability_option(a); is_mana && (option.mana_cost != nil || !option.taps || option.each) && object_supported(o, g.card_db) && mana_ability_activatable(g, p, o, &a) {
					// CR 605.3a: mana abilities automatic payment doesn't use ("{1}, {T}: Add one mana of any color").
					append(&out, types.GameAction_ActivateAbility{source_id = o.id, ability_index = i})
				}
			}
		}
		// Abilities that work from the hand (cycling) or the graveyard (CR 113.6j).
		for zone in ([]types.Zone{.Hand, .Graveyard}) {
			for id in ids_of(zone_list(s, zone, p)^) {
				o := object(s, id)
				if o.abilities == nil do continue
				for _, i in o.abilities^ do if can_activate(g, p, o, i) do append(&out, types.GameAction_ActivateAbility{source_id = o.id, ability_index = i})
			}
		}
	case types.WaitingFor_TargetSelection:
		for t in w.selection.current_legal_targets do append(&out, types.GameAction_ChooseTarget{target = t})
		slot := w.selection.current_slot
		if slot < len(w.target_slots) && w.target_slots[slot].optional do append(&out, types.GameAction_ChooseTarget{}) // CR 115.6
	case types.WaitingFor_TriggerTargetSelection:
		for t in w.selection.current_legal_targets do append(&out, types.GameAction_ChooseTarget{target = t})
		slot := w.selection.current_slot
		if slot < len(w.target_slots) && w.target_slots[slot].optional do append(&out, types.GameAction_ChooseTarget{})
	case types.WaitingFor_OptionalCostChoice:
		append(&out, types.GameAction_DecideOptionalCost{index = 0}, types.GameAction_DecideOptionalCost{index = 1})
	case types.WaitingFor_ModeChoice:
		// Every allowed set of modes (CR 700.2a), in printed order, from the minimum to the maximum number.
		available := make([dynamic]int, context.temp_allocator)
		for i in 0 ..< w.modal.mode_count do if !slice.contains(w.unavailable_modes[:], i) do append(&available, i)
		mode_sets(&out, available[:], 0, make([dynamic]int, context.temp_allocator), w.modal.min_choices, w.modal.max_choices)
		append(&out, types.GameAction_CancelCast{})
	case types.WaitingFor_AbilityModeChoice:
		available := make([dynamic]int, context.temp_allocator)
		for i in 0 ..< w.modal.mode_count do if !slice.contains(w.unavailable_modes[:], i) do append(&available, i)
		mode_sets(&out, available[:], 0, make([dynamic]int, context.temp_allocator), w.modal.min_choices, w.modal.max_choices)
	case types.WaitingFor_CopyTargetChoice:
		for id in w.valid_targets do append(&out, types.GameAction_ChooseTarget{target = types.TargetRef_Object{id}})
		append(&out, types.GameAction_ChooseTarget{}) // copy nothing
	case types.WaitingFor_CrewVehicle:
		// The client picks the creatures (any set with enough power); every eligible one is a valid answer to offer.
		append(&out, types.GameAction_CrewVehicle{vehicle_id = w.vehicle_id, creature_ids = slice.clone_to_dynamic(w.eligible_creatures[:], context.temp_allocator)})
		append(&out, types.GameAction_CancelCast{})
	case types.WaitingFor_ReplacementChoice:
		land: types.ObjectId
		if len(g.entry_choices) > 0 do land = g.entry_choices[0]
		else if len(w.candidates) > 0 do land = w.candidates[0].source_id
		if o := object(s, land); o != nil && entry_payment_of_ok(o) {
			r, _ := entry_payment_of(o)
			life, _ := entry_payment(r)
			if int(player(s, p).life) >= life do append(&out, types.GameAction_ChooseReplacement{index = 0})
		}
		append(&out, types.GameAction_ChooseReplacement{index = 1})
	case types.WaitingFor_OptionalEffectChoice:
		append(&out, types.GameAction_DecideOptionalEffect{accept = true})
		append(&out, types.GameAction_DecideOptionalEffect{accept = false})
	case types.WaitingFor_DeclareAttackers:
		append(&out, types.GameAction_DeclareAttackers{})
	case types.WaitingFor_DeclareBlockers:
		append(&out, types.GameAction_DeclareBlockers{})
	}
	return out
}

// Whether the game waits on this player: the one acting, or any player still owed a simultaneous decision.
is_deciding :: proc(s: ^types.GameState, p: types.PlayerId) -> bool {
	#partial switch w in s.waiting_for {
	case types.WaitingFor_MulliganDecision:
		for e in w.pending do if e.player == p do return true
		return false
	case types.WaitingFor_OpeningHandBottomCards:
		for e in w.pending do if e.player == p do return true
		return false
	}
	who, ok := acting_player(s)
	return ok && who == p
}

has_duplicates :: proc(ids: []types.ObjectId) -> bool {
	for a, i in ids do for b in ids[i + 1:] do if a == b do return true
	return false
}

// The cards a player could cast or play: their hand, and their commanders in the command zone (CR 903.8).
castable_zone_ids :: proc(s: ^types.GameState, p: types.PlayerId) -> [dynamic]types.ObjectId {
	out := make([dynamic]types.ObjectId, context.temp_allocator)
	append(&out, ..ids_of(player(s, p).hand))
	for id in ids_of(s.command_zone) do if object(s, id).owner == p do append(&out, id)
	for id in ids_of(player(s, p).graveyard) do if flashback_castable(object(s, id), p) do append(&out, id) // CR 702.34a
	for id in ids_of(s.exile) do if _, ok := exile_permission(object(s, id), p); ok do append(&out, id)
	return out
}

@(private = "file")
mode_sets :: proc(out: ^[dynamic]types.GameAction, available: []int, from: int, chosen: [dynamic]int, least, most: int) {
	if len(chosen) >= least {
		set: [dynamic]int
		append(&set, ..chosen[:])
		append(out, types.GameAction_SelectModes{indices = set})
	}
	if len(chosen) == most do return
	for i in from ..< len(available) {
		next := make([dynamic]int, context.temp_allocator)
		append(&next, ..chosen[:])
		append(&next, available[i])
		mode_sets(out, available, i + 1, next, least, most)
	}
}
