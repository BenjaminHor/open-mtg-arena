// What happened during an action, told to the client: the game events its animations and sounds play from, and
// the lines of its game log. This is output only. The engine's rules never read it (triggers read `Game.events`).
package game

import "core:fmt"
import "../types"

// One action's (or the game start's) report. The caller (the WASM layer) points `reporting` at one before calling
// `start_game` or `apply`, and reads it after; while it's nil nothing is recorded (the rules tests, the AI).
Report :: struct {
	state:  ^types.GameState,
	events: [dynamic]types.GameEvent,
	log:    [dynamic]types.GameLogEntry,
}

@(thread_local)
reporting: ^Report

// A move the log has already told in its own words ("X is destroyed", "P sacrifices X", "P discards X"), so the
// zone change that carries it out isn't told twice.
@(thread_local, private = "file")
told_move: types.ObjectId

// Starts recording `g`'s events, when the caller asked for a report.
begin_report :: proc(g: ^Game) {
	if reporting == nil do return
	reporting.state = &g.state
	told_move = 0
}

// Records an event, and its log line when it has one.
report :: proc(e: types.GameEvent) {
	r := reporting
	if r == nil do return
	append(&r.events, e)
	if r.state == nil do return
	segments := log_line(r.state, e)
	if len(segments) == 0 do return
	entry := types.GameLogEntry {
		seq         = u32(len(r.log)), // the client numbers entries itself
		game_number = r.state.game_number,
		turn        = r.state.turn_number,
		phase       = r.state.phase,
		category    = log_category(e),
		segments    = segments,
	}
	entry.presentation = log_presentation(e)
	// A turn's first line belongs to its first step (CR 500.1), not the last turn's cleanup.
	if _, starts := e.(types.GameEvent_TurnStarted); starts do entry.phase = .Untap
	append(&r.log, entry)
}

report_zone_change :: proc(s: ^types.GameState, id: types.ObjectId, from, to: types.Zone) {
	if reporting == nil do return
	if told_move == id {
		told_move = 0
		append(&reporting.events, types.GameEvent(types.GameEvent_ZoneChanged{object_id = id, from = from, to = to}))
		return
	}
	report(types.GameEvent_ZoneChanged{object_id = id, from = from, to = to})
}

// The next zone change of `id` is the one an event just reported carries out.
report_told_move :: proc(id: types.ObjectId) {
	if reporting != nil do told_move = id
}

report_life :: proc(s: ^types.GameState, p: types.PlayerId, amount: int) {
	if reporting == nil || amount == 0 do return
	report(types.GameEvent_LifeChanged{player_id = p, amount = i32(amount), new_total = types.LifeTotalReading(player(s, p).life)})
}

report_attackers :: proc(s: ^types.GameState, attacks: []types.Tuple2(types.ObjectId, types.AttackTarget), defender: types.PlayerId) {
	if reporting == nil do return
	e := types.GameEvent_AttackersDeclared{defending_player = defender}
	e.attacker_ids = make([dynamic]types.ObjectId, context.temp_allocator)
	e.attacks = make([dynamic]types.Tuple2(types.ObjectId, types.AttackTarget), context.temp_allocator)
	for a in attacks {
		append(&e.attacker_ids, a._0)
		append(&e.attacks, a)
	}
	report(e)
}

report_blockers :: proc(assignments: []types.Tuple2(types.ObjectId, types.ObjectId)) {
	if reporting == nil do return
	e := types.GameEvent_BlockersDeclared{}
	e.assignments = make([dynamic]types.Tuple2(types.ObjectId, types.ObjectId), context.temp_allocator)
	append(&e.assignments, ..assignments)
	report(e)
}

// ---- The log -------------------------------------------------------------------------------------------------

@(private = "file")
text :: proc(t: string) -> types.LogSegment {return types.LogSegment_Text{t}}

@(private = "file")
number :: proc(n: int) -> types.LogSegment {return types.LogSegment_Number{i32(n)}}

@(private = "file")
player_name :: proc(s: ^types.GameState, p: types.PlayerId) -> types.LogSegment {
	name := ""
	if int(p) < len(s.log_player_names) do name = s.log_player_names[int(p)]
	if name == "" do name = fmt.tprintf("Player %d", int(p) + 1)
	return types.LogSegment_PlayerName{name = name, player_id = p}
}

@(private = "file")
card_name :: proc(s: ^types.GameState, id: types.ObjectId) -> types.LogSegment {
	name := "a card"
	if o := object(s, id); o != nil && o.name != "" do name = o.name
	else if o := last_known(id); o != nil && o.name != "" do name = o.name
	return types.LogSegment_CardName{name = name, object_id = id}
}

