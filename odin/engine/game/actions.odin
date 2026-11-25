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
	case types.WaitingFor_UnlessPayment:
		return w.player, true
	case types.WaitingFor_CastOffer:
		return w.player, true
	case types.WaitingFor_ModalFaceChoice:
		return w.player, true
	case types.WaitingFor_DistributeAmong:
		return w.player, true
	case types.WaitingFor_ReplacementChoice:
		return w.player, true
	case types.WaitingFor_ChooseOneOfBranch:
		return w.player, true
	case types.WaitingFor_NamedChoice:
		return w.player, true
	case types.WaitingFor_RevealChoice:
		return w.player, true
	case types.WaitingFor_CrewVehicle:
		return w.player, true
	case types.WaitingFor_ReturnAsAuraTarget:
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
	case types.WaitingFor_DigBottomOrder:
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
	case types.WaitingFor_SearchPartitionChoice:
		return w.player, true
	case types.WaitingFor_EffectZoneChoice:
		return w.player, true
	case types.WaitingFor_ChooseFromZoneChoice:
		return w.player, true
	case types.WaitingFor_ProliferateChoice:
		return w.player, true
	case types.WaitingFor_OptionalCostChoice:
		return w.player, true
	case types.WaitingFor_BlightChoice:
		return w.player, true
	case types.WaitingFor_CollectEvidenceChoice:
		return w.player, true
	case types.WaitingFor_CostTypeChoice:
		return w.player, true
	}
	return 0, false
}

