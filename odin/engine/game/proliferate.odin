package game

// CR 701.34a: "To proliferate means to choose any number of permanents and/or players that have a counter, then give
// each one additional counter of each kind that permanent or player already has."

import "core:slice"
import types "../types"

// What has a counter: permanents with counters (a planeswalker's loyalty is one kind, CR 306.5b), players with
// poison or other counters, or energy (CR 107.14: energy counters).
@(private = "file")
has_counter :: proc(s: ^types.GameState, t: types.TargetRef) -> bool {
	switch x in t {
	case types.TargetRef_Object:
		o := object(s, x._0)
		return o != nil && o.zone == .Battlefield && (len(o.counters) > 0 || (o.loyalty.? or_else 0) > 0)
	case types.TargetRef_Player:
		p := player(s, x._0)
		if p.poison_counters > 0 || p.energy > 0 do return true
		for _, n in p.player_counters do if n > 0 do return true
	}
	return false
}

// Asks the player what to proliferate; false when nothing has a counter (nothing to choose).
start_proliferate :: proc(g: ^Game, controller: types.PlayerId) -> bool {
	s := &g.state
	eligible := make([dynamic]types.TargetRef)
	for id in ids_of(s.battlefield) do if has_counter(s, types.TargetRef_Object{id}) do append(&eligible, types.TargetRef_Object{id})
	for p in s.players do if has_counter(s, types.TargetRef_Player{p.id}) do append(&eligible, types.TargetRef_Player{p.id})
	if len(eligible) == 0 do return false
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_ProliferateChoice{player = controller, eligible = eligible}
	return true
}

answer_proliferate :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ProliferateChoice, chosen: []types.TargetRef) -> bool {
	s := &g.state
	if !g.resolution.active || p != w.player do return false
	for t, i in chosen {
		if !slice.contains(w.eligible[:], t) do return false
		for u in chosen[:i] do if u == t do return false
	}
	for t in chosen {
		switch x in t {
		case types.TargetRef_Object:
			o := object(s, x._0)
			kinds := slice.clone(o.counters[:], context.temp_allocator)
			for c in kinds do add_counters(o, c._0, 1)
			if l, has := o.loyalty.?; has && l > 0 do o.loyalty = l + 1
		case types.TargetRef_Player:
			pl := player(s, x._0)
			if pl.poison_counters > 0 do pl.poison_counters += 1
			if pl.energy > 0 do pl.energy += 1
			for k, n in pl.player_counters do if n > 0 do pl.player_counters[k] = n + 1
		}
	}
	s.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// The AI's choice: what helps its controller: its own permanents' counters other than -1/-1 and its own energy and
// experience; the opponent's -1/-1 counters and poison.
ai_proliferate :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ProliferateChoice) -> [dynamic]types.TargetRef {
	s := &g.state
	out := make([dynamic]types.TargetRef)
	for t in w.eligible {
		good := false
		switch x in t {
		case types.TargetRef_Object:
			o := object(s, x._0)
			minus := counter_count(o, types.CounterType_Minus1Minus1{}) > 0
			good = (o.controller == p) != minus
		case types.TargetRef_Player:
			pl := player(s, x._0)
			good = x._0 != p ? pl.poison_counters > 0 : pl.poison_counters == 0
		}
		if good do append(&out, t)
	}
	return out
}
