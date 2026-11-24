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
	}
	seed, has_seed := json.to_u64(arg(args, 1))
	if !has_seed do seed = random_seed()
	first, _ := json.to_u64(arg(args, 5))
	current = game.start_game(decks[:], seed, format, types.PlayerId(first))

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
	strings.write_string(b, `{"ok":{"state":`)
	types.encode_GameState(b, current.state)
	strings.write_string(b, `,"derived":{"state_revision":0,"storm_count":0,"debug_library_cards":[]}}}`)
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
	current = g
	reply_ok_raw(b, "null")
}
