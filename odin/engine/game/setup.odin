// Starting a game (CR 103): the players' decks become shuffled libraries, each player gets the starting life total
// and draws an opening hand, and the game waits for the mulligan declarations.
//
// The game is held in the client's data model (odin/engine/types, D-187): the rules here are new, the types are only
// the shape the client and the captured tests read.
package game

import "core:slice"
import rng "../rng"
import types "../types"

STARTING_HAND_SIZE :: 7 // CR 103.5

// One player's deck: the cards, already looked up in the card database, in deck-list order.
Deck :: struct {
	main: []^types.CardExportEntry,
}

Game :: struct {
	state: types.GameState,
	rng:   rng.Chacha20,
}

// CR 103: starts a two-player game. The first player (CR 103.1) is given; each library is shuffled with the game's
// seeded generator (CR 103.3), each player's life is the format's starting life (CR 103.4), each draws seven cards
// (CR 103.5) and the game waits for the starting player's mulligan declaration, then the others' in turn order.
start_game :: proc(decks: []Deck, seed: u64, format: types.FormatConfig, first_player: types.PlayerId) -> ^Game {
	g := new(Game)
	g.rng = rng.from_u64(seed)
	s := &g.state
	s.format_config = format
	s.turn_number = 1
	s.active_player = first_player
	s.priority_player = first_player
	s.current_starting_player = first_player
	s.phase = .Untap
	s.max_lands_per_turn = 1 // CR 305.2: one land per turn
	s.rng_seed = seed
	s.game_number = 1
	s.next_object_id = 1
	s.next_timestamp = 1
	objects := new(map[types.ObjectId]^types.GameObject)
	s.objects.inner = objects

	for deck, seat in decks {
		player := types.PlayerId(seat)
		p: types.Player
		p.id = player
		p.life = format.starting_life
		p.starting_deck_size = u32(len(deck.main))
		library := make([dynamic]types.ObjectId, 0, len(deck.main))
		for card in deck.main {
			obj := new_card_object(s, card, player, .Library)
			append(&library, obj.id)
		}
		// CR 103.3: each player shuffles their deck, which becomes their library.
		rng.shuffle(&g.rng, library[:])
		for id in library do types.pvec_push_new(&p.library, id)
		append(&s.players, p)
		append(&s.seat_order, player)
	}

	// CR 103.5: each player draws their opening hand.
	for &p in s.players do for _ in 0 ..< STARTING_HAND_SIZE do draw_card(s, &p)

	// CR 103.5: the starting player declares first, then each other player in turn order.
	pending: [dynamic]types.MulliganDecisionEntry
	for i in 0 ..< len(s.players) {
		seat := (int(first_player) + i) % len(s.players)
		append(&pending, types.MulliganDecisionEntry{player = types.PlayerId(seat)})
	}
	s.waiting_for = types.WaitingFor_MulliganDecision{pending = pending}
	return g
}

// A new object for a card in a zone (CR 109.1), with the card's printed characteristics (CR 109.3) as its own.
new_card_object :: proc(s: ^types.GameState, card: ^types.CardExportEntry, owner: types.PlayerId, zone: types.Zone) -> ^types.GameObject {
	face := &card.face
	o := new(types.GameObject)
	o.id = types.ObjectId(s.next_object_id)
	s.next_object_id += 1
	o.card_id = types.CardId(o.id)
	o.owner = owner
	o.controller = owner
	o.base_controller = owner
	o.zone = zone
	o.incarnation = 1
	o.name = face.name
	o.card_types = face.card_type
	o.mana_cost = face.mana_cost
	o.keywords = slice.clone_to_dynamic(face.keywords[:])
	o.color = object_colors(face)
	o.power = pt_value(face.power)
	o.toughness = pt_value(face.toughness)
	o.layer_base_power = o.power
	o.layer_base_toughness = o.toughness
	abilities := new([dynamic]types.AbilityDefinition)
	abilities^ = slice.clone_to_dynamic(face.abilities[:])
	o.abilities = abilities
	triggers := new([dynamic]types.TriggerEntry)
	for t in face.triggers do append(triggers, types.TriggerEntry{definition = t})
	o.trigger_definitions = types.Definitions_TriggerEntry(triggers)
	statics := new([dynamic]types.StaticDefinition)
	statics^ = slice.clone_to_dynamic(face.static_abilities[:])
	o.static_definitions = types.Definitions_StaticDefinition(statics)
	replacements := new([dynamic]types.ReplacementDefinition)
	replacements^ = slice.clone_to_dynamic(face.replacements[:])
	o.replacement_definitions = types.Definitions_ReplacementDefinition(replacements)
	if id, ok := face.scryfall_oracle_id.?; ok do o.printed_ref = types.PrintedCardRef{oracle_id = id, face_name = face.name}

	// The printed values, kept apart from the current ones that effects change (CR 613).
	o.base_name = o.name
	o.base_card_types = o.card_types
	o.base_mana_cost = o.mana_cost
	o.base_keywords = o.keywords
	o.base_color = o.color
	o.base_power = o.power
	o.base_toughness = o.toughness
	o.base_abilities = o.abilities
	o.base_static_definitions = (^[dynamic]types.StaticDefinition)(o.static_definitions)
	o.base_replacement_definitions = (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)
	o.base_printed_ref = o.printed_ref
	o.base_characteristics_initialized = true
	s.objects.inner[o.id] = o
	return o
}