// A stack object by what it is: a spell by its card's name, an ability by its source's ("X's ability").
@(private = "file")
stack_name :: proc(s: ^types.GameState, entry: types.ObjectId, source: types.ObjectId) -> [dynamic]types.LogSegment {
	out := make([dynamic]types.LogSegment, context.temp_allocator)
	append(&out, card_name(s, source))
	if entry != source do append(&out, text("'s ability"))
	return out
}

@(private = "file")
target_name :: proc(s: ^types.GameState, t: types.TargetRef) -> types.LogSegment {
	switch x in t {
	case types.TargetRef_Player:
		return player_name(s, x._0)
	case types.TargetRef_Object:
		return card_name(s, x._0)
	}
	return text("nothing")
}

// Zones whose cards the players can't all see (CR 400.2): a move between two of them isn't told.
@(private = "file")
hidden :: proc(z: types.Zone) -> bool {return z == .Library || z == .Hand}

// The log line for an event, or none when the event isn't told (it's bookkeeping, or the log's other lines already
// say it).
@(private = "file")
log_line :: proc(s: ^types.GameState, e: types.GameEvent) -> [dynamic]types.LogSegment {
	segs := make([dynamic]types.LogSegment, context.temp_allocator)
	#partial switch x in e {
	case types.GameEvent_GameStarted:
		append(&segs, text("Game started"))
		return segs
	case types.GameEvent_TurnStarted:
		append(&segs, text("Turn "), number(int(x.turn_number)), text(" — "), player_name(s, x.player_id))
		return segs
	case types.GameEvent_SpellCast:
		append(&segs, player_name(s, x.controller), text(" casts "), card_name(s, x.object_id))
		return segs
	case types.GameEvent_AbilityTriggered:
		append(&segs, card_name(s, x.source_id), text("'s ability triggers"))
		return segs
	case types.GameEvent_AbilityActivated:
		append(&segs, player_name(s, x.player_id), text(" activates "), card_name(s, x.source_id), text("'s ability"))
		return segs
	case types.GameEvent_StackResolved:
		return {} // told by report_resolved, which knows the entry's source
	case types.GameEvent_LandPlayed:
		append(&segs, player_name(s, x.player_id), text(" plays "), card_name(s, x.object_id))
		return segs
	case types.GameEvent_CardDrawn:
		append(&segs, player_name(s, x.player_id), text(" draws a card"))
		return segs
	case types.GameEvent_Discarded:
		append(&segs, player_name(s, x.player_id), text(" discards "), card_name(s, x.object_id))
		return segs
	case types.GameEvent_ZoneChanged:
		from, has_from := x.from.?
		// The moves the cast, the resolution, a land play or a draw already tell, and moves the players can't see.
		if !has_from || from == .Stack || x.to == .Stack || (hidden(from) && hidden(x.to)) do return {}
		// CR 700.4: "dies" means "is put into a graveyard from the battlefield".
		if from == .Battlefield && x.to == .Graveyard do append(&segs, card_name(s, x.object_id), text(" dies"))
		else do append(&segs, card_name(s, x.object_id), text(" moves from "), types.LogSegment_Zone{from}, text(" to "), types.LogSegment_Zone{x.to})
		return segs
	case types.GameEvent_LifeChanged:
		if x.amount > 0 do append(&segs, player_name(s, x.player_id), text(" gains "), number(int(x.amount)), text(" life"))
		else do append(&segs, player_name(s, x.player_id), text(" loses "), number(-int(x.amount)), text(" life"))
		return segs
	case types.GameEvent_DamageDealt:
		append(&segs, card_name(s, x.source_id), text(" deals "), number(int(x.amount)), text(" damage to "), target_name(s, x.target))
		return segs
	case types.GameEvent_AttackersDeclared:
		attacks_line(s, &segs, x.attacks[:])
		return segs
	case types.GameEvent_BlockersDeclared:
		if len(x.assignments) == 0 {
			append(&segs, text("No blockers declared"))
			return segs
		}
		for a, i in x.assignments {
			if i > 0 do append(&segs, text("; "))
			append(&segs, card_name(s, a._0), text(" blocks "), card_name(s, a._1))
		}
		return segs
	case types.GameEvent_CreatureDestroyed:
		append(&segs, card_name(s, x.object_id), text(" is destroyed"))
		return segs
	case types.GameEvent_PermanentSacrificed:
		append(&segs, player_name(s, x.player_id), text(" sacrifices "), card_name(s, x.object_id))
		return segs
	case types.GameEvent_TokenCreated:
		append(&segs, text(x.name), text(" token is created"))
		return segs
	case types.GameEvent_CounterAdded:
		return {} // the counters show on the card
	case types.GameEvent_PlayerLost:
		append(&segs, player_name(s, x.player_id), text(" loses the game"))
		return segs
	case types.GameEvent_GameOver:
		if w, has := x.winner.?; has do append(&segs, text("Game over — "), player_name(s, w), text(" wins!"))
		else do append(&segs, text("Game over — Draw"))
		return segs
	case:
	}
	return {}
}