// Applies one action from a player. False (and nothing changed) when it isn't legal now.
apply :: proc(g: ^Game, p: types.PlayerId, action: types.GameAction) -> bool {
	rejection, rejection_object = "", 0
	action_events = &g.events
	defer action_events = nil
	begin_report(g)
	was_over := game_over(&g.state)
	ok := apply_action(g, p, action)
	if ok {
		run_auto_pass(g) // the standing passes of whoever now has priority
		apply_continuous_effects(g)
		sync_decider(&g.state)
		if w, over := g.state.waiting_for.(types.WaitingFor_GameOver); over && !was_over do report(types.GameEvent_GameOver{winner = w.winner})
	} else if reporting != nil {
		// A refused action changed nothing, so nothing happened to tell.
		clear(&reporting.events)
		clear(&reporting.log)
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
	// A player's own settings. Standing passes and where to stop are kept in the state, and the engine passes for
	// the player (auto_pass.odin); the others (passing preferences, the order of their hand) the client keeps.
	#partial switch a in action {
	case types.GameAction_SetAutoPass:
		return set_auto_pass(g, p, a.mode)
	case types.GameAction_CancelAutoPass:
		delete_key(&s.auto_pass, p)
		return true
	case types.GameAction_SetPhaseStops:
		if old, had := s.phase_stops[p]; had do delete(old)
		stops := make([dynamic]types.PhaseStop)
		append(&stops, ..a.stops[:])
		s.phase_stops[p] = stops
		return true
	case types.GameAction_SetPriorityPassingMode, types.GameAction_SetPriorityYield, types.GameAction_SetMayTriggerAutoChoice,
	     types.GameAction_SetTriggerOrderTemplate, types.GameAction_SetReplacementAutoChoice, types.GameAction_ReorderHand,
	     types.GameAction_UnAction:
		return true
	case types.GameAction_Concede:
		// CR 104.3a: a player may concede at any time; they leave the game and lose. Only for themselves.
		if a.player_id != p do return false
		player(s, a.player_id).is_eliminated = true
		report(types.GameEvent_PlayerLost{player_id = a.player_id})
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
		case types.GameAction_CastPreparedCopy:
			c := prepared_copy_of(s, a.source) // CR 723.3c
			return c != nil && cast_spell(g, p, c.id, nil)
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
			if g.pending.ability_index < 0 do forget_cast_choices(object(s, g.pending.object)) // CR 601.2: the cast is undone
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
	case types.WaitingFor_UnlessPayment:
		a, ok := action.(types.GameAction_PayUnlessCost)
		return ok && answer_unless_payment(g, p, w, a.pay)
	case types.WaitingFor_DistributeAmong:
		a, ok := action.(types.GameAction_DistributeAmong)
		return ok && answer_division(g, p, w, a.distribution[:])
	case types.WaitingFor_CastOffer:
		a, ok := action.(types.GameAction_ChooseAdventureFace)
		return ok && answer_adventure_offer(g, p, w, a.creature)
	case types.WaitingFor_ModalFaceChoice:
		#partial switch a in action {
		case types.GameAction_ChooseModalFace:
			return answer_modal_face(g, p, w, a.back_face)
		case types.GameAction_CancelCast:
			g.state.waiting_for = types.WaitingFor_Priority{player = p}
			return true
		}
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
	case types.WaitingFor_DigBottomOrder:
		a, ok := action.(types.GameAction_SelectCards)
		return ok && answer_dig_bottom_order(g, p, w, a.cards[:])
	case types.WaitingFor_SurveilChoice:
		a, ok := action.(types.GameAction_SelectCards)
		return ok && answer_scry(g, p, w.cards[:], a.cards[:], true)
	case types.WaitingFor_OptionalCostChoice:
		#partial switch a in action {
		case types.GameAction_DecideOptionalCost:
			if _, is_choice := w.cost.(types.AdditionalCost_Choice); is_choice do return decide_additional_choice(g, p, a.index)
			return decide_kicker(g, p, a.index)
		case types.GameAction_CancelCast:
			forget_cast_choices(object(s, g.pending.object))
			withdraw_spell(s, g.pending.object) // CR 734: the cast is reversed
			g.pending = {}
			give_priority(g, p)
			return true
		}
	case types.WaitingFor_ProliferateChoice:
		a, ok := action.(types.GameAction_SelectTargets)
		return ok && answer_proliferate(g, p, w, a.targets[:])
	case types.WaitingFor_EffectZoneChoice:
		a, ok := action.(types.GameAction_SelectCards)
		if !ok do return false
		if w.effect_kind == .ChangeZone do return answer_zone_choice(g, p, w, a.cards[:])
		if w.effect_kind == .Bounce do return answer_bounce(g, p, w, a.cards[:])
		if w.effect_kind == .Attach do return answer_attach(g, p, w, a.cards[:])
		if w.effect_kind == .Amass do return answer_amass(g, p, w, a.cards[:])
		if w.effect_kind == .Tap || w.effect_kind == .Untap do return p == w.player && answer_resolution_choice(g, p, w.cards[:], w.min_count, w.count, a.cards[:])
		return answer_sacrifice(g, p, w, a.cards[:])
	case types.WaitingFor_ChooseFromZoneChoice:
		// A permanent chosen as an instruction resolves (resolution_choice.odin).
		a, ok := action.(types.GameAction_SelectCards)
		least := 0 if w.up_to else w.count
		return ok && p == w.player && answer_resolution_choice(g, p, w.cards[:], least, w.count, a.cards[:])
	case types.WaitingFor_SearchChoice:
		a, ok := action.(types.GameAction_SelectCards)
		return ok && answer_search(g, p, w, a.cards[:])
	case types.WaitingFor_SearchPartitionChoice:
		a, ok := action.(types.GameAction_SelectCards)
		return ok && answer_search_partition(g, p, w, a.cards[:])
	case types.WaitingFor_ModeChoice:
		#partial switch a in action {
		case types.GameAction_SelectModes:
			return select_modes(g, p, w, a.indices[:])
		case types.GameAction_CancelCast:
			forget_cast_choices(object(s, g.pending.object))
			withdraw_spell(s, g.pending.object) // CR 734: the cast is reversed
			g.pending = {}
			give_priority(g, p)
			return true
		}
	case types.WaitingFor_CopyTargetChoice:
		a, ok := action.(types.GameAction_ChooseTarget)
		return ok && answer_entry_copy(g, p, w, a.target)
	case types.WaitingFor_ReturnAsAuraTarget:
		a, ok := action.(types.GameAction_ChooseTarget)
		return ok && answer_aura_host(g, p, w, a.target) // zone_effects.odin
	case types.WaitingFor_ReplacementChoice:
		a, ok := action.(types.GameAction_ChooseReplacement)
		return ok && answer_entry_payment(g, p, w, a.index)
	case types.WaitingFor_ChooseOneOfBranch:
		a, ok := action.(types.GameAction_ChooseBranch)
		return ok && answer_entry_branch(g, p, w, a.index)
	case types.WaitingFor_NamedChoice:
		a, ok := action.(types.GameAction_ChooseOption)
		return ok && answer_entry_name(g, p, w, a.choice)
	case types.WaitingFor_RevealChoice:
		a, ok := action.(types.GameAction_SelectCards)
		return ok && answer_entry_reveal(g, p, w, a.cards[:])
	case types.WaitingFor_AbilityModeChoice:
		a, ok := action.(types.GameAction_SelectModes)
		return ok && select_trigger_modes(g, p, w, a.indices[:])
	case types.WaitingFor_ChooseManaColor:
		a, ok := action.(types.GameAction_ChooseManaColor)
		if _, resolving := w.context_.(types.ManaChoiceContext_ResolvingEffect); resolving do return ok && answer_mana_color(g, p, w, a.choice)
		return ok && choose_mana_color(g, p, w, a.choice)
	case types.WaitingFor_ChooseXValue:
		#partial switch a in action {
		case types.GameAction_ChooseX:
			return choose_x(g, p, w, a.value)
		case types.GameAction_CancelCast:
			forget_cast_choices(object(s, g.pending.object))
			withdraw_spell(s, g.pending.object) // CR 734: the cast is reversed
			g.pending = {}
			give_priority(g, p)
			return true
		}
	case types.WaitingFor_BlightChoice, types.WaitingFor_CollectEvidenceChoice:
		// A spell's blight or collect-evidence cost (CR 701.68a, 701.59a).
		#partial switch a in action {
		case types.GameAction_SelectCards:
			if blight, is_blight := w.(types.WaitingFor_BlightChoice); is_blight do return answer_blight_choice(g, p, blight, a.cards[:])
			return answer_evidence_choice(g, p, w.(types.WaitingFor_CollectEvidenceChoice), a.cards[:])
		case types.GameAction_CancelCast:
			// CR 734: the cast or activation is reversed (an activated ability's source keeps what it was cast with).
			if g.pending.ability_index < 0 do forget_cast_choices(object(s, g.pending.object))
			withdraw_spell(s, g.pending.object)
			g.pending = {}
			give_priority(g, p)
			return true
		}
	case types.WaitingFor_CostTypeChoice:
		// "Remove a counter from this creature": the kind of counter (activated.odin, ask_counter_kind).
		#partial switch a in action {
		case types.GameAction_ChooseOption:
			return answer_counter_kind(g, p, w, a.choice)
		case types.GameAction_CancelCast:
			g.pending = {} // CR 734.1: the activation is reversed; nothing was paid yet
			give_priority(g, p)
			return true
		}
	case types.WaitingFor_PayCost:
		#partial switch a in action {
		case types.GameAction_SelectCards:
			return answer_cost_choice(g, p, w, a.cards[:])
		case types.GameAction_ChooseRemoveCounterCostDistribution:
			return answer_counter_distribution(g, p, w, a.distribution[:])
		case types.GameAction_CancelCast:
			// CR 734.1: an activation or cast that can't be finished is reversed entirely.
			withdraw_spell(s, g.pending.object)
			if g.pending.ability_index < 0 do forget_cast_choices(object(s, g.pending.object))
			g.pending = {}
			give_priority(g, p)
			return true
		}
	case types.WaitingFor_DiscardToHandSize:
		a, ok := action.(types.GameAction_SelectCards)
		if !ok || len(a.cards) != w.count || has_duplicates(a.cards[:]) do return false
		for id in a.cards do if !slice.contains(w.cards[:], id) do return false
		together := begin_together() // CR 514.1: discarded at the same time
		for id in a.cards do discard_card(g, id)
		end_together(together)
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
play_land :: proc(g: ^Game, p: types.PlayerId, id: types.ObjectId, face_decided := false) -> bool {
	s := &g.state
	o := object(s, id)
	if o != nil && !face_decided {
		// CR 712.9: a modal double-faced card's land face (mdfc.odin).
		if handled, ok := offer_modal_face(g, p, o); handled do return ok
	}
	if o == nil || !can_play_land(g, p, o) || !object_supported(o, g.card_db) do return false
	report(types.GameEvent_LandPlayed{object_id = id, player_id = p, from_zone = o.zone})
	report_told_move(id)
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
			} else if src, is_copy := o.prepared_copy_source.?; is_copy {
				// CR 723.3c: the prepared permanent's copy, offered as that permanent's action.
				if castable(s, p, o, g.card_db) do append(&out, types.GameAction_CastPreparedCopy{source = src})
			} else if castable(s, p, o, g.card_db) || adventure_castable(g, p, o) {
				append(&out, types.GameAction_CastSpell{object_id = id, card_id = o.card_id})
			} else if _, back := mdfc_faces_usable(g, p, o); back {
				append(&out, types.GameAction_CastSpell{object_id = id, card_id = o.card_id}) // its back face (CR 712.8b, 712.9)
			}
		}
		for o in permanents_of(s, p) do if can_crew(g, p, o) do append(&out, types.GameAction_CrewVehicle{vehicle_id = o.id})
		for o in permanents_of(s, p) {
			if o.abilities == nil do continue
			for &a, i in o.abilities^ {
				if can_activate(g, p, o, i) {
					append(&out, types.GameAction_ActivateAbility{source_id = o.id, ability_index = i})
				} else if option, is_mana := mana_ability_option(a); is_mana && player_activated_only(option) && object_supported(o, g.card_db) && mana_ability_activatable(g, p, o, &a) {
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
		if choice, is_choice := w.cost.(types.AdditionalCost_Choice); is_choice {
			// One of the costs the player can pay.
			if o := object(s, g.pending.object); o != nil do for _, i in choice._0 do if option_payable(s, p, o, i) do append(&out, types.GameAction_DecideOptionalCost{index = i})
		} else {
			append(&out, types.GameAction_DecideOptionalCost{index = 0}, types.GameAction_DecideOptionalCost{index = 1})
		}
	case types.WaitingFor_ModeChoice:
		// Every allowed choice of modes the player can pay for (CR 700.2, 601.2f), in printed order.
		if o := object(s, g.pending.object); o != nil && is_modal(o) {
			for set in allowed_mode_sets(s, p, o, w.unavailable_modes[:]) do append(&out, types.GameAction_SelectModes{indices = slice.clone_to_dynamic(set)})
		}
		append(&out, types.GameAction_CancelCast{})
	case types.WaitingFor_AbilityModeChoice:
		available := make([dynamic]int, context.temp_allocator)
		for i in 0 ..< w.modal.mode_count do if !slice.contains(w.unavailable_modes[:], i) do append(&available, i)
		mode_sets(&out, available[:], 0, make([dynamic]int, context.temp_allocator), w.modal.min_choices, w.modal.max_choices)
	case types.WaitingFor_CopyTargetChoice:
		for id in w.valid_targets do append(&out, types.GameAction_ChooseTarget{target = types.TargetRef_Object{id}})
		append(&out, types.GameAction_ChooseTarget{}) // copy nothing
	case types.WaitingFor_ReturnAsAuraTarget:
		for t in w.legal_targets do append(&out, types.GameAction_ChooseTarget{target = t})
	case types.WaitingFor_CrewVehicle:
		// The client picks the creatures (any set with enough power); every eligible one is a valid answer to offer.
		append(&out, types.GameAction_CrewVehicle{vehicle_id = w.vehicle_id, creature_ids = slice.clone_to_dynamic(w.eligible_creatures[:], context.temp_allocator)})
		append(&out, types.GameAction_CancelCast{})
	case types.WaitingFor_ReplacementChoice:
		if len(w.candidates) > 0 {
			if r, ok := asked_entry_option(g, w.candidates[0].source_id); ok && entry_option_acceptable(s, p, r) {
				append(&out, types.GameAction_ChooseReplacement{index = 0})
			}
		}
		append(&out, types.GameAction_ChooseReplacement{index = 1})
	case types.WaitingFor_ChooseOneOfBranch:
		for i in 0 ..< len(w.branches) do append(&out, types.GameAction_ChooseBranch{index = i})
	case types.WaitingFor_NamedChoice:
		for name in w.options do append(&out, types.GameAction_ChooseOption{choice = name})
	case types.WaitingFor_CostTypeChoice:
		for name in w.options do append(&out, types.GameAction_ChooseOption{choice = name})
		append(&out, types.GameAction_CancelCast{})
	case types.WaitingFor_ProliferateChoice:
		// Any subset is an answer; offered: all of them, and none.
		append(&out, types.GameAction_SelectTargets{targets = slice.clone_to_dynamic(w.eligible[:], context.temp_allocator)})
		append(&out, types.GameAction_SelectTargets{})
	case types.WaitingFor_RevealChoice:
		for id in w.cards {
			one := make([dynamic]types.ObjectId, context.temp_allocator)
			append(&one, id)
			append(&out, types.GameAction_SelectCards{cards = one})
		}
		append(&out, types.GameAction_SelectCards{})
	case types.WaitingFor_OptionalEffectChoice:
		append(&out, types.GameAction_DecideOptionalEffect{accept = true})
		append(&out, types.GameAction_DecideOptionalEffect{accept = false})
	case types.WaitingFor_UnlessPayment:
		append(&out, types.GameAction_PayUnlessCost{pay = true})
		append(&out, types.GameAction_PayUnlessCost{pay = false})
	case types.WaitingFor_DistributeAmong:
		append(&out, types.GameAction_DistributeAmong{distribution = ai_division(w)})
	case types.WaitingFor_ModalFaceChoice:
		if o := object(s, w.object_id); o != nil {
			front, back := mdfc_faces_usable(g, p, o)
			if front do append(&out, types.GameAction_ChooseModalFace{back_face = false})
			if back do append(&out, types.GameAction_ChooseModalFace{back_face = true})
		}
		append(&out, types.GameAction_CancelCast{})
	case types.WaitingFor_CastOffer:
		if k, adventure := w.kind.(types.CastOfferKind_Adventure); adventure {
			append(&out, types.GameAction_ChooseAdventureFace{creature = true})
			append(&out, types.GameAction_ChooseAdventureFace{creature = false})
		}
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
	for id in ids_of(s.exile) {
		o := object(s, id)
		if _, ok := exile_permission(o, p); ok || adventure_permission(o, p) do append(&out, id) // CR 716.3d
		else if _, prepared := prepared_source(s, o, p); prepared do append(&out, id) // CR 723.3c
	}
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
