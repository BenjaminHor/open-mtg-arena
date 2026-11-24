// Turn structure (CR 500-514) and priority (CR 117).
package game

import types "../types"

MAX_HAND_SIZE :: 7 // CR 402.2

// The step after this one, in turn order (CR 500.1).
next_step :: proc(p: types.Phase) -> (types.Phase, bool) {
	if p == .Cleanup do return .Untap, false
	return types.Phase(int(p) + 1), true
}

// CR 103.8: once every player has kept, the starting player takes their first turn.
begin_first_turn :: proc(g: ^Game) {
	s := &g.state
	s.turn_number = 1
	begin_turn(g, s.current_starting_player)
}

begin_turn :: proc(g: ^Game, active: types.PlayerId) {
	s := &g.state
	s.active_player = active
	s.lands_played_this_turn = 0
	s.spells_cast_this_turn = 0
	if s.activated_abilities_this_turn != nil do clear(s.activated_abilities_this_turn)
	clear(&s.spells_cast_this_turn_by_player)
	for &p in s.players {
		p.lands_played_this_turn = 0
		p.cards_drawn_this_turn = 0
		p.has_drawn_this_turn = false
		p.life_gained_this_turn = 0
		p.life_lost_this_turn = 0
	}
	player(s, active).turns_taken += 1
	begin_step(g, .Untap)
}

// Starts a step: its turn-based actions happen, then the active player gets priority (CR 500.2, 117.3a) in the steps
// where players get it. Steps that end on their own move straight on.
begin_step :: proc(g: ^Game, step: types.Phase) {
	s := &g.state
	s.phase = step
	s.priority_passes = nil
	#partial switch step {
	case .Untap:
		// CR 502.3: the active player untaps their permanents; nobody gets priority (CR 502.4).
		for o in permanents_of(s, s.active_player) {
			o.summoning_sick = false
			if !has_rule(g, o, .Cant_Untap) do o.tapped = false // CR 502.3, "doesn't untap"
		}
		begin_step(g, .Upkeep)
		return
	case .Draw:
		// CR 103.8a: in a two-player game, the starting player skips the draw step of their first turn.
		if s.turn_number == 1 && len(s.players) == 2 {
			begin_step(g, .PreCombatMain)
			return
		}
		// CR 504.1: the active player draws a card.
		draw_card(s, player(s, s.active_player))
	case .BeginCombat:
		s.combat = types.CombatState{}
	case .DeclareAttackers:
		// CR 508.1: the active player declares attackers, if they have creatures that can attack.
		if ask_attackers(g) do return
	case .DeclareBlockers:
		// CR 508.8: with no attackers, the declare blockers and combat damage steps are skipped.
		if !has_attackers(s) {
			begin_step(g, .EndCombat)
			return
		}
		if ask_blockers(g) do return
	case .CombatDamage:
		if !has_attackers(s) {
			begin_step(g, .EndCombat)
			return
		}
		if !combat_damage(g) do return // the attacking player is dividing damage
		if game_over(s) do return
	case .EndCombat:
		// CR 511.3: at the end of combat, creatures stop being attacking and blocking creatures.
	case .PostCombatMain:
		s.combat = nil
	case .Cleanup:
		// CR 514.1: the active player discards down to their maximum hand size.
		if ask_discard_to_hand_size(g) do return
		cleanup(g)
		return
	case .Upkeep, .PreCombatMain, .End:
	}
	// CR 503.1, 513.1, 507.1 ...: "at the beginning of" a step, abilities trigger once its turn-based actions are done.
	append(&g.events, Event{kind = .Step_Begin, step = step})
	give_priority(g, s.active_player)
}

// CR 514.2: damage wears off and "until end of turn" effects end; then the turn is over (CR 514.3: no player gets
// priority unless something happened, which this engine's cleanup doesn't yet cause).
cleanup :: proc(g: ^Game) {
	s := &g.state
	for id in ids_of(s.battlefield) do object(s, id).damage_marked = 0
	end_until_end_of_turn_effects(g)
	s.turn_number += 1
	begin_turn(g, opponent(s, s.active_player))
}

give_priority :: proc(g: ^Game, p: types.PlayerId) {
	s := &g.state
	// CR 117.5: state-based actions are checked, then triggered abilities go on the stack, repeating until neither
	// happens, before a player receives priority.
	for {
		check_state_based_actions(g)
		if game_over(s) do return
		before := types.pvec_len(s.stack)
		if !place_triggers(g) do return // a player is choosing a trigger's target
		collect_triggers(g)
		if types.pvec_len(s.stack) == before && len(g.events) == 0 && len(g.pending_triggers) == 0 do break
	}
	// CR 117.3c-d: after abilities are put on the stack, the active player gets priority, unless a player just acted.
	s.priority_player = p
	s.waiting_for = types.WaitingFor_Priority{player = p}
}

// CR 117.3d, 117.4: a player passes priority. When every player has passed in succession, the top of the stack
// resolves, or with an empty stack the step ends.
pass_priority :: proc(g: ^Game, p: types.PlayerId) {
	s := &g.state
	append(&s.priority_passes, p)
	if len(s.priority_passes) < len(s.players) {
		give_priority(g, opponent(s, p))
		return
	}
	s.priority_passes = nil
	if types.pvec_len(s.stack) > 0 {
		resolve_top_of_stack(g)
		if game_over(s) do return
		if _, asking := s.waiting_for.(types.WaitingFor_OptionalEffectChoice); asking do return
		if g.resolution.active do return // a player is choosing partway through
		after_resolution(g)
		return
	}
	step, same_turn := next_step(s.phase)
	if !same_turn {
		cleanup(g)
		return
	}
	begin_step(g, step)
}

game_over :: proc(s: ^types.GameState) -> bool {
	_, over := s.waiting_for.(types.WaitingFor_GameOver)
	return over
}

// CR 514.1: the active player chooses cards to discard down to seven.
ask_discard_to_hand_size :: proc(g: ^Game) -> bool {
	s := &g.state
	p := player(s, s.active_player)
	if player_rule_count(g, s.active_player, .No_Max_Hand_Size) > 0 do return false // CR 402.2
	n := types.pvec_len(p.hand) - MAX_HAND_SIZE
	if n <= 0 do return false
	cards: [dynamic]types.ObjectId
	append(&cards, ..ids_of(p.hand))
	s.waiting_for = types.WaitingFor_DiscardToHandSize{player = s.active_player, count = n, cards = cards}
	return true
}

// CR 117.3b: after a spell or ability resolves, the active player receives priority.
after_resolution :: proc(g: ^Game) {
	give_priority(g, g.state.active_player)
}

has_attackers :: proc(s: ^types.GameState) -> bool {
	c, ok := s.combat.?
	return ok && len(c.attackers) > 0
}