// "X attacks P; Y attacks Z". (A proc of its own: the Odin compiler's WebAssembly output for this loop inside
// log_line's big switch didn't validate.)
@(private = "file")
attacks_line :: proc(s: ^types.GameState, segs: ^[dynamic]types.LogSegment, attacks: []types.Tuple2(types.ObjectId, types.AttackTarget)) {
	for i in 0 ..< len(attacks) {
		if i > 0 do append(segs, text("; "))
		append(segs, card_name(s, attacks[i]._0), text(" attacks "))
		if pl, is_player := attacks[i]._1.(types.AttackTarget_Player); is_player do append(segs, player_name(s, pl._0))
		else if pw, is_pw := attacks[i]._1.(types.AttackTarget_Planeswalker); is_pw do append(segs, card_name(s, pw._0))
		else if b, is_battle := attacks[i]._1.(types.AttackTarget_Battle); is_battle do append(segs, card_name(s, b._0))
	}
}

// The log's grouping of a line (the client filters by it).
@(private = "file")
log_category :: proc(e: types.GameEvent) -> types.LogCategory {
	#partial switch x in e {
	case types.GameEvent_TurnStarted:
		return .Turn
	case types.GameEvent_SpellCast, types.GameEvent_AbilityActivated, types.GameEvent_StackResolved:
		return .Stack
	case types.GameEvent_AbilityTriggered:
		return .Trigger
	case types.GameEvent_LandPlayed, types.GameEvent_CardDrawn, types.GameEvent_Discarded, types.GameEvent_ZoneChanged:
		return .Zone
	case types.GameEvent_LifeChanged:
		return .Life
	case types.GameEvent_DamageDealt:
		if x.is_combat do return .Combat
		return .Life
	case types.GameEvent_AttackersDeclared, types.GameEvent_BlockersDeclared:
		return .Combat
	case types.GameEvent_CreatureDestroyed, types.GameEvent_PermanentSacrificed:
		return .Destroy
	case types.GameEvent_TokenCreated:
		return .Token
	}
	return .Game
}

// How the client shows a line: turn starts and game results stand out; draws are hidden information (an
// opponent's draws aren't public, CR 401.2).
@(private = "file")
log_presentation :: proc(e: types.GameEvent) -> types.LogPresentation {
	p := types.LogPresentation{importance = .Context, tone = .Neutral, boundary = .None, visibility = .Public}
	#partial switch x in e {
	case types.GameEvent_GameStarted, types.GameEvent_GameOver, types.GameEvent_PlayerLost, types.GameEvent_TurnStarted,
	     types.GameEvent_SpellCast, types.GameEvent_LandPlayed, types.GameEvent_AttackersDeclared,
	     types.GameEvent_BlockersDeclared, types.GameEvent_DamageDealt, types.GameEvent_LifeChanged,
	     types.GameEvent_CreatureDestroyed, types.GameEvent_PermanentSacrificed, types.GameEvent_TokenCreated:
		p.importance = .Essential
	}
	#partial switch x in e {
	case types.GameEvent_TurnStarted:
		p.boundary = .Turn
	case types.GameEvent_CardDrawn:
		p.visibility = .HiddenInformation
	case types.GameEvent_LifeChanged:
		p.tone = .Positive if x.amount > 0 else .Negative
	case types.GameEvent_TokenCreated:
		p.tone = .Positive
	case types.GameEvent_DamageDealt, types.GameEvent_CreatureDestroyed, types.GameEvent_PermanentSacrificed, types.GameEvent_PlayerLost:
		p.tone = .Negative
	}
	return p
}

// A stack object resolves (CR 608.2): the event, and its line naming the spell or the ability's source.
report_resolved :: proc(s: ^types.GameState, entry: types.StackEntry) {
	r := reporting
	if r == nil do return
	append(&r.events, types.GameEvent(types.GameEvent_StackResolved{object_id = entry.id}))
	segs := stack_name(s, entry.id, entry.source_id)
	append(&segs, text(" resolves"))
	append(&r.log, types.GameLogEntry{seq = u32(len(r.log)), game_number = s.game_number, turn = s.turn_number, phase = s.phase, category = .Stack, segments = segs, presentation = {importance = .Context}})
}
