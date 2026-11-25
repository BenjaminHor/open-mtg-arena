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
	main:       []^types.CardExportEntry,
	commanders: []^types.CardExportEntry, // CR 903.3: a Commander game's commander(s), outside the 99
}

Game :: struct {
	state:   types.GameState,
	rng:     rng.Chacha20,
	card_db: Card_Lookup, // the card each object was made from, to tell what this engine supports of it
	pending: Pending_Cast, // a spell being cast while its targets are chosen
	// "Until end of turn" changes to power and toughness, undone in the cleanup step. Kept beside the state, so a
	// saved and restored game forgets them (to be moved into the state's continuous effects).
	pumps:   [dynamic]Pump,
	temp_effects: [dynamic]Temp_Effect, // other "until end of turn" effects, kept the same way
	bottoms: [dynamic]types.MulliganBottomEntry, // players who kept after mulligans, owing cards to the bottom
	// Triggered abilities (triggers.odin): what happened since the last check, what triggered and waits to go on the
	// stack, a trigger whose targets are being chosen, and the definition of each ability on the stack. Kept beside
	// the state like the pumps: a restored game loses abilities that were mid-flight.
	events:            [dynamic]Event,
	pending_triggers:  [dynamic]Pending_Trigger,
	delayed_marks:     [dynamic]Delayed_Mark, // where each delayed ability created since then began (CR 603.7a)
	trigger_targets:   Trigger_Target_Choice,
	stack_abilities:   map[types.ObjectId]^types.AbilityDefinition,
	stack_conditions:  map[types.ObjectId]Stack_Condition, // triggered abilities with an intervening "if" (CR 603.4)
	stack_events: map[types.ObjectId]Trigger_Event,
	stack_sources: map[types.ObjectId]^types.GameObject, // a triggered ability's source as it was put on the stack (CR 608.2h)
	priority_after: Maybe(types.PlayerId), // who gets priority once the triggers being put on the stack are (CR 117.3c)
	stack_crews:  map[types.ObjectId]u64,
	stack_transforms: map[types.ObjectId]u32, // an ability on the stack: its source's transformation count then (CR 701.27g)
	attacked_planeswalkers: map[types.ObjectId]u64, // this combat's attacked planeswalkers, as they were (CR 506.4) // a crew ability on the stack: its Vehicle's incarnation then (CR 400.7) // a triggered ability's event: "that much damage", "that creature"
	optional_entry:    types.StackEntry, // a "may" ability waiting for its controller's answer
	optional_accepted: bool,
	damage_progress:   Combat_Damage_Progress, // a combat damage step waiting on damage divisions
	resolution:        Resolution, // a spell or ability partway through resolving, waiting on a choice
	// Permanents that entered with "as this enters, you may pay N life", riot or "your choice of" counters whose
	// controller hasn't chosen yet, and who gets priority once they have (replacements.odin).
	entry_choices:     [dynamic]Entry_Option,
	entry_copies:      [dynamic]types.ObjectId, // entered with "you may have this enter as a copy", still to choose
	entry_names:       [dynamic]types.ObjectId, // entered with "as this enters, choose a color" (entry_choice.odin)
	entry_reveals:     [dynamic]types.ObjectId, // entered with "you may reveal a Goblin card from your hand"
	copy_exceptions:   map[types.ObjectId]Copy_Exceptions, // a copy's exceptions, for copies of it (CR 707.9b)
	mana_color_choice: Mana_Color_Choice, // mana of one color being added while an ability resolves (mana.odin)
	entry_after:       types.PlayerId,
	// "Gain control of target creature until end of turn": who controlled it before, to give it back (kept beside
	// the state like the pumps).
	control_changes:   [dynamic]Control_Change,
	preventions:       [dynamic]Prevention, // damage prevention shields lasting the turn (prevention.odin)
	permission_ends:   [dynamic]Permission_End, // when the play-from-exile permissions end (impulse.odin)
	// Permanents whose shield counter already prevented damage in the combat damage being dealt now: the rest of
	// that simultaneous damage is prevented too (CR 122.1c, 510.2).
	shielded:          [dynamic]types.ObjectId,
	exile_instead:     [dynamic]Control_Change, // "if it would die this turn, exile it instead" (prevention.odin)
	dealing_combat:    bool,
}

Control_Change :: struct {
	object:      types.ObjectId,
	incarnation: u64,
	previous:    types.PlayerId,
	until_eot:   bool,
}

// CR 103: starts a two-player game. The first player (CR 103.1) is given; each library is shuffled with the game's
// seeded generator (CR 103.3), each player's life is the format's starting life (CR 103.4), each draws seven cards
// (CR 103.5) and the game waits for the starting player's mulligan declaration, then the others' in turn order.
start_game :: proc(decks: []Deck, seed: u64, format: types.FormatConfig, first_player: types.PlayerId, card_db: Card_Lookup) -> ^Game {
	g := new(Game)
	begin_report(g)
	report(types.GameEvent_GameStarted{})
	g.card_db = card_db
	current_card_db = card_db
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
		// CR 903.6: each player's commander starts face up in the command zone.
		for c in deck.commanders {
			obj := new_card_object(s, c, player, .Command)
			obj.is_commander = true
			types.pvec_push_new(&s.command_zone, obj.id)
		}
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
		append(&pending, types.MulliganDecisionEntry{player = types.PlayerId(seat), phase = types.MulliganDecisionPhase_Declare{}})
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
	o.phase_status = types.PhaseStatus_PhasedIn{} // CR 702.26: permanents are phased in unless something phases them out
	set_card_characteristics(o, face)
	note_back_face(o, card)
	s.objects.inner[o.id] = o
	return o
}

// The characteristics a card gives its object (CR 109.3), current and printed alike: also what a copy of that card
// takes (CR 707.2).
set_card_characteristics :: proc(o: ^types.GameObject, face: ^types.CardFace) {
	o.name = face.name
	o.card_types = face.card_type
	o.mana_cost = face.mana_cost
	o.keywords = slice.clone_to_dynamic(face.keywords[:])
	o.color = object_colors(face)
	// CR 702.114a: devoid, "this object is colorless", a characteristic-defining ability that works everywhere.
	for k in face.keywords do if _, devoid := k.(types.Keyword_Devoid); devoid do clear(&o.color)
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
	// How it's cast: its modes (CR 700.2), additional costs (CR 601.2b) and casting rules, part of the object.
	o.modal = face.modal
	o.additional_cost = face.additional_cost
	o.casting_restrictions = slice.clone_to_dynamic(face.casting_restrictions[:])
	o.strive_cost = face.strive_cost
	o.cleave_variant = face.cleave_variant

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
	report_zone_change(s, id, .Library, .Hand)
	report(types.GameEvent_CardDrawn{player_id = p.id, object_id = id, nth_in_turn = p.cards_drawn_this_turn})
	// CR 121.2: each card drawn is its own event ("whenever you draw a card").
	if action_events != nil do append(action_events, Event{kind = .Card_Drawn, controller = p.id, amount = 1, before = int(p.cards_drawn_this_turn) - 1})
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
