// Rules tests for the Odin engine (odin/engine/game), each naming the CR rule it checks. They need the generated card
// data (./scripts/gen-card-data.sh, client/public/card-data.json); without it they're skipped.
// Run: odin test odin/tests/game
package game_test

import "core:os"
import "core:sync"
import "core:testing"
import carddb "../../engine/carddb"
import game "../../engine/game"
import types "../../engine/types"

CARD_DATA :: "client/public/card-data.json"

@(private = "file")
db: carddb.DB
@(private = "file")
db_once: sync.Once
@(private = "file")
db_ok: bool

load_db :: proc() -> bool {
	sync.once_do(&db_once, proc() {
		data, err := os.read_entire_file(CARD_DATA, context.allocator)
		if err != nil do return
		db_ok = carddb.load(&db, string(data))
	})
	return db_ok
}

lookup :: proc(name: string) -> ^types.CardExportEntry {
	e, _ := carddb.find(&db, name)
	return e
}

card :: proc(t: ^testing.T, name: string) -> ^types.CardExportEntry {
	e, ok := carddb.find(&db, name)
	testing.expectf(t, ok, "card %q is in the card data", name)
	return e
}

// A two-player game past the mulligans: player 0's precombat main phase on turn 2, priority to player 0. Decks of
// basic lands, so nothing else is around unless a test adds it.
new_game :: proc() -> ^game.Game {
	lands := make([]^types.CardExportEntry, 40)
	forest, _ := carddb.find(&db, "Forest")
	for &l in lands do l = forest
	decks := []game.Deck{{main = lands}, {main = lands}}
	format: types.FormatConfig
	format.starting_life = 20
	g := game.start_game(decks, 1, format, 0, lookup)
	s := &g.state
	s.turn_number = 2
	s.phase = .PreCombatMain
	s.active_player = 0
	s.priority_player = 0
	s.waiting_for = types.WaitingFor_Priority{player = 0}
	return g
}

// Puts a card's object straight into a zone, as a test setup: on the battlefield it has been there since the turn
// began (no summoning sickness).
add :: proc(t: ^testing.T, g: ^game.Game, name: string, owner: types.PlayerId, zone: types.Zone) -> ^types.GameObject {
	o := game.new_card_object(&g.state, card(t, name), owner, zone)
	list := game.zone_list(&g.state, zone, owner)
	types.pvec_push(list, o.id, game.copy_id)
	if zone == .Battlefield do o.summoning_sick = false
	game.apply_continuous_effects(g)
	return o
}

cost_of :: proc(t: ^testing.T, name: string) -> types.ManaCost {return card(t, name).face.mana_cost}

@(test)
dual_land_pays_either_color :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 605.3a: any of a permanent's mana abilities can be activated. Scrubland makes {W} or {B}.
	g := new_game()
	add(t, g, "Scrubland", 0, .Battlefield)
	add(t, g, "Swamp", 0, .Battlefield)
	_, ok := game.plan_payment(&g.state, 0, cost_of(t, "Hymn to Tourach")) // {B}{B}
	testing.expect(t, ok, "Scrubland and Swamp pay {B}{B}")
}

@(test)
payment_tries_every_color_assignment :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 601.2h: a cost that some assignment of sources pays is payable.
	g := new_game()
	add(t, g, "Bloodstone Cameo", 0, .Battlefield) // {B} or {R}
	add(t, g, "Drake-Skull Cameo", 0, .Battlefield) // {U} or {B}
	_, ok := game.plan_payment(&g.state, 0, cost_of(t, "Terminate")) // {B}{R}
	testing.expect(t, ok, "the Cameos pay {B}{R}")
}

