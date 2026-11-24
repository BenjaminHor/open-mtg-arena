// The game's calls at the boundary: starting a game, reading its state, saving and restoring it. The rules are in
// odin/engine/game; this file turns the client's JSON into its inputs and its state back into JSON.
package engine_odin

import "base:runtime"
import "core:strings"
import json "../engine/json"
import game "../engine/game"
import types "../engine/types"

// The game in progress, in its own arena: it outlives each call's scratch arena and is replaced by the next game.
current: ^game.Game
@(private = "file")
game_arena: runtime.Arena

@(private = "file")
reset_game :: proc() {
	current = nil
	runtime.arena_destroy(&game_arena)
}

// The format a game is played under: the client's format config, or Standard's when it sends none (as the Rust
// engine defaults).
@(private = "file")
format_config :: proc(v: json.Value) -> (types.FormatConfig, bool) {
	config := v
	if config.kind != .Object {
		entry, _ := format_entry("Standard")
		config = json.get_or_null(entry, "default_config")
	}
	f: types.FormatConfig
	ok := types.decode_FormatConfig(config, &f)
	return f, ok
}

// initialize_game(deck_data, seed, format_config, match_config, player_count, first_player): starts a game between
// the player's deck and the opponent's, after checking both against the format (CR 100.2a). Answers the opening
// events and the first decision, or {error: true, reasons} when a deck can't be played.
initialize_game :: proc(b: ^strings.Builder, args: []json.Value) {
	deck_data := arg(args, 0)
	if deck_data.kind != .Object {
		reply_err(b, "initialize_game: the Odin engine needs both players' decks")
		return
	}
	format_value := arg(args, 2)
	seats := [2]string{"player", "opponent"}
	labels := [2]string{"Player deck", "Opponent deck"}
	reasons: [dynamic]string
	format_tag := json.get_or_null(format_value, "format").text if format_value.kind == .Object else "Standard"
	for seat, i in seats {
		request := json.get_or_null(deck_data, seat)
		verdict, has := deck_verdict(request, format_tag)
		if has && !verdict.compatible do for reason in verdict.reasons do append(&reasons, strings.concatenate({labels[i], ": ", reason}))
	}
	if len(reasons) > 0 {
		strings.write_string(b, `{"ok":{"error":true,"reasons":`)
		write_strings(b, reasons[:])
		strings.write_string(b, "}}")
		return
	}

	reset_game()
	context.allocator = runtime.arena_allocator(&game_arena)
	format, ok := format_config(format_value)
	if !ok {
		reply_err(b, "initialize_game: invalid format config")
		return
	}
	decks: [2]game.Deck
	for seat, i in seats {
		main: [dynamic]^types.CardExportEntry
		names, _ := json.get(json.get_or_null(deck_data, seat), "main_deck")
		for name in names.items {
			card, found := find_card(name.text)
			if !found {
				reply_err(b, strings.concatenate({"initialize_game: unknown card ", name.text}, context.temp_allocator))
				return
			}
			append(&main, card)
		}
		decks[i].main = main[:]
		commanders: [dynamic]^types.CardExportEntry
		listed, _ := json.get(json.get_or_null(deck_data, seat), "commander")
		for name in listed.items do if card, found := find_card(name.text); found do append(&commanders, card)
		decks[i].commanders = commanders[:]
	}
	seed, has_seed := json.to_u64(arg(args, 1))
	if !has_seed do seed = random_seed()
	first, _ := json.to_u64(arg(args, 5))
	current = game.start_game(decks[:], seed, format, types.PlayerId(first), card_lookup)
	revision = 0

	strings.write_string(b, `{"ok":{"events":[],"log_entries":[],"waiting_for":`)
	types.encode_WaitingFor(b, current.state.waiting_for)
	strings.write_string(b, "}}")
}

@(private = "file")
random_seed :: proc() -> u64 {
	bytes: [8]byte
	runtime.rand_bytes(bytes[:])
	return transmute(u64)bytes
}

// get_game_state(): the state and the values the client reads alongside it, or null before a game starts.
get_game_state :: proc(b: ^strings.Builder) {
	if current == nil {
		reply_ok_raw(b, "null")
		return
	}
	strings.write_string(b, `{"ok":`)
	write_state(b, nil)
	strings.write_byte(b, '}')
}

// export_game_state_json(): the whole state as a JSON string, for saving and for restore_game_state.
export_game_state_json :: proc(b: ^strings.Builder) {
	if current == nil {
		reply_err(b, "Game not initialized")
		return
	}
	text := strings.builder_make(context.temp_allocator)
	types.encode_GameState(&text, current.state)
	strings.write_string(b, `{"ok":`)
	json.write_string(b, strings.to_string(text))
	strings.write_byte(b, '}')
}