// CR 202.2: an object's colors are the colors of the mana symbols in its mana cost, unless a color indicator or a
// characteristic-defining ability (the card data's color override) says otherwise (CR 202.2e, 204).
object_colors :: proc(face: ^types.CardFace) -> [dynamic]types.ManaColor {
	if override, ok := face.color_override.?; ok do return slice.clone_to_dynamic(override[:])
	colors: bit_set[types.ManaColor]
	if cost, ok := face.mana_cost.(types.ManaCost_Cost); ok {
		for shard in cost.shards do colors += shard_colors(shard)
	}
	out: [dynamic]types.ManaColor
	for c in types.ManaColor do if c in colors do append(&out, c)
	return out
}

// The colors a mana symbol has (CR 107.4): hybrid symbols have both of theirs, Phyrexian ones their color.
shard_colors :: proc(shard: types.ManaCostShard) -> bit_set[types.ManaColor] {
	#partial switch shard {
	case .White, .TwoWhite, .PhyrexianWhite, .ColorlessWhite:
		return {.White}
	case .Blue, .TwoBlue, .PhyrexianBlue, .ColorlessBlue:
		return {.Blue}
	case .Black, .TwoBlack, .PhyrexianBlack, .ColorlessBlack:
		return {.Black}
	case .Red, .TwoRed, .PhyrexianRed, .ColorlessRed:
		return {.Red}
	case .Green, .TwoGreen, .PhyrexianGreen, .ColorlessGreen:
		return {.Green}
	case .WhiteBlue, .PhyrexianWhiteBlue:
		return {.White, .Blue}
	case .WhiteBlack, .PhyrexianWhiteBlack:
		return {.White, .Black}
	case .BlueBlack, .PhyrexianBlueBlack:
		return {.Blue, .Black}
	case .BlueRed, .PhyrexianBlueRed:
		return {.Blue, .Red}
	case .BlackRed, .PhyrexianBlackRed:
		return {.Black, .Red}
	case .BlackGreen, .PhyrexianBlackGreen:
		return {.Black, .Green}
	case .RedWhite, .PhyrexianRedWhite:
		return {.Red, .White}
	case .RedGreen, .PhyrexianRedGreen:
		return {.Red, .Green}
	case .GreenWhite, .PhyrexianGreenWhite:
		return {.Green, .White}
	case .GreenBlue, .PhyrexianGreenBlue:
		return {.Green, .Blue}
	}
	return {}
}

// A printed power or toughness: a number, or none for a characteristic-defining "*" (computed elsewhere, CR 208.2a).
pt_value :: proc(v: Maybe(types.PtValue)) -> Maybe(i32) {
	pv, ok := v.?
	if !ok do return nil
	if fixed, is_fixed := pv.(types.PtValue_Fixed); is_fixed do return fixed._0
	return i32(0)
}

// CR 121.2: a player draws the top card of their library into their hand. The top of a library is its last element.
draw_card :: proc(s: ^types.GameState, p: ^types.Player) -> bool {
	n := types.pvec_len(p.library)
	if n == 0 {
		// CR 704.5b: drawing from an empty library loses the game at the next state-based action check.
		p.drew_from_empty_library = true
		return false
	}
	id := types.pvec_pop(&p.library, copy_id)
	types.pvec_push(&p.hand, id, copy_id)
	s.objects.inner[id].zone = .Hand
	p.cards_drawn_this_turn += 1
	return true
}

// An object id has nothing owned to copy, for the persistent vectors' copy-on-write.
copy_id :: proc(x: types.ObjectId) -> types.ObjectId {return x}

// The generator of a restored game: the saved seed, continued from the saved stream position.
restored_rng :: proc(s: types.GameState) -> rng.Chacha20 {
	r := rng.from_u64(s.rng_seed)
	rng.set_word_pos(&r, s.rng_word_pos)
	return r
}