@(test)
lands_are_tapped_before_creatures :: proc(t: ^testing.T) {
	if !load_db() do return
	// The player pays (CR 601.2g-h); the automatic payment keeps creatures free when lands can pay.
	g := new_game()
	add(t, g, "Forest", 0, .Battlefield)
	elves := add(t, g, "Llanowar Elves", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	taps, ok := game.plan_payment(&g.state, 0, cost_of(t, "Grizzly Bears")) // {1}{G}
	testing.expect(t, ok)
	for o in taps do testing.expect(t, o.id != elves.id, "Llanowar Elves stays untapped")
}

@(test)
no_mana_cost_is_unpayable :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 118.6: an object with no mana cost can't be cast by paying it.
	g := new_game()
	add(t, g, "Forest", 0, .Battlefield)
	_, ok := game.plan_payment(&g.state, 0, types.ManaCost_NoCost{})
	testing.expect(t, !ok)
}

@(test)
unsupported_riders_and_alternate_payments :: proc(t: ^testing.T) {
	if !load_db() do return
	// Supported means every part is carried out: mana riders (CR 605.3b, 602.5), Phyrexian mana (CR 107.4f), and a
	// mass pump misparsed as a single "any target" pump aren't yet.
	for name in ([]string{"Ancient Tomb", "Karplusan Forest", "Temple of the False God", "Gut Shot", "Defensive Maneuvers"}) {
		testing.expectf(t, !game.card_supported(&card(t, name).face), "%s isn't supported yet", name)
	}
	for name in ([]string{"Grizzly Bears", "Shock", "Scrubland", "Llanowar Elves"}) {
		testing.expectf(t, game.card_supported(&card(t, name).face), "%s is supported", name)
	}
}

// Player 0 attacks with a Grizzly Bears; the game moves to the declare attackers step and asks.
attack_with_bears :: proc(t: ^testing.T) -> (^game.Game, ^types.GameObject) {
	g := new_game()
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{bears.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	return g, bears
}

attacks_dynamic :: proc(a: []types.Tuple2(types.ObjectId, types.AttackTarget)) -> [dynamic]types.Tuple2(types.ObjectId, types.AttackTarget) {
	out: [dynamic]types.Tuple2(types.ObjectId, types.AttackTarget)
	append(&out, ..a)
	return out
}

@(test)
attacker_that_leaves_is_removed_from_combat :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 506.4: a permanent that leaves the battlefield is removed from combat.
	g, bears := attack_with_bears(t)
	game.move_object(g, bears.id, .Graveyard)
	c, _ := g.state.combat.?
	testing.expect(t, len(c.attackers) == 0)
}

@(test)
blocking_needs_a_creature_on_the_battlefield :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 509.1a: the defending player blocks with creatures they control, which are on the battlefield.
	g, bears := attack_with_bears(t)
	in_hand := add(t, g, "Grizzly Bears", 1, .Hand)
	game.pass_priority(g, 0)
	game.pass_priority(g, 1) // to the declare blockers step
	blocks: [dynamic]types.Tuple2(types.ObjectId, types.ObjectId)
	append(&blocks, types.Tuple2(types.ObjectId, types.ObjectId){in_hand.id, bears.id})
	testing.expect(t, !game.apply(g, 1, types.GameAction_DeclareBlockers{assignments = blocks}))
}

@(test)
player_concedes_only_for_themselves :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 104.3a: a player can concede; the other player can't concede for them.
	g := new_game()
	testing.expect(t, !game.apply(g, 0, types.GameAction_Concede{player_id = 1}))
	testing.expect(t, game.apply(g, 1, types.GameAction_Concede{player_id = 1}))
}

@(test)
discard_choice_rejects_repeated_cards :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 514.1: discard down to seven: as many different cards as the excess.
	g := new_game()
	s := &g.state
	hand := game.ids_of(game.player(s, 0).hand)
	extra := add(t, g, "Forest", 0, .Hand)
	cards: [dynamic]types.ObjectId
	append(&cards, ..hand)
	append(&cards, extra.id)
	append(&cards, add(t, g, "Forest", 0, .Hand).id)
	s.waiting_for = types.WaitingFor_DiscardToHandSize{player = 0, count = 2, cards = cards}
	twice: [dynamic]types.ObjectId
	append(&twice, extra.id, extra.id)
	testing.expect(t, !game.apply(g, 0, types.GameAction_SelectCards{cards = twice}))
}