// restore_game_state(json_str): replaces the game with a saved state (a bare state, or the Rust engine's saved
// envelope around one).
restore_game_state :: proc(b: ^strings.Builder, args: []json.Value) {
	reset_game()
	context.allocator = runtime.arena_allocator(&game_arena)
	text := strings.clone(arg(args, 0).text)
	root, err := json.parse(transmute([]byte)text)
	if err != nil {
		reply_err(b, "restore_game_state: malformed state")
		return
	}
	for root.kind == .Object {
		if _, has_players := json.get(root, "players"); has_players do break
		inner, ok := json.get(root, "state")
		if !ok do break
		root = inner
	}
	g := new(game.Game)
	types.decode_error = ""
	if !types.decode_GameState(root, &g.state) {
		reply_err(b, strings.concatenate({"restore_game_state: ", types.decode_error}, context.temp_allocator))
		return
	}
	g.rng = game.restored_rng(g.state)
	g.card_db = card_lookup
	game.current_card_db = card_lookup
	current = g
	reply_ok_raw(b, "null")
}

// The card an object was made from, for the rules to tell what they support of it.
card_lookup :: proc(name: string) -> ^types.CardExportEntry {
	e, _ := find_card(name)
	return e
}

// Runs a rules procedure on the game's own allocator, so what it changes outlives this call.
@(private = "file")
game_allocator :: proc() -> runtime.Allocator {return runtime.arena_allocator(&game_arena)}

// A revision number the client compares to drop stale snapshots: one more for each applied action.
revision: u64

// submit_action(actor, action): the client's action for a seat. Applied, or rejected with nothing changed.
submit_action :: proc(b: ^strings.Builder, args: []json.Value) {
	if current == nil {
		reply_ok_raw(b, `"NOT_INITIALIZED: no game"`)
		return
	}
	actor, _ := json.to_u64(arg(args, 0))
	applied := false
	{
		context.allocator = game_allocator()
		action: types.GameAction
		if types.decode_GameAction(arg(args, 1), &action) do applied = game.apply(current, types.PlayerId(actor), action)
	}
	write_outcome(b, applied)
}

@(private = "file")
write_outcome :: proc(b: ^strings.Builder, applied: bool) {
	if applied {
		revision += 1
		reply_ok_raw(b, `{"status":"applied","result":{"events":[],"log_entries":[]}}`)
	} else {
		reply_ok_raw(b, `{"status":"rejected","rejection":{"code":"invalid_action","disposition":"invalid","message":"That action isn't legal now.","related_object_ids":[]}}`)
	}
}

// The legal actions for a viewer, with what the client reads alongside them.
@(private = "file")
write_legal :: proc(b: ^strings.Builder, viewer: types.PlayerId) {
	actions := game.legal_actions(current, viewer)
	strings.write_string(b, `{"actions":[`)
	for a, i in actions {
		if i > 0 do strings.write_byte(b, ',')
		types.encode_GameAction(b, a)
	}
	// Only "pass" offered: the client may pass on the player's behalf.
	auto_pass := len(actions) == 1 && is_pass(actions[0])
	strings.write_string(b, `],"autoPassRecommended":`)
	strings.write_string(b, "true" if auto_pass else "false")
	strings.write_string(b, `,"endContinuousEffectOffers":[],"manaPaymentShortcutActions":[],"spellCosts":{},"legalActionsByObject":{`)
	first := true
	for a in actions {
		id: types.ObjectId
		#partial switch x in a {
		case types.GameAction_PlayLand:
			id = x.object_id
		case types.GameAction_CastSpell:
			id = x.object_id
		case types.GameAction_ActivateAbility:
			id = x.source_id
		case:
			continue
		}
		if !first do strings.write_byte(b, ',')
		first = false
		strings.write_byte(b, '"')
		strings.write_u64(b, u64(id))
		strings.write_string(b, `":[`)
		types.encode_GameAction(b, a)
		strings.write_byte(b, ']')
	}
	strings.write_string(b, `},"activationBlockReasons":{},"viewerInteraction":null}`)
}

@(private = "file")
is_pass :: proc(a: types.GameAction) -> bool {
	_, ok := a.(types.GameAction_PassPriority)
	return ok
}

