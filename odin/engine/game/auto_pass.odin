package game

// A player's standing choice to pass priority (CR 117.3d: "a player may pass") without being asked each time:
// "pass until the stack is empty" and "pass until the end of the turn". The engine passes for them whenever they'd
// receive priority, until the goal is met or something needs their attention: a spell or ability of another player's
// on top of the stack (so they can respond), or a step they asked to stop at. Choices other than priority (targets,
// attackers, blockers) are always asked. These are the player's settings, not game rules; the rules they keep are
// CR 117 (priority) and CR 500.2 (a step ends when all pass in succession with the stack empty).

import types "../types"

// "Pass" (to the end of the turn) or "resolve the stack": the request is stored and, if it's the player's priority
// now, they pass at once.
set_auto_pass :: proc(g: ^Game, p: types.PlayerId, request: types.AutoPassRequest) -> bool {
	s := &g.state
	switch r in request {
	case types.AutoPassRequest_UntilStackEmpty:
		s.auto_pass[p] = types.AutoPassMode_UntilStackEmpty{initial_stack_len = types.pvec_len(s.stack)}
	case types.AutoPassRequest_UntilTurnBoundary:
		s.auto_pass[p] = types.AutoPassMode_UntilTurnBoundary{until = r.until}
	case:
		return false
	}
	if w, priority := s.waiting_for.(types.WaitingFor_Priority); priority && w.player == p {
		return apply_action(g, p, types.GameAction_PassPriority{})
	}
	return true
}

// Whether `p` asked to stop in the current step or phase (their phase stops, CR 500.1).
phase_stop_hit :: proc(s: ^types.GameState, p: types.PlayerId) -> bool {
	stops, has := s.phase_stops[p]
	if !has do return false
	for stop in stops {
		if stop.phase != s.phase do continue
		switch stop.scope {
		case .AllTurns:
			return true
		case .OwnTurn:
			if s.active_player == p do return true
		case .OpponentsTurns:
			if s.active_player != p do return true
		}
	}
	return false
}

// Passes for players with a standing pass while it's their priority, until the goal is met or they need to decide.
run_auto_pass :: proc(g: ^Game) {
	s := &g.state
	for _ in 0 ..< 2000 {
		if game_over(s) do return
		w, priority := s.waiting_for.(types.WaitingFor_Priority)
		if !priority do return
		mode, has := s.auto_pass[w.player]
		if !has do return
		n := types.pvec_len(s.stack)
		switch m in mode {
		case types.AutoPassMode_UntilStackEmpty:
			// Done once the stack is empty, or when something new went on it (the player sees it).
			if n == 0 || n > m.initial_stack_len {
				delete_key(&s.auto_pass, w.player)
				return
			}
		case types.AutoPassMode_UntilTurnBoundary:
			// Another player's spell or ability on top: the player may want to respond (kept for after).
			if n > 0 && types.pvec_get(s.stack, n - 1).controller != w.player do return
			if phase_stop_hit(s, w.player) {
				delete_key(&s.auto_pass, w.player)
				return
			}
		}
		if !apply_action(g, w.player, types.GameAction_PassPriority{}) do return
	}
}

// The turn-boundary sessions end with the turn ("until end of turn") or as the player's next turn begins.
end_turn_auto_passes :: proc(s: ^types.GameState, new_active: types.PlayerId) {
	for p in s.players {
		mode, has := s.auto_pass[p.id]
		if !has do continue
		m, turn := mode.(types.AutoPassMode_UntilTurnBoundary)
		if !turn do continue
		if m.until == .EndOfCurrentTurn || p.id == new_active do delete_key(&s.auto_pass, p.id)
	}
}

// A player passing to the end of the turn declares no attackers (they've committed to passing the turn).
passing_the_turn :: proc(s: ^types.GameState, p: types.PlayerId) -> bool {
	mode, has := s.auto_pass[p]
	if !has do return false
	_, turn := mode.(types.AutoPassMode_UntilTurnBoundary)
	return turn
}