// The state as a viewer may see it (CR 401.2, 402.3): libraries and the other players' hands are hidden.
@(private = "file")
write_state :: proc(b: ^strings.Builder, viewer: Maybe(types.PlayerId)) {
	s := &current.state
	hidden := make([dynamic]^types.GameObject, context.temp_allocator)
	if v, filtered := viewer.?; filtered {
		for p in s.players {
			for id in game.ids_of(p.library) do append(&hidden, s.objects.inner[id])
			if p.id != v do for id in game.ids_of(p.hand) do append(&hidden, s.objects.inner[id])
		}
	}
	for o in hidden {
		placeholder := new(types.GameObject, context.temp_allocator)
		placeholder.id, placeholder.card_id, placeholder.owner, placeholder.controller, placeholder.zone = o.id, o.card_id, o.owner, o.controller, o.zone
		placeholder.name = "Hidden Card"
		placeholder.base_name = "Hidden Card"
		s.objects.inner[o.id] = placeholder
	}
	strings.write_string(b, `{"state":`)
	types.encode_GameState(b, s^)
	for o in hidden do s.objects.inner[o.id] = o
	strings.write_string(b, `,"derived":{"waiting_for_identity":"`)
	strings.write_u64(b, revision)
	strings.write_string(b, `","state_revision":`)
	strings.write_u64(b, revision)
	strings.write_string(b, `,"storm_count":0,"debug_library_cards":[]}}`)
}

get_filtered_game_state :: proc(b: ^strings.Builder, args: []json.Value) {
	if current == nil {
		reply_ok_raw(b, "null")
		return
	}
	viewer, _ := json.to_u64(arg(args, 0))
	strings.write_string(b, `{"ok":`)
	write_state(b, types.PlayerId(viewer))
	strings.write_byte(b, '}')
}

get_legal_actions_for_viewer :: proc(b: ^strings.Builder, args: []json.Value) {
	if current == nil {
		reply_ok_raw(b, "null")
		return
	}
	viewer, ok := json.to_u64(arg(args, 0))
	if !ok {
		who, _ := game.acting_player(&current.state)
		viewer = u64(who)
	}
	strings.write_string(b, `{"ok":`)
	write_legal(b, types.PlayerId(viewer))
	strings.write_byte(b, '}')
}

// get_viewer_snapshot_js(viewer): the viewer's state and legal actions, from one moment.
get_viewer_snapshot :: proc(b: ^strings.Builder, args: []json.Value) {
	if current == nil {
		reply_ok_raw(b, "null")
		return
	}
	viewer, _ := json.to_u64(arg(args, 0))
	strings.write_string(b, `{"ok":{"state":`)
	write_state(b, types.PlayerId(viewer))
	legal := strings.builder_make(context.temp_allocator)
	write_legal(&legal, types.PlayerId(viewer))
	text := strings.to_string(legal)
	// The legal result's members follow the state's in one object.
	strings.write_byte(b, ',')
	strings.write_string(b, text[1:])
	strings.write_byte(b, '}')
}

// get_ai_action_proposal(difficulty, player): the AI's choice for a seat, as a proposal the client submits back.
get_ai_action_proposal :: proc(b: ^strings.Builder, args: []json.Value) {
	if current == nil {
		reply_ok_raw(b, "null")
		return
	}
	p, _ := json.to_u64(arg(args, 1))
	action, ok := game.ai_action(current, types.PlayerId(p))
	if !ok {
		reply_ok_raw(b, "null")
		return
	}
	strings.write_string(b, `{"ok":{"token":"`)
	strings.write_u64(b, revision)
	strings.write_string(b, `","semanticOwner":`)
	strings.write_u64(b, p)
	strings.write_string(b, `,"actor":`)
	strings.write_u64(b, p)
	strings.write_string(b, `,"action":`)
	types.encode_GameAction(b, action)
	strings.write_string(b, "}}")
}

// submit_ai_action_proposal(token, actor, action): applies a proposal made for the current revision.
submit_ai_action_proposal :: proc(b: ^strings.Builder, args: []json.Value) {
	if current == nil {
		reply_ok_raw(b, `{"status":"stale","reason":"no game"}`)
		return
	}
	token := arg(args, 0).text
	rev := strings.builder_make(context.temp_allocator)
	strings.write_u64(&rev, revision)
	if token != strings.to_string(rev) {
		reply_ok_raw(b, `{"status":"stale","reason":"the game moved on"}`)
		return
	}
	submit_action(b, args[1:])
}

// Of these card names, the ones the Odin engine fully supports (each name as given; unknown names are left out).
supported_cards :: proc(b: ^strings.Builder, names: json.Value) {
	out := make([dynamic]string)
	for n in names.items {
		if e, ok := find_card(n.text); ok && game.card_supported(&e.face) do append(&out, n.text)
	}
	strings.write_string(b, `{"ok":`)
	write_strings(b, out[:])
	strings.write_byte(b, '}')
}

// For each of these card names, what the Odin engine is missing to support it: {name: [gap, ...]}.
card_gaps :: proc(b: ^strings.Builder, names: json.Value) {
	strings.write_string(b, `{"ok":{`)
	first := true
	for n in names.items {
		e, ok := find_card(n.text)
		if !ok do continue
		if !first do strings.write_byte(b, ',')
		first = false
		json.write_string(b, n.text)
		strings.write_byte(b, ':')
		write_strings(b, game.card_gaps(&e.face)[:])
	}
	strings.write_string(b, "}}")
}
