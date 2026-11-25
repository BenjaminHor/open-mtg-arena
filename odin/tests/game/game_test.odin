// Rules tests for the Odin engine (odin/engine/game), each naming the CR rule it checks. They need the generated card
// data (./scripts/gen-card-data.sh, client/public/card-data.json); without it they're skipped.
// Run: odin test odin/tests/game
package game_test

import "core:os"
import "core:sync"
import "core:slice"
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
		game.other_face_lookup = proc(e: ^types.CardExportEntry) -> ^types.CardExportEntry {
			sync.mutex_lock(&db_lock)
			defer sync.mutex_unlock(&db_lock)
			f, _ := carddb.other_face(&db, e)
			return f
		}
	})
	return db_ok
}

// The card database decodes cards lazily into a shared map, and the test runner runs tests on several threads.
@(private = "file")
db_lock: sync.Mutex

find :: proc(name: string) -> (^types.CardExportEntry, bool) {
	sync.mutex_lock(&db_lock)
	defer sync.mutex_unlock(&db_lock)
	return carddb.find(&db, name)
}

lookup :: proc(name: string) -> ^types.CardExportEntry {
	e, _ := find(name)
	return e
}

card :: proc(t: ^testing.T, name: string) -> ^types.CardExportEntry {
	e, ok := find(name)
	testing.expectf(t, ok, "card %q is in the card data", name)
	return e
}

// A two-player game past the mulligans: player 0's precombat main phase on turn 2, priority to player 0. Decks of
// basic lands, so nothing else is around unless a test adds it.
new_game :: proc() -> ^game.Game {
	lands := make([]^types.CardExportEntry, 40)
	forest, _ := find("Forest")
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
	// Supported means every part is carried out: Phyrexian mana (CR 107.4f) and a mass pump misparsed as a single
	// "any target" pump aren't yet. Damage to you as a mana ability resolves (CR 605.3b: Ancient Tomb, the
	// painlands) is.
	for name in ([]string{"Gut Shot", "Defensive Maneuvers"}) {
		testing.expectf(t, !game.card_supported(&card(t, name).face), "%s isn't supported yet", name)
	}
	for name in ([]string{"Grizzly Bears", "Shock", "Scrubland", "Llanowar Elves", "Ancient Tomb", "Karplusan Forest"}) {
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

// Player 0 attacks with `attacker`; player 1 blocks with `blockers`; the game reaches combat damage.
fight :: proc(t: ^testing.T, attacker: string, blockers: []string) -> (^game.Game, ^types.GameObject, [dynamic]^types.GameObject) {
	g := new_game()
	a := add(t, g, attacker, 0, .Battlefield)
	bs: [dynamic]^types.GameObject
	for name in blockers do append(&bs, add(t, g, name, 1, .Battlefield))
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{a.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	blocks: [dynamic]types.Tuple2(types.ObjectId, types.ObjectId)
	for b in bs do append(&blocks, types.Tuple2(types.ObjectId, types.ObjectId){b.id, a.id})
	testing.expect(t, game.apply(g, 1, types.GameAction_DeclareBlockers{assignments = blocks}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	return g, a, bs
}

@(test)
attacker_divides_damage_among_blockers :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 510.1c: with two or more blockers, the attacking creature's controller divides its damage as they choose.
	g, wurm, bs := fight(t, "Spined Wurm", {"Grizzly Bears", "Air Elemental"}) // 5/4 against 2/2 and 4/4
	w, asked := g.state.waiting_for.(types.WaitingFor_AssignCombatDamage)
	testing.expect(t, asked && w.player == 0 && w.total_damage == 5, "player 0 is asked to divide 5 damage")
	division: [dynamic]types.Tuple2(types.ObjectId, u32)
	append(&division, types.Tuple2(types.ObjectId, u32){bs[1].id, 4}, types.Tuple2(types.ObjectId, u32){bs[0].id, 1})
	testing.expect(t, game.apply(g, 0, types.GameAction_AssignCombatDamage{mode = .Normal, assignments = division}))
	testing.expect(t, bs[1].zone == .Graveyard, "the 4/4 got 4 and died")
	testing.expect(t, bs[0].zone == .Battlefield, "the 2/2 got 1 and lived")
	_ = wurm
}

@(test)
trample_needs_lethal_on_blockers_first :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.19b: excess damage goes to the player only once every blocker is assigned lethal damage.
	g, _, bs := fight(t, "Colossal Dreadmaw", {"Grizzly Bears"}) // 6/6 trample against a 2/2
	short: [dynamic]types.Tuple2(types.ObjectId, u32)
	append(&short, types.Tuple2(types.ObjectId, u32){bs[0].id, 1})
	testing.expect(t, !game.apply(g, 0, types.GameAction_AssignCombatDamage{mode = .Normal, assignments = short, trample_damage = 5}))
	lethal: [dynamic]types.Tuple2(types.ObjectId, u32)
	append(&lethal, types.Tuple2(types.ObjectId, u32){bs[0].id, 2})
	testing.expect(t, game.apply(g, 0, types.GameAction_AssignCombatDamage{mode = .Normal, assignments = lethal, trample_damage = 4}))
	testing.expect(t, game.player(&g.state, 1).life == 16, "4 trampled over")
}

@(test)
target_that_left_and_returned_is_a_new_object :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 400.7, 608.2b: a creature that leaves the battlefield and comes back is a new object, so a spell that
	// targeted it has no legal target and doesn't resolve.
	g := new_game()
	add(t, g, "Mountain", 0, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	game.move_object(g, bears.id, .Hand) // bounced in response...
	game.move_object(g, bears.id, .Battlefield) // ...and back
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, shock.zone == .Graveyard, "Shock left the stack")
	testing.expect(t, bears.damage_marked == 0 && bears.zone == .Battlefield, "the new Grizzly Bears took no damage")
}

@(test)
casting_an_instant_triggers_young_pyromancer :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 601.2i, 603.2: "whenever you cast an instant or sorcery spell" triggers once the spell is cast, and its
	// ability resolves before the spell (it's put on the stack above it).
	g := new_game()
	add(t, g, "Young Pyromancer", 0, .Battlefield)
	add(t, g, "Mountain", 0, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	testing.expect(t, types.pvec_len(g.state.stack) == 2, "Shock and the trigger are on the stack")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	tokens := 0
	for id in game.ids_of(g.state.battlefield) do if game.object(&g.state, id).is_token do tokens += 1
	testing.expect(t, tokens == 1, "an Elemental token")
	testing.expect(t, game.player(&g.state, 1).life == 20, "Shock hasn't resolved yet")
}

@(test)
damage_to_each_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	// Tremor: 1 damage to each creature without flying (CR 120.3, 704.5g).
	g := new_game()
	add(t, g, "Mountain", 0, .Battlefield)
	tremor := add(t, g, "Tremor", 0, .Hand)
	elves := add(t, g, "Llanowar Elves", 1, .Battlefield)
	bird := add(t, g, "Suntail Hawk", 1, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = tremor.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, elves.zone == .Graveyard, "the 1/1 without flying died")
	testing.expect(t, bird.zone == .Battlefield, "the flyer was spared")
	testing.expect(t, bears.zone == .Battlefield && bears.damage_marked == 1, "the 2/2 took 1")
}

@(test)
commander_cast_from_command_zone_with_tax :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 903.6: the commander starts in the command zone. CR 903.8: it can be cast from there, for {2} more for
	// each earlier cast from there. CR 903.9a: when it dies it goes back to the command zone.
	lands := make([]^types.CardExportEntry, 40)
	for &l in lands do l = card(t, "Forest")
	commanders := []^types.CardExportEntry{card(t, "Grizzly Bears")} // any creature will do for the zone rules
	format: types.FormatConfig
	format.starting_life = 40
	g := game.start_game([]game.Deck{{main = lands, commanders = commanders}, {main = lands}}, 1, format, 0, lookup)
	s := &g.state
	testing.expect(t, types.pvec_len(s.command_zone) == 1, "the commander is in the command zone")
	commander := game.object(s, types.pvec_get(s.command_zone, 0))
	s.turn_number, s.phase, s.active_player = 2, .PreCombatMain, 0
	s.waiting_for = types.WaitingFor_Priority{player = 0}
	for _ in 0 ..< 4 do add(t, g, "Forest", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = commander.id}), "cast from the command zone")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, commander.zone == .Battlefield)
	game.destroy(g, commander)
	game.check_state_based_actions(g)
	testing.expect(t, commander.zone == .Command, "back to the command zone")
	// Second cast: {1}{G} + {2} = four mana; three untapped Forests aren't enough, four are.
	for id in game.ids_of(s.battlefield) do game.object(s, id).tapped = false
	game.object(s, game.ids_of(s.battlefield)[0]).tapped = true
	testing.expect(t, !game.castable(s, 0, commander, lookup), "three lands don't pay the tax")
	game.object(s, game.ids_of(s.battlefield)[0]).tapped = false
	testing.expect(t, game.castable(s, 0, commander, lookup), "four lands do")
}

@(test)
until_end_of_turn_grant_ends_in_cleanup :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 611.2, 514.2: "until end of turn" effects end in the cleanup step.
	g := new_game()
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	add(t, g, "Plains", 0, .Battlefield)
	spell := add(t, g, "Gods Willing", 0, .Hand) // protection from a color; or any +N/+N grant
	_ = spell
	e := types.Effect_GenericEffect{duration = types.Duration_UntilEndOfTurn{}}
	st: types.StaticDefinition
	st.mode = types.StaticMode_Continuous{}
	st.affected = types.TargetFilter_ParentTarget{}
	append(&st.modifications, types.ContinuousModification(types.ContinuousModification_AddKeyword{keyword = types.Keyword_Flying{}}))
	append(&st.modifications, types.ContinuousModification(types.ContinuousModification_AddPower{value = 2}))
	append(&e.static_abilities, st)
	game.add_temp_effect(g, e, 0, bears.id, bears)
	testing.expect(t, game.has_keyword(bears, types.Keyword_Flying) && game.power_of(bears) == 4, "flying and +2/+0")
	game.end_until_end_of_turn_effects(g)
	testing.expect(t, !game.has_keyword(bears, types.Keyword_Flying) && game.power_of(bears) == 2, "gone after cleanup")
}

@(test)
combat_damage_to_a_player_triggers :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.2, 510.2: "whenever this deals combat damage to a player" triggers on the combat damage event.
	g := new_game()
	thief := add(t, g, "Scroll Thief", 0, .Battlefield) // draw a card
	testing.expect(t, game.card_supported(&card(t, "Scroll Thief").face))
	hand_before := types.pvec_len(game.player(&g.state, 0).hand)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{thief.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	for _ in 0 ..< 8 {
		if game.player(&g.state, 1).life < 20 && types.pvec_len(g.state.stack) == 0 && types.pvec_len(game.player(&g.state, 0).hand) > hand_before do break
		who, _ := game.acting_player(&g.state)
		#partial switch _ in g.state.waiting_for {
		case types.WaitingFor_DeclareBlockers:
			game.apply(g, who, types.GameAction_DeclareBlockers{})
		case:
			game.apply(g, who, types.GameAction_PassPriority{})
		}
	}
	testing.expect(t, game.player(&g.state, 1).life == 19, "1 combat damage")
	testing.expect(t, types.pvec_len(game.player(&g.state, 0).hand) == hand_before + 1, "the trigger drew a card")
}

@(test)
scry_two_one_to_the_bottom :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 701.22a: scry 2: look at the top two, put any on the bottom and the rest on top in any order. The spell
	// finishes resolving after the choice (Opt: scry 1, then draw a card).
	g := new_game()
	add(t, g, "Island", 0, .Battlefield)
	opt := add(t, g, "Opt", 0, .Hand)
	pl := game.player(&g.state, 0)
	top := types.pvec_get(pl.library, types.pvec_len(pl.library) - 1)
	second := types.pvec_get(pl.library, types.pvec_len(pl.library) - 2)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = opt.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	w, asked := g.state.waiting_for.(types.WaitingFor_ScryChoice)
	testing.expect(t, asked && len(w.cards) == 1 && w.cards[0] == top, "asked about the top card")
	none: [dynamic]types.ObjectId
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = none}), "it goes to the bottom")
	testing.expect(t, types.pvec_get(pl.library, 0) == top, "the scried card is on the bottom")
	testing.expect(t, game.object(&g.state, second).zone == .Hand, "then Opt drew the next card")
	testing.expect(t, opt.zone == .Graveyard, "and Opt finished resolving")
}

@(test)
draw_a_card_for_each_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 608.2h: an amount that depends on the game is worked out as the instruction is carried out.
	g := new_game()
	for _ in 0 ..< 6 do add(t, g, "Forest", 0, .Battlefield)
	add(t, g, "Grizzly Bears", 0, .Battlefield)
	add(t, g, "Llanowar Elves", 0, .Battlefield)
	add(t, g, "Grizzly Bears", 1, .Battlefield) // the opponent's doesn't count
	spell := add(t, g, "Collective Unconscious", 0, .Hand) // {4}{G}: draw a card for each creature you control
	before := types.pvec_len(game.player(&g.state, 0).hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, types.pvec_len(game.player(&g.state, 0).hand) == before - 1 + 2, "two cards drawn")
}

@(test)
creature_that_cant_block :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 509.1b: a blocking restriction ("can't block") makes that block illegal.
	g := new_game()
	goblin := add(t, g, "Hulking Goblin", 1, .Battlefield) // can't block
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, !game.can_block(g, goblin, bears))
	warrior := add(t, g, "Phantom Warrior", 0, .Battlefield) // can't be blocked
	other := add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, !game.can_block(g, other, warrior), "Phantom Warrior can't be blocked")
	testing.expect(t, game.can_block(g, other, bears))
}

@(test)
creature_that_must_attack :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 508.1d: a declaration that leaves out a creature that attacks each combat if able is illegal.
	g := new_game()
	cyclops := add(t, g, "Bloodrock Cyclops", 0, .Battlefield) // attacks each combat if able
	game.begin_step(g, .DeclareAttackers)
	none: [dynamic]types.Tuple2(types.ObjectId, types.AttackTarget)
	testing.expect(t, !game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = none}), "it has to attack")
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{cyclops.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
}

@(test)
aura_enters_attached_and_leaves_with_its_host :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 303.4a, 608.3c: an Aura spell targets what it can enchant and enters attached to it. CR 704.5m: when the
	// host leaves, the Aura goes to the graveyard.
	g := new_game()
	add(t, g, "Plains", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	aura := add(t, g, "Holy Strength", 0, .Hand) // enchanted creature gets +1/+2
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = aura.id}))
	game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}})
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, aura.zone == .Battlefield && game.host_of(&g.state, aura) == bears, "attached to the Bears")
	testing.expect(t, game.power_of(bears) == 3 && game.toughness_of(bears) == 4, "3/4")
	game.destroy(g, bears)
	game.check_state_based_actions(g)
	testing.expect(t, aura.zone == .Graveyard, "the Aura went to the graveyard")
}

@(test)
equip_moves_the_bonus :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.6a: equip attaches the Equipment to target creature you control; "equipped creature gets +2/+0".
	g := new_game()
	add(t, g, "Forest", 0, .Battlefield)
	splitter := add(t, g, "Bonesplitter", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = splitter.id, ability_index = 0}))
	game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}})
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, game.host_of(&g.state, splitter) == bears && game.power_of(bears) == 4, "the Bears are 4/2")
	game.destroy(g, bears)
	game.check_state_based_actions(g)
	testing.expect(t, splitter.zone == .Battlefield && game.host_of(&g.state, splitter) == nil, "unattached, still in play")
}

@(test)
characteristic_defining_and_conditional_statics :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 604.3, 613.4a: a */* creature's power and toughness come from its characteristic-defining ability.
	// CR 611.3b: a static ability with "as long as" applies only while the condition holds.
	g := new_game()
	for _ in 0 ..< 3 do add(t, g, "Forest", 0, .Battlefield)
	wurm := add(t, g, "Molimo, Maro-Sorcerer", 0, .Battlefield) // */* equal to the number of lands you control
	testing.expectf(t, game.power_of(wurm) == 3 && game.toughness_of(wurm) == 3, "3/3 with three lands, got %d/%d", game.power_of(wurm), game.toughness_of(wurm))
	add(t, g, "Forest", 0, .Battlefield)
	testing.expect(t, game.power_of(wurm) == 4, "4/4 with four")
}

@(test)
target_player_discards_chosen_cards :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 701.9b: the discarding player chooses the cards (Mind Rot: target player discards two cards).
	g := new_game()
	for _ in 0 ..< 3 do add(t, g, "Swamp", 0, .Battlefield)
	rot := add(t, g, "Mind Rot", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = rot.id}))
	game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}})
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	w, asked := g.state.waiting_for.(types.WaitingFor_DiscardChoice)
	testing.expect(t, asked && w.player == 1 && w.count == 2, "player 1 chooses two")
	two: [dynamic]types.ObjectId
	append(&two, w.cards[0], w.cards[1])
	testing.expect(t, game.apply(g, 1, types.GameAction_SelectCards{cards = two}))
	testing.expect(t, types.pvec_len(game.player(&g.state, 1).graveyard) == 2 && rot.zone == .Graveyard)
}

@(test)
look_at_three_take_one :: proc(t: ^testing.T) {
	if !load_db() do return
	// Anticipate: look at the top three cards, put one into your hand and the rest on the bottom.
	g := new_game()
	for _ in 0 ..< 2 do add(t, g, "Island", 0, .Battlefield)
	spell := add(t, g, "Anticipate", 0, .Hand)
	pl := game.player(&g.state, 0)
	n := types.pvec_len(pl.library)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	w, asked := g.state.waiting_for.(types.WaitingFor_DigChoice)
	testing.expect(t, asked && len(w.cards) == 3 && w.keep_count == 1, "three to look at, one to keep")
	pick: [dynamic]types.ObjectId
	append(&pick, w.cards[1])
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = pick}))
	testing.expect(t, game.object(&g.state, w.cards[1]).zone == .Hand, "the pick is in hand")
	testing.expect(t, types.pvec_len(pl.library) == n - 1 && types.pvec_get(pl.library, 0) == w.cards[0], "the rest on the bottom")
}

@(test)
that_creature_cant_block_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 608.2c: "that creature" in Mugging's second sentence is the first sentence's target; CR 611.2a: "this
	// turn" ends with the turn, and the creature can block again afterwards.
	g := new_game()
	add(t, g, "Mountain", 0, .Battlefield)
	mugging := add(t, g, "Mugging", 0, .Hand) // {R}: 2 damage to target creature; that creature can't block this turn
	giant := add(t, g, "Hill Giant", 1, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = mugging.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{giant.id}}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, giant.damage_marked == 2, "2 damage dealt")
	testing.expect(t, !game.can_block(g, giant, bears), "the Giant can't block this turn")
	testing.expect(t, game.can_block(g, add(t, g, "Grizzly Bears", 1, .Battlefield), bears), "other creatures still can")
	game.end_until_end_of_turn_effects(g)
	testing.expect(t, game.can_block(g, giant, bears), "next turn it can block again")
}

@(test)
it_gains_hexproof :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 608.2c: "Put a +1/+1 counter on target creature you control. It gains hexproof": both on the target.
	g := new_game()
	add(t, g, "Forest", 0, .Battlefield)
	veil := add(t, g, "Snakeskin Veil", 0, .Hand)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	other := add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = veil.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, bears.power.? == 3, "the counter")
	testing.expect(t, game.keyword_in(bears, types.Keyword_Hexproof{}), "hexproof on the target")
	testing.expect(t, !game.keyword_in(other, types.Keyword_Hexproof{}), "and only on it")
}

@(test)
sacrifice_a_creature_as_a_cost :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 602.2b, 601.2h: the player chooses what to sacrifice as they pay the cost; CR 701.21a: only a permanent
	// they control. Nantuko Husk can sacrifice itself, since it's a creature too.
	g := new_game()
	husk := add(t, g, "Nantuko Husk", 0, .Battlefield) // Sacrifice a creature: +2/+2 until end of turn
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = husk.id, ability_index = 0}))
	w, asked := g.state.waiting_for.(types.WaitingFor_PayCost)
	testing.expect(t, asked && w.count == 1, "asked what to sacrifice")
	if !asked do return
	testing.expect(t, len(w.choices) == 2, "its controller's two creatures")
	for id in w.choices do testing.expect(t, id != theirs.id, "not the opponent's")
	wrong: [dynamic]types.ObjectId
	append(&wrong, theirs.id)
	testing.expect(t, !game.apply(g, 0, types.GameAction_SelectCards{cards = wrong}), "the opponent's creature isn't a choice")
	chosen: [dynamic]types.ObjectId
	append(&chosen, bears.id)
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = chosen}))
	testing.expect(t, bears.zone == .Graveyard, "sacrificed as the cost is paid")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, husk.zone == .Battlefield && husk.power.? == 4 && husk.toughness.? == 4, "then the ability resolves on the Husk")
}

@(test)
discard_a_card_as_a_cost :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 602.2b, 601.2h: "Discard a card" is paid from the hand; with an empty hand it can't be paid (CR 602.2b
	// via 601.2h: a cost that can't be paid can't be activated).
	g := new_game()
	mongrel := add(t, g, "Noose Constrictor", 0, .Battlefield) // Discard a card: +1/+1 until end of turn
	hand := &game.player(&g.state, 0).hand
	for types.pvec_len(hand^) > 0 do game.move_object(g, types.pvec_get(hand^, 0), .Library) // the hand itself, not a copy
	testing.expect(t, !game.can_activate(g, 0, mongrel, 0), "nothing to discard")
	add(t, g, "Forest", 0, .Hand)
	testing.expect(t, game.can_activate(g, 0, mongrel, 0), "a card to discard")
}

@(test)
heroic_triggers_on_a_spell_that_targets_it :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 601.2c, 603.2: a spell's targets are chosen as it's cast, so "whenever you cast a spell that targets this
	// creature" triggers then, and its ability resolves first: the +1/+1 counter lets the Hoplite survive Shock.
	g := new_game()
	for _ in 0 ..< 2 do add(t, g, "Mountain", 0, .Battlefield)
	hoplite := add(t, g, "Battlewise Hoplite", 0, .Battlefield) // heroic: +1/+1 counter, then scry 1
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	other := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = other.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{theirs.id}}))
	testing.expect(t, types.pvec_len(g.state.stack) == 1, "a spell aimed elsewhere doesn't trigger it")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	shock := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{hoplite.id}}))
	testing.expect(t, types.pvec_len(g.state.stack) == 2, "the heroic trigger is above Shock")
	for _ in 0 ..< 6 {
		if _, scry := g.state.waiting_for.(types.WaitingFor_ScryChoice); scry {
			none: [dynamic]types.ObjectId
			game.apply(g, 0, types.GameAction_SelectCards{cards = none})
		} else {
			game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
		}
		if types.pvec_len(g.state.stack) == 0 do break
	}
	testing.expect(t, hoplite.zone == .Battlefield && hoplite.damage_marked == 2, "3/3 with the counter, 2 damage")
}

@(test)
lands_that_enter_tapped_unless :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 614.1c, 614.12: "enters tapped unless you control two or fewer other lands" is checked as the land
	// enters; the land itself isn't one of the others.
	g := new_game()
	for _ in 0 ..< 2 do add(t, g, "Swamp", 0, .Battlefield)
	early := add(t, g, "Blackcleave Cliffs", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = early.id}))
	testing.expect(t, !early.tapped, "two other lands: untapped")
	late := add(t, g, "Blackcleave Cliffs", 0, .Hand)
	game.move_object(g, late.id, .Battlefield)
	testing.expect(t, late.tapped, "three other lands: tapped")
	// "Unless you control a Plains."
	castle := add(t, g, "Castle Ardenvale", 0, .Hand)
	game.move_object(g, castle.id, .Battlefield)
	testing.expect(t, castle.tapped, "no Plains: tapped")
	add(t, g, "Plains", 0, .Battlefield)
	castle2 := add(t, g, "Castle Ardenvale", 0, .Hand)
	game.move_object(g, castle2.id, .Battlefield)
	testing.expect(t, !castle2.tapped, "a Plains: untapped")
}

@(test)
damage_to_that_creatures_controller :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 608.2c: Chandra's Outrage deals 4 damage to target creature and 2 to "its controller", the controller of
	// that target; CR 608.2h: worked out as the instruction is carried out.
	g := new_game()
	for _ in 0 ..< 4 do add(t, g, "Mountain", 0, .Battlefield)
	outrage := add(t, g, "Chandra's Outrage", 0, .Hand)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = outrage.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, bears.zone == .Graveyard, "the creature is destroyed by lethal damage")
	testing.expect(t, game.player(&g.state, 1).life == 18 && game.player(&g.state, 0).life == 20, "its controller took 2")
}

@(test)
target_opponent_written_as_a_player_filter :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 115.1: "target opponent" can name only an opponent.
	g := new_game()
	f: types.TypedFilter
	f.controller = types.ControllerRef_Opponent{}
	legal := game.legal_targets(&g.state, types.TargetFilter_Typed{f}, 0)
	testing.expect(t, len(legal) == 1 && legal[0] == types.TargetRef(types.TargetRef_Player{1}), "only the opponent")
}

@(test)
spells_you_cast_cost_less :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 601.2f: the total cost is the mana cost minus cost reductions. Archmage of Runes: "Instant and sorcery
	// spells you cast cost {1} less to cast" (its controller's spells only).
	g := new_game()
	for _ in 0 ..< 2 do add(t, g, "Island", 0, .Battlefield)
	divination := add(t, g, "Divination", 0, .Hand) // {2}{U}
	testing.expect(t, !game.castable(&g.state, 0, divination, g.card_db), "three mana needed, two lands")
	add(t, g, "Archmage of Runes", 1, .Battlefield)
	testing.expect(t, !game.castable(&g.state, 0, divination, g.card_db), "the opponent's Archmage doesn't help")
	add(t, g, "Archmage of Runes", 0, .Battlefield)
	testing.expect(t, game.castable(&g.state, 0, divination, g.card_db), "{1}{U} with the Archmage")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = divination.id}))
	testing.expect(t, divination.zone == .Stack, "cast for two")
}

@(test)
intervening_if_is_checked_twice :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.4: "At the beginning of your upkeep, if you have seven or more cards in hand, you gain 4 life" triggers
	// only if the condition is true, and does nothing if it's false as the ability resolves.
	g := new_game()
	add(t, g, "Ivory Crane Netsuke", 0, .Battlefield)
	hand := &game.player(&g.state, 0).hand
	for types.pvec_len(hand^) > 0 do game.move_object(g, types.pvec_get(hand^, 0), .Library) // the hand itself, not a copy
	game.begin_step(g, .Upkeep)
	testing.expect(t, types.pvec_len(g.state.stack) == 0, "an empty hand: no trigger")

	for _ in 0 ..< 7 do add(t, g, "Forest", 0, .Hand)
	game.begin_step(g, .Upkeep)
	testing.expect(t, types.pvec_len(g.state.stack) == 1, "seven cards: it triggers")
	game.move_object(g, types.pvec_get(hand^, 0), .Graveyard) // down to six before it resolves
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, types.pvec_len(g.state.stack) == 0 && game.player(&g.state, 0).life == 20, "six cards on resolution: nothing")

	add(t, g, "Forest", 0, .Hand)
	game.begin_step(g, .Upkeep)
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, game.player(&g.state, 0).life == 24, "seven cards throughout: 4 life")
}

@(test)
amounts_from_zones_and_players :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 608.2h: amounts read from the game: "the number of creature cards in your graveyard", your life total,
	// and (CR 202.3) a mana value.
	g := new_game()
	s := &g.state
	add(t, g, "Grizzly Bears", 0, .Graveyard)
	add(t, g, "Shock", 0, .Graveyard)
	add(t, g, "Hill Giant", 1, .Graveyard) // the opponent's
	creature_cards := types.QuantityRef_ZoneCardCount{zone = .Graveyard, scope = .Controller}
	append(&creature_cards.card_types, types.TypeFilter(types.TypeFilter_Creature{}))
	q := types.QuantityExpr(types.QuantityExpr_Ref{creature_cards})
	testing.expect(t, game.quantity_supported(q))
	testing.expect(t, game.quantity_value(s, q, 0, 0, 0) == 1, "one creature card in your graveyard")
	creature_cards.scope = .All
	testing.expect(t, game.quantity_value(s, types.QuantityExpr_Ref{creature_cards}, 0, 0, 0) == 2, "two in all graveyards")
	life := types.QuantityExpr(types.QuantityExpr_Ref{types.QuantityRef_LifeTotal{player = types.PlayerScope_Controller{}}})
	testing.expect(t, game.quantity_value(s, life, 0, 0, 0) == 20)
	giant := add(t, g, "Hill Giant", 0, .Battlefield)
	mv := types.QuantityExpr(types.QuantityExpr_Ref{types.QuantityRef_ObjectManaValue{scope = types.ObjectScope_Source{}}})
	testing.expect(t, game.quantity_value(s, mv, 0, giant.id, 0) == 4, "Hill Giant's mana value")
}

@(test)
x_is_announced_then_paid :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 601.2b, 107.3a: X is announced as the spell is cast and its cost includes it; the effect uses it.
	g := new_game()
	for _ in 0 ..< 4 do add(t, g, "Mountain", 0, .Battlefield)
	blaze := add(t, g, "Blaze", 0, .Hand) // {X}{R}: X damage to any target
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = blaze.id}))
	w, asked := g.state.waiting_for.(types.WaitingFor_ChooseXValue)
	testing.expect(t, asked && w.max == 3, "X up to 3 with four Mountains")
	testing.expect(t, !game.apply(g, 0, types.GameAction_ChooseX{value = 4}), "can't announce more than it can pay")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseX{value = 3}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	untapped := 0
	for id in game.ids_of(g.state.battlefield) do if !game.object(&g.state, id).tapped do untapped += 1
	testing.expect(t, untapped == 0, "all four Mountains paid {3}{R}")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, game.player(&g.state, 1).life == 17, "3 damage")
	testing.expect(t, blaze.zone == .Graveyard && blaze.cost_x_paid == nil, "X is gone once it leaves the stack")
}

@(test)
if_its_an_artifact_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 608.2c: Built to Smash: "Target attacking creature gets +3/+3 until end of turn. If it's an artifact
	// creature, it gains trample until end of turn": the second instruction happens only if the condition is true.
	cast_on :: proc(t: ^testing.T, name: string) -> ^types.GameObject {
		g := new_game()
		add(t, g, "Mountain", 0, .Battlefield)
		spell := add(t, g, "Built to Smash", 0, .Hand)
		c := add(t, g, name, 0, .Battlefield)
		game.begin_step(g, .DeclareAttackers)
		attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{c.id, types.AttackTarget_Player{1}}}
		testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{c.id}}))
		game.apply(g, 0, types.GameAction_PassPriority{})
		game.apply(g, 1, types.GameAction_PassPriority{})
		return c
	}
	bears := cast_on(t, "Grizzly Bears")
	testing.expect(t, bears.power.? == 5 && !game.keyword_in(bears, types.Keyword_Trample{}), "+3/+3, no trample")
	thopter := cast_on(t, "Ornithopter")
	testing.expect(t, thopter.power.? == 3 && game.keyword_in(thopter, types.Keyword_Trample{}), "+3/+3 and trample")
}

@(test)
painland_and_sacrifice_mana_riders :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 605.3b: a mana ability resolves at once, rider and all. Adarkar Wastes: "{T}: Add {C}. {T}: Add {W} or
	// {U}. This land deals 1 damage to you." Paying generic mana uses the painless ability.
	g := new_game()
	wastes := add(t, g, "Adarkar Wastes", 0, .Battlefield)
	ring := add(t, g, "Sol Ring", 0, .Hand) // {1}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = ring.id}))
	testing.expect(t, wastes.tapped && game.player(&g.state, 0).life == 20, "{C} for {1}: no damage")

	g2 := new_game()
	wastes2 := add(t, g2, "Adarkar Wastes", 0, .Battlefield)
	lions := add(t, g2, "Savannah Lions", 0, .Hand) // {W}
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = lions.id}))
	testing.expect(t, wastes2.tapped && game.player(&g2.state, 0).life == 19, "{W}: 1 damage")

	// Abandoned Outpost: "{T}: Add {W}. {T}, Sacrifice this land: Add one mana of any color."
	g3 := new_game()
	outpost := add(t, g3, "Abandoned Outpost", 0, .Battlefield)
	opt := add(t, g3, "Opt", 0, .Hand) // {U}
	testing.expect(t, game.apply(g3, 0, types.GameAction_CastSpell{object_id = opt.id}))
	testing.expect(t, outpost.zone == .Graveyard, "sacrificed for {U}")
}

@(test)
support_gate_holes :: proc(t: ^testing.T) {
	if !load_db() do return
	// Cards the engine would play wrongly are reported unsupported rather than guessed at:
	// - Cinder Elemental: "{X}{R}, {T}, Sacrifice: X damage": an {X} in an activation cost isn't announced yet
	//   (CR 107.3a), so X would be 0.
	testing.expect(t, !game.card_supported(&card(t, "Cinder Elemental").face), "X in an activation cost")
	// - Blaze: the X of the spell's own mana cost is announced (CR 601.2b).
	testing.expect(t, game.card_supported(&card(t, "Blaze").face), "X in a spell's mana cost")
}

@(test)
up_to_two_targets :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 601.2c, 115.6: "up to two target creatures": zero, one or two; CR 115.3: not the same one twice.
	g := new_game()
	add(t, g, "Mountain", 0, .Battlefield)
	assault := add(t, g, "Coordinated Assault", 0, .Hand) // up to two: +1/+0 and first strike until end of turn
	a := add(t, g, "Grizzly Bears", 0, .Battlefield)
	b := add(t, g, "Grizzly Bears", 0, .Battlefield)
	c := add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = assault.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{a.id}}))
	w, asked := g.state.waiting_for.(types.WaitingFor_TargetSelection)
	testing.expect(t, asked && w.target_slots[1].optional, "the second target is optional")
	testing.expect(t, !game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{a.id}}), "not the same creature twice")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{b.id}}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, a.power.? == 3 && b.power.? == 3 && c.power.? == 2, "both targets, not the third")
	testing.expect(t, game.keyword_in(a, types.Keyword_FirstStrike{}) && game.keyword_in(b, types.Keyword_FirstStrike{}))

	// Declining the second: only one.
	g2 := new_game()
	add(t, g2, "Mountain", 0, .Battlefield)
	assault2 := add(t, g2, "Coordinated Assault", 0, .Hand)
	d := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	e := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = assault2.id}))
	testing.expect(t, game.apply(g2, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{d.id}}))
	testing.expect(t, game.apply(g2, 0, types.GameAction_ChooseTarget{}), "declined")
	testing.expect(t, assault2.zone == .Stack, "cast with one target")
	game.apply(g2, 0, types.GameAction_PassPriority{})
	game.apply(g2, 1, types.GameAction_PassPriority{})
	testing.expect(t, d.power.? == 3 && e.power.? == 2)
}

@(test)
two_targets_must_be_different :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 115.3, 601.2c: "Exile two target nonartifact creatures" needs two different ones.
	g := new_game()
	add(t, g, "Swamp", 0, .Battlefield)
	add(t, g, "Swamp", 0, .Battlefield)
	add(t, g, "Swamp", 0, .Battlefield)
	ashes := add(t, g, "Ashes to Ashes", 0, .Hand)
	add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, !game.castable(&g.state, 0, ashes, g.card_db), "one creature isn't enough")
	add(t, g, "Hill Giant", 1, .Battlefield)
	testing.expect(t, game.castable(&g.state, 0, ashes, g.card_db), "two are")
}

@(test)
dies_trigger_looks_back_at_power :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.10a, 603.4, 608.2h: Deathknell Berserker (2/2): "When this creature dies, if its power was 3 or
	// greater, ..." reads the creature as it last existed on the battlefield, pumps included.
	dies :: proc(t: ^testing.T, pumped: bool) -> int {
		g := new_game()
		b := add(t, g, "Deathknell Berserker", 0, .Battlefield)
		testing.expect(t, game.card_supported(&card(t, "Deathknell Berserker").face))
		if pumped do game.pump(g, b, 1, 0)
		game.destroy(g, b)
		game.give_priority(g, 0)
		game.apply(g, 0, types.GameAction_PassPriority{})
		game.apply(g, 1, types.GameAction_PassPriority{})
		tokens := 0
		for id in game.ids_of(g.state.battlefield) do if game.object(&g.state, id).is_token do tokens += 1
		return tokens
	}
	testing.expect(t, dies(t, true) == 1, "3 power as it died: a Zombie")
	testing.expect(t, dies(t, false) == 0, "2 power: nothing")
}

@(test)
creatures_cant_block_this_turn_includes_later_ones :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 611.2c: "Creatures without flying can't block this turn" changes the rules, not the creatures, so a
	// creature that arrives afterwards can't block either.
	g := new_game()
	for _ in 0 ..< 2 do add(t, g, "Mountain", 0, .Battlefield)
	chasm := add(t, g, "Magmatic Chasm", 0, .Hand)
	attacker := add(t, g, "Grizzly Bears", 0, .Battlefield)
	before := add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = chasm.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	later := add(t, g, "Hill Giant", 1, .Battlefield)
	testing.expect(t, !game.can_block(g, before, attacker) && !game.can_block(g, later, attacker), "neither can block")
	game.end_until_end_of_turn_effects(g)
	testing.expect(t, game.can_block(g, later, attacker), "next turn it can")
}

@(test)
pay_life_mana_needs_the_life :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 119.4: a player can pay life only up to their life total. Abandoned Outpost-style sacrifice aside, a
	// "{T}, Pay 1 life: Add one mana of any color" source can't pay at 0 life.
	g := new_game()
	add(t, g, "Mana Confluence", 0, .Battlefield)
	lions := add(t, g, "Savannah Lions", 0, .Hand)
	testing.expect(t, game.castable(&g.state, 0, lions, g.card_db), "1 life paid at 20")
	game.player(&g.state, 0).life = 0
	testing.expect(t, !game.castable(&g.state, 0, lions, g.card_db), "no life to pay")
}

@(test)
mana_value_counts_x_on_the_stack :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 202.3e: X is the announced value while the spell is on the stack, 0 elsewhere.
	g := new_game()
	for _ in 0 ..< 5 do add(t, g, "Mountain", 0, .Battlefield)
	blaze := add(t, g, "Blaze", 0, .Hand) // {X}{R}
	testing.expect(t, game.object_mana_value(blaze) == 1, "in hand: 1")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = blaze.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseX{value = 4}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	testing.expect(t, game.object_mana_value(blaze) == 5, "on the stack with X = 4: 5")
}

@(test)
modal_spell_choose_one :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 700.2a: the mode is chosen as the spell is cast; a mode whose targets can't be chosen can't be.
	// CR 700.2c: targets only for the chosen mode. Boros Charm: 4 damage to target player or planeswalker /
	// permanents you control gain indestructible / target creature gains double strike.
	g := new_game()
	add(t, g, "Mountain", 0, .Battlefield)
	add(t, g, "Plains", 0, .Battlefield)
	charm := add(t, g, "Boros Charm", 0, .Hand)
	testing.expect(t, game.card_supported(&card(t, "Boros Charm").face))
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = charm.id}))
	w, asked := g.state.waiting_for.(types.WaitingFor_ModeChoice)
	testing.expect(t, asked && len(w.unavailable_modes) == 1 && w.unavailable_modes[0] == 2, "no creature: the double strike mode is unavailable")
	two: [dynamic]int
	append(&two, 0, 1)
	testing.expect(t, !game.apply(g, 0, types.GameAction_SelectModes{indices = two}), "choose one, not two")
	third: [dynamic]int
	append(&third, 2)
	testing.expect(t, !game.apply(g, 0, types.GameAction_SelectModes{indices = third}), "not the unavailable one")
	first: [dynamic]int
	append(&first, 0)
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectModes{indices = first}))
	tw, targeting := g.state.waiting_for.(types.WaitingFor_TargetSelection)
	testing.expect(t, targeting && len(tw.target_slots) == 1, "one target, for the chosen mode")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, game.player(&g.state, 1).life == 16 && charm.zone == .Graveyard, "4 damage, then the graveyard")
}

@(test)
second_spell_and_opponent_casts :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.2, 601.2i: Clarion Spirit triggers on its controller's second spell of the turn only; Mogg Sentry
	// on a spell its controller's opponent casts.
	g := new_game()
	for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
	add(t, g, "Clarion Spirit", 0, .Battlefield)
	sentry := add(t, g, "Mogg Sentry", 1, .Battlefield)
	shocks: [3]^types.GameObject
	for &x in shocks do x = add(t, g, "Shock", 0, .Hand)
	cast_shock :: proc(t: ^testing.T, g: ^game.Game, spell: ^types.GameObject) -> int {
		before := types.pvec_len(g.state.stack)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
		n := types.pvec_len(g.state.stack) - before
		for types.pvec_len(g.state.stack) > 0 do game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
		return n
	}
	testing.expect(t, cast_shock(t, g, shocks[0]) == 2, "first spell: Shock and Mogg Sentry's trigger")
	testing.expect(t, sentry.power.? == 3, "the opponent's spell pumped Mogg Sentry")
	testing.expect(t, cast_shock(t, g, shocks[1]) == 3, "second spell: Clarion Spirit triggers too")
	testing.expect(t, cast_shock(t, g, shocks[2]) == 2, "third spell: not Clarion Spirit")
}

@(test)
activate_only_once_each_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 602.5b: "Activate only once each turn" (Azimaet Drake: {U}: +1/+0 until end of turn).
	g := new_game()
	for _ in 0 ..< 2 do add(t, g, "Island", 0, .Battlefield)
	drake := add(t, g, "Azimaet Drake", 0, .Battlefield)
	testing.expect(t, game.can_activate(g, 0, drake, 0))
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = drake.id, ability_index = 0}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, drake.power.? == 2, "pumped once")
	testing.expect(t, !game.can_activate(g, 0, drake, 0), "not again this turn, though an Island is untapped")
	game.begin_turn(g, 0)
	for id in game.ids_of(g.state.battlefield) do game.object(&g.state, id).tapped = false
	game.end_until_end_of_turn_effects(g)
	g.state.phase = .PreCombatMain
	g.state.priority_player = 0
	g.state.waiting_for = types.WaitingFor_Priority{player = 0}
	testing.expect(t, game.can_activate(g, 0, drake, 0), "again on a new turn")
}

@(test)
treasure_and_food_tokens :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 111.10a: a Treasure has "{T}, Sacrifice this token: Add one mana of any color"; CR 111.10b: a Food has
	// "{2}, {T}, Sacrifice this token: You gain 3 life".
	token :: proc(g: ^game.Game, kind: string) -> ^types.GameObject {
		e: types.Effect_Token
		e.name = kind
		append(&e.types, "Artifact", kind)
		e.power = types.PtValue_Fixed{0}
		e.toughness = types.PtValue_Fixed{0}
		game.create_token(g, e, 0)
		ids := game.ids_of(g.state.battlefield)
		return game.object(&g.state, ids[len(ids) - 1])
	}
	g := new_game()
	treasure := token(g, "Treasure")
	opt := add(t, g, "Opt", 0, .Hand) // {U}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = opt.id}), "the Treasure pays {U}")
	testing.expect(t, treasure.zone != .Battlefield, "and is sacrificed")

	g2 := new_game()
	for _ in 0 ..< 2 do add(t, g2, "Forest", 0, .Battlefield)
	food := token(g2, "Food")
	testing.expect(t, game.apply(g2, 0, types.GameAction_ActivateAbility{source_id = food.id, ability_index = 0}))
	game.apply(g2, 0, types.GameAction_PassPriority{})
	game.apply(g2, 1, types.GameAction_PassPriority{})
	testing.expect(t, game.player(&g2.state, 0).life == 23 && food.zone != .Battlefield, "3 life, Food sacrificed")
}

@(test)
whenever_you_attack :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 508.3d: "Whenever you attack" triggers once if one or more creatures its controller controls are declared
	// as attackers. Battlesong Berserker: target creature you control gets +1/+0 and gains menace.
	g := new_game()
	berserker := add(t, g, "Battlesong Berserker", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	add(t, g, "Battlesong Berserker", 1, .Battlefield) // the opponent's: not its controller attacking
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{bears.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	if _, asked := g.state.waiting_for.(types.WaitingFor_TriggerTargetSelection); asked {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	}
	testing.expect(t, types.pvec_len(g.state.stack) == 1, "one trigger: its controller attacked")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, bears.power.? == 3 && game.keyword_in(bears, types.Keyword_Menace{}), "+1/+0 and menace")
	_ = berserker
}

@(test)
you_may_then_if_you_do :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 608.2d: "you may" is chosen as the instruction is carried out; CR 608.2c: "if you do" follows the
	// choice. Common Iguana: "When this enters, you may discard a card. If you do, draw a card."
	run :: proc(t: ^testing.T, accept: bool) -> (library_drawn: int, discarded: int) {
		g := new_game()
		for _ in 0 ..< 2 do add(t, g, "Mountain", 0, .Battlefield)
		iguana := add(t, g, "Common Iguana", 0, .Hand)
		spare := add(t, g, "Forest", 0, .Hand)
		pl := game.player(&g.state, 0)
		library := types.pvec_len(pl.library)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = iguana.id}))
		steps: for i := 0; i < 12; i += 1 {
			#partial switch w in g.state.waiting_for {
			case types.WaitingFor_OptionalEffectChoice:
				testing.expect(t, game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = accept}))
			case types.WaitingFor_DiscardChoice:
				one: [dynamic]types.ObjectId
				append(&one, spare.id)
				testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = one}))
			case:
				if types.pvec_len(g.state.stack) == 0 && iguana.zone == .Battlefield && i > 0 do break steps
				game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
			}
		}
		return library - types.pvec_len(pl.library), 1 if spare.zone == .Graveyard else 0
	}
	drawn, discarded := run(t, true)
	testing.expect(t, drawn == 1 && discarded == 1, "accepted: discard, then draw")
	drawn, discarded = run(t, false)
	testing.expect(t, drawn == 0 && discarded == 0, "declined: neither")
}

@(test)
search_library :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 701.23a-b, 701.24a: Rampant Growth: search for a basic land card, put it onto the battlefield tapped,
	// then shuffle. A card with a stated quality may be left unfound; "a card" (Demonic Tutor) can't.
	g := new_game()
	for _ in 0 ..< 2 do add(t, g, "Forest", 0, .Battlefield)
	growth := add(t, g, "Rampant Growth", 0, .Hand)
	pl := game.player(&g.state, 0)
	library := types.pvec_len(pl.library)
	lands := len(game.ids_of(g.state.battlefield))
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = growth.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	w, asked := g.state.waiting_for.(types.WaitingFor_SearchChoice)
	testing.expect(t, asked && w.count == 1 && w.allows_partial_find, "asked to find up to one basic land")
	if !asked do return
	one: [dynamic]types.ObjectId
	append(&one, w.cards[0])
	found := game.object(&g.state, w.cards[0])
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = one}))
	testing.expect(t, found.zone == .Battlefield && found.tapped, "onto the battlefield tapped")
	testing.expect(t, types.pvec_len(pl.library) == library - 1 && len(game.ids_of(g.state.battlefield)) == lands + 1)

	g2 := new_game()
	for _ in 0 ..< 2 do add(t, g2, "Swamp", 0, .Battlefield)
	tutor := add(t, g2, "Demonic Tutor", 0, .Hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = tutor.id}))
	game.apply(g2, 0, types.GameAction_PassPriority{})
	game.apply(g2, 1, types.GameAction_PassPriority{})
	w2, asked2 := g2.state.waiting_for.(types.WaitingFor_SearchChoice)
	testing.expect(t, asked2 && !w2.allows_partial_find, "a card must be found")
	none: [dynamic]types.ObjectId
	testing.expect(t, !game.apply(g2, 0, types.GameAction_SelectCards{cards = none}), "not none")
	pick: [dynamic]types.ObjectId
	append(&pick, w2.cards[0])
	testing.expect(t, game.apply(g2, 0, types.GameAction_SelectCards{cards = pick}))
	testing.expect(t, game.object(&g2.state, w2.cards[0]).zone == .Hand, "into the hand")
}

@(test)
sacrifice_effects :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 701.21a: the controller sacrifices their own permanents; with a choice, they choose (CR 608.2d).
	g := new_game()
	ball := add(t, g, "Ball Lightning", 0, .Battlefield) // at the beginning of the end step, sacrifice it
	game.begin_step(g, .End)
	for types.pvec_len(g.state.stack) > 0 do game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, ball.zone == .Graveyard, "Ball Lightning sacrificed itself")

	g2 := new_game()
	add(t, g2, "Swamp", 0, .Battlefield)
	bears := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g2, "Grizzly Bears", 1, .Battlefield)
	centaur := add(t, g2, "Accursed Centaur", 0, .Hand) // when it enters, sacrifice a creature
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = centaur.id}))
	for i := 0; i < 6; i += 1 {
		if _, choosing := g2.state.waiting_for.(types.WaitingFor_EffectZoneChoice); choosing do break
		game.apply(g2, g2.state.priority_player, types.GameAction_PassPriority{})
	}
	w, asked := g2.state.waiting_for.(types.WaitingFor_EffectZoneChoice)
	testing.expect(t, asked && len(w.cards) == 2, "a choice between its controller's two creatures")
	if !asked do return
	wrong: [dynamic]types.ObjectId
	append(&wrong, theirs.id)
	testing.expect(t, !game.apply(g2, 0, types.GameAction_SelectCards{cards = wrong}), "not the opponent's")
	pick: [dynamic]types.ObjectId
	append(&pick, bears.id)
	testing.expect(t, game.apply(g2, 0, types.GameAction_SelectCards{cards = pick}))
	testing.expect(t, bears.zone == .Graveyard && centaur.zone == .Battlefield && theirs.zone == .Battlefield)
}

@(test)
counter_target_spell :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 701.6a: a countered spell doesn't resolve and goes to its owner's graveyard. Essence Scatter ("counter
	// target creature spell") can't target a noncreature spell.
	g := new_game()
	add(t, g, "Mountain", 0, .Battlefield)
	for _ in 0 ..< 2 do add(t, g, "Island", 1, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	counterspell := add(t, g, "Counterspell", 1, .Hand)
	scatter := add(t, g, "Essence Scatter", 1, .Hand)
	testing.expect(t, !game.castable(&g.state, 1, counterspell, g.card_db), "nothing to counter yet")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	testing.expect(t, !game.castable(&g.state, 1, scatter, g.card_db), "Shock isn't a creature spell")
	testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = counterspell.id}))
	if _, asked := g.state.waiting_for.(types.WaitingFor_TargetSelection); asked {
		testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = types.TargetRef_Object{shock.id}}))
	}
	for types.pvec_len(g.state.stack) > 0 do game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, shock.zone == .Graveyard && counterspell.zone == .Graveyard, "both in graveyards")
	testing.expect(t, game.player(&g.state, 1).life == 20, "Shock didn't resolve")
}

@(test)
graveyard_either_or_and_blink :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 115.1, 608.2c: Archaeomancer returns target instant or sorcery card from your graveyard to your hand;
	// Cloudshift exiles target creature you control, then returns that card under your control (a new object,
	// CR 400.7).
	g := new_game()
	for _ in 0 ..< 4 do add(t, g, "Island", 0, .Battlefield)
	shock := add(t, g, "Shock", 0, .Graveyard)
	bears_card := add(t, g, "Grizzly Bears", 0, .Graveyard)
	arch := add(t, g, "Archaeomancer", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = arch.id}))
	for i := 0; i < 8 && shock.zone == .Graveyard; i += 1 {
		#partial switch w in g.state.waiting_for {
		case types.WaitingFor_TriggerTargetSelection:
			for t2 in w.selection.current_legal_targets do testing.expect(t, t2 != types.TargetRef(types.TargetRef_Object{bears_card.id}), "not a creature card")
			game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{shock.id}})
		case:
			game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
		}
	}
	testing.expect(t, shock.zone == .Hand && bears_card.zone == .Graveyard, "the instant came back")

	g2 := new_game()
	add(t, g2, "Plains", 0, .Battlefield)
	shift := add(t, g2, "Cloudshift", 0, .Hand)
	bears := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	bears.tapped = true
	before := bears.incarnation
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = shift.id}))
	if _, asked := g2.state.waiting_for.(types.WaitingFor_TargetSelection); asked {
		game.apply(g2, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}})
	}
	game.apply(g2, 0, types.GameAction_PassPriority{})
	game.apply(g2, 1, types.GameAction_PassPriority{})
	testing.expect(t, bears.zone == .Battlefield && !bears.tapped && bears.incarnation > before, "back as a new, untapped object")
}

@(test)
each_player_and_each_opponent :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 101.4: "each player" instructions go in turn order from the active player, each choosing for themself.
	// Barter in Blood: each player sacrifices two creatures.
	g := new_game()
	for _ in 0 ..< 4 do add(t, g, "Swamp", 0, .Battlefield)
	barter := add(t, g, "Barter in Blood", 0, .Hand)
	mine: [3]^types.GameObject
	for &m in mine do m = add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := [2]^types.GameObject{add(t, g, "Grizzly Bears", 1, .Battlefield), add(t, g, "Hill Giant", 1, .Battlefield)}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = barter.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	w, asked := g.state.waiting_for.(types.WaitingFor_EffectZoneChoice)
	testing.expect(t, asked && w.player == 0 && w.count == 2, "the active player chooses two of three")
	if asked {
		two: [dynamic]types.ObjectId
		append(&two, mine[0].id, mine[1].id)
		testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = two}))
	}
	testing.expect(t, mine[2].zone == .Battlefield && mine[0].zone == .Graveyard, "two of the caster's")
	testing.expect(t, theirs[0].zone == .Graveyard && theirs[1].zone == .Graveyard, "the opponent had just two")

	// Burglar Rat: when it enters, each opponent discards a card (the opponent, not its controller).
	g2 := new_game()
	for _ in 0 ..< 2 do add(t, g2, "Swamp", 0, .Battlefield)
	rat := add(t, g2, "Burglar Rat", 0, .Hand)
	mine_hand := types.pvec_len(game.player(&g2.state, 0).hand)
	theirs_hand := types.pvec_len(game.player(&g2.state, 1).hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = rat.id}))
	for i := 0; i < 8; i += 1 {
		#partial switch w2 in g2.state.waiting_for {
		case types.WaitingFor_DiscardChoice:
			testing.expect(t, w2.player == 1, "the opponent discards")
			one: [dynamic]types.ObjectId
			append(&one, w2.cards[0])
			game.apply(g2, 1, types.GameAction_SelectCards{cards = one})
		case:
			game.apply(g2, g2.state.priority_player, types.GameAction_PassPriority{})
		}
	}
	testing.expect(t, types.pvec_len(game.player(&g2.state, 1).hand) == theirs_hand - 1, "one card from the opponent")
	testing.expect(t, types.pvec_len(game.player(&g2.state, 0).hand) == mine_hand - 1, "the caster only cast the Rat")
}

@(test)
cycling_from_the_hand :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.29a: "Cycling {B}" means "{B}, Discard this card: Draw a card", only while the card is in hand.
	g := new_game()
	add(t, g, "Swamp", 0, .Battlefield)
	tusker := add(t, g, "Barren Moor", 0, .Hand)
	pl := game.player(&g.state, 0)
	hand := types.pvec_len(pl.hand)
	cycling := -1
	for &a, i in tusker.abilities^ do if a.activation_zone != nil do cycling = i
	testing.expect(t, game.can_activate(g, 0, tusker, cycling), "cycling from the hand")
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = tusker.id, ability_index = cycling}))
	testing.expect(t, tusker.zone == .Graveyard, "discarded as the cost is paid")
	for i := 0; i < 6 && types.pvec_len(g.state.stack) > 0; i += 1 {
		#partial switch w in g.state.waiting_for {
		case types.WaitingFor_OptionalEffectChoice:
			game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = false})
		case:
			game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
		}
	}
	testing.expect(t, types.pvec_len(pl.hand) == hand, "one card out, one drawn")
	on_battlefield := add(t, g, "Barren Moor", 0, .Battlefield)
	add(t, g, "Swamp", 0, .Battlefield)
	for &a, i in on_battlefield.abilities^ do if a.activation_zone != nil do testing.expect(t, !game.can_activate(g, 0, on_battlefield, i), "not from the battlefield")
}

@(test)
additional_cost_sacrifice :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 601.2b, 601.2h: Village Rites: "As an additional cost to cast this spell, sacrifice a creature. Draw two
	// cards." Without a creature it can't be cast; the sacrifice is chosen and paid as it's cast.
	g := new_game()
	add(t, g, "Swamp", 0, .Battlefield)
	rites := add(t, g, "Village Rites", 0, .Hand)
	testing.expect(t, game.card_supported(&card(t, "Village Rites").face))
	testing.expect(t, !game.castable(&g.state, 0, rites, g.card_db), "no creature to sacrifice")
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	pl := game.player(&g.state, 0)
	hand := types.pvec_len(pl.hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = rites.id}))
	w, asked := g.state.waiting_for.(types.WaitingFor_PayCost)
	testing.expect(t, asked && len(w.choices) == 1, "what to sacrifice")
	pick: [dynamic]types.ObjectId
	append(&pick, bears.id)
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = pick}))
	testing.expect(t, bears.zone == .Graveyard && rites.zone == .Stack, "sacrificed as it was cast")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, types.pvec_len(pl.hand) == hand - 1 + 2, "two cards drawn")
}

@(test)
kicker_instead :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.33a, d: Burst Lightning: "Kicker {4}. Deals 2 damage to any target. If this spell was kicked, it
	// deals 4 damage instead." Kicking is announced as it's cast (CR 601.2b) and adds to the cost.
	run :: proc(t: ^testing.T, kick: bool) -> i32 {
		g := new_game()
		for _ in 0 ..< 5 do add(t, g, "Mountain", 0, .Battlefield)
		burst := add(t, g, "Burst Lightning", 0, .Hand)
		testing.expect(t, game.card_supported(&card(t, "Burst Lightning").face))
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = burst.id}))
		_, asked := g.state.waiting_for.(types.WaitingFor_OptionalCostChoice)
		testing.expect(t, asked, "asked whether to kick")
		testing.expect(t, game.apply(g, 0, types.GameAction_DecideOptionalCost{index = 0 if kick else 1}))
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
		tapped := 0
		for id in game.ids_of(g.state.battlefield) do if game.object(&g.state, id).tapped do tapped += 1
		testing.expect(t, tapped == (5 if kick else 1), "kicker {4} paid too")
		game.apply(g, 0, types.GameAction_PassPriority{})
		game.apply(g, 1, types.GameAction_PassPriority{})
		return 20 - game.player(&g.state, 1).life
	}
	testing.expect(t, run(t, false) == 2, "not kicked: 2")
	testing.expect(t, run(t, true) == 4, "kicked: 4 instead")
}

@(test)
kicked_creature_enters_with_counters :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.33d, 614.12: a kicked creature spell becomes a permanent that was kicked: Goblin Bushwhacker's "When
	// this enters, if it was kicked, ..." triggers only then.
	run :: proc(t: ^testing.T, kick: bool) -> int {
		g := new_game()
		for _ in 0 ..< 2 do add(t, g, "Mountain", 0, .Battlefield)
		goblin := add(t, g, "Goblin Bushwhacker", 0, .Hand)
		testing.expect(t, game.card_supported(&card(t, "Goblin Bushwhacker").face))
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = goblin.id}))
		testing.expect(t, game.apply(g, 0, types.GameAction_DecideOptionalCost{index = 0 if kick else 1}))
		game.apply(g, 0, types.GameAction_PassPriority{})
		game.apply(g, 1, types.GameAction_PassPriority{})
		return types.pvec_len(g.state.stack)
	}
	testing.expect(t, run(t, true) == 1, "kicked: its enters trigger")
	testing.expect(t, run(t, false) == 0, "not kicked: no trigger")
}

@(test)
condition_instead :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 608.2c: Electrostatic Bolt: "deals 2 damage to target creature. If it's an artifact creature, deals 4
	// damage to it instead."
	run :: proc(t: ^testing.T, name: string) -> u32 {
		g := new_game()
		add(t, g, "Mountain", 0, .Battlefield)
		bolt := add(t, g, "Electrostatic Bolt", 0, .Hand)
		c := add(t, g, name, 1, .Battlefield)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = bolt.id}))
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{c.id}}))
		game.apply(g, 0, types.GameAction_PassPriority{})
		game.apply(g, 1, types.GameAction_PassPriority{})
		return c.damage_marked
	}
	testing.expect(t, run(t, "Hill Giant") == 2, "a creature: 2")
	testing.expect(t, run(t, "Darksteel Colossus") == 4, "an artifact creature: 4 instead")
}

@(test)
enchanted_creature_deals_damage :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.2: Curiosity: "Whenever enchanted creature deals damage to an opponent, you may draw a card."
	g := new_game()
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	curiosity := add(t, g, "Curiosity", 0, .Battlefield)
	game.attach(&g.state, curiosity, bears)
	pl := game.player(&g.state, 0)
	library := types.pvec_len(pl.library)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{bears.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	for i := 0; i < 20 && g.state.phase != .PostCombatMain; i += 1 {
		#partial switch w in g.state.waiting_for {
		case types.WaitingFor_OptionalEffectChoice:
			game.apply(g, w.player, types.GameAction_DecideOptionalEffect{accept = true})
		case types.WaitingFor_DeclareBlockers:
			game.apply(g, w.player, types.GameAction_DeclareBlockers{})
		case:
			game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
		}
	}
	testing.expect(t, game.player(&g.state, 1).life == 18, "2 combat damage")
	testing.expect(t, types.pvec_len(pl.library) == library - 1, "Curiosity drew a card")
}

@(test)
token_with_its_own_trigger :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 111.4: Pest Summoning makes two Pests "with 'When this creature dies, you gain 1 life.'"
	g := new_game()
	for _ in 0 ..< 3 do add(t, g, "Swamp", 0, .Battlefield)
	summoning := add(t, g, "Pest Summoning", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = summoning.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	pests := make([dynamic]^types.GameObject, context.temp_allocator)
	for id in game.ids_of(g.state.battlefield) do if o := game.object(&g.state, id); o.is_token do append(&pests, o)
	testing.expect(t, len(pests) == 2, "two Pests")
	if len(pests) == 0 do return
	game.destroy(g, pests[0])
	game.give_priority(g, 0)
	for types.pvec_len(g.state.stack) > 0 do game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, game.player(&g.state, 0).life == 21, "its dies trigger: 1 life")
}

@(test)
flashback_from_the_graveyard :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.34a: Think Twice (draw a card; flashback {2}{U}) is cast from the graveyard for its flashback cost,
	// then exiled instead of going anywhere else as it leaves the stack.
	g := new_game()
	for _ in 0 ..< 3 do add(t, g, "Island", 0, .Battlefield)
	twice := add(t, g, "Think Twice", 0, .Graveyard)
	pl := game.player(&g.state, 0)
	library := types.pvec_len(pl.library)
	testing.expect(t, game.castable(&g.state, 0, twice, g.card_db), "castable from the graveyard")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = twice.id}))
	tapped := 0
	for id in game.ids_of(g.state.battlefield) do if game.object(&g.state, id).tapped do tapped += 1
	testing.expect(t, tapped == 3, "the flashback cost {2}{U}, not {1}{U}")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, types.pvec_len(pl.library) == library - 1 && twice.zone == .Exile, "drew, then exiled")
}

@(test)
review_two_regressions :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 400.7: Ball Lightning's end-step "sacrifice it" doesn't touch the new object Cloudshift returns.
	{
		g := new_game()
		add(t, g, "Plains", 0, .Battlefield)
		ball := add(t, g, "Ball Lightning", 0, .Battlefield)
		shift := add(t, g, "Cloudshift", 0, .Hand)
		game.begin_step(g, .End)
		testing.expect(t, types.pvec_len(g.state.stack) == 1, "the sacrifice trigger")
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shift.id}))
		if _, asked := g.state.waiting_for.(types.WaitingFor_TargetSelection); asked {
			game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{ball.id}})
		}
		for types.pvec_len(g.state.stack) > 0 do game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
		testing.expect(t, ball.zone == .Battlefield, "the returned Ball Lightning stays")
	}
	// CR 111.8, 704.5d: a token exiled by Cloudshift doesn't come back.
	{
		g := new_game()
		add(t, g, "Plains", 0, .Battlefield)
		e: types.Effect_Token
		e.name = "Soldier"
		append(&e.types, "Creature", "Soldier")
		e.power = types.PtValue_Fixed{1}
		e.toughness = types.PtValue_Fixed{1}
		game.create_token(g, e, 0)
		ids := game.ids_of(g.state.battlefield)
		soldier := game.object(&g.state, ids[len(ids) - 1])
		shift := add(t, g, "Cloudshift", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shift.id}))
		if _, asked := g.state.waiting_for.(types.WaitingFor_TargetSelection); asked {
			game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{soldier.id}})
		}
		game.apply(g, 0, types.GameAction_PassPriority{})
		game.apply(g, 1, types.GameAction_PassPriority{})
		testing.expect(t, soldier.zone != .Battlefield, "the token didn't return")
	}
	// CR 608.2d: with an empty hand, Common Iguana's "you may discard" can't be chosen: no draw.
	{
		g := new_game()
		for _ in 0 ..< 2 do add(t, g, "Mountain", 0, .Battlefield)
		iguana := add(t, g, "Common Iguana", 0, .Hand)
		pl := game.player(&g.state, 0)
		for types.pvec_len(pl.hand) > 1 do game.move_object(g, types.pvec_get(pl.hand, 0) if types.pvec_get(pl.hand, 0) != iguana.id else types.pvec_get(pl.hand, 1), .Library)
		library := types.pvec_len(pl.library)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = iguana.id}))
		for i := 0; i < 8; i += 1 {
			if _, asked := g.state.waiting_for.(types.WaitingFor_OptionalEffectChoice); asked {
				game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = true})
			} else do game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
		}
		testing.expect(t, types.pvec_len(pl.library) == library, "nothing drawn")
	}
	// CR 601.2h: one Treasure can't both pay {R} and be sacrificed for Kuldotha Rebirth's additional cost.
	{
		g := new_game()
		e: types.Effect_Token
		e.name = "Treasure"
		append(&e.types, "Artifact", "Treasure")
		e.power = types.PtValue_Fixed{0}
		e.toughness = types.PtValue_Fixed{0}
		game.create_token(g, e, 0)
		rebirth := add(t, g, "Kuldotha Rebirth", 0, .Hand)
		if game.card_supported(&card(t, "Kuldotha Rebirth").face) {
			testing.expect(t, !game.castable(&g.state, 0, rebirth, g.card_db), "only the Treasure: not castable")
			add(t, g, "Mountain", 0, .Battlefield)
			testing.expect(t, game.castable(&g.state, 0, rebirth, g.card_db), "Treasure plus a Mountain: castable")
		}
	}
	// Support gate: a comparison against a target's amount (Fell the Mighty), and a channel cost reduction.
	testing.expect(t, !game.card_supported(&card(t, "Fell the Mighty").face), "Fell the Mighty: target's power")
	testing.expect(t, !game.card_supported(&card(t, "Eiganjo, Seat of the Empire").face), "channel cost reduction")
}

@(test)
its_controller_creates_a_token :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 608.2c: Beast Within: "Destroy target permanent. Its controller creates a 3/3 green Beast creature token."
	g := new_game()
	for _ in 0 ..< 3 do add(t, g, "Forest", 0, .Battlefield)
	within := add(t, g, "Beast Within", 0, .Hand)
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, game.card_supported(&card(t, "Beast Within").face))
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = within.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{theirs.id}}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	beasts := 0
	for id in game.ids_of(g.state.battlefield) do if o := game.object(&g.state, id); o.is_token {
		testing.expect(t, o.controller == 1, "the opponent's Beast")
		beasts += 1
	}
	testing.expect(t, theirs.zone == .Graveyard && beasts == 1)
}

@(test)
amounts_this_turn_and_phase_conditions :: proc(t: ^testing.T) {
	if !load_db() do return
	// Amounts tracked through the turn: spells cast (CR 601.2i), life gained (CR 119.3), life lost from damage,
	// effects or payment (CR 119.2-119.4), cards drawn (CR 121.1). All reset as a turn begins.
	g := new_game()
	s := &g.state
	shock := add(t, g, "Shock", 0, .Graveyard)
	game.record_spell_cast(s, 0, shock, .Hand)
	game.record_spell_cast(s, 1, shock, .Hand)
	game.record_spell_cast(s, 1, shock, .Hand)
	spells :: proc(scope: types.CountScope) -> types.QuantityExpr {
		return types.QuantityExpr_Ref{types.QuantityRef_SpellsCast{scope = scope, window = .ThisTurn}}
	}
	testing.expect(t, game.quantity_supported(spells(.Controller)))
	testing.expect(t, game.quantity_value(s, spells(.Controller), 0, 0, 0) == 1, "you cast one")
	testing.expect(t, game.quantity_value(s, spells(.Opponents), 0, 0, 0) == 2, "your opponent cast two")
	testing.expect(t, game.quantity_value(s, spells(.All), 0, 0, 0) == 3, "three in all")
	last_turn := types.QuantityExpr(types.QuantityExpr_Ref{types.QuantityRef_SpellsCast{scope = .Controller, window = .LastTurn}})
	testing.expect(t, !game.quantity_supported(last_turn), "last turn's spells aren't tracked yet")

	game.gain_life(s, 0, 3)
	game.lose_life(s, 0, 2)
	gained := types.QuantityExpr(types.QuantityExpr_Ref{types.QuantityRef_LifeGainedThisTurn{player = types.PlayerScope_Controller{}}})
	lost := types.QuantityExpr(types.QuantityExpr_Ref{types.QuantityRef_LifeLost{player = types.PlayerScope_Controller{}, window = .ThisTurn}})
	testing.expect(t, game.quantity_value(s, gained, 0, 0, 0) == 3, "a later loss doesn't offset the gain")
	testing.expect(t, game.quantity_value(s, lost, 0, 0, 0) == 2)
	testing.expect(t, game.quantity_value(s, lost, 1, 0, 0) == 0, "the opponent lost none")

	// CR 603.4: "if you control an artifact", "if you control no creatures", "if this is tapped".
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	creature := types.TypedFilter{controller = types.ControllerRef_You{}}
	append(&creature.type_filters, types.TypeFilter(types.TypeFilter_Creature{}))
	controls := types.TriggerCondition(types.TriggerCondition_ControlsType{filter = types.TargetFilter_Typed{creature}})
	none := types.TriggerCondition(types.TriggerCondition_ControlsNone{filter = types.TargetFilter_Typed{creature}})
	testing.expect(t, game.trigger_condition_supported(controls) && game.trigger_condition_supported(none))
	testing.expect(t, game.trigger_condition_holds(s, bears.id, 0, controls), "you control a creature")
	testing.expect(t, !game.trigger_condition_holds(s, bears.id, 1, controls), "your opponent controls none")
	testing.expect(t, game.trigger_condition_holds(s, bears.id, 1, none))
	tapped := types.TriggerCondition(types.TriggerCondition_SourceIsTapped{})
	testing.expect(t, !game.trigger_condition_holds(s, bears.id, 0, tapped))
	bears.tapped = true
	testing.expect(t, game.trigger_condition_holds(s, bears.id, 0, tapped))
}

@(test)
mana_pool_holds_and_empties :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 605.3a-b: with priority, a player may activate a mana ability on its own; it resolves at once and its mana
	// goes into their mana pool (CR 106.4).
	g := new_game()
	s := &g.state
	game.begin_step(g, .PreCombatMain)
	forest := add(t, g, "Forest", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = forest.id, ability_index = 0}))
	pool := &game.player(s, 0).mana_pool.mana
	testing.expect(t, forest.tapped && len(pool) == 1 && pool[0].color == .Green, "{G} in the pool")
	testing.expect(t, types.pvec_len(s.stack) == 0, "a mana ability doesn't use the stack (CR 605.3b)")
	testing.expect(t, !game.apply(g, 0, types.GameAction_ActivateAbility{source_id = forest.id, ability_index = 0}), "already tapped")

	// The pool's mana pays a cost (CR 106.4): Llanowar Elves with the Forest tapped.
	elves := add(t, g, "Llanowar Elves", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = elves.id}), "paid from the pool")
	testing.expect(t, len(pool) == 0, "the mana was spent")

	// Floating mana that isn't spent is lost as the step ends (CR 106.4).
	mountain := add(t, g, "Mountain", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = mountain.id, ability_index = 0}))
	testing.expect(t, len(pool) == 1)
	game.begin_step(g, .BeginCombat)
	testing.expect(t, len(pool) == 0, "the pool empties between steps")

	// A painland's rider happens as the ability resolves (CR 605.3b): Adarkar Wastes' {C} ability has none.
	wastes := add(t, g, "Adarkar Wastes", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = wastes.id, ability_index = 0}))
	testing.expect(t, len(pool) == 1 && pool[0].color == .Colorless && game.player(s, 0).life == 20)
	// Its other ability makes one of two colors: the player chooses as it resolves, and its damage happens then too
	// (CR 405.6c).
	wastes2 := add(t, g, "Adarkar Wastes", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = wastes2.id, ability_index = 1}))
	_, choosing := s.waiting_for.(types.WaitingFor_ChooseManaColor)
	testing.expect(t, choosing)
	testing.expect(t, !game.apply(g, 0, types.GameAction_ChooseManaColor{choice = types.ManaChoice_SingleColor{.Red}, count = 1}), "not a color it makes")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseManaColor{choice = types.ManaChoice_SingleColor{.Blue}, count = 1}))
	testing.expect(t, len(pool) == 2 && pool[1].color == .Blue && game.player(s, 0).life == 19, "{U} and 1 damage")
}

@(test)
spell_is_on_the_stack_while_cast :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 601.2a: casting a spell starts by putting it on the stack; it's there while its targets are chosen
	// (601.2c). A cast that's cancelled is reversed (CR 734): the stack is as it was.
	g := new_game()
	s := &g.state
	add(t, g, "Mountain", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	_, choosing := s.waiting_for.(types.WaitingFor_TargetSelection)
	testing.expect(t, choosing && types.pvec_len(s.stack) == 1 && types.pvec_get(s.stack, 0).id == shock.id, "on the stack while targeting")
	testing.expect(t, game.apply(g, 0, types.GameAction_CancelCast{}))
	testing.expect(t, types.pvec_len(s.stack) == 0 && shock.zone == .Hand, "cancelled: as before")

	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	testing.expect(t, types.pvec_len(s.stack) == 1 && shock.zone == .Stack, "cast: one entry, the spell's")
	e := types.pvec_get(s.stack, 0)
	k, _ := e.kind.(types.StackEntryKind_Spell)
	testing.expect(t, k.ability != nil, "the full entry, with its targets")
}

@(test)
mana_ability_alone_then_priority :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 405.6c, 117.3c: after a mana ability activated with priority resolves, its player gets priority again,
	// state-based actions first (CR 117.5): Ancient Tomb at 2 life loses the game at once (CR 704.5a).
	g := new_game()
	s := &g.state
	tomb := add(t, g, "Ancient Tomb", 0, .Battlefield) // {T}: Add {C}{C}. This deals 2 damage to you.
	game.player(s, 0).life = 2
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = tomb.id, ability_index = 0}))
	_, over := s.waiting_for.(types.WaitingFor_GameOver)
	testing.expect(t, over, "0 life: the game is over before anything else")

	// CR 117.4: a player who acts resets the passes: A casts, A passes, B taps a land, B passes: A gets priority
	// back and the spell is still on the stack.
	g2 := new_game()
	s2 := &g2.state
	add(t, g2, "Mountain", 0, .Battlefield)
	forest := add(t, g2, "Forest", 1, .Battlefield)
	shock := add(t, g2, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g2, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	testing.expect(t, game.apply(g2, 0, types.GameAction_PassPriority{}))
	testing.expect(t, game.apply(g2, 1, types.GameAction_ActivateAbility{source_id = forest.id, ability_index = 0}))
	testing.expect(t, s2.priority_player == 1, "B keeps priority after the mana ability")
	testing.expect(t, game.apply(g2, 1, types.GameAction_PassPriority{}))
	testing.expect(t, types.pvec_len(s2.stack) == 1 && s2.priority_player == 0, "A gets priority again; nothing resolved")
}

@(test)
surplus_mana_stays_in_the_pool :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 106.4: mana made beyond what a cost needs stays in the pool: Sol Ring's {C}{C} paying {1}.
	g := new_game()
	s := &g.state
	add(t, g, "Sol Ring", 0, .Battlefield)
	ring := add(t, g, "Sol Ring", 0, .Hand) // {1}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = ring.id}))
	pool := game.player(s, 0).mana_pool.mana
	testing.expect(t, len(pool) == 1 && pool[0].color == .Colorless, "one {C} left over")
}

@(test)
flashback_spell_cant_target_itself :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 115.5: a spell can't target itself; cast from the graveyard by flashback (CR 702.34a), Mystic Retrieval
	// ("Return target instant or sorcery card from your graveyard to your hand") isn't among its own targets.
	g := new_game()
	retrieval := add(t, g, "Mystic Retrieval", 0, .Graveyard)
	if !game.card_supported(&card(t, "Mystic Retrieval").face) do return
	for _ in 0 ..< 4 do add(t, g, "Mountain", 0, .Battlefield)
	testing.expect(t, !game.apply(g, 0, types.GameAction_CastSpell{object_id = retrieval.id}), "no other target: can't be cast")
	opt := add(t, g, "Opt", 0, .Graveyard)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = retrieval.id}))
	w, choosing := g.state.waiting_for.(types.WaitingFor_TargetSelection)
	if choosing {
		for t2 in w.selection.current_legal_targets do if o, ok := t2.(types.TargetRef_Object); ok do testing.expect(t, o._0 != retrieval.id, "not itself")
	}
	_ = opt
}

@(test)
enters_with_counters_if_and_x :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 614.1c, 614.12: "enters with a +1/+1 counter on it if an opponent lost life this turn" is checked as it
	// enters. Cindering Cutthroat.
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
	testing.expect(t, game.card_supported(&card(t, "Cindering Cutthroat").face))
	a := add(t, g, "Cindering Cutthroat", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = a.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, a.zone == .Battlefield && len(a.counters) == 0, "no life lost: no counter")
	_ = s
	g2 := new_game()
	for _ in 0 ..< 3 do add(t, g2, "Mountain", 0, .Battlefield)
	game.lose_life(&g2.state, 1, 2)
	b := add(t, g2, "Cindering Cutthroat", 0, .Hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = b.id}))
	game.apply(g2, 0, types.GameAction_PassPriority{})
	game.apply(g2, 1, types.GameAction_PassPriority{})
	testing.expect(t, b.zone == .Battlefield && len(b.counters) == 1 && b.counters[0]._1 == 1, "an opponent lost life: a counter")

	// CR 107.3m: "enters with X +1/+1 counters" uses the X announced for the spell. Endless One, X = 3.
	g3 := new_game()
	for _ in 0 ..< 3 do add(t, g3, "Forest", 0, .Battlefield)
	one := add(t, g3, "Endless One", 0, .Hand)
	testing.expect(t, game.card_supported(&card(t, "Endless One").face))
	testing.expect(t, game.apply(g3, 0, types.GameAction_CastSpell{object_id = one.id}))
	testing.expect(t, game.apply(g3, 0, types.GameAction_ChooseX{value = 3}))
	game.apply(g3, 0, types.GameAction_PassPriority{})
	game.apply(g3, 1, types.GameAction_PassPriority{})
	testing.expect(t, one.zone == .Battlefield && len(one.counters) == 1 && one.counters[0]._1 == 3 && game.power_of(one) == 3, "three counters")
}

@(test)
a_creature_died_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// "If a creature died this turn" counts the turn's moves from the battlefield to a graveyard (CR 700.4), each
	// with the object as it was; a new turn starts the count again. Cackling Slasher enters with a +1/+1 counter if
	// a creature died this turn (CR 614.1c).
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "Cackling Slasher").face))
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	creature: types.TypedFilter
	append(&creature.type_filters, types.TypeFilter(types.TypeFilter_Creature{}))
	died := types.QuantityExpr(types.QuantityExpr_Ref{types.QuantityRef_ZoneChangeCountThisTurn{from = types.Zone.Battlefield, to = types.Zone.Graveyard, filter = types.TargetFilter_Typed{creature}}})
	testing.expect(t, game.quantity_supported(died) && game.quantity_value(s, died, 0, 0, 0) == 0)
	game.move_object(g, bears.id, .Graveyard)
	testing.expect(t, game.quantity_value(s, died, 0, 0, 0) == 1, "the Bears died")
	for _ in 0 ..< 4 do add(t, g, "Swamp", 0, .Battlefield)
	slasher := add(t, g, "Cackling Slasher", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = slasher.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, slasher.zone == .Battlefield && len(slasher.counters) == 1, "it enters with a counter")
	game.begin_turn(g, 1)
	testing.expect(t, game.quantity_value(s, died, 0, 0, 0) == 0, "a new turn: none yet")
}

@(test)
enters_trigger_with_a_targeted_effect :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.6a: "When this land enters, it deals 1 damage to target opponent" (Abraded Bluffs) triggers on its own
	// entering; the effect's target is chosen as the ability is put on the stack (CR 603.3d).
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "Abraded Bluffs").face))
	bluffs := add(t, g, "Abraded Bluffs", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = bluffs.id}))
	testing.expect(t, bluffs.tapped, "it enters tapped")
	for _ in 0 ..< 4 {
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, game.player(s, 1).life == 19, "1 damage to the opponent")
}

@(test)
condition_on_a_target_that_left :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 608.2h: "Exile target creature. If it had mana value 3 or less, surveil 2" reads the creature as it last
	// existed on the battlefield. Consuming Ashes.
	testing.expect(t, game.card_supported(&card(t, "Consuming Ashes").face))
	for c in ([]struct {
		name:    string,
		surveil: bool,
	}{{"Grizzly Bears", true}, {"Hill Giant", false}}) {
		g := new_game()
		s := &g.state
		for _ in 0 ..< 4 do add(t, g, "Swamp", 0, .Battlefield)
		victim := add(t, g, c.name, 1, .Battlefield)
		ashes := add(t, g, "Consuming Ashes", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = ashes.id}))
		if _, choosing := s.waiting_for.(types.WaitingFor_TargetSelection); choosing {
			testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{victim.id}}))
		}
		game.apply(g, 0, types.GameAction_PassPriority{})
		game.apply(g, 1, types.GameAction_PassPriority{})
		_, surveilling := s.waiting_for.(types.WaitingFor_SurveilChoice)
		testing.expectf(t, victim.zone == .Exile && surveilling == c.surveil, "%s: surveil %v", c.name, c.surveil)
	}
}

@(test)
mana_ability_with_a_mana_cost_and_a_color :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 605.3a-b: "{1}, {T}: Add one mana of any color" (Capital City) is activated with priority; its {1} is paid
	// from another source, and the color is chosen as it resolves, at once (CR 405.6c).
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "Capital City").face))
	add(t, g, "Forest", 0, .Battlefield)
	city := add(t, g, "Capital City", 0, .Battlefield) // {T}: Add {C}. {1}, {T}: Add one mana of any color.
	offered := false
	for a in game.legal_actions(g, 0) do if x, ok := a.(types.GameAction_ActivateAbility); ok && x.source_id == city.id && x.ability_index == 1 do offered = true
	testing.expect(t, offered, "offered among the legal actions")
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = city.id, ability_index = 1}))
	w, choosing := s.waiting_for.(types.WaitingFor_ChooseManaColor)
	testing.expect(t, choosing && city.tapped, "the color is asked for; the costs are paid")
	if choosing do testing.expect(t, w.player == 0)
	testing.expect(t, !game.apply(g, 0, types.GameAction_PassPriority{}), "only the color can be chosen now")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseManaColor{choice = types.ManaChoice_SingleColor{.Red}, count = 1}))
	pool := game.player(s, 0).mana_pool.mana
	testing.expect(t, len(pool) == 1 && pool[0].color == .Red, "{R} in the pool")
	_, prio := s.waiting_for.(types.WaitingFor_Priority)
	testing.expect(t, prio && s.priority_player == 0, "priority back to its player")
	shock := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}), "Shock paid with the {R}")
}

@(test)
restricted_mana :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 106.6: "Spend this mana only to cast a creature spell" (Ancient Ziggurat): it pays for a creature spell,
	// not another spell, whether it's tapped by the payment or already in the pool.
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "Ancient Ziggurat").face))
	ziggurat := add(t, g, "Ancient Ziggurat", 0, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, !game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}), "Shock isn't a creature spell")
	elves := add(t, g, "Llanowar Elves", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = elves.id}), "a creature spell")
	testing.expect(t, ziggurat.tapped)

	g2 := new_game()
	s2 := &g2.state
	z2 := add(t, g2, "Ancient Ziggurat", 0, .Battlefield)
	testing.expect(t, game.apply(g2, 0, types.GameAction_ActivateAbility{source_id = z2.id, ability_index = 0}))
	testing.expect(t, game.apply(g2, 0, types.GameAction_ChooseManaColor{choice = types.ManaChoice_SingleColor{.Red}, count = 1}))
	pool := game.player(s2, 0).mana_pool.mana
	testing.expect(t, len(pool) == 1 && len(pool[0].restrictions) == 1, "the {R} keeps its restriction in the pool")
	shock2 := add(t, g2, "Shock", 0, .Hand)
	testing.expect(t, !game.apply(g2, 0, types.GameAction_CastSpell{object_id = shock2.id}), "not for Shock")
	_ = s
}

@(test)
predefined_tokens_are_carried_out :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 111.10: each predefined token's ability is one the engine carries out (a token counts as supported, so
	// its abilities have to be).
	for kind in game.MADE_TOKENS {
		for a in game.predefined_abilities(kind) {
			_, _, mana := game.tap_mana_ability(a)
			testing.expectf(t, mana || game.activated_supported(a), "%s's ability", kind)
		}
	}
	// CR 111.10h: a Powerstone's {C} pays for an artifact spell, not for another spell.
	g := new_game()
	s := &g.state
	stone := add(t, g, "Forest", 0, .Battlefield)
	stone.is_token = true
	stone.name = "Powerstone"
	// Its own type lists (an object's are shared with its card's until something changes them).
	stone.card_types.core_types = {}
	stone.card_types.subtypes = {}
	append(&stone.card_types.core_types, types.CoreType.Artifact)
	append(&stone.card_types.subtypes, "Powerstone")
	abilities := new([dynamic]types.AbilityDefinition)
	abilities^ = game.predefined_abilities("Powerstone")
	stone.abilities = abilities
	bears := add(t, g, "Grizzly Bears", 0, .Hand) // {1}{G}
	add(t, g, "Forest", 0, .Battlefield)
	testing.expect(t, !game.apply(g, 0, types.GameAction_CastSpell{object_id = bears.id}), "not for a creature spell")
	ring := add(t, g, "Sol Ring", 0, .Hand) // {1}, an artifact
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = ring.id}), "for an artifact spell")
	testing.expect(t, stone.tapped)
	_ = s
}

@(test)
this_or_another_enters :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.6a: "Whenever this creature or another creature you control enters, you gain 1 life" (Bogwater
	// Lumaret) triggers on its own entering and on another creature of its controller's.
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "Bogwater Lumaret").face))
	for _ in 0 ..< 4 do add(t, g, "Forest", 0, .Battlefield)
	add(t, g, "Swamp", 0, .Battlefield)
	resolve_all :: proc(g: ^game.Game) {
		for _ in 0 ..< 8 {
			if types.pvec_len(g.state.stack) == 0 do break
			game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
		}
	}
	lumaret := add(t, g, "Bogwater Lumaret", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = lumaret.id}))
	resolve_all(g)
	testing.expect(t, lumaret.zone == .Battlefield && game.player(s, 0).life == 21, "it entered: 1 life")
	bears := add(t, g, "Grizzly Bears", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = bears.id}))
	resolve_all(g)
	testing.expect(t, bears.zone == .Battlefield && game.player(s, 0).life == 22, "another creature entered: 1 more")
}

@(test)
ability_from_the_graveyard :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 113.6j: "Renew — {B}, Exile this card from your graveyard: Put a +1/+1 counter on target creature.
	// Activate only as a sorcery." (Adorned Crocodile) works from the graveyard, where its cost can be paid; the
	// card is exiled as the cost (CR 701.13a).
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "Adorned Crocodile").face))
	add(t, g, "Swamp", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	croc := add(t, g, "Adorned Crocodile", 0, .Graveyard)
	index := -1
	for a in game.legal_actions(g, 0) do if x, ok := a.(types.GameAction_ActivateAbility); ok && x.source_id == croc.id do index = x.ability_index
	testing.expect(t, index >= 0, "offered from the graveyard")
	if index < 0 do return
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = croc.id, ability_index = index}))
	if _, choosing := s.waiting_for.(types.WaitingFor_TargetSelection); choosing {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	}
	testing.expect(t, croc.zone == .Exile, "exiled as the cost")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, len(bears.counters) == 1, "the counter")
	// Not from the battlefield: its cost can't be paid there.
	croc2 := add(t, g, "Adorned Crocodile", 0, .Battlefield)
	testing.expect(t, !game.apply(g, 0, types.GameAction_ActivateAbility{source_id = croc2.id, ability_index = index}))
}

@(test)
sacrifice_one_of_two_kinds :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 602.2b, 601.2h: "{3}, Sacrifice another creature or artifact: Draw a card." (Ahriman): either kind may
	// be chosen; nothing else (a land), and not Ahriman itself ("another").
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "Ahriman").face))
	for _ in 0 ..< 3 do add(t, g, "Forest", 0, .Battlefield)
	ahriman := add(t, g, "Ahriman", 0, .Battlefield)
	ring := add(t, g, "Sol Ring", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = ahriman.id, ability_index = 0}))
	w, choosing := s.waiting_for.(types.WaitingFor_PayCost)
	testing.expect(t, choosing, "asked what to sacrifice")
	if !choosing do return
	testing.expect(t, len(w.choices) == 2 && slice.contains(w.choices[:], ring.id) && slice.contains(w.choices[:], bears.id), "the artifact and the creature, not the lands or itself")
	one: [dynamic]types.ObjectId
	append(&one, ring.id)
	hand := types.pvec_len(game.player(s, 0).hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = one}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, ring.zone == .Graveyard && types.pvec_len(game.player(s, 0).hand) == hand + 1, "sacrificed, and a card drawn")
}

@(test)
return_this_card_from_the_graveyard :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 113.6b: "{2}{B}: Return this card from your graveyard to the battlefield. Activate only as a sorcery and
	// only if you have one or fewer cards in hand." (Dread Wanderer) works from the graveyard, under its
	// restrictions (CR 602.5); it enters tapped (its own replacement, CR 614.1c).
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "Dread Wanderer").face))
	for _ in 0 ..< 3 do add(t, g, "Swamp", 0, .Battlefield)
	wanderer := add(t, g, "Dread Wanderer", 0, .Graveyard)
	testing.expect(t, !game.apply(g, 0, types.GameAction_ActivateAbility{source_id = wanderer.id, ability_index = 0}), "seven cards in hand")
	hand := &game.player(s, 0).hand
	for types.pvec_len(hand^) > 1 do game.move_object(g, types.pvec_get(hand^, 0), .Library)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = wanderer.id, ability_index = 0}), "one card in hand")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, wanderer.zone == .Battlefield && wanderer.tapped, "back on the battlefield, tapped")
}

@(test)
stun_and_keyword_counters :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 122.1d: a permanent with a stun counter that would untap loses a stun counter instead.
	g := new_game()
	s := &g.state
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	bears.tapped = true
	game.add_counters(bears, types.CounterType_Stun{}, 1)
	game.begin_turn(g, 0)
	testing.expect(t, bears.tapped && len(bears.counters) == 0, "still tapped; the stun counter is gone")
	game.begin_turn(g, 0)
	testing.expect(t, !bears.tapped, "untaps the next time")
	// Two stun counters of the same kind are one entry (CR 122.1: counters of a kind are counted together).
	game.add_counters(bears, types.CounterType_Stun{}, 1)
	game.add_counters(bears, types.CounterType_Stun{}, 1)
	testing.expect(t, len(bears.counters) == 1 && bears.counters[0]._1 == 2)
	// CR 122.1b, 613.1f: a flying counter gives flying.
	testing.expect(t, !game.has_keyword(bears, types.Keyword_Flying))
	game.add_counters(bears, types.CounterType_Keyword{.Flying}, 1)
	game.apply_continuous_effects(g)
	testing.expect(t, game.has_keyword(bears, types.Keyword_Flying), "flying from the counter")
	_ = s
}

@(test)
put_a_land_from_your_hand :: proc(t: ^testing.T) {
	if !load_db() do return
	// "When this creature enters, you may put a land card from your hand onto the battlefield tapped." (Arboreal
	// Grazer): the land is chosen from the hand as it resolves (CR 115.10a, 608.2d), not targeted.
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "Arboreal Grazer").face))
	add(t, g, "Forest", 0, .Battlefield)
	grazer := add(t, g, "Arboreal Grazer", 0, .Hand)
	hand := &game.player(s, 0).hand
	lands_before := len(game.ids_of(s.battlefield))
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = grazer.id}))
	for _ in 0 ..< 12 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_OptionalEffectChoice:
			game.apply(g, w.player, types.GameAction_DecideOptionalEffect{accept = true})
			continue
		case types.WaitingFor_EffectZoneChoice:
			testing.expect(t, w.zone == .Hand && w.min_count == 1, "a card from the hand")
			one: [dynamic]types.ObjectId
			append(&one, w.cards[0])
			chosen := game.object(s, w.cards[0])
			testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = one}))
			testing.expect(t, chosen.zone == .Battlefield && chosen.tapped, "onto the battlefield tapped")
			continue
		}
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, grazer.zone == .Battlefield && len(game.ids_of(s.battlefield)) == lands_before + 2, "the Grazer and a land")
	_ = hand
}

@(test)
amounts_devotion_domain_aggregates :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	ref :: proc(q: types.QuantityRef) -> types.QuantityExpr {return types.QuantityExpr_Ref{q}}
	// CR 700.5: devotion to green counts the green symbols among mana costs of permanents you control.
	add(t, g, "Grizzly Bears", 0, .Battlefield) // {1}{G}
	add(t, g, "Llanowar Elves", 0, .Battlefield) // {G}
	add(t, g, "Hill Giant", 0, .Battlefield) // {3}{R}
	add(t, g, "Llanowar Elves", 1, .Battlefield) // the opponent's
	green: types.DevotionColors_Fixed
	append(&green._0, types.ManaColor.Green)
	devotion := ref(types.QuantityRef_Devotion{colors = green})
	testing.expect(t, game.quantity_supported(devotion) && game.quantity_value(s, devotion, 0, 0, 0) == 2, "devotion to green 2")
	// Domain (CR 305.6): basic land types among lands you control.
	add(t, g, "Forest", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	add(t, g, "Island", 0, .Battlefield)
	domain := ref(types.QuantityRef_BasicLandTypeCount{controller = types.ControllerRef_You{}})
	testing.expect(t, game.quantity_value(s, domain, 0, 0, 0) == 2, "two basic land types")
	// The greatest power among creatures you control.
	creature: types.TypedFilter
	append(&creature.type_filters, types.TypeFilter(types.TypeFilter_Creature{}))
	creature.controller = types.ControllerRef_You{}
	greatest := ref(types.QuantityRef_PropertyAggregate{{function = .Max, property = types.ObjectProperty_Power{}, source = types.CardTypeSetSource_Objects{filter = types.TargetFilter_Typed{creature}}}})
	testing.expect(t, game.quantity_supported(greatest) && game.quantity_value(s, greatest, 0, 0, 0) == 3, "Hill Giant's 3")
	total := ref(types.QuantityRef_PropertyAggregate{{function = .Sum, property = types.ObjectProperty_Power{}, source = types.CardTypeSetSource_Objects{filter = types.TargetFilter_Typed{creature}}}})
	testing.expect(t, game.quantity_value(s, total, 0, 0, 0) == 6, "2 + 1 + 3")
	// Card types among cards in your graveyard (CR 205.2a): a creature, an instant and a land: three.
	add(t, g, "Grizzly Bears", 0, .Graveyard)
	add(t, g, "Shock", 0, .Graveyard)
	add(t, g, "Forest", 0, .Graveyard)
	add(t, g, "Hill Giant", 0, .Graveyard)
	types_among := ref(types.QuantityRef_DistinctCardTypes{source = types.CardTypeSetSource_Zone{zone = .Graveyard, scope = .Controller}})
	testing.expect(t, game.quantity_supported(types_among) && game.quantity_value(s, types_among, 0, 0, 0) == 3, "creature, instant, land")
	// CR 202.3: this object's mana value.
	giant := add(t, g, "Hill Giant", 0, .Battlefield)
	mv := ref(types.QuantityRef_SelfManaValue{})
	testing.expect(t, game.quantity_value(s, mv, 0, giant.id, 0) == 4)
	opponents := ref(types.QuantityRef_PlayerCount{filter = types.PlayerFilter_Opponent{}})
	testing.expect(t, game.quantity_value(s, opponents, 0, 0, 0) == 1, "one opponent")
}

@(test)
that_much_damage :: proc(t: ^testing.T) {
	if !load_db() do return
	// "Whenever enchanted creature deals damage, you gain that much life." (Armadillo Cloak): the amount is the
	// damage that triggered it. "Discard all the cards in your hand. If you do, draw that many cards" (Book
	// Devourer) counts the discarded cards, which isn't tracked: refused rather than read as the damage.
	testing.expect(t, game.card_supported(&card(t, "April, Reporter of the Weird").face))
	testing.expect(t, !game.card_supported(&card(t, "Book Devourer").face))
	g := new_game()
	s := &g.state
	april := add(t, g, "April, Reporter of the Weird", 0, .Battlefield) // draw that many, then discard a card
	hand := types.pvec_len(game.player(s, 0).hand)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{april.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	for _ in 0 ..< 16 {
		who, _ := game.acting_player(s)
		#partial switch w in s.waiting_for {
		case types.WaitingFor_DeclareBlockers:
			game.apply(g, who, types.GameAction_DeclareBlockers{})
		case types.WaitingFor_DiscardChoice:
			game.apply(g, who, types.GameAction_SelectCards{cards = game.worst_cards(g, who, w.count)})
		case:
			game.apply(g, who, types.GameAction_PassPriority{})
		}
		if s.phase == .EndCombat || s.phase == .PostCombatMain do break
	}
	power := game.power_of(april)
	testing.expectf(t, game.player(s, 1).life == 20 - i32(power), "the damage: %d", power)
	testing.expectf(t, types.pvec_len(game.player(s, 0).hand) == hand + power - 1, "drew %d, discarded 1", power)
}

@(test)
gain_life_draw_and_damage_triggers :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.2: "whenever you gain life" (Ajani's Pridemate: a +1/+1 counter), "whenever you draw a card" (Psychosis
	// Crawler: each opponent loses 1 life), each card drawn its own event (CR 121.2). Revitalize: gain 3 life,
	// draw a card.
	g := new_game()
	s := &g.state
	for _ in 0 ..< 2 do add(t, g, "Plains", 0, .Battlefield)
	pridemate := add(t, g, "Ajani's Pridemate", 0, .Battlefield)
	add(t, g, "Psychosis Crawler", 0, .Battlefield)
	revitalize := add(t, g, "Revitalize", 0, .Hand)
	resolve :: proc(g: ^game.Game) {
		for _ in 0 ..< 16 {
			who, _ := game.acting_player(&g.state)
			if _, choosing := g.state.waiting_for.(types.WaitingFor_TriggerTargetSelection); choosing {
				a, _ := game.ai_action(g, who) // a trigger's target, before it goes on the stack (CR 603.3d)
				game.apply(g, who, a)
				continue
			}
			if types.pvec_len(g.state.stack) == 0 do break
			game.apply(g, who, types.GameAction_PassPriority{})
		}
	}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = revitalize.id}))
	resolve(g)
	testing.expect(t, game.player(s, 0).life == 23, "3 life")
	testing.expect(t, len(pridemate.counters) == 1, "the Pridemate's counter")
	testing.expect(t, game.player(s, 1).life == 19, "the Crawler: 1 life for the card drawn")

	// CR 120.3: "Whenever this creature is dealt damage, it deals that much damage to any target." (Boros Reckoner)
	g2 := new_game()
	s2 := &g2.state
	add(t, g2, "Mountain", 0, .Battlefield)
	reckoner := add(t, g2, "Boros Reckoner", 1, .Battlefield)
	shock := add(t, g2, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g2, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{reckoner.id}}))
	resolve(g2)
	testing.expect(t, reckoner.damage_marked == 2 || reckoner.zone == .Graveyard)
	testing.expectf(t, game.player(s2, 0).life == 18, "2 damage back (the AI aims at its opponent): life %d", game.player(s2, 0).life)
}

@(test)
becomes_tapped :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 701.26a: "Whenever this land becomes tapped, it deals 1 damage to you." (City of Brass) triggers when it's
	// tapped for mana to pay a cost; entering tapped isn't becoming tapped.
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "City of Brass").face))
	testing.expect(t, !game.card_supported(&card(t, "Agent Maria Hill").face), "a tapping for a teamwork cost isn't told apart")
	brass := add(t, g, "City of Brass", 0, .Battlefield)
	elves := add(t, g, "Llanowar Elves", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = elves.id}))
	testing.expect(t, brass.tapped)
	for _ in 0 ..< 8 {
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, game.player(s, 0).life == 19, "1 damage")
}

@(test)
whenever_you_sacrifice :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 701.21a: sacrificing moves a permanent its controller controls from the battlefield to the graveyard, and
	// "whenever you sacrifice" abilities trigger on it, looking back at the permanent as it last existed (CR
	// 603.10a). Bloodbriar: "Whenever you sacrifice another permanent, put a +1/+1 counter on this creature."
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "Bloodbriar").face))
	testing.expect(t, game.card_supported(&card(t, "Carrot Cake").face), "\"when you sacrifice this\"")
	testing.expect(t, !game.card_supported(&card(t, "Curious Cadaver").face), "an ability that works from the graveyard isn't watched there yet")
	briar := add(t, g, "Bloodbriar", 0, .Battlefield) // 2/3
	husk := add(t, g, "Nantuko Husk", 0, .Battlefield) // Sacrifice a creature: +2/+2 until end of turn
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	resolve_all := proc(g: ^game.Game) {
		for _ in 0 ..< 8 {
			if types.pvec_len(g.state.stack) == 0 do break
			game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
		}
	}
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = husk.id, ability_index = 0}))
	chosen: [dynamic]types.ObjectId
	append(&chosen, bears.id)
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = chosen}))
	testing.expect(t, types.pvec_len(s.stack) == 2, "the Husk's ability and the sacrifice trigger")
	resolve_all(g)
	testing.expect(t, briar.power.? == 3 && briar.toughness.? == 4, "a +1/+1 counter")

	// A creature that's destroyed isn't sacrificed.
	g2 := new_game()
	briar2 := add(t, g2, "Bloodbriar", 0, .Battlefield)
	bears2 := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	murder := add(t, g2, "Murder", 0, .Hand)
	for _ in 0 ..< 3 do add(t, g2, "Swamp", 0, .Battlefield)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = murder.id}))
	if _, choosing := g2.state.waiting_for.(types.WaitingFor_TargetSelection); choosing {
		game.apply(g2, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears2.id}})
	}
	resolve_all(g2)
	testing.expect(t, bears2.zone == .Graveyard && types.pvec_len(g2.state.stack) == 0 && briar2.power.? == 2, "no trigger")
}

@(test)
saga_chapters :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 715.3a: a Saga enters with a lore counter; CR 715.3c, 505.4: its controller adds one as their precombat
	// main phase begins; CR 715.2b: chapter N triggers when the count goes from below N to at least N; CR 704.5s,
	// 715.4: with lore counters at its final chapter number and no chapter ability of its own waiting, it's
	// sacrificed. History of Benalia: I, II - a 2/2 Knight token with vigilance; III - Knights you control get +2/+1.
	g := new_game()
	s := &g.state
	testing.expect(t, game.card_supported(&card(t, "History of Benalia").face))
	for _ in 0 ..< 3 do add(t, g, "Plains", 0, .Battlefield)
	saga := add(t, g, "History of Benalia", 0, .Hand)
	knights :: proc(s: ^types.GameState) -> [dynamic]^types.GameObject {
		out := make([dynamic]^types.GameObject, context.temp_allocator)
		for id in game.ids_of(s.battlefield) do if o := game.object(s, id); game.has_subtype(o, "Knight") do append(&out, o)
		return out
	}
	resolve_all := proc(g: ^game.Game) {
		for _ in 0 ..< 8 {
			if types.pvec_len(g.state.stack) == 0 do break
			game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
		}
	}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = saga.id}))
	resolve_all(g)
	lore := types.CounterType(types.CounterType_Lore{})
	testing.expect(t, saga.zone == .Battlefield && game.counter_count(saga, lore) == 1, "it enters with a lore counter")
	testing.expect(t, len(knights(s)) == 1, "chapter I: a Knight")

	game.begin_step(g, .PreCombatMain) // the next turn's precombat main phase
	testing.expect(t, game.counter_count(saga, lore) == 2)
	resolve_all(g)
	testing.expect(t, len(knights(s)) == 2, "chapter II: another Knight")

	game.begin_step(g, .PreCombatMain)
	testing.expect(t, saga.zone == .Battlefield && types.pvec_len(s.stack) == 1, "chapter III on the stack, the Saga still there")
	resolve_all(g)
	testing.expect(t, saga.zone == .Graveyard, "sacrificed once chapter III has left the stack")
	k := knights(s)
	testing.expect(t, len(k) == 2 && k[0].power.? == 4 && k[0].toughness.? == 3, "Knights get +2/+1")
}

@(test)
when_you_do :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.12: "you may X. When you do, Y": Y is a reflexive triggered ability, created if X was done, with its
	// target chosen as it goes on the stack, not with the first ability's. Cavalier of Night: "When this creature
	// enters, you may sacrifice another creature. When you do, destroy target creature an opponent controls."
	run :: proc(t: ^testing.T, accept: bool) {
		g := new_game()
		s := &g.state
		for _ in 0 ..< 5 do add(t, g, "Swamp", 0, .Battlefield)
		cavalier := add(t, g, "Cavalier of Night", 0, .Hand)
		mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
		theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = cavalier.id}))
		reflexive_on_stack := false
		for _ in 0 ..< 12 {
			#partial switch w in s.waiting_for {
			case types.WaitingFor_OptionalEffectChoice:
				testing.expect(t, game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = accept}))
				if accept {
					testing.expect(t, mine.zone == .Graveyard, "sacrificed")
					testing.expect(t, theirs.zone == .Battlefield, "not yet destroyed: the reflexive ability goes on the stack first")
					reflexive_on_stack = types.pvec_len(s.stack) == 1
				}
				continue
			case types.WaitingFor_Priority:
				if types.pvec_len(s.stack) == 0 do break
				game.apply(g, s.priority_player, types.GameAction_PassPriority{})
				continue
			}
			break
		}
		if accept {
			testing.expect(t, reflexive_on_stack, "the reflexive ability waited on the stack")
			testing.expect(t, theirs.zone == .Graveyard, "then destroyed the opponent's creature")
		} else {
			testing.expect(t, mine.zone == .Battlefield && theirs.zone == .Battlefield, "declined: nothing happens")
		}
	}
	testing.expect(t, game.card_supported(&card(t, "Cavalier of Night").face))
	run(t, true)
	run(t, false)
}

@(test)
look_back_at_leaving_together :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.10a: leaves-the-battlefield and sacrifice abilities look back in time. Mayhem Devil ("whenever a player
	// sacrifices a permanent, it deals 1 damage to any target") sees its own sacrifice; Zulaport Cutthroat
	// ("whenever this or another creature you control dies, each opponent loses 1 life and you gain 1 life") sees a
	// creature that dies at the same time it does (CR 704.3: the state-based actions happen at once).
	g := new_game()
	s := &g.state
	devil := add(t, g, "Mayhem Devil", 0, .Battlefield)
	husk := add(t, g, "Nantuko Husk", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = husk.id, ability_index = 0}))
	chosen: [dynamic]types.ObjectId
	append(&chosen, devil.id)
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = chosen}))
	if _, asked := s.waiting_for.(types.WaitingFor_TriggerTargetSelection); asked {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	}
	testing.expect(t, types.pvec_len(s.stack) == 2, "the Husk's ability and the Devil's own sacrifice trigger")
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, game.player(s, 1).life == 19, "1 damage")

	g2 := new_game()
	s2 := &g2.state
	add(t, g2, "Zulaport Cutthroat", 0, .Battlefield) // 1/1
	add(t, g2, "Grizzly Bears", 0, .Battlefield)
	for _ in 0 ..< 2 do add(t, g2, "Mountain", 0, .Battlefield)
	wipe := add(t, g2, "Pyroclasm", 0, .Hand) // 2 damage to each creature
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = wipe.id}))
	for _ in 0 ..< 8 {
		if types.pvec_len(s2.stack) == 0 do break
		game.apply(g2, s2.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, game.player(s2, 1).life == 18 && game.player(s2, 0).life == 22, "two triggers: its own death and the Bears'")
}

@(test)
saga_last_chapter_without_target :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.3d: a chapter ability with no legal target is removed; CR 704.5s, 117.5: the Saga is then sacrificed
	// before anyone gets priority, since no chapter ability of its own waits.
	g := new_game()
	s := &g.state
	// Triumph of Gerrard III: "target creature you control with the greatest power gains flying, first strike, and
	// lifelink until end of turn"; with no creature, it has no target.
	testing.expect(t, game.card_supported(&card(t, "Triumph of Gerrard").face))
	saga := add(t, g, "Triumph of Gerrard", 0, .Battlefield)
	game.add_counters(saga, types.CounterType_Lore{}, 2)
	game.begin_step(g, .PreCombatMain)
	_, has_priority := s.waiting_for.(types.WaitingFor_Priority)
	testing.expect(t, has_priority && types.pvec_len(s.stack) == 0 && saga.zone == .Graveyard, "gone before anyone has priority")
}

@(test)
mana_ability_restrictions_and_two_symbols :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 602.5: "Activate only if you control a Swamp or a Mountain" (Blazemire Verge's {T}: Add {R}) applies to a
	// mana ability too. Azorius Signet: "{1}, {T}: Add {W}{U}" adds both (CR 106.4).
	testing.expect(t, game.card_supported(&card(t, "Blazemire Verge").face))
	testing.expect(t, game.card_supported(&card(t, "Azorius Signet").face))
	g := new_game()
	add(t, g, "Blazemire Verge", 0, .Battlefield)
	_, red := game.plan_payment(&g.state, 0, cost_of(t, "Shock")) // {R}
	_, black := game.plan_payment(&g.state, 0, cost_of(t, "Duress")) // {B}
	testing.expect(t, !red && black, "without a Swamp or Mountain, only {B}")
	add(t, g, "Swamp", 0, .Battlefield)
	_, red = game.plan_payment(&g.state, 0, cost_of(t, "Shock"))
	testing.expect(t, red, "with a Swamp, {R} too")

	// Temple of the False God: "{T}: Add {C}{C}. Activate only if you control five or more lands."
	g3 := new_game()
	add(t, g3, "Temple of the False God", 0, .Battlefield)
	for _ in 0 ..< 3 do add(t, g3, "Forest", 0, .Battlefield)
	_, five := game.plan_payment(&g3.state, 0, cost_of(t, "Hill Giant")) // {3}{R}: no red, so only to check {C}
	_, four_lands := game.plan_payment(&g3.state, 0, types.ManaCost(types.ManaCost_Cost{generic = 5}))
	testing.expect(t, !four_lands, "four lands: the Temple can't be activated")
	add(t, g3, "Forest", 0, .Battlefield)
	_, five_lands := game.plan_payment(&g3.state, 0, types.ManaCost(types.ManaCost_Cost{generic = 6}))
	testing.expect(t, five_lands && !five, "five lands: {C}{C} and four {G} pay {6}")

	g2 := new_game()
	add(t, g2, "Plains", 0, .Battlefield)
	signet := add(t, g2, "Azorius Signet", 0, .Battlefield)
	testing.expect(t, game.apply(g2, 0, types.GameAction_ActivateAbility{source_id = signet.id, ability_index = 0}))
	pool := game.player(&g2.state, 0).mana_pool.mana
	has := proc(pool: [dynamic]types.ManaUnit, c: types.ManaType) -> bool {
		for u in pool do if u.color == c do return true
		return false
	}
	testing.expect(t, len(pool) == 2 && has(pool, .White) && has(pool, .Blue), "{W}{U} in the pool")
}

@(test)
raid_if_you_attacked_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 508.1: a creature attacked this turn when it was declared as an attacker. Deadeye Rig-Hauler: "Raid -
	// When this creature enters, if you attacked this turn, you may return target creature to its owner's hand"
	// (an intervening "if", CR 603.4).
	run :: proc(t: ^testing.T, attack: bool) -> int {
		g := new_game()
		s := &g.state
		bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
		add(t, g, "Grizzly Bears", 1, .Battlefield)
		for _ in 0 ..< 4 do add(t, g, "Island", 0, .Battlefield)
		hauler := add(t, g, "Deadeye Rig-Hauler", 0, .Hand)
		if attack {
			game.begin_step(g, .DeclareAttackers)
			attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{bears.id, types.AttackTarget_Player{1}}}
			testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
		}
		game.begin_step(g, .PostCombatMain)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = hauler.id}))
		game.apply(g, 0, types.GameAction_PassPriority{})
		game.apply(g, 1, types.GameAction_PassPriority{})
		if _, asked := s.waiting_for.(types.WaitingFor_TriggerTargetSelection); asked {
			a, _ := game.ai_action(g, 0)
			game.apply(g, 0, a)
		}
		return types.pvec_len(s.stack)
	}
	testing.expect(t, game.card_supported(&card(t, "Deadeye Rig-Hauler").face))
	testing.expect(t, run(t, true) == 1, "attacked: the Raid ability triggers")
	testing.expect(t, run(t, false) == 0, "no attack: it doesn't")
}

@(test)
opponent_controls_more_lands :: proc(t: ^testing.T) {
	if !load_db() do return
	// Knight of the White Orchid: "When this creature enters, if an opponent controls more lands than you, you may
	// search your library for a Plains card ..." (an intervening "if", CR 603.4): counted as it enters.
	run :: proc(t: ^testing.T, their_lands: int) -> int {
		g := new_game()
		s := &g.state
		for _ in 0 ..< 2 do add(t, g, "Plains", 0, .Battlefield)
		for _ in 0 ..< their_lands do add(t, g, "Forest", 1, .Battlefield)
		knight := add(t, g, "Knight of the White Orchid", 0, .Hand) // {W}{W}
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = knight.id}))
		game.apply(g, 0, types.GameAction_PassPriority{})
		game.apply(g, 1, types.GameAction_PassPriority{})
		return types.pvec_len(s.stack)
	}
	testing.expect(t, game.card_supported(&card(t, "Knight of the White Orchid").face))
	testing.expect(t, run(t, 3) == 1, "three lands to two: it triggers")
	testing.expect(t, run(t, 2) == 0, "two to two: it doesn't")
}

@(test)
shockland_pay_or_tapped :: proc(t: ^testing.T) {
	if !load_db() do return
	// Blood Crypt: "As this land enters, you may pay 2 life. If you don't, it enters tapped." Its controller chooses
	// as it enters (CR 614.12); paying life is losing it (CR 119.4).
	testing.expect(t, game.card_supported(&card(t, "Blood Crypt").face))
	run :: proc(t: ^testing.T, pay: bool) -> (^types.GameObject, int) {
		g := new_game()
		s := &g.state
		crypt := add(t, g, "Blood Crypt", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = crypt.id}))
		_, asked := s.waiting_for.(types.WaitingFor_ReplacementChoice)
		testing.expect(t, asked, "asked as it enters")
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseReplacement{index = 0 if pay else 1}))
		_, priority := s.waiting_for.(types.WaitingFor_Priority)
		testing.expect(t, priority && s.priority_player == 0, "then priority back to its player")
		return crypt, int(game.player(s, 0).life)
	}
	crypt, life := run(t, true)
	testing.expect(t, !crypt.tapped && life == 18, "paid: untapped, 2 life")
	crypt, life = run(t, false)
	testing.expect(t, crypt.tapped && life == 20, "declined: tapped")
	// Raid: "This creature enters with a +1/+1 counter on it if you attacked this turn."
	testing.expect(t, game.card_supported(&card(t, "Goblin Boarders").face))
}

@(test)
shield_counters :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 122.1c: a shield counter prevents damage that would be dealt to the permanent, and replaces its being
	// destroyed by an effect; either way one shield counter is removed.
	testing.expect(t, game.card_supported(&card(t, "Dapper Shieldmate").face))
	g := new_game()
	s := &g.state
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	shield := types.CounterType(types.CounterType_Shield{})
	game.add_counters(bears, shield, 1)
	for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
	for _ in 0 ..< 3 do add(t, g, "Swamp", 0, .Battlefield)
	cast_at :: proc(t: ^testing.T, g: ^game.Game, name: string, target: types.ObjectId) {
		spell := add(t, g, name, 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
		if _, asked := g.state.waiting_for.(types.WaitingFor_TargetSelection); asked {
			game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{target}})
		}
		for types.pvec_len(g.state.stack) > 0 do game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
	}
	cast_at(t, g, "Shock", bears.id)
	testing.expect(t, bears.zone == .Battlefield && bears.damage_marked == 0 && game.counter_count(bears, shield) == 0, "damage prevented, the counter removed")
	game.add_counters(bears, shield, 1)
	cast_at(t, g, "Murder", bears.id)
	testing.expect(t, bears.zone == .Battlefield && game.counter_count(bears, shield) == 0, "not destroyed, the counter removed")
	_ = s
}

@(test)
fetchland_search_either_type :: proc(t: ^testing.T) {
	if !load_db() do return
	// Arid Mesa: "{T}, Pay 1 life, Sacrifice this land: Search your library for a Mountain or Plains card, put it
	// onto the battlefield, then shuffle." CR 701.23a: the cards found must match the search, either type here.
	testing.expect(t, game.card_supported(&card(t, "Arid Mesa").face))
	g := new_game()
	s := &g.state
	mesa := add(t, g, "Arid Mesa", 0, .Battlefield)
	mountain := add(t, g, "Mountain", 0, .Library)
	plains := add(t, g, "Plains", 0, .Library)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = mesa.id, ability_index = 0}))
	for types.pvec_len(s.stack) > 0 {
		if _, searching := s.waiting_for.(types.WaitingFor_SearchChoice); searching do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	w, searching := s.waiting_for.(types.WaitingFor_SearchChoice)
	testing.expect(t, searching, "searching")
	if !searching do return
	testing.expect(t, len(w.cards) == 2 && slice.contains(w.cards[:], mountain.id) && slice.contains(w.cards[:], plains.id), "only the Mountain and the Plains, not the Forests")
	chosen: [dynamic]types.ObjectId
	append(&chosen, plains.id)
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = chosen}))
	testing.expect(t, plains.zone == .Battlefield && mesa.zone == .Graveyard && game.player(s, 0).life == 19)
}

@(test)
damage_each_opponent_and_counters_on_each :: proc(t: ^testing.T) {
	if !load_db() do return
	// Guttersnipe: "Whenever you cast an instant or sorcery spell, this creature deals 2 damage to each opponent"
	// (CR 120.3). Abzan Ascendancy: "When this enchantment enters, put a +1/+1 counter on each creature you
	// control" (CR 122.6).
	testing.expect(t, game.card_supported(&card(t, "Guttersnipe").face))
	testing.expect(t, game.card_supported(&card(t, "Abzan Ascendancy").face))
	g := new_game()
	s := &g.state
	add(t, g, "Guttersnipe", 0, .Battlefield)
	add(t, g, "Mountain", 0, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
		game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}})
	}
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, game.player(s, 1).life == 16 && game.player(s, 0).life == 20, "2 from Guttersnipe, 2 from Shock")

	g2 := new_game()
	s2 := &g2.state
	bears := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g2, "Grizzly Bears", 1, .Battlefield)
	add(t, g2, "Plains", 0, .Battlefield)
	add(t, g2, "Swamp", 0, .Battlefield)
	add(t, g2, "Forest", 0, .Battlefield)
	asc := add(t, g2, "Abzan Ascendancy", 0, .Hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = asc.id}))
	for _ in 0 ..< 6 {
		if types.pvec_len(s2.stack) == 0 do break
		game.apply(g2, s2.priority_player, types.GameAction_PassPriority{})
	}
	p1 := types.CounterType(types.CounterType_Plus1Plus1{})
	testing.expect(t, game.counter_count(bears, p1) == 1 && game.counter_count(theirs, p1) == 0, "a counter on each of yours only")
}

@(test)
pump_by_an_amount :: proc(t: ^testing.T) {
	if !load_db() do return
	// Death Wind: "Target creature gets -X/-X until end of turn": the spell's X (CR 107.3a), worked out as it
	// resolves (CR 608.2h).
	testing.expect(t, game.card_supported(&card(t, "Death Wind").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Swamp", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	wind := add(t, g, "Death Wind", 0, .Hand) // {X}{B}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = wind.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseX{value = 2}))
	if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	}
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, bears.zone == .Graveyard, "-2/-2 on a 2/2: toughness 0 (CR 704.5f)")
}

@(test)
delayed_trigger_next_end_step :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.7: Flickerwisp: "When this creature enters, exile another target permanent. Return that card to the
	// battlefield under its owner's control at the beginning of the next end step." The delayed ability triggers
	// once, at the next end step (CR 603.7b), and returns the card it exiled (CR 603.7c).
	testing.expect(t, game.card_supported(&card(t, "Flickerwisp").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Plains", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	wisp := add(t, g, "Flickerwisp", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = wisp.id}))
	for _ in 0 ..< 8 {
		if _, asked := s.waiting_for.(types.WaitingFor_TriggerTargetSelection); asked {
			testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
			continue
		}
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, bears.zone == .Exile && len(s.delayed_triggers) == 1, "exiled, the delayed ability waiting")
	game.begin_step(g, .End)
	testing.expect(t, types.pvec_len(s.stack) == 1 && len(s.delayed_triggers) == 0, "it triggered at the end step, once")
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, bears.zone == .Battlefield && bears.controller == 1, "back under its owner's control")
}

@(test)
token_copy_of_a_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	// Cackling Counterpart: "Create a token that's a copy of target creature you control." CR 707.2: the token has
	// the creature's copiable values (its printed characteristics), not its counters or damage; CR 111.2: its
	// creator owns and controls it.
	testing.expect(t, game.card_supported(&card(t, "Cackling Counterpart").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Island", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	game.add_counters(bears, types.CounterType_Plus1Plus1{}, 1)
	bears.damage_marked = 1
	spell := add(t, g, "Cackling Counterpart", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
		game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}})
	}
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	copy: ^types.GameObject
	for id in game.ids_of(s.battlefield) do if o := game.object(s, id); o.is_token do copy = o
	testing.expect(t, copy != nil, "a token")
	if copy == nil do return
	testing.expect(t, copy.name == "Grizzly Bears" && copy.power.? == 2 && copy.toughness.? == 2 && copy.damage_marked == 0, "a 2/2 Grizzly Bears, without the counter or damage")
	testing.expect(t, copy.controller == 0 && copy.owner == 0)
}

@(test)
target_player_draws :: proc(t: ^testing.T) {
	if !load_db() do return
	// Opportunity: "Target player draws four cards" (CR 115.1: a player as a target; CR 121.2).
	testing.expect(t, game.card_supported(&card(t, "Opportunity").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 6 do add(t, g, "Island", 0, .Battlefield)
	spell := add(t, g, "Opportunity", 0, .Hand) // {4}{U}{U}
	before := types.pvec_len(game.player(s, 1).hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	}
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, types.pvec_len(game.player(s, 1).hand) == before + 4, "the target player drew four")
}

@(test)
gain_control_until_end_of_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// Act of Treason: "Gain control of target creature until end of turn. Untap that creature. It gains haste until
	// end of turn." CR 613.1b (layer 2); CR 514.2: it ends in the cleanup step, and control goes back.
	testing.expect(t, game.card_supported(&card(t, "Act of Treason").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	bears.tapped = true
	spell := add(t, g, "Act of Treason", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
		game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}})
	}
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, bears.controller == 0 && !bears.tapped, "ours, untapped")
	testing.expect(t, game.can_attack(g, bears), "with haste it can attack (CR 302.6)")
	game.cleanup(g)
	testing.expect(t, bears.controller == 1, "back to its controller at end of turn")
}

@(test)
return_all_creatures :: proc(t: ^testing.T) {
	if !load_db() do return
	// Evacuation: "Return all creatures to their owners' hands": each to its owner's hand (CR 400.3), all at once.
	testing.expect(t, game.card_supported(&card(t, "Evacuation").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 5 do add(t, g, "Island", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	spell := add(t, g, "Evacuation", 0, .Hand) // {3}{U}{U}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, mine.zone == .Hand && theirs.zone == .Hand, "both returned")
	testing.expect(t, slice.contains(game.ids_of(game.player(s, 1).hand), theirs.id), "to its owner's hand")
}

@(test)
exile_all_creatures :: proc(t: ^testing.T) {
	if !load_db() do return
	// Beyond the Quiet: "Exile all creatures and Spacecraft": every permanent matching either, at once.
	testing.expect(t, game.card_supported(&card(t, "Beyond the Quiet").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 6 do add(t, g, "Plains", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	spell := add(t, g, "Beyond the Quiet", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, mine.zone == .Exile && theirs.zone == .Exile, "both exiled")
}

@(test)
prevent_all_combat_damage :: proc(t: ^testing.T) {
	if !load_db() do return
	// Fog: "Prevent all combat damage that would be dealt this turn" (CR 615.1a); noncombat damage still is.
	testing.expect(t, game.card_supported(&card(t, "Fog").face))
	g := new_game()
	s := &g.state
	add(t, g, "Forest", 1, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	fog := add(t, g, "Fog", 1, .Hand)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{bears.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = fog.id}), "Fog at instant speed")
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	for _ in 0 ..< 10 {
		if s.phase >= .EndCombat do break
		if _, priority := s.waiting_for.(types.WaitingFor_Priority); !priority {
			a, _ := game.ai_action(g, s.priority_player)
			game.apply(g, s.priority_player, a)
			continue
		}
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, game.player(s, 1).life == 20, "the Bears' combat damage was prevented")
	game.deal_damage(g, bears.id, types.TargetRef_Player{1}, 2)
	testing.expect(t, game.player(s, 1).life == 18, "noncombat damage isn't")
}

@(test)
review_fixes_delayed_shield_shockland :: proc(t: ^testing.T) {
	if !load_db() do return
	// A delayed "it" with no earlier target to name would do nothing (CR 608.2c): such cards are refused, as is an
	// "if you do" inside a delayed ability; cards whose card data is wrong are refused too.
	for name in ([]string{"Attack-in-the-Box", "Alora, Cheerful Assassin", "Phelia, Exuberant Shepherd", "Shallow Grave", "Vizier of Deferment"}) {
		testing.expectf(t, !game.card_supported(&card(t, name).face), "%s isn't supported yet", name)
	}
	testing.expect(t, game.card_supported(&card(t, "Flickerwisp").face), "an \"it\" an earlier target names is")

	// CR 122.1c, 510.2: combat damage is dealt at once, so one shield counter prevents all of it. A shielded
	// Grizzly Bears blocked by two Grizzly Bears takes no damage and loses one counter.
	g := new_game()
	s := &g.state
	a := add(t, g, "Grizzly Bears", 0, .Battlefield)
	shield := types.CounterType(types.CounterType_Shield{})
	game.add_counters(a, shield, 2)
	b1 := add(t, g, "Grizzly Bears", 1, .Battlefield)
	b2 := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{a.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	blocks: [dynamic]types.Tuple2(types.ObjectId, types.ObjectId)
	append(&blocks, types.Tuple2(types.ObjectId, types.ObjectId){b1.id, a.id}, types.Tuple2(types.ObjectId, types.ObjectId){b2.id, a.id})
	testing.expect(t, game.apply(g, 1, types.GameAction_DeclareBlockers{assignments = blocks}))
	for _ in 0 ..< 6 {
		if s.phase >= .EndCombat do break
		if _, priority := s.waiting_for.(types.WaitingFor_Priority); !priority {
			act, _ := game.ai_action(g, s.priority_player)
			game.apply(g, s.priority_player, act)
			continue
		}
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, a.zone == .Battlefield && a.damage_marked == 0 && game.counter_count(a, shield) == 1, "all prevented, one counter removed")

	// A shockland at 1 life: paying 2 life isn't offered (CR 119.4).
	g2 := new_game()
	game.player(&g2.state, 0).life = 1
	crypt := add(t, g2, "Blood Crypt", 0, .Hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_PlayLand{object_id = crypt.id}))
	acts := game.legal_actions(g2, 0)
	testing.expect(t, len(acts) == 1, "only declining")
	testing.expect(t, !game.apply(g2, 0, types.GameAction_ChooseReplacement{index = 0}))
	testing.expect(t, game.apply(g2, 0, types.GameAction_ChooseReplacement{index = 1}) && crypt.tapped)
}

@(test)
exile_instead_of_dying :: proc(t: ^testing.T) {
	if !load_db() do return
	// Agate Assault: "deals 4 damage to target creature. If that creature would die this turn, exile it instead"
	// (CR 614.6: the replacement changes where it goes; dying is going to the graveyard from the battlefield).
	testing.expect(t, game.card_supported(&card(t, "Agate Assault").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	spell := add(t, g, "Agate Assault", 0, .Hand) // {2}{R}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	if _, asked := s.waiting_for.(types.WaitingFor_ModeChoice); asked {
		modes: [dynamic]int
		append(&modes, 0)
		testing.expect(t, game.apply(g, 0, types.GameAction_SelectModes{indices = modes}))
	}
	if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
		game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}})
	}
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, bears.zone == .Exile, "exiled, not put into the graveyard")
}

@(test)
players_lose_life :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 119.3: "Target opponent loses 3 life" (Bump in the Night); "whenever this creature attacks, defending
	// player loses 1 life and you gain 1 life" (Agate-Blade Assassin; CR 506.2: the attacking player's opponent).
	testing.expect(t, game.card_supported(&card(t, "Bump in the Night").face))
	testing.expect(t, game.card_supported(&card(t, "Agate-Blade Assassin").face))
	g := new_game()
	s := &g.state
	add(t, g, "Swamp", 0, .Battlefield)
	bump := add(t, g, "Bump in the Night", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = bump.id}))
	if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
		game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}})
	}
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, game.player(s, 1).life == 17, "3 life")

	assassin := add(t, g, "Agate-Blade Assassin", 0, .Battlefield)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{assassin.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, game.player(s, 1).life == 16 && game.player(s, 0).life == 21, "defending player loses 1, you gain 1")
}

@(test)
return_a_creature_you_control :: proc(t: ^testing.T) {
	if !load_db() do return
	// Shrieking Drake: "When this creature enters, return a creature you control to its owner's hand." Chosen as
	// the ability resolves (CR 608.2d), not targeted, from its controller's own creatures; the Drake itself counts.
	testing.expect(t, game.card_supported(&card(t, "Shrieking Drake").face))
	g := new_game()
	s := &g.state
	add(t, g, "Island", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	drake := add(t, g, "Shrieking Drake", 0, .Hand) // {U}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = drake.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, types.pvec_len(s.stack) == 1, "the trigger, with no target to choose")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	w, asked := s.waiting_for.(types.WaitingFor_EffectZoneChoice)
	testing.expect(t, asked && len(w.cards) == 2 && !slice.contains(w.cards[:], theirs.id), "the Bears or the Drake, not the opponent's")
	if !asked do return
	chosen: [dynamic]types.ObjectId
	append(&chosen, bears.id)
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = chosen}))
	testing.expect(t, bears.zone == .Hand && drake.zone == .Battlefield)
}

@(test)
crew_a_vehicle :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.122a: "Crew N": tap other untapped creatures you control with total power N or more; the Vehicle becomes
	// an artifact creature until end of turn. Funeral Longboat: a 3/3 Vehicle with vigilance, crew 1.
	testing.expect(t, game.card_supported(&card(t, "Funeral Longboat").face))
	g := new_game()
	s := &g.state
	skiff := add(t, g, "Funeral Longboat", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, !game.is_type(skiff, .Creature), "not a creature yet")
	testing.expect(t, game.apply(g, 0, types.GameAction_CrewVehicle{vehicle_id = skiff.id}))
	w, asked := s.waiting_for.(types.WaitingFor_CrewVehicle)
	testing.expect(t, asked && w.crew_power == 1 && len(w.eligible_creatures) == 1, "the Bears can crew it")
	crew: [dynamic]types.ObjectId
	append(&crew, bears.id)
	testing.expect(t, game.apply(g, 0, types.GameAction_CrewVehicle{vehicle_id = skiff.id, creature_ids = crew}))
	testing.expect(t, bears.tapped && types.pvec_len(s.stack) == 1, "tapped to pay; the ability on the stack")
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, game.is_type(skiff, .Creature) && skiff.power.? == 3, "an artifact creature, 3/3")
	game.cleanup(g)
	testing.expect(t, !game.is_type(skiff, .Creature), "until end of turn")
	// The Vehicle leaves and comes back while crew is on the stack: a new object the ability doesn't affect (CR 400.7).
	bears.tapped = false
	s.phase, s.active_player, s.priority_player = .PreCombatMain, 0, 0
	s.waiting_for = types.WaitingFor_Priority{player = 0}
	testing.expect(t, game.apply(g, 0, types.GameAction_CrewVehicle{vehicle_id = skiff.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_CrewVehicle{vehicle_id = skiff.id, creature_ids = crew}))
	testing.expect(t, types.pvec_len(s.stack) == 1, "crew on the stack again")
	game.move_object(g, skiff.id, .Hand)
	game.move_object(g, skiff.id, .Battlefield)
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, !game.is_type(skiff, .Creature), "the new Vehicle isn't crewed")
}

@(test)
clone_enters_as_a_copy :: proc(t: ^testing.T) {
	if !load_db() do return
	// Clone: "You may have this creature enter as a copy of any creature on the battlefield." CR 707.9, 614.12: the
	// choice is made as it enters; CR 707.2: it takes the copied card's copiable values. Declining, it's a 0/0 and
	// dies (CR 704.5f).
	testing.expect(t, game.card_supported(&card(t, "Clone").face))
	testing.expect(t, !game.card_supported(&card(t, "Altered Ego").face), "\"except it enters with X counters\" isn't read yet")
	run :: proc(t: ^testing.T, copy: bool) -> (^types.GameObject, ^game.Game) {
		g := new_game()
		s := &g.state
		for _ in 0 ..< 4 do add(t, g, "Island", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
		clone := add(t, g, "Clone", 0, .Hand) // {3}{U}
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = clone.id}))
		game.apply(g, 0, types.GameAction_PassPriority{})
		game.apply(g, 1, types.GameAction_PassPriority{})
		w, asked := s.waiting_for.(types.WaitingFor_CopyTargetChoice)
		testing.expect(t, asked && slice.contains(w.valid_targets[:], bears.id), "asked what to copy")
		target: Maybe(types.TargetRef)
		if copy do target = types.TargetRef_Object{bears.id}
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = target}))
		return clone, g
	}
	c, g := run(t, true)
	testing.expect(t, c.zone == .Battlefield && c.name == "Grizzly Bears" && c.power.? == 2, "a Grizzly Bears")
	// It leaves the battlefield: a new object, the card Clone again (CR 400.7, 707.2).
	game.move_object(g, c.id, .Graveyard)
	cost, _ := c.mana_cost.(types.ManaCost_Cost)
	testing.expect(t, c.name == "Clone" && cost.generic == 3, "Clone in the graveyard, {3}{U}")
	c, _ = run(t, false)
	testing.expect(t, c.zone == .Graveyard, "declined: a 0/0, put into the graveyard")
}

@(test)
planeswalker_loyalty_and_attacks :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 306.5b: a planeswalker enters with its printed loyalty. CR 606.3-606.4: a loyalty ability, at sorcery
	// speed, once per turn for that permanent, adds or removes loyalty as its cost. CR 508.1b, 510.1a: a creature
	// can attack it, and its combat damage removes loyalty (CR 120.3c).
	testing.expect(t, game.card_supported(&card(t, "Jace Beleren").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Island", 0, .Battlefield)
	ajani := add(t, g, "Jace Beleren", 0, .Hand) // {1}{U}{U}, loyalty 3; +2: Each player draws a card
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = ajani.id}))
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, ajani.zone == .Battlefield && ajani.loyalty.? == 3, "enters with 3 loyalty")
	hand := types.pvec_len(game.player(s, 1).hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = ajani.id, ability_index = 0}))
	testing.expect(t, ajani.loyalty.? == 5, "+2 paid as it's activated")
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, types.pvec_len(game.player(s, 1).hand) == hand + 1, "each player drew")
	testing.expect(t, !game.apply(g, 0, types.GameAction_ActivateAbility{source_id = ajani.id, ability_index = 0}), "once per turn")

	// The opponent's turn: their Bears attack Jace.
	s.active_player, s.priority_player = 1, 1
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.begin_step(g, .DeclareAttackers)
	w, asked := s.waiting_for.(types.WaitingFor_DeclareAttackers)
	pw_offered := false
	if asked do for target in w.valid_attack_targets do if p, is_pw := target.(types.AttackTarget_Planeswalker); is_pw && p._0 == ajani.id do pw_offered = true
	testing.expect(t, pw_offered, "Jace can be attacked")
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{bears.id, types.AttackTarget_Planeswalker{ajani.id}}}
	testing.expect(t, game.apply(g, 1, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	for _ in 0 ..< 8 {
		if s.phase >= .EndCombat do break
		if _, priority := s.waiting_for.(types.WaitingFor_Priority); !priority {
			act, _ := game.ai_action(g, s.priority_player)
			game.apply(g, s.priority_player, act)
			continue
		}
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, ajani.loyalty.? == 3 && game.player(s, 0).life == 20, "2 damage to Jace, none to its controller")
}

@(test)
you_may_pay_mana :: proc(t: ^testing.T) {
	if !load_db() do return
	// Mentor of the Meek: "Whenever another creature you control with power 2 or less enters, you may pay {1}. If
	// you do, draw a card." The payment is a choice as it resolves (CR 608.2d), possible only if the player can pay
	// it (CR 118.3).
	testing.expect(t, game.card_supported(&card(t, "Mentor of the Meek").face))
	run :: proc(t: ^testing.T, lands: int) -> (drew: bool, asked: bool) {
		g := new_game()
		s := &g.state
		add(t, g, "Mentor of the Meek", 0, .Battlefield)
		for _ in 0 ..< lands do add(t, g, "Forest", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 0, .Hand)
		hand := types.pvec_len(game.player(s, 0).hand) - 1
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = bears.id}))
		for _ in 0 ..< 10 {
			if _, optional := s.waiting_for.(types.WaitingFor_OptionalEffectChoice); optional {
				asked = true
				testing.expect(t, game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = true}))
				continue
			}
			if types.pvec_len(s.stack) == 0 do break
			game.apply(g, s.priority_player, types.GameAction_PassPriority{})
		}
		return types.pvec_len(game.player(s, 0).hand) == hand + 1, asked
	}
	drew, asked := run(t, 3)
	testing.expect(t, asked && drew, "a third Forest pays {1}: a card")
	drew, asked = run(t, 2)
	testing.expect(t, !drew, "no mana left: it can't be paid")
}

@(test)
exiled_this_way :: proc(t: ^testing.T) {
	if !load_db() do return
	// Deathgorge Scavenger: "Whenever this creature enters or attacks, you may exile target card from a graveyard. If
	// a creature card is exiled this way, you gain 2 life. If a noncreature card is exiled this way, this creature
	// gets +1/+1 until end of turn." "This way" reads what the instruction before did (CR 608.2c).
	testing.expect(t, game.card_supported(&card(t, "Deathgorge Scavenger").face))
	run :: proc(t: ^testing.T, in_graveyard: string) -> (^game.Game, ^types.GameObject) {
		g := new_game()
		s := &g.state
		for _ in 0 ..< 3 do add(t, g, "Forest", 0, .Battlefield)
		dead := add(t, g, in_graveyard, 1, .Graveyard)
		scavenger := add(t, g, "Deathgorge Scavenger", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = scavenger.id}))
		for _ in 0 ..< 12 {
			#partial switch w in s.waiting_for {
			case types.WaitingFor_TriggerTargetSelection:
				game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{dead.id}})
				continue
			case types.WaitingFor_OptionalEffectChoice:
				game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = true})
				continue
			}
			if types.pvec_len(s.stack) == 0 do break
			game.apply(g, s.priority_player, types.GameAction_PassPriority{})
		}
		testing.expect(t, dead.zone == .Exile)
		return g, scavenger
	}
	g, sc := run(t, "Grizzly Bears")
	testing.expect(t, game.player(&g.state, 0).life == 22 && sc.power.? == 3, "a creature card: 2 life, no pump")
	g, sc = run(t, "Shock")
	testing.expect(t, game.player(&g.state, 0).life == 20 && sc.power.? == 4, "a noncreature card: +1/+1, no life")
}

@(test)
when_you_do_after_a_sacrifice :: proc(t: ^testing.T) {
	if !load_db() do return
	// Brokers Hideout: "When this land enters, sacrifice it. When you do, search your library for a basic Forest,
	// Plains, or Island card, put it onto the battlefield tapped, then shuffle." CR 603.12: the reflexive ability
	// triggers because the sacrifice happened.
	testing.expect(t, game.card_supported(&card(t, "Brokers Hideout").face))
	g := new_game()
	s := &g.state
	plains := add(t, g, "Plains", 0, .Library)
	hideout := add(t, g, "Brokers Hideout", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = hideout.id}))
	for _ in 0 ..< 10 {
		if w, searching := s.waiting_for.(types.WaitingFor_SearchChoice); searching {
			chosen: [dynamic]types.ObjectId
			append(&chosen, plains.id)
			testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = chosen}))
			_ = w
			continue
		}
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, hideout.zone == .Graveyard, "sacrificed")
	testing.expect(t, plains.zone == .Battlefield && plains.tapped, "then the Plains, tapped")
}

@(test)
fight_and_bite :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 701.14a: Prey Upon, "Target creature you control fights target creature you don't control": each deals
	// damage equal to its power to the other. Bite Down: "Target creature you control deals damage equal to its
	// power to target creature or planeswalker you don't control": one way only.
	testing.expect(t, game.card_supported(&card(t, "Prey Upon").face))
	testing.expect(t, game.card_supported(&card(t, "Bite Down").face))
	cast_two :: proc(t: ^testing.T, g: ^game.Game, name: string, a, b: types.ObjectId) {
		s := &g.state
		spell := add(t, g, name, 0, .Hand)
		ok := game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id})
		testing.expectf(t, ok, "cast %s: %v", name, game.rejection)
		for pick in ([]types.ObjectId{a, b}) {
			if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
				testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{pick}}))
			}
		}
		for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	g := new_game()
	for _ in 0 ..< 2 do add(t, g, "Forest", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	giant := add(t, g, "Hill Giant", 1, .Battlefield) // 3/3
	cast_two(t, g, "Prey Upon", mine.id, giant.id)
	testing.expect(t, mine.zone == .Graveyard && giant.zone == .Battlefield && giant.damage_marked == 2, "fought: 2 to the Giant, 3 to the Bears")

	g2 := new_game()
	for _ in 0 ..< 2 do add(t, g2, "Forest", 0, .Battlefield)
	mine2 := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g2, "Grizzly Bears", 1, .Battlefield)
	cast_two(t, g2, "Bite Down", mine2.id, theirs.id)
	testing.expect(t, theirs.zone == .Graveyard && mine2.zone == .Battlefield && mine2.damage_marked == 0, "bitten: one way")
}

@(test)
modal_triggered_ability :: proc(t: ^testing.T) {
	if !load_db() do return
	// Abiding Grace: "At the beginning of your end step, choose one - You gain 1 life; or return target creature card
	// with mana value 1 from your graveyard to the battlefield." CR 603.3c: the mode is chosen as the ability is put
	// on the stack; CR 700.2a: a mode whose target can't be chosen can't be chosen.
	testing.expect(t, game.card_supported(&card(t, "Abiding Grace").face))
	g := new_game()
	s := &g.state
	add(t, g, "Abiding Grace", 0, .Battlefield)
	game.begin_step(g, .End)
	w, asked := s.waiting_for.(types.WaitingFor_AbilityModeChoice)
	testing.expect(t, asked && slice.contains(w.unavailable_modes[:], 1), "asked, the return mode unavailable with no such card")
	modes: [dynamic]int
	append(&modes, 1)
	testing.expect(t, !game.apply(g, 0, types.GameAction_SelectModes{indices = modes}), "not the unavailable mode")
	modes[0] = 0
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectModes{indices = modes}))
	testing.expect(t, types.pvec_len(s.stack) == 1, "on the stack with its mode")
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, game.player(s, 0).life == 21)
}

@(test)
impulse_draw :: proc(t: ^testing.T) {
	if !load_db() do return
	// Reckless Impulse: "Exile the top two cards of your library. Until the end of your next turn, you may play those
	// cards." A land among them is played as the land for the turn (CR 305.1), a spell cast from exile.
	testing.expect(t, game.card_supported(&card(t, "Reckless Impulse").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 2 do add(t, g, "Mountain", 0, .Battlefield)
	mountain := add(t, g, "Mountain", 0, .Library)
	shock := add(t, g, "Shock", 0, .Library) // the top card
	impulse := add(t, g, "Reckless Impulse", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = impulse.id}))
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, shock.zone == .Exile && mountain.zone == .Exile, "both exiled")
	testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = mountain.id}), "the Mountain played from exile")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}), "Shock cast from exile")
	if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
		game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}})
	}
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, game.player(s, 1).life == 18 && shock.zone == .Graveyard)

	// A card not played by then stays exiled and can't be played after the end of the controller's next turn.
	g2 := new_game()
	s2 := &g2.state
	for _ in 0 ..< 2 do add(t, g2, "Mountain", 0, .Battlefield)
	kept := add(t, g2, "Shock", 0, .Library)
	impulse2 := add(t, g2, "Reckless Impulse", 0, .Hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = impulse2.id}))
	for types.pvec_len(s2.stack) > 0 do game.apply(g2, s2.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, len(kept.casting_permissions) == 1)
	game.cleanup(g2) // this turn ends: the permission lasts
	testing.expect(t, len(kept.casting_permissions) == 1, "still playable on the opponent's turn and the next of ours")
	game.cleanup(g2)
	game.cleanup(g2) // the end of its controller's next turn
	testing.expect(t, len(kept.casting_permissions) == 0 && kept.zone == .Exile, "gone, the card still exiled")
}

@(test)
effect_without_duration_lasts :: proc(t: ^testing.T) {
	if !load_db() do return
	// Apprentice Necromancer: "{B}, {T}, Sacrifice this creature: Return target creature card from your graveyard to
	// the battlefield. That creature gains haste. At the beginning of the next end step, sacrifice it." The haste has
	// no stated duration, so it lasts (CR 611.2a); the delayed ability sacrifices it (CR 603.7).
	testing.expect(t, game.card_supported(&card(t, "Apprentice Necromancer").face))
	g := new_game()
	s := &g.state
	add(t, g, "Swamp", 0, .Battlefield)
	necro := add(t, g, "Apprentice Necromancer", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Graveyard)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = necro.id, ability_index = 0}))
	if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
		game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}})
	}
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, bears.zone == .Battlefield && game.has_keyword(bears, types.Keyword_Haste), "back, with haste")
	game.begin_step(g, .End)
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, bears.zone == .Graveyard, "sacrificed at the end step")
}

@(test)
creature_land :: proc(t: ^testing.T) {
	if !load_db() do return
	// Blinkmoth Nexus: "{1}: This land becomes a 1/1 Blinkmoth artifact creature with flying until end of turn.
	// It's still a land." CR 205.1b: it gets the new creature type, keeping its land types (CR 613.1d, 613.4b).
	testing.expect(t, game.card_supported(&card(t, "Blinkmoth Nexus").face))
	g := new_game()
	s := &g.state
	add(t, g, "Plains", 0, .Battlefield)
	nexus := add(t, g, "Blinkmoth Nexus", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = nexus.id, ability_index = 1}))
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, game.is_type(nexus, .Creature) && game.is_type(nexus, .Land) && game.is_type(nexus, .Artifact), "an artifact creature land")
	testing.expect(t, nexus.power.? == 1 && game.has_keyword(nexus, types.Keyword_Flying) && game.has_subtype(nexus, "Blinkmoth"))
	game.cleanup(g)
	testing.expect(t, !game.is_type(nexus, .Creature), "a land again after the turn")
}

@(test)
typecycling :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.29e: Ash Barrens, "Basic landcycling {1}": {1}, discard it: search your library for a basic land card,
	// reveal it, put it into your hand, then shuffle.
	testing.expect(t, game.card_supported(&card(t, "Ash Barrens").face))
	g := new_game()
	s := &g.state
	add(t, g, "Plains", 0, .Battlefield)
	barrens := add(t, g, "Ash Barrens", 0, .Hand)
	hand := types.pvec_len(game.player(s, 0).hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = barrens.id, ability_index = 1}))
	testing.expect(t, barrens.zone == .Graveyard, "discarded as the cost")
	for _ in 0 ..< 6 {
		if w, searching := s.waiting_for.(types.WaitingFor_SearchChoice); searching {
			one: [dynamic]types.ObjectId
			append(&one, w.cards[0])
			game.apply(g, 0, types.GameAction_SelectCards{cards = one})
			continue
		}
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, types.pvec_len(game.player(s, 0).hand) == hand, "a basic land in place of the Barrens")
}

@(test)
attach_to_the_new_token :: proc(t: ^testing.T) {
	if !load_db() do return
	// Ancestral Blade: "When this Equipment enters, create a 1/1 white Soldier creature token, then attach this
	// Equipment to it. Equipped creature gets +1/+1." CR 701.3a: attach puts it on that creature.
	testing.expect(t, game.card_supported(&card(t, "Ancestral Blade").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 2 do add(t, g, "Plains", 0, .Battlefield)
	blade := add(t, g, "Ancestral Blade", 0, .Hand) // {1}{W}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = blade.id}))
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	soldier: ^types.GameObject
	for id in game.ids_of(s.battlefield) do if o := game.object(s, id); o.is_token do soldier = o
	testing.expect(t, soldier != nil && game.host_of(s, blade) == soldier, "attached to the Soldier")
	if soldier != nil do testing.expect(t, soldier.power.? == 2 && soldier.toughness.? == 2, "a 2/2")
}

@(test)
exile_from_an_opponents_graveyard :: proc(t: ^testing.T) {
	if !load_db() do return
	// Disposal Mummy: "When this creature enters, exile target card from an opponent's graveyard." Only a card an
	// opponent owns (CR 108.3) in a graveyard can be the target (CR 115.1).
	testing.expect(t, game.card_supported(&card(t, "Disposal Mummy").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Plains", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Graveyard)
	theirs := add(t, g, "Grizzly Bears", 1, .Graveyard)
	mummy := add(t, g, "Disposal Mummy", 0, .Hand) // {2}{W}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = mummy.id}))
	for _ in 0 ..< 8 {
		if w, asked := s.waiting_for.(types.WaitingFor_TriggerTargetSelection); asked {
			legal := w.selection.current_legal_targets
			testing.expect(t, len(legal) == 1 && legal[0] == types.TargetRef(types.TargetRef_Object{theirs.id}), "only the opponent's card")
			game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{theirs.id}})
			continue
		}
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, theirs.zone == .Exile && mine.zone == .Graveyard)
}

@(test)
cost_that_depends_on_the_target :: proc(t: ^testing.T) {
	if !load_db() do return
	// Ajani's Response ({4}{W}): "This spell costs {3} less to cast if it targets a tapped creature. Destroy target
	// creature." CR 601.2f: the total cost is worked out after the targets are chosen (601.2c), so with two Plains it
	// can be cast at a tapped creature only; an untapped one leaves a cost it can't pay, and the cast is reversed
	// (CR 601.2h, 734.1).
	testing.expect(t, game.card_supported(&card(t, "Ajani's Response").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 2 do add(t, g, "Plains", 0, .Battlefield)
	untapped := add(t, g, "Grizzly Bears", 1, .Battlefield)
	response := add(t, g, "Ajani's Response", 0, .Hand)
	testing.expect(t, !game.castable(s, 0, response, g.card_db), "no tapped creature: five mana needed")
	tapped := add(t, g, "Grizzly Bears", 1, .Battlefield)
	tapped.tapped = true
	testing.expect(t, game.castable(s, 0, response, g.card_db), "{1}{W} at the tapped creature")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = response.id}))
	game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{untapped.id}})
	testing.expect(t, response.zone == .Hand && types.pvec_len(s.stack) == 0, "reversed: back in hand, nothing on the stack")
	_, has_priority := s.waiting_for.(types.WaitingFor_Priority)
	testing.expect(t, has_priority, "the player has priority again")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = response.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{tapped.id}}))
	testing.expect(t, response.zone == .Stack, "cast for {1}{W}")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, tapped.zone == .Graveyard && untapped.zone == .Battlefield)
}

@(test)
spells_that_target_it_cost_more :: proc(t: ^testing.T) {
	if !load_db() do return
	// Boreal Elemental: "Spells your opponents cast that target this creature cost {2} more to cast." (CR 601.2f).
	// With one Mountain, Shock can go at the player but not at the Elemental.
	testing.expect(t, game.card_supported(&card(t, "Boreal Elemental").face))
	g := new_game()
	s := &g.state
	add(t, g, "Mountain", 0, .Battlefield)
	elemental := add(t, g, "Boreal Elemental", 1, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, game.castable(s, 0, shock, g.card_db), "castable at another target")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{elemental.id}})
	testing.expect(t, shock.zone == .Hand, "{2} more at the Elemental: reversed")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	testing.expect(t, shock.zone == .Stack, "cast at the player for {R}")
}

@(test)
cost_increase_every_target_would_pay :: proc(t: ^testing.T) {
	if !load_db() do return
	// Boreal Elemental: "Spells your opponents cast that target this creature cost {2} more to cast." When it's the
	// only creature, Murder ({1}{B}{B}, "destroy target creature") can't be cast with three Swamps: every legal
	// target raises the cost (CR 601.2f, 601.2h).
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Swamp", 0, .Battlefield)
	add(t, g, "Boreal Elemental", 1, .Battlefield)
	murder := add(t, g, "Murder", 0, .Hand)
	testing.expect(t, !game.castable(s, 0, murder, g.card_db), "only the Elemental to target: {3}{B}{B}")
	add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, game.castable(s, 0, murder, g.card_db), "the Bears can be targeted for {1}{B}{B}")
}

// Passes priority until the stack is empty (at most `n` passes).
@(private = "file")
settle_stack :: proc(g: ^game.Game, n := 8) {
	for _ in 0 ..< n {
		if types.pvec_len(g.state.stack) == 0 do return
		game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
	}
}

@(test)
that_creature_is_the_one_that_entered :: proc(t: ^testing.T) {
	if !load_db() do return
	// Good-Fortune Unicorn: "Whenever another creature you control enters, put a +1/+1 counter on that creature."
	// CR 603.2, 608.2c: "that creature" is the object the trigger event was about; once it has changed zones it's a
	// new object the ability doesn't affect (CR 400.7).
	testing.expect(t, game.card_supported(&card(t, "Good-Fortune Unicorn").face))
	g := new_game()
	s := &g.state
	unicorn := add(t, g, "Good-Fortune Unicorn", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = bears.id}))
	settle_stack(g)
	testing.expect(t, bears.zone == .Battlefield && game.counter_count(bears, types.CounterType_Plus1Plus1{}) == 1, "the Bears got the counter")
	testing.expect(t, game.counter_count(unicorn, types.CounterType_Plus1Plus1{}) == 0, "not the Unicorn")
	// The creature leaves before the trigger resolves: nothing gets the counter.
	elves := add(t, g, "Llanowar Elves", 0, .Hand)
	add(t, g, "Forest", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = elves.id}))
	for _ in 0 ..< 4 {
		if elves.zone == .Battlefield do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, elves.zone == .Battlefield && types.pvec_len(s.stack) == 1, "the Unicorn's trigger waits")
	// The Unicorn leaves (its trigger on the stack still resolves, CR 113.7a), and the Elves leave and come back: a
	// new object (CR 400.7), which the trigger about the old one doesn't affect.
	game.move_object(g, unicorn.id, .Graveyard)
	game.move_object(g, elves.id, .Hand)
	game.move_object(g, elves.id, .Battlefield)
	settle_stack(g)
	testing.expect(t, elves.zone == .Battlefield && game.counter_count(elves, types.CounterType_Plus1Plus1{}) == 0, "a new object: no counter")
}

@(test)
that_player_is_the_caster :: proc(t: ^testing.T) {
	if !load_db() do return
	// Eidolon of the Great Revel: "Whenever a player casts a spell with mana value 3 or less, this creature deals 2
	// damage to that player." "That player" is the one who cast it (CR 603.2, 608.2c).
	testing.expect(t, game.card_supported(&card(t, "Eidolon of the Great Revel").face))
	g := new_game()
	s := &g.state
	add(t, g, "Eidolon of the Great Revel", 1, .Battlefield)
	add(t, g, "Mountain", 0, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	settle_stack(g)
	testing.expect(t, s.players[0].life == 18, "the caster took 2")
	testing.expect(t, s.players[1].life == 18, "the Shock hit the Eidolon's controller")
}

@(test)
addendum_only_in_your_main_phase :: proc(t: ^testing.T) {
	if !load_db() do return
	// Arrester's Admonition: "Return target creature to its owner's hand. Addendum — If you cast this spell during
	// your main phase, draw a card." A spell resolves in the phase it was cast in (CR 500.2).
	testing.expect(t, game.card_supported(&card(t, "Arrester's Admonition").face))
	for mine in ([]bool{true, false}) {
		g := new_game()
		s := &g.state
		if !mine {
			// The opponent's turn: player 0 has priority in it.
			s.active_player = 1
		}
		for _ in 0 ..< 3 do add(t, g, "Island", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
		spell := add(t, g, "Arrester's Admonition", 0, .Hand) // {2}{U}
		hand := types.pvec_len(s.players[0].hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
		settle_stack(g)
		testing.expect(t, bears.zone == .Hand, "bounced")
		drew := types.pvec_len(s.players[0].hand) - (hand - 1)
		testing.expectf(t, drew == (1 if mine else 0), "your main phase: %v, cards drawn %d", mine, drew)
	}
}

@(test)
counter_unless_its_controller_pays :: proc(t: ^testing.T) {
	if !load_db() do return
	// Mana Leak: "Counter target spell unless its controller pays {3}." CR 118.12a: the spell's controller chooses
	// whether to pay as Mana Leak resolves; one who can't pay isn't asked, and the spell is countered.
	testing.expect(t, game.card_supported(&card(t, "Mana Leak").face))
	for lands in ([]int{5, 2}) {
		g := new_game()
		s := &g.state
		for _ in 0 ..< lands do add(t, g, "Forest", 0, .Battlefield)
		for _ in 0 ..< 2 do add(t, g, "Island", 1, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 0, .Hand)
		leak := add(t, g, "Mana Leak", 1, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = bears.id}))
		testing.expect(t, game.apply(g, 0, types.GameAction_PassPriority{}))
		testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = leak.id}))
		testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
		game.apply(g, 1, types.GameAction_PassPriority{})
		game.apply(g, 0, types.GameAction_PassPriority{})
		w, asked := s.waiting_for.(types.WaitingFor_UnlessPayment)
		if lands == 5 {
			testing.expect(t, asked && w.player == 0, "the Bears' controller is asked")
			testing.expect(t, game.apply(g, 0, types.GameAction_PayUnlessCost{pay = true}))
			settle_stack(g)
			testing.expect(t, bears.zone == .Battlefield, "paid: the Bears resolve")
			untapped := 0
			for id in game.ids_of(s.battlefield) do if o := game.object(s, id); o.controller == 0 && o.id != bears.id && !o.tapped do untapped += 1
			testing.expect(t, untapped == 0, "two Forests for the Bears, three for Mana Leak")
		} else {
			testing.expect(t, !asked, "can't pay: not asked")
			testing.expect(t, bears.zone == .Graveyard, "countered")
		}
	}
}

@(test)
it_fights_and_a_declined_fight :: proc(t: ^testing.T) {
	if !load_db() do return
	// Epic Confrontation: "Target creature you control gets +1/+2 until end of turn. It fights target creature you
	// don't control." "It" is the first target, not a target of its own (CR 608.2c, 701.14a).
	testing.expect(t, game.card_supported(&card(t, "Epic Confrontation").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 2 do add(t, g, "Forest", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g, "Hill Giant", 1, .Battlefield) // 3/3
	spell := add(t, g, "Epic Confrontation", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{mine.id}}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{theirs.id}}))
	settle_stack(g)
	testing.expect(t, theirs.zone == .Graveyard, "3 damage from the 3/4 Bears")
	testing.expect(t, mine.zone == .Battlefield && mine.damage_marked == 3, "the Bears survive as a 3/4")

	// Affectionate Indrik: "When this creature enters, you may have it fight target creature you don't control."
	// Declined, nothing happens (CR 603.5, 608.2d).
	testing.expect(t, game.card_supported(&card(t, "Affectionate Indrik").face))
	g = new_game()
	s = &g.state
	for _ in 0 ..< 6 do add(t, g, "Forest", 0, .Battlefield)
	big := add(t, g, "Craw Wurm", 1, .Battlefield) // 6/4
	indrik := add(t, g, "Affectionate Indrik", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = indrik.id}))
	for _ in 0 ..< 10 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_OptionalEffectChoice:
			game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = false})
			continue
		case types.WaitingFor_TriggerTargetSelection:
			game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{big.id}})
			continue
		}
		if types.pvec_len(s.stack) == 0 && indrik.zone == .Battlefield do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, indrik.zone == .Battlefield && indrik.damage_marked == 0 && big.damage_marked == 0, "declined: no fight")
}

@(test)
modal_trigger_with_no_mode_it_can_choose :: proc(t: ^testing.T) {
	if !load_db() do return
	// Damage Control Crew: "When this creature enters, choose one — return target card with mana value 4 or greater
	// from your graveyard to your hand; or exile target artifact or enchantment." With neither target, no mode can
	// be chosen and the ability is removed (CR 700.2b, 603.3c); the game goes on.
	testing.expect(t, game.card_supported(&card(t, "Damage Control Crew").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 4 do add(t, g, "Forest", 0, .Battlefield)
	crew := add(t, g, "Damage Control Crew", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = crew.id}))
	settle_stack(g)
	_, priority := s.waiting_for.(types.WaitingFor_Priority)
	testing.expect(t, crew.zone == .Battlefield && types.pvec_len(s.stack) == 0 && priority, "no trigger, priority as usual")
}

@(test)
creature_types_are_the_cr_list :: proc(t: ^testing.T) {
	// CR 205.3m lists the creature types; planeswalker types (205.3j) and Siege (205.3q) aren't, so "becomes a
	// creature" effects that replace creature types leave them (CR 205.1b).
	testing.expect(t, game.subtype_in_set("Elf", .Creature) && game.subtype_in_set("Time Lord", .Creature))
	testing.expect(t, !game.subtype_in_set("Gideon", .Creature) && !game.subtype_in_set("Siege", .Creature))
	testing.expect(t, !game.subtype_in_set("Equipment", .Creature) && !game.subtype_in_set("Forest", .Creature))
}

@(test)
clone_is_not_offered_a_token :: proc(t: ^testing.T) {
	if !load_db() do return
	// Copying a token (its copiable values come from what made it, CR 111.3, 707.2) isn't supported yet, so Clone
	// isn't offered one: a choice the engine would refuse would leave the player, or the AI, stuck.
	g := new_game()
	s := &g.state
	for _ in 0 ..< 4 do add(t, g, "Island", 0, .Battlefield)
	token := add(t, g, "Grizzly Bears", 1, .Battlefield)
	token.is_token, token.printed_ref = true, nil
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	clone := add(t, g, "Clone", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = clone.id}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	w, asked := s.waiting_for.(types.WaitingFor_CopyTargetChoice)
	testing.expect(t, asked && len(w.valid_targets) == 1 && w.valid_targets[0] == bears.id, "only the card")
}

@(test)
priority_returns_to_the_caster_after_trigger_targets :: proc(t: ^testing.T) {
	if !load_db() do return
	// The non-active player casts an instant in response; their Rockslide Sorcerer triggers ("Whenever you cast an
	// instant or sorcery spell, this creature deals 1 damage to any target") and they choose its target. CR 117.3c:
	// the player who cast the spell receives priority afterward, not the active player.
	testing.expect(t, game.card_supported(&card(t, "Rockslide Sorcerer").face))
	g := new_game()
	s := &g.state
	add(t, g, "Rockslide Sorcerer", 1, .Battlefield)
	add(t, g, "Mountain", 1, .Battlefield)
	shock := add(t, g, "Shock", 1, .Hand)
	game.apply(g, 0, types.GameAction_PassPriority{})
	testing.expect(t, s.priority_player == 1, "the non-active player has priority")
	testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = types.TargetRef_Player{0}}))
	_, asked := s.waiting_for.(types.WaitingFor_TriggerTargetSelection)
	testing.expect(t, asked, "the Dragon's target is asked")
	testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = types.TargetRef_Player{0}}))
	w, priority := s.waiting_for.(types.WaitingFor_Priority)
	testing.expect(t, priority && w.player == 1, "the caster gets priority back")
}

@(test)
flickered_planeswalker_isnt_dealt_the_damage :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 506.4: an attacked planeswalker that leaves the battlefield is removed from combat; if it comes back it's a
	// new object (CR 400.7), which nothing is attacking, so the unblocked attacker deals no combat damage to it.
	g := new_game()
	s := &g.state
	jace := add(t, g, "Jace Beleren", 0, .Battlefield)
	s.active_player, s.priority_player = 1, 1
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{bears.id, types.AttackTarget_Planeswalker{jace.id}}}
	testing.expect(t, game.apply(g, 1, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	game.move_object(g, jace.id, .Exile)
	game.move_object(g, jace.id, .Battlefield)
	loyalty := jace.loyalty.?
	for _ in 0 ..< 8 {
		if s.phase >= .EndCombat do break
		if _, priority := s.waiting_for.(types.WaitingFor_Priority); !priority {
			act, _ := game.ai_action(g, s.priority_player)
			game.apply(g, s.priority_player, act)
			continue
		}
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, jace.loyalty.? == loyalty && game.player(s, 0).life == 20, "no damage to the new Jace or its controller")
}

@(test)
fights_up_to_one_target :: proc(t: ^testing.T) {
	if !load_db() do return
	// Wicked Wolf: "When this creature enters, it fights up to one target creature you don't control." The target is
	// optional (CR 115.1, 601.2c); chosen, they fight (CR 701.14a); with none, nothing happens.
	testing.expect(t, game.card_supported(&card(t, "Wicked Wolf").face))
	for choose in ([]bool{true, false}) {
		g := new_game()
		s := &g.state
		for _ in 0 ..< 4 do add(t, g, "Forest", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
		wolf := add(t, g, "Wicked Wolf", 0, .Hand) // 3/3
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = wolf.id}))
		for _ in 0 ..< 10 {
			if _, asked := s.waiting_for.(types.WaitingFor_TriggerTargetSelection); asked {
				target: Maybe(types.TargetRef)
				if choose do target = types.TargetRef_Object{bears.id}
				testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = target}))
				continue
			}
			if types.pvec_len(s.stack) == 0 && wolf.zone == .Battlefield do break
			game.apply(g, s.priority_player, types.GameAction_PassPriority{})
		}
		if choose do testing.expect(t, bears.zone == .Graveyard && wolf.damage_marked == 2, "they fought")
		else do testing.expect(t, bears.zone == .Battlefield && wolf.damage_marked == 0, "no target: no fight")
	}
}

@(test)
damage_divided_among_targets :: proc(t: ^testing.T) {
	if !load_db() do return
	// Arc Lightning: "Arc Lightning deals 3 damage divided as you choose among one, two, or three targets." CR
	// 601.2d: the division is announced after the targets, each target getting at least one.
	testing.expect(t, game.card_supported(&card(t, "Arc Lightning").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	arc := add(t, g, "Arc Lightning", 0, .Hand) // {2}{R}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = arc.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	game.apply(g, 0, types.GameAction_ChooseTarget{target = nil}) // no third target
	w, asked := s.waiting_for.(types.WaitingFor_DistributeAmong)
	testing.expect(t, asked && w.total == 3 && len(w.targets) == 2, "asked to divide 3 between the two")
	d := func_division(bears.id, 3, 0)
	testing.expect(t, !game.apply(g, 0, types.GameAction_DistributeAmong{distribution = d}), "each target gets at least one")
	d = func_division(bears.id, 2, 2)
	testing.expect(t, !game.apply(g, 0, types.GameAction_DistributeAmong{distribution = d}), "the shares add up to 3")
	d = func_division(bears.id, 2, 1)
	testing.expect(t, game.apply(g, 0, types.GameAction_DistributeAmong{distribution = d}))
	testing.expect(t, arc.zone == .Stack, "cast")
	settle_stack(g)
	testing.expect(t, bears.zone == .Graveyard && s.players[1].life == 19, "2 to the Bears, 1 to the player")
}

@(private = "file")
func_division :: proc(creature: types.ObjectId, to_creature, to_player: u32) -> [dynamic]types.Tuple2(types.TargetRef, u32) {
	out: [dynamic]types.Tuple2(types.TargetRef, u32)
	append(&out, types.Tuple2(types.TargetRef, u32){types.TargetRef_Object{creature}, to_creature})
	append(&out, types.Tuple2(types.TargetRef, u32){types.TargetRef_Player{1}, to_player})
	return out
}

@(test)
prowess_on_noncreature_spells :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.108a: Prowess, "Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn."
	testing.expect(t, game.card_supported(&card(t, "Monastery Swiftspear").face))
	g := new_game()
	s := &g.state
	spear := add(t, g, "Monastery Swiftspear", 0, .Battlefield) // 1/2
	for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	testing.expect(t, types.pvec_len(s.stack) == 2, "prowess triggered above Shock")
	settle_stack(g)
	testing.expect(t, spear.power.? == 2 && spear.toughness.? == 3, "2/3 until end of turn")
	bears := add(t, g, "Grizzly Bears", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = bears.id}))
	testing.expect(t, types.pvec_len(s.stack) == 1, "a creature spell: no trigger")
	settle_stack(g)
	game.cleanup(g)
	testing.expect(t, spear.power.? == 1 && spear.toughness.? == 2, "back to 1/2")
}

@(test)
ward_counters_unless_paid :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.21a: Ward {3}, "Whenever this creature becomes the target of a spell or ability an opponent controls,
	// counter it unless that player pays {3}." Rimeshield Frost Giant, a 4/5.
	testing.expect(t, game.card_supported(&card(t, "Rimeshield Frost Giant").face))
	for mountains in ([]int{1, 4}) {
		g := new_game()
		s := &g.state
		for _ in 0 ..< mountains do add(t, g, "Mountain", 0, .Battlefield)
		giant := add(t, g, "Rimeshield Frost Giant", 1, .Battlefield)
		shock := add(t, g, "Shock", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{giant.id}}))
		testing.expect(t, types.pvec_len(s.stack) == 2, "ward triggered above Shock")
		for _ in 0 ..< 8 {
			if w, asked := s.waiting_for.(types.WaitingFor_UnlessPayment); asked {
				testing.expect(t, w.player == 0, "Shock's controller pays")
				game.apply(g, 0, types.GameAction_PayUnlessCost{pay = true})
				continue
			}
			if types.pvec_len(s.stack) == 0 do break
			game.apply(g, s.priority_player, types.GameAction_PassPriority{})
		}
		if mountains == 1 {
			testing.expect(t, shock.zone == .Graveyard && giant.damage_marked == 0, "can't pay: Shock is countered")
		} else {
			testing.expect(t, giant.damage_marked == 2, "paid {3}: Shock resolves")
		}
	}
	// Its controller's own spells don't trigger it.
	g := new_game()
	s := &g.state
	add(t, g, "Mountain", 1, .Battlefield)
	giant := add(t, g, "Rimeshield Frost Giant", 1, .Battlefield)
	shock := add(t, g, "Shock", 1, .Hand)
	s.active_player, s.priority_player = 1, 1
	s.waiting_for = types.WaitingFor_Priority{player = 1}
	testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = types.TargetRef_Object{giant.id}}))
	testing.expect(t, types.pvec_len(s.stack) == 1, "no ward trigger")
}

@(test)
ward_counters_an_ability :: proc(t: ^testing.T) {
	if !load_db() do return
	// Ward counters a targeting ability as well as a spell (CR 702.21a, 701.6a: it's removed from the stack).
	// Prodigal Sorcerer: "{T}: This creature deals 1 damage to any target."
	testing.expect(t, game.card_supported(&card(t, "Prodigal Sorcerer").face))
	g := new_game()
	s := &g.state
	sorcerer := add(t, g, "Prodigal Sorcerer", 0, .Battlefield)
	giant := add(t, g, "Rimeshield Frost Giant", 1, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = sorcerer.id, ability_index = 0}))
	if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{giant.id}}))
	}
	testing.expect(t, types.pvec_len(s.stack) == 2, "ward triggered above the ability")
	settle_stack(g)
	testing.expect(t, types.pvec_len(s.stack) == 0 && giant.damage_marked == 0, "no mana to pay: the ability is countered")
}

@(test)
convoke_taps_creatures_to_pay :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.51a: convoke, tapping an untapped creature you control instead of paying {1} or one mana of its color.
	// Not a {T} cost, so a summoning-sick creature can convoke. Arboretum Elemental: {7}{G}{G}.
	testing.expect(t, game.card_supported(&card(t, "Arboretum Elemental").face))
	for creatures in ([]int{4, 5}) {
		g := new_game()
		s := &g.state
		for _ in 0 ..< 4 do add(t, g, "Forest", 0, .Battlefield)
		bears: [dynamic]^types.GameObject
		for _ in 0 ..< creatures do append(&bears, add(t, g, "Grizzly Bears", 0, .Battlefield))
		bears[0].summoning_sick = true
		elemental := add(t, g, "Arboretum Elemental", 0, .Hand)
		castable := game.castable(s, 0, elemental, g.card_db)
		if creatures == 4 {
			testing.expect(t, !castable, "8 of the 9 mana")
			continue
		}
		testing.expect(t, castable, "4 Forests and 5 creatures pay {7}{G}{G}")
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = elemental.id}))
		testing.expect(t, elemental.zone == .Stack, "cast")
		tapped := 0
		for b in bears do if b.tapped do tapped += 1
		testing.expect(t, tapped == 5, "every creature convoked")
		testing.expect(t, len(s.players[0].mana_pool.mana) == 0, "no mana left over")
	}
}

@(test)
investigate_makes_a_clue :: proc(t: ^testing.T) {
	if !load_db() do return
	// Thraben Inspector: "When this creature enters, investigate." CR 701.16a: create a Clue token, which has
	// "{2}, Sacrifice this token: Draw a card." (CR 111.10f).
	testing.expect(t, game.card_supported(&card(t, "Thraben Inspector").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Plains", 0, .Battlefield)
	inspector := add(t, g, "Thraben Inspector", 0, .Hand) // {W}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = inspector.id}))
	settle_stack(g)
	clue: ^types.GameObject
	for id in game.ids_of(s.battlefield) do if o := game.object(s, id); o.is_token && o.name == "Clue" do clue = o
	testing.expect(t, clue != nil && game.is_type(clue, .Artifact), "a Clue artifact token")
	if clue == nil do return
	hand := types.pvec_len(s.players[0].hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = clue.id, ability_index = 0}))
	settle_stack(g)
	testing.expect(t, types.pvec_len(s.players[0].hand) == hand + 1, "sacrificed for a card")
}

@(test)
amass_makes_or_grows_an_army :: proc(t: ^testing.T) {
	if !load_db() do return
	// Lazotep Reaver: "When this creature enters, amass Zombies 1." CR 701.47a: with no Army, a 0/0 black Zombie
	// Army token is created first; then the Army gets the counters. A second amass grows the same Army.
	testing.expect(t, game.card_supported(&card(t, "Lazotep Reaver").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 4 do add(t, g, "Swamp", 0, .Battlefield)
	army :: proc(s: ^types.GameState) -> ^types.GameObject {
		for id in game.ids_of(s.battlefield) do if o := game.object(s, id); o.is_token && slice.contains(o.card_types.subtypes[:], "Army") do return o
		return nil
	}
	first := add(t, g, "Lazotep Reaver", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = first.id}))
	settle_stack(g)
	a := army(s)
	testing.expect(t, a != nil && a.power.? == 1 && slice.contains(a.card_types.subtypes[:], "Zombie"), "a 1/1 Zombie Army")
	second := add(t, g, "Lazotep Reaver", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = second.id}))
	settle_stack(g)
	tokens := 0
	for id in game.ids_of(s.battlefield) do if o := game.object(s, id); o.is_token do tokens += 1
	testing.expect(t, tokens == 1 && a != nil && a.power.? == 2, "the same Army, now 2/2")
}

@(test)
mana_counted_as_it_is_added :: proc(t: ^testing.T) {
	if !load_db() do return
	// Elvish Archdruid: "{T}: Add {G} for each Elf you control." The count is taken as the mana ability resolves
	// (CR 605.3b, 106.4); the Archdruid is an Elf itself.
	testing.expect(t, game.card_supported(&card(t, "Elvish Archdruid").face))
	g := new_game()
	s := &g.state
	druid := add(t, g, "Elvish Archdruid", 0, .Battlefield)
	for _ in 0 ..< 2 do add(t, g, "Llanowar Elves", 0, .Battlefield)
	index := -1
	for a, i in druid.abilities^ do if a.kind == .Activated do index = i
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = druid.id, ability_index = index}))
	testing.expect(t, len(s.players[0].mana_pool.mana) == 3, "{G}{G}{G}")
	// Paying automatically counts it the same way: a {4}{G}{G} spell from the Archdruid's three, the Elves' two and
	// one Forest.
	g = new_game()
	s = &g.state
	add(t, g, "Elvish Archdruid", 0, .Battlefield)
	for _ in 0 ..< 2 do add(t, g, "Llanowar Elves", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	wurm := add(t, g, "Craw Wurm", 0, .Hand) // {4}{G}{G}
	testing.expect(t, game.castable(s, 0, wurm, g.card_db), "3 + 1 + 1 + 1 mana")
}

@(test)
if_you_cast_it_from_your_hand :: proc(t: ^testing.T) {
	if !load_db() do return
	// Wakening Sun's Avatar: "When this creature enters, if you cast it from your hand, destroy all non-Dinosaur
	// creatures." An intervening "if" (CR 603.4): cast, it triggers; put onto the battlefield, it doesn't.
	testing.expect(t, game.card_supported(&card(t, "Wakening Sun's Avatar").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 8 do add(t, g, "Plains", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	avatar := add(t, g, "Wakening Sun's Avatar", 0, .Hand) // {5}{W}{W}{W}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = avatar.id}))
	settle_stack(g)
	testing.expect(t, avatar.zone == .Battlefield && bears.zone == .Graveyard, "cast from the hand: the Bears are destroyed")
	other := add(t, g, "Grizzly Bears", 1, .Battlefield)
	second := add(t, g, "Wakening Sun's Avatar", 0, .Hand)
	game.move_object(g, second.id, .Battlefield)
	game.apply(g, 0, types.GameAction_PassPriority{})
	testing.expect(t, types.pvec_len(s.stack) == 0 && other.zone == .Battlefield, "not cast: no trigger")
}

@(test)
that_player_loses_life_when_they_draw :: proc(t: ^testing.T) {
	if !load_db() do return
	// Sheoldred, the Apocalypse: "Whenever you draw a card, you gain 2 life. Whenever an opponent draws a card, they
	// lose 2 life." "They" is the trigger event's player (CR 603.2, 608.2c); each card drawn is its own event (CR
	// 121.2).
	testing.expect(t, game.card_supported(&card(t, "Sheoldred, the Apocalypse").face))
	g := new_game()
	s := &g.state
	add(t, g, "Sheoldred, the Apocalypse", 0, .Battlefield)
	for _ in 0 ..< 6 do add(t, g, "Island", 0, .Battlefield)
	divination := add(t, g, "Divination", 0, .Hand) // {2}{U}: draw two cards
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = divination.id}))
	settle_stack(g, 12)
	testing.expect(t, s.players[0].life == 24, "drew two: gained 4")
	opportunity := add(t, g, "Opportunity", 0, .Hand) // {4}{U}{U}: target player draws four cards
	for _ in 0 ..< 3 do add(t, g, "Island", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = opportunity.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	settle_stack(g, 16)
	testing.expect(t, s.players[1].life == 12 && s.players[0].life == 24, "the opponent drew four: lost 8")
}

@(test)
transform_to_the_back_face_and_back :: proc(t: ^testing.T) {
	if !load_db() do return
	// Ulvenwald Captive // Ulvenwald Abomination: "{5}{G}{G}: Transform this creature." CR 701.27a, c: it turns its
	// other face up and stays the same object; CR 712.6d: with its back face up it has only the back face's
	// characteristics, its mana value the front face's; CR 712.6a: in the graveyard it's the front face again.
	testing.expect(t, game.card_supported(&card(t, "Ulvenwald Captive").face))
	g := new_game()
	s := &g.state
	captive := add(t, g, "Ulvenwald Captive", 0, .Battlefield)
	testing.expect(t, captive.back_face != nil, "it knows its back face")
	for _ in 0 ..< 7 do add(t, g, "Forest", 0, .Battlefield)
	captive.damage_marked = 1
	index := -1
	for a, i in captive.abilities^ do if a.effect != nil {
		if _, transform := a.effect^.(types.Effect_Transform); transform do index = i
	}
	before := captive.timestamp
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = captive.id, ability_index = index}))
	settle_stack(g)
	testing.expect(t, captive.name == "Ulvenwald Abomination" && captive.power.? == 4 && captive.toughness.? == 6, "a 4/6 Abomination")
	testing.expect(t, captive.timestamp > before, "a new timestamp (CR 613.7g)")
	testing.expect(t, captive.transformed && captive.damage_marked == 1, "the same object: its damage stays")
	testing.expect(t, game.object_mana_value(captive) == 2, "mana value of {1}{G}, the front face's (CR 712.6d)")
	testing.expect(t, game.mana_value(captive.mana_cost) == 0, "the back face has no mana cost (CR 202.3b): no devotion")
	testing.expect(t, !game.has_keyword(captive, types.Keyword_Defender), "the back face has no defender")
	game.move_object(g, captive.id, .Graveyard)
	testing.expect(t, captive.name == "Ulvenwald Captive" && !captive.transformed, "the front face in the graveyard")
}

@(test)
transform_only_if_not_transformed_since :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 701.27g: an activated ability of a permanent transforms it only if it hasn't transformed since the ability
	// was put on the stack. Two Ulvenwald Captive activations on the stack: the first transforms it, the second
	// does nothing (it doesn't turn it back).
	g := new_game()
	s := &g.state
	captive := add(t, g, "Ulvenwald Captive", 0, .Battlefield)
	for _ in 0 ..< 14 do add(t, g, "Forest", 0, .Battlefield)
	index := -1
	for a, i in captive.abilities^ do if a.effect != nil {
		if _, transform := a.effect^.(types.Effect_Transform); transform do index = i
	}
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = captive.id, ability_index = index}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = captive.id, ability_index = index}))
	testing.expect(t, types.pvec_len(s.stack) == 2, "both on the stack")
	settle_stack(g)
	testing.expect(t, captive.transformed && captive.name == "Ulvenwald Abomination", "transformed once")
}

@(test)
adventure_then_the_creature_from_exile :: proc(t: ^testing.T) {
	if !load_db() do return
	// Giant Killer // Chop Down. CR 716.3: cast from the hand, the player chooses the creature or the Adventure;
	// 716.3b: on the stack the Adventure has only its own characteristics; 716.3d: as it resolves it's exiled, and
	// its controller may cast the creature from exile; 716.4: everywhere else it's the creature.
	testing.expect(t, game.card_supported(&card(t, "Giant Killer").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 4 do add(t, g, "Plains", 0, .Battlefield)
	wurm := add(t, g, "Craw Wurm", 1, .Battlefield) // 6/4
	killer := add(t, g, "Giant Killer", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = killer.id}))
	_, offered := s.waiting_for.(types.WaitingFor_CastOffer)
	testing.expect(t, offered, "the creature or the Adventure")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseAdventureFace{creature = false}))
	testing.expect(t, killer.name == "Chop Down", "the Adventure's characteristics while being cast")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{wurm.id}}))
	testing.expect(t, killer.zone == .Stack, "cast as Chop Down")
	settle_stack(g)
	testing.expect(t, wurm.zone == .Graveyard, "power 4 or greater: destroyed")
	testing.expect(t, killer.zone == .Exile && killer.name == "Giant Killer", "exiled, the creature again")
	testing.expect(t, game.castable(s, 0, killer, g.card_db), "castable from exile")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = killer.id}))
	_, offered_again := s.waiting_for.(types.WaitingFor_CastOffer)
	testing.expect(t, !offered_again && killer.zone == .Stack, "from exile only the creature")
	settle_stack(g)
	testing.expect(t, killer.zone == .Battlefield, "Giant Killer on the battlefield")

	// An Adventure whose target is gone doesn't resolve: it goes to the graveyard, the creature card (716.3d, 716.4).
	g = new_game()
	s = &g.state
	for _ in 0 ..< 3 do add(t, g, "Plains", 0, .Battlefield)
	wurm = add(t, g, "Craw Wurm", 1, .Battlefield)
	killer = add(t, g, "Giant Killer", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = killer.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseAdventureFace{creature = false}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{wurm.id}}))
	game.move_object(g, wurm.id, .Hand)
	settle_stack(g)
	testing.expect(t, killer.zone == .Graveyard && killer.name == "Giant Killer", "graveyard, as the creature")
}

@(test)
modal_double_faced_cards :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 712.9: played as a land, the player chooses a face that's a land; it enters with that face up (712.6e).
	// CR 712.6a: in other zones it's its front face.
	testing.expect(t, game.card_supported(&card(t, "Barkchannel Pathway").face))
	g := new_game()
	s := &g.state
	pathway := add(t, g, "Barkchannel Pathway", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = pathway.id}))
	_, asked := s.waiting_for.(types.WaitingFor_ModalFaceChoice)
	testing.expect(t, asked, "which face")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseModalFace{back_face = true}))
	testing.expect(t, pathway.zone == .Battlefield && pathway.name == "Tidechannel Pathway", "Tidechannel Pathway, back face up")
	game.move_object(g, pathway.id, .Graveyard)
	testing.expect(t, pathway.name == "Barkchannel Pathway" && !pathway.modal_back_face, "the front face in the graveyard")

	// Akoum Warrior // Akoum Teeth with no mana: only the land face can be used, so it's played without asking.
	g = new_game()
	s = &g.state
	warrior := add(t, g, "Akoum Warrior", 0, .Hand)
	has_action := false
	for a in game.legal_actions(g, 0) {
		if c, is_cast := a.(types.GameAction_CastSpell); is_cast && c.object_id == warrior.id do has_action = true
	}
	testing.expect(t, has_action, "offered for its land face")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = warrior.id}))
	testing.expect(t, warrior.zone == .Battlefield && warrior.name == "Akoum Teeth" && warrior.tapped, "Akoum Teeth, entering tapped")
	testing.expect(t, s.players[0].lands_played_this_turn == 1, "the turn's land")
}

@(test)
affinity_devoid_and_toxic :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.41a: Frogmite ({4}), affinity for artifacts: {1} less for each artifact you control.
	testing.expect(t, game.card_supported(&card(t, "Frogmite").face))
	g := new_game()
	s := &g.state
	frogmite := add(t, g, "Frogmite", 0, .Hand)
	for _ in 0 ..< 3 do add(t, g, "Ornithopter", 0, .Battlefield)
	testing.expect(t, !game.castable(s, 0, frogmite, g.card_db), "three artifacts: {1} still to pay")
	add(t, g, "Ornithopter", 0, .Battlefield)
	testing.expect(t, game.castable(s, 0, frogmite, g.card_db), "four artifacts: free")
	add(t, g, "Ornithopter", 1, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = frogmite.id}))

	// CR 702.114a: Eldrazi Devastator has devoid: colorless, though its mana cost is {8}.
	devastator := add(t, g, "Eldrazi Devastator", 0, .Hand)
	testing.expect(t, len(devastator.color) == 0, "colorless")

	// CR 702.164c: combat damage to a player from a creature with toxic 1 also gives a poison counter.
	sentry := add(t, g, "Annex Sentry", 0, .Battlefield)
	game.deal_damage(g, sentry.id, types.TargetRef_Player{1}, 1, combat = true)
	game.deal_damage(g, sentry.id, types.TargetRef_Player{1}, 1)
	testing.expect(t, s.players[1].poison_counters == 1, "one poison counter, from the combat damage only")
}

@(test)
protection_from_a_color :: proc(t: ^testing.T) {
	if !load_db() do return
	// White Knight: first strike, protection from black. CR 702.16b: black spells can't target it; 702.16e: damage
	// from black sources is prevented; 702.16f: black creatures can't block it.
	testing.expect(t, game.card_supported(&card(t, "White Knight").face))
	g := new_game()
	s := &g.state
	knight := add(t, g, "White Knight", 1, .Battlefield)
	murder := add(t, g, "Murder", 0, .Hand)
	shock := add(t, g, "Shock", 0, .Hand)
	in_list :: proc(list: [dynamic]types.TargetRef, id: types.ObjectId) -> bool {
		for t in list do if o, ok := t.(types.TargetRef_Object); ok && o._0 == id do return true
		return false
	}
	murder_slots := game.spell_target_slots(murder)
	shock_slots := game.spell_target_slots(shock)
	testing.expect(t, !in_list(game.legal_targets(s, murder_slots[0], 0, murder.id), knight.id), "Murder can't target it")
	testing.expect(t, in_list(game.legal_targets(s, shock_slots[0], 0, shock.id), knight.id), "Shock can")
	vampire := add(t, g, "Vampire Nighthawk", 0, .Battlefield) // black
	game.deal_damage(g, vampire.id, types.TargetRef_Object{knight.id}, 2)
	testing.expect(t, knight.damage_marked == 0, "damage from a black source is prevented")
	testing.expect(t, !game.can_block(g, vampire, knight), "a black creature can't block it")
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, game.can_block(g, bears, knight), "a green one can")
}

@(test)
attack_triggers_watching_other_attackers :: proc(t: ^testing.T) {
	if !load_db() do return
	// Boros Elite, battalion: "Whenever this creature and at least two other creatures attack, this creature gets
	// +2/+2 until end of turn." The other attackers are counted as they're declared (CR 508.1, 508.3a).
	testing.expect(t, game.card_supported(&card(t, "Boros Elite").face))
	attack :: proc(t: ^testing.T, others: int) -> ^types.GameObject {
		g := new_game()
		s := &g.state
		elite := add(t, g, "Boros Elite", 0, .Battlefield)
		attackers: [dynamic]types.Tuple2(types.ObjectId, types.AttackTarget)
		append(&attackers, types.Tuple2(types.ObjectId, types.AttackTarget){elite.id, types.AttackTarget_Player{1}})
		for _ in 0 ..< others {
			b := add(t, g, "Grizzly Bears", 0, .Battlefield)
			append(&attackers, types.Tuple2(types.ObjectId, types.AttackTarget){b.id, types.AttackTarget_Player{1}})
		}
		game.begin_step(g, .DeclareAttackers)
		testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attackers}))
		settle_stack(g)
		return elite
	}
	testing.expect(t, attack(t, 2).power.? == 3, "with two others: 3/3")
	testing.expect(t, attack(t, 1).power.? == 1, "with one other: no battalion")

	// Glory Bearers: "Whenever another creature you control attacks, it gets +0/+1 until end of turn": a trigger
	// on another attacker ("it" is that creature, CR 608.2c).
	testing.expect(t, game.card_supported(&card(t, "Glory Bearers").face))
	g := new_game()
	add(t, g, "Glory Bearers", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	game.begin_step(g, .DeclareAttackers)
	attackers: [dynamic]types.Tuple2(types.ObjectId, types.AttackTarget)
	append(&attackers, types.Tuple2(types.ObjectId, types.AttackTarget){bears.id, types.AttackTarget_Player{1}})
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attackers}))
	settle_stack(g)
	testing.expect(t, bears.toughness.? == 3, "the attacking Bears get +0/+1")
}

@(test)
multicolored_spell_trigger :: proc(t: ^testing.T) {
	if !load_db() do return
	// Hero of Precinct One: "Whenever you cast a multicolored spell, create a 1/1 white Human creature token."
	// Multicolored: two or more colors (CR 105.4).
	testing.expect(t, game.card_supported(&card(t, "Hero of Precinct One").face))
	g := new_game()
	s := &g.state
	add(t, g, "Hero of Precinct One", 0, .Battlefield)
	add(t, g, "Mountain", 0, .Battlefield)
	add(t, g, "Plains", 0, .Battlefield)
	add(t, g, "Mountain", 0, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	testing.expect(t, types.pvec_len(s.stack) == 1, "a red spell: no trigger")
	settle_stack(g)
	helix := add(t, g, "Lightning Helix", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = helix.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	testing.expect(t, types.pvec_len(s.stack) == 2, "red and white: the Hero triggers")
}

@(test)
triggered_ability_divides_damage :: proc(t: ^testing.T) {
	if !load_db() do return
	// Inferno Titan: "Whenever this creature enters or attacks, it deals 3 damage divided as you choose among one,
	// two, or three targets." CR 603.3d: a triggered ability's division is announced as it's put on the stack, as
	// a spell's is (601.2d).
	g := new_game()
	s := &g.state
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	elves := add(t, g, "Llanowar Elves", 1, .Battlefield)
	titan := add(t, g, "Inferno Titan", 0, .Hand)
	game.move_object(g, titan.id, .Battlefield)
	game.apply(g, 0, types.GameAction_PassPriority{})
	asked_division := false
	for _ in 0 ..< 12 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_TriggerTargetSelection:
			slot := w.selection.current_slot
			target: Maybe(types.TargetRef)
			if slot == 0 do target = types.TargetRef_Object{bears.id}
			if slot == 1 do target = types.TargetRef_Object{elves.id}
			if slot == 2 do target = types.TargetRef_Player{1}
			game.apply(g, 0, types.GameAction_ChooseTarget{target = target})
			continue
		case types.WaitingFor_DistributeAmong:
			asked_division = true
			testing.expect(t, w.total == 3 && len(w.targets) == 3, "3 among the three targets")
			d: [dynamic]types.Tuple2(types.TargetRef, u32)
			append(&d, types.Tuple2(types.TargetRef, u32){types.TargetRef_Object{bears.id}, 1})
			append(&d, types.Tuple2(types.TargetRef, u32){types.TargetRef_Object{elves.id}, 1})
			append(&d, types.Tuple2(types.TargetRef, u32){types.TargetRef_Player{1}, 1})
			testing.expect(t, game.apply(g, 0, types.GameAction_DistributeAmong{distribution = d}))
			continue
		}
		if types.pvec_len(s.stack) == 0 && asked_division do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, asked_division, "asked to divide")
	testing.expect(t, bears.zone == .Battlefield && bears.damage_marked == 1, "1 to the Bears")
	testing.expect(t, elves.zone == .Graveyard, "1 to the Elves")
	testing.expect(t, s.players[1].life == 19, "1 to the player")
}

@(test)
its_controller_and_power_as_it_last_existed :: proc(t: ^testing.T) {
	if !load_db() do return
	// Swords to Plowshares: "Exile target creature. Its controller gains life equal to its power." The creature has
	// left the battlefield, so its controller and power are as it last existed there (CR 608.2h): the player who
	// controlled it (not its owner), and its power with counters.
	testing.expect(t, game.card_supported(&card(t, "Swords to Plowshares").face))
	g := new_game()
	s := &g.state
	add(t, g, "Plains", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield) // owned by the opponent...
	bears.controller, bears.base_controller = 0, 0 // ...controlled by player 0
	game.add_counters(bears, types.CounterType_Plus1Plus1{}, 3)
	game.apply_continuous_effects(g)
	testing.expect(t, game.power_of(bears) == 5, "a 5/5")
	swords := add(t, g, "Swords to Plowshares", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = swords.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	settle_stack(g)
	testing.expect(t, bears.zone == .Exile, "exiled")
	testing.expect(t, s.players[0].life == 25 && s.players[1].life == 20, "its last controller gains its last power")
}

@(test)
convoke_with_a_mana_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.51a: a green creature can convoke for {G} even if its mana ability makes another color. Siege Wurm
	// ({5}{G}{G}, convoke) with five Plains, a Forest and Avacyn's Pilgrim (green, "{T}: Add {W}").
	g := new_game()
	s := &g.state
	for _ in 0 ..< 5 do add(t, g, "Plains", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	pilgrim := add(t, g, "Avacyn's Pilgrim", 0, .Battlefield)
	wurm := add(t, g, "Siege Wurm", 0, .Hand)
	testing.expect(t, game.castable(s, 0, wurm, g.card_db), "the Pilgrim convokes for the second {G}")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = wurm.id}))
	testing.expect(t, wurm.zone == .Stack && pilgrim.tapped, "cast, the Pilgrim tapped")
}

@(test)
if_you_cast_it_after_it_left :: proc(t: ^testing.T) {
	if !load_db() do return
	// The intervening "if" is checked again as the ability resolves (CR 603.4); the Avatar has left by then, so it's
	// read as it last existed (CR 608.2h): it was cast, and the creatures are destroyed.
	g := new_game()
	s := &g.state
	for _ in 0 ..< 8 do add(t, g, "Plains", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	avatar := add(t, g, "Wakening Sun's Avatar", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = avatar.id}))
	for _ in 0 ..< 4 {
		if avatar.zone == .Battlefield do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, avatar.zone == .Battlefield && types.pvec_len(s.stack) == 1, "its trigger on the stack")
	game.move_object(g, avatar.id, .Graveyard) // removed in response
	settle_stack(g)
	testing.expect(t, bears.zone == .Graveyard, "the trigger still destroys the Bears")
}

@(test)
modal_face_from_exile :: proc(t: ^testing.T) {
	if !load_db() do return
	// An effect lets the player play Akoum Warrior // Akoum Teeth from exile: either face can be used (CR 712.8b,
	// 712.9), here the land face, as the turn's land.
	g := new_game()
	s := &g.state
	warrior := add(t, g, "Akoum Warrior", 0, .Exile)
	append(&warrior.casting_permissions, types.CastingPermission(types.CastingPermission_PlayFromExile{granted_to = 0, mode = .Play}))
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = warrior.id}))
	testing.expect(t, warrior.zone == .Battlefield && warrior.name == "Akoum Teeth", "played as Akoum Teeth from exile")
	testing.expect(t, s.players[0].lands_played_this_turn == 1, "the turn's land")
}

@(test)
token_copy_of_a_transformed_permanent :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 707.8a: a token copy of a double-faced permanent is double-faced, entering with the original's face up.
	g := new_game()
	captive := add(t, g, "Ulvenwald Captive", 0, .Battlefield)
	testing.expect(t, game.transform_permanent(g, captive), "transformed")
	game.create_copy_token(g, captive, 0, false)
	copy: ^types.GameObject
	for id in game.ids_of(g.state.battlefield) do if o := game.object(&g.state, id); o.is_token do copy = o
	testing.expect(t, copy != nil && copy.name == "Ulvenwald Abomination" && copy.transformed, "back face up")
	if copy != nil do testing.expect(t, game.transform_permanent(g, copy) && copy.name == "Ulvenwald Captive", "and it can transform back")
}

@(test)
colors_of_mana_spent_to_cast :: proc(t: ^testing.T) {
	if !load_db() do return
	// Painful Truths ({2}{B}), converge: "You draw X cards and you lose X life, where X is the number of colors of
	// mana spent to cast this spell." Paid with a Swamp, an Island and a Mountain: three colors.
	testing.expect(t, game.card_supported(&card(t, "Painful Truths").face))
	g := new_game()
	s := &g.state
	add(t, g, "Swamp", 0, .Battlefield)
	add(t, g, "Island", 0, .Battlefield)
	add(t, g, "Mountain", 0, .Battlefield)
	truths := add(t, g, "Painful Truths", 0, .Hand)
	hand := types.pvec_len(s.players[0].hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = truths.id}))
	testing.expect(t, truths.colors_spent_to_cast.black == 1 && truths.mana_spent_to_cast_amount == 3, "one black of three")
	settle_stack(g)
	testing.expect(t, types.pvec_len(s.players[0].hand) == hand - 1 + 3 && s.players[0].life == 17, "drew 3, lost 3")
}

@(test)
number_of_different_names :: proc(t: ^testing.T) {
	if !load_db() do return
	// Awakened Amalgam: "power and toughness are each equal to the number of differently named lands you control."
	testing.expect(t, game.card_supported(&card(t, "Awakened Amalgam").face))
	g := new_game()
	amalgam := add(t, g, "Awakened Amalgam", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	add(t, g, "Island", 0, .Battlefield)
	add(t, g, "Plains", 1, .Battlefield) // the opponent's
	game.apply_continuous_effects(g)
	testing.expect(t, game.power_of(amalgam) == 2 && game.toughness_of(amalgam) == 2, "Forest and Island: 2/2")
}

@(test)
landfall_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// Groundswell: "Target creature gets +2/+2 until end of turn. Landfall — If you had a land enter the battlefield
	// under your control this turn, that creature gets +4/+4 until end of turn instead."
	testing.expect(t, game.card_supported(&card(t, "Groundswell").face))
	for landfall in ([]bool{false, true}) {
		g := new_game()
		add(t, g, "Forest", 0, .Battlefield)
		if landfall {
			land := add(t, g, "Forest", 0, .Hand)
			testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = land.id}))
		}
		bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
		spell := add(t, g, "Groundswell", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
		settle_stack(g)
		testing.expectf(t, game.power_of(bears) == (6 if landfall else 4), "landfall %v: power %d", landfall, game.power_of(bears))
	}
}

@(test)
party_size_counts_the_largest_party :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 700.8a-b: up to one Cleric, Rogue, Warrior and Wizard; a creature with two of those types fills one role,
	// whichever makes the party largest. A Cleric Wizard, a Cleric and a Rogue: 3.
	g := new_game()
	with_types :: proc(t: ^testing.T, g: ^game.Game, subtypes: ..string) {
		o := add(t, g, "Grizzly Bears", 0, .Battlefield)
		o.base_card_types.subtypes = make([dynamic]string)
		append(&o.base_card_types.subtypes, ..subtypes)
		o.card_types.subtypes = o.base_card_types.subtypes
	}
	with_types(t, g, "Human", "Cleric", "Wizard")
	with_types(t, g, "Cleric")
	with_types(t, g, "Rogue")
	testing.expectf(t, game.party_size(&g.state, 0) == 3, "Cleric, Wizard, Rogue: got %d", game.party_size(&g.state, 0))
	testing.expect(t, game.party_size(&g.state, 1) == 0, "the opponent has none")
}

@(test)
returned_with_a_finality_counter :: proc(t: ^testing.T) {
	if !load_db() do return
	// Rite of the Moth: "Return target creature card from your graveyard to the battlefield with a finality counter
	// on it." CR 122.6: it enters with the counter; CR 122.1h: if it would then go to a graveyard from the
	// battlefield, it's exiled instead.
	testing.expect(t, game.card_supported(&card(t, "Rite of the Moth").face))
	g := new_game()
	s := &g.state
	for name in ([]string{"Plains", "Swamp", "Swamp", "Swamp"}) do add(t, g, name, 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Graveyard)
	rite := add(t, g, "Rite of the Moth", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = rite.id}))
	if _, choosing := s.waiting_for.(types.WaitingFor_TargetSelection); choosing {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	}
	settle_stack(g)
	testing.expect(t, bears.zone == .Battlefield, "returned")
	testing.expect(t, game.counter_count(bears, types.CounterType_Finality{}) == 1, "with a finality counter")
	game.move_object(g, bears.id, .Graveyard)
	testing.expectf(t, bears.zone == .Exile, "exiled instead of dying, got %v", bears.zone)
}

@(test)
put_onto_the_battlefield_tapped_and_attacking :: proc(t: ^testing.T) {
	if !load_db() do return
	// Kinscaer Sentry: "Whenever this creature attacks, you may put a creature card with mana value X or less from
	// your hand onto the battlefield tapped and attacking, where X is the number of attacking creatures you
	// control." CR 508.4: it attacks as it enters, though it was never declared as an attacker.
	testing.expect(t, game.card_supported(&card(t, "Kinscaer Sentry").face))
	g := new_game()
	s := &g.state
	sentry := add(t, g, "Kinscaer Sentry", 0, .Battlefield)
	elves := add(t, g, "Llanowar Elves", 0, .Hand)
	add(t, g, "Grizzly Bears", 0, .Hand) // mana value 2: too much with one attacker
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{sentry.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	for _ in 0 ..< 10 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_OptionalEffectChoice:
			testing.expect(t, game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = true}))
			continue
		case types.WaitingFor_EffectZoneChoice:
			testing.expectf(t, len(w.cards) == 1 && w.cards[0] == elves.id, "only the Elves fit: %v", w.cards)
			pick := make([dynamic]types.ObjectId)
			append(&pick, elves.id)
			testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = pick}))
			continue
		}
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, elves.zone == .Battlefield && elves.tapped, "entered tapped")
	c, _ := s.combat.?
	attacking := false
	for a in c.attackers do if a.object_id == elves.id do attacking = true
	testing.expect(t, attacking, "and attacking")
}

@(test)
as_it_enters_choose_a_color :: proc(t: ^testing.T) {
	if !load_db() do return
	// Coldsteel Heart: "This artifact enters tapped. As this artifact enters, choose a color. {T}: Add one mana of
	// the chosen color." CR 614.12: the choice is made as it enters, and kept for its mana ability to read.
	testing.expect(t, game.card_supported(&card(t, "Coldsteel Heart").face))
	g := new_game()
	s := &g.state
	add(t, g, "Forest", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	heart := add(t, g, "Coldsteel Heart", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = heart.id}))
	settle_stack(g)
	w, asked := s.waiting_for.(types.WaitingFor_NamedChoice)
	testing.expect(t, asked && len(w.options) == 5, "asked for one of the five colors")
	testing.expect(t, !game.apply(g, 0, types.GameAction_ChooseOption{choice = "Purple"}), "not a color")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseOption{choice = "Blue"}))
	testing.expect(t, heart.zone == .Battlefield && heart.tapped, "entered tapped")
	heart.tapped = false
	found := false
	for src in game.mana_sources(s, 0) do if src.object == heart {
		found = true
		for o in src.options do testing.expectf(t, o.colors == {.Blue}, "only blue: %v", o.colors)
	}
	testing.expect(t, found, "a mana source")
	// CR 400.7: a new object after leaving the battlefield, without the choice.
	game.move_object(g, heart.id, .Hand)
	testing.expect(t, len(heart.chosen_attributes) == 0, "the choice is forgotten")
}

@(test)
creatures_of_the_chosen_type :: proc(t: ^testing.T) {
	if !load_db() do return
	// Adaptive Automaton: "As this creature enters, choose a creature type. This creature is the chosen type in
	// addition to its other types. Other creatures you control of the chosen type get +1/+1."
	testing.expect(t, game.card_supported(&card(t, "Adaptive Automaton").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Forest", 0, .Battlefield)
	elves := add(t, g, "Llanowar Elves", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	automaton := add(t, g, "Adaptive Automaton", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = automaton.id}))
	settle_stack(g)
	_, asked := s.waiting_for.(types.WaitingFor_NamedChoice)
	testing.expect(t, asked, "asked for a creature type")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseOption{choice = "Elf"}))
	testing.expect(t, game.has_subtype(automaton, "Elf"), "it's an Elf too")
	testing.expect(t, game.power_of(elves) == 2 && game.power_of(bears) == 2, "the Elf gets +1/+1, the Bear doesn't")
	testing.expect(t, game.power_of(automaton) == 2, "not itself (other creatures)")
}

@(test)
reveal_a_card_or_enter_tapped :: proc(t: ^testing.T) {
	if !load_db() do return
	// Auntie's Hovel: "As this land enters, you may reveal a Goblin card from your hand. If you don't, this land
	// enters tapped." CR 614.12: decided as it enters.
	testing.expect(t, game.card_supported(&card(t, "Auntie's Hovel").face))
	for reveal in ([]bool{true, false}) {
		g := new_game()
		s := &g.state
		goblin := add(t, g, "Raging Goblin", 0, .Hand)
		add(t, g, "Grizzly Bears", 0, .Hand)
		hovel := add(t, g, "Auntie's Hovel", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = hovel.id}))
		w, asked := s.waiting_for.(types.WaitingFor_RevealChoice)
		testing.expect(t, asked && len(w.cards) == 1 && w.cards[0] == goblin.id, "only the Goblin may be revealed")
		pick := make([dynamic]types.ObjectId)
		if reveal do append(&pick, goblin.id)
		testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = pick}))
		testing.expectf(t, hovel.tapped == !reveal, "revealed %v: tapped %v", reveal, hovel.tapped)
		testing.expect(t, goblin.zone == .Hand, "the revealed card stays in hand")
	}
	// No Goblin in hand: it enters tapped without asking.
	g := new_game()
	hovel := add(t, g, "Auntie's Hovel", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = hovel.id}))
	_, asked := g.state.waiting_for.(types.WaitingFor_RevealChoice)
	testing.expect(t, !asked && hovel.tapped, "tapped, nothing to reveal")
}

@(test)
sacrifice_a_spawn_for_mana :: proc(t: ^testing.T) {
	if !load_db() do return
	// Brood Monitor: "When this creature enters, create three 1/1 colorless Eldrazi Scion creature tokens with
	// 'Sacrifice this creature: Add {C}.'" CR 605.1a: a mana ability with no {T} in its cost, so a token that has just
	// entered (summoning sick, CR 302.6) can be sacrificed for mana; the player activates it (CR 605.3a).
	testing.expect(t, game.card_supported(&card(t, "Brood Monitor").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 6 do add(t, g, "Forest", 0, .Battlefield) // {4}{G}{G}
	monitor := add(t, g, "Brood Monitor", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = monitor.id}))
	settle_stack(g)
	spawns := make([dynamic]^types.GameObject)
	for id in game.ids_of(s.battlefield) do if o := game.object(s, id); o.is_token && o.name == "Eldrazi Scion" do append(&spawns, o)
	testing.expectf(t, len(spawns) == 3, "three Scions: %d", len(spawns))
	if len(spawns) == 0 do return
	spawn := spawns[0]
	index := -1
	if spawn.abilities != nil do for a, i in spawn.abilities^ do if _, is_mana := a.effect.(types.Effect_Mana); is_mana do index = i
	testing.expect(t, index >= 0, "it has the mana ability")
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = spawn.id, ability_index = index}))
	testing.expect(t, spawn.zone != .Battlefield, "sacrificed")
	colorless := 0
	for u in s.players[0].mana_pool.mana do if u.color == .Colorless do colorless += 1
	testing.expect(t, colorless == 1, "added {C}")
}

@(test)
decayed_cant_block_and_is_sacrificed_after_attacking :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 702.147a: decayed means "This creature can't block" and "When this creature attacks, sacrifice it at end
	// of combat." Falcon Abomination's Zombie token has decayed; here a Grizzly Bears given the keyword.
	g := new_game()
	s := &g.state
	zombie := add(t, g, "Grizzly Bears", 0, .Battlefield)
	append(&zombie.base_keywords, types.Keyword_Decayed{})
	game.apply_continuous_effects(g)
	attacker := add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, !game.can_block(g, zombie, attacker), "can't block")
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{zombie.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	for _ in 0 ..< 40 {
		if zombie.zone != .Battlefield || s.phase == .PostCombatMain do break
		if _, blocking := s.waiting_for.(types.WaitingFor_DeclareBlockers); blocking {
			game.apply(g, 1, types.GameAction_DeclareBlockers{})
			continue
		}
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expectf(t, zombie.zone == .Graveyard, "sacrificed at end of combat, in %v", zombie.zone)
	testing.expect(t, s.players[1].life == 18, "after dealing its damage")
}

@(test)
proliferate_chosen_permanents_and_players :: proc(t: ^testing.T) {
	if !load_db() do return
	// Steady Progress: "Proliferate. Draw a card." CR 701.34a: choose any number of permanents and/or players that
	// have a counter; each chosen gets one more counter of each kind it has.
	testing.expect(t, game.card_supported(&card(t, "Steady Progress").face))
	g := new_game()
	s := &g.state
	for name in ([]string{"Island", "Island", "Island"}) do add(t, g, name, 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	game.add_counters(mine, types.CounterType_Plus1Plus1{}, 1)
	game.add_counters(mine, types.CounterType_Stun{}, 1)
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.add_counters(theirs, types.CounterType_Plus1Plus1{}, 1)
	add(t, g, "Grizzly Bears", 1, .Battlefield) // no counters: not a choice
	s.players[1].poison_counters = 2
	spell := add(t, g, "Steady Progress", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	settle_stack(g)
	w, asked := s.waiting_for.(types.WaitingFor_ProliferateChoice)
	testing.expectf(t, asked && len(w.eligible) == 3, "two permanents and a player: %v", w.eligible)
	chosen := make([dynamic]types.TargetRef)
	append(&chosen, types.TargetRef_Object{mine.id}, types.TargetRef_Player{1})
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectTargets{targets = chosen}))
	testing.expect(t, game.counter_count(mine, types.CounterType_Plus1Plus1{}) == 2 && game.counter_count(mine, types.CounterType_Stun{}) == 2, "one more of each kind")
	testing.expect(t, game.counter_count(theirs, types.CounterType_Plus1Plus1{}) == 1, "not chosen")
	testing.expect(t, s.players[1].poison_counters == 3, "one more poison counter")
	testing.expect(t, spell.zone == .Graveyard, "then the rest of the spell")
}

@(test)
a_spell_that_adds_mana :: proc(t: ^testing.T) {
	if !load_db() do return
	// Dark Ritual: "Add {B}{B}{B}." CR 605.5b: a spell is never a mana ability; it resolves like any other, and its
	// mana goes into its controller's pool (CR 106.4), there to pay for a spell.
	testing.expect(t, game.card_supported(&card(t, "Dark Ritual").face))
	g := new_game()
	s := &g.state
	add(t, g, "Swamp", 0, .Battlefield)
	ritual := add(t, g, "Dark Ritual", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = ritual.id}))
	settle_stack(g)
	black := 0
	for u in s.players[0].mana_pool.mana do if u.color == .Black do black += 1
	testing.expect(t, black == 3, "three black mana")
	corpse := add(t, g, "Walking Corpse", 0, .Hand) // {1}{B}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = corpse.id}), "paid from the pool")
	testing.expect(t, len(s.players[0].mana_pool.mana) == 1, "one left")
}

@(test)
second_card_drawn_each_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// Atlantean Cavalry: "Whenever you draw your second card each turn, put a +1/+1 counter on this creature." Each
	// card drawn is its own event (CR 121.2): drawing two at once triggers on the second, a third doesn't.
	testing.expect(t, game.card_supported(&card(t, "Atlantean Cavalry").face))
	g := new_game()
	s := &g.state
	cavalry := add(t, g, "Atlantean Cavalry", 0, .Battlefield)
	s.players[0].cards_drawn_this_turn = 0 // the opening hand was drawn before this turn
	for _ in 0 ..< 6 do add(t, g, "Island", 0, .Battlefield)
	for _ in 0 ..< 2 {
		// Divination: "Draw two cards." The first one's second card triggers; the second one's (3rd, 4th) doesn't.
		spell := add(t, g, "Divination", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
		settle_stack(g)
	}
	testing.expectf(t, game.counter_count(cavalry, types.CounterType_Plus1Plus1{}) == 1, "one counter, got %d", game.counter_count(cavalry, types.CounterType_Plus1Plus1{}))
}

@(test)
cant_be_blocked_by_big_creatures :: proc(t: ^testing.T) {
	if !load_db() do return
	// Amrou Kithkin: "This creature can't be blocked by creatures with power 3 or greater." CR 509.1b: a blocking
	// restriction, checked as blockers are declared.
	testing.expect(t, game.card_supported(&card(t, "Amrou Kithkin").face))
	g := new_game()
	kithkin := add(t, g, "Amrou Kithkin", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	big := add(t, g, "Hill Giant", 1, .Battlefield)
	testing.expect(t, game.can_block(g, bears, kithkin), "power 2 may block")
	testing.expect(t, !game.can_block(g, big, kithkin), "power 3 may not")
	testing.expect(t, game.can_block(g, big, bears), "only what it affects")
}

@(test)
static_prevention_of_damage :: proc(t: ^testing.T) {
	if !load_db() do return
	// Bubble Matrix: "Prevent all damage that would be dealt to creatures." CR 615.1a, 615.6: a prevention effect
	// from a static ability; prevented damage isn't dealt. Players aren't creatures.
	testing.expect(t, game.card_supported(&card(t, "Bubble Matrix").face))
	g := new_game()
	s := &g.state
	bubble := add(t, g, "Bubble Matrix", 1, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	game.deal_damage(g, bubble.id, types.TargetRef_Object{bears.id}, 3)
	testing.expect(t, bears.damage_marked == 0, "the creature is dealt none")
	game.deal_damage(g, bubble.id, types.TargetRef_Player{0}, 3)
	testing.expect(t, s.players[0].life == 17, "a player isn't protected")
	// Gaseous Form: "Prevent all combat damage that would be dealt to and dealt by enchanted creature."
	testing.expect(t, game.card_supported(&card(t, "Gaseous Form").face))
	g2 := new_game()
	form := add(t, g2, "Gaseous Form", 0, .Battlefield)
	host := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	other := add(t, g2, "Grizzly Bears", 1, .Battlefield)
	game.attach(&g2.state, form, host)
	game.deal_damage(g2, other.id, types.TargetRef_Object{host.id}, 2, true)
	testing.expect(t, host.damage_marked == 0, "combat damage to it prevented")
	game.deal_damage(g2, host.id, types.TargetRef_Object{other.id}, 2, true)
	testing.expect(t, other.damage_marked == 0, "combat damage by it prevented")
	game.deal_damage(g2, other.id, types.TargetRef_Object{host.id}, 1, false)
	testing.expect(t, host.damage_marked == 1, "noncombat damage isn't")
}

@(test)
pass_to_the_end_of_the_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// The app's "Pass" button: a standing pass until the end of the turn. The engine passes for the player each time
	// they'd get priority (CR 117.3d); the opponent still passes for themselves. When the turn ends, so does the
	// standing pass.
	g := new_game()
	s := &g.state
	add(t, g, "Grizzly Bears", 0, .Battlefield) // could attack: passing the turn declares no attackers
	testing.expect(t, game.apply(g, 0, types.GameAction_SetAutoPass{mode = types.AutoPassRequest_UntilTurnBoundary{until = .EndOfCurrentTurn}}))
	for _ in 0 ..< 40 {
		if s.active_player == 1 do break
		w, priority := s.waiting_for.(types.WaitingFor_Priority)
		testing.expectf(t, priority && w.player == 1, "only the opponent is asked: %v", s.waiting_for)
		if !priority || w.player != 1 do break
		testing.expect(t, game.apply(g, 1, types.GameAction_PassPriority{}))
	}
	testing.expect(t, s.active_player == 1, "the turn passed")
	_, still := s.auto_pass[0]
	testing.expect(t, !still, "the standing pass ended with the turn")
	testing.expect(t, s.players[1].life == 20, "no attack was made")

	// "Resolve the stack": passes until the stack is empty, then stops.
	g2 := new_game()
	s2 := &g2.state
	add(t, g2, "Mountain", 1, .Battlefield)
	shock := add(t, g2, "Shock", 1, .Hand)
	s2.priority_player = 1
	s2.waiting_for = types.WaitingFor_Priority{player = 1}
	testing.expect(t, game.apply(g2, 1, types.GameAction_CastSpell{object_id = shock.id}))
	if _, choosing := s2.waiting_for.(types.WaitingFor_TargetSelection); choosing {
		testing.expect(t, game.apply(g2, 1, types.GameAction_ChooseTarget{target = types.TargetRef_Player{0}}))
	}
	// The caster passes; then player 0 asks to pass until the stack is empty.
	testing.expect(t, game.apply(g2, 1, types.GameAction_PassPriority{}))
	testing.expect(t, game.apply(g2, 0, types.GameAction_SetAutoPass{mode = types.AutoPassRequest_UntilStackEmpty{}}))
	testing.expect(t, types.pvec_len(s2.stack) == 0 && s2.players[0].life == 18, "Shock resolved")
}

@(test)
fifth_review_fixes :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 609.7c: "prevent all damage dealt to this by creatures" also covers a creature source that has left the
	// battlefield (Champion Lancer and a creature card dealing damage from the graveyard).
	{
		g := new_game()
		lancer := add(t, g, "Champion Lancer", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
		game.move_object(g, bears.id, .Graveyard)
		game.deal_damage(g, bears.id, types.TargetRef_Object{lancer.id}, 2)
		testing.expect(t, lancer.damage_marked == 0, "a creature source off the battlefield")
	}
	// "Enchanted creatures" on a creature isn't its host: not read yet, so the card isn't offered.
	testing.expect(t, !game.card_supported(&card(t, "Wall of Putrid Flesh").face), "Wall of Putrid Flesh refused")
	// Cards whose data dropped part of their text.
	for name in ([]string{"Guardian Naga", "Camato Scout", "Pompous Gadabout", "Dawn-Blessed Pennant"}) {
		testing.expectf(t, !game.card_supported(&card(t, name).face), "%s refused", name)
	}
	// Loyalty counters are the planeswalker's loyalty (CR 306.5b): one number, not a second store.
	{
		g := new_game()
		pw := add(t, g, "Grizzly Bears", 0, .Battlefield)
		pw.loyalty = 3
		game.add_counters(pw, types.CounterType_Loyalty{}, 2)
		testing.expect(t, (pw.loyalty.? or_else 0) == 5 && len(pw.counters) == 0, "loyalty 5, nothing else")
		testing.expect(t, game.counter_count(pw, types.CounterType_Loyalty{}) == 5)
		game.remove_counters(pw, types.CounterType_Loyalty{}, 1)
		testing.expect(t, (pw.loyalty.? or_else 0) == 4)
	}
}

@(test)
clone_makes_the_copied_cards_entry_choice :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 707.5, 707.6: a Clone entering as a copy of Adaptive Automaton has its "as this enters, choose a creature
	// type", and its controller chooses.
	g := new_game()
	s := &g.state
	for _ in 0 ..< 4 do add(t, g, "Island", 0, .Battlefield)
	automaton := add(t, g, "Adaptive Automaton", 1, .Battlefield)
	append(&automaton.chosen_attributes, types.ChosenAttribute_CreatureType{"Bear"}) // its own choice isn't copied
	clone := add(t, g, "Clone", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = clone.id}))
	settle_stack(g)
	_, copying := s.waiting_for.(types.WaitingFor_CopyTargetChoice)
	testing.expect(t, copying, "asked what to copy")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{automaton.id}}))
	_, naming := s.waiting_for.(types.WaitingFor_NamedChoice)
	testing.expect(t, naming, "then asked for a creature type")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseOption{choice = "Elf"}))
	testing.expect(t, game.has_subtype(clone, "Elf") && !game.has_subtype(clone, "Bear"), "its own choice")
}

@(test)
chosen_type_looks_back_when_its_source_dies :: proc(t: ^testing.T) {
	if !load_db() do return
	// Species Specialist: "As this creature enters, choose a creature type. Whenever another creature of the chosen
	// type dies, you may draw a card." Dying with the Bears in one wrath, it looks back at itself as it was (CR
	// 603.10a), choice included.
	testing.expect(t, game.card_supported(&card(t, "Species Specialist").face))
	g := new_game()
	s := &g.state
	specialist := add(t, g, "Species Specialist", 0, .Battlefield)
	append(&specialist.chosen_attributes, types.ChosenAttribute_CreatureType{"Bear"})
	add(t, g, "Grizzly Bears", 0, .Battlefield)
	for _ in 0 ..< 4 do add(t, g, "Plains", 0, .Battlefield)
	wrath := add(t, g, "Day of Judgment", 0, .Hand)
	hand := types.pvec_len(s.players[0].hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = wrath.id}))
	for _ in 0 ..< 10 {
		if _, may := s.waiting_for.(types.WaitingFor_OptionalEffectChoice); may {
			game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = true})
			continue
		}
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expectf(t, types.pvec_len(s.players[0].hand) == hand, "drew for the Bears (the wrath left the hand): %d vs %d", types.pvec_len(s.players[0].hand), hand)
}

@(test)
remove_counters_and_exile_from_graveyard_as_costs :: proc(t: ^testing.T) {
	if !load_db() do return
	// Barkhide Troll: "{1}, Remove a +1/+1 counter from this creature: This creature gains hexproof until end of
	// turn." CR 118.3: with no counter, the cost can't be paid; CR 602.2b, 601.2h: paying removes it.
	testing.expect(t, game.card_supported(&card(t, "Barkhide Troll").face))
	{
		g := new_game()
		add(t, g, "Forest", 0, .Battlefield)
		add(t, g, "Forest", 0, .Battlefield)
		troll := add(t, g, "Barkhide Troll", 0, .Battlefield)
		testing.expect(t, !game.apply(g, 0, types.GameAction_ActivateAbility{source_id = troll.id, ability_index = 0}), "no counter to remove")
		game.add_counters(troll, types.CounterType_Plus1Plus1{}, 1)
		testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = troll.id, ability_index = 0}))
		testing.expect(t, game.counter_count(troll, types.CounterType_Plus1Plus1{}) == 0, "the counter is removed as a cost")
	}
	// Dread Rider: "{1}{B}, {T}, Exile a creature card from your graveyard: Target opponent loses 3 life." The
	// player chooses a creature card of their own graveyard (CR 404.1); it's exiled as the cost is paid (701.13a).
	testing.expect(t, game.card_supported(&card(t, "Dread Rider").face))
	{
		g := new_game()
		s := &g.state
		add(t, g, "Swamp", 0, .Battlefield)
		add(t, g, "Swamp", 0, .Battlefield)
		rider := add(t, g, "Dread Rider", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 0, .Graveyard)
		add(t, g, "Shock", 0, .Graveyard) // not a creature card
		add(t, g, "Grizzly Bears", 1, .Graveyard) // not theirs
		testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = rider.id, ability_index = 0}))
		for _ in 0 ..< 4 {
			#partial switch w in s.waiting_for {
			case types.WaitingFor_TargetSelection, types.WaitingFor_TriggerTargetSelection:
				game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}})
				continue
			case types.WaitingFor_PayCost:
				testing.expectf(t, len(w.choices) == 1 && w.choices[0] == bears.id, "only their creature card: %v", w.choices)
				pick := make([dynamic]types.ObjectId)
				append(&pick, bears.id)
				testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = pick}))
				continue
			}
			break
		}
		testing.expect(t, bears.zone == .Exile, "exiled as the cost")
		settle_stack(g)
		testing.expect(t, s.players[1].life == 17, "the opponent loses 3")
	}
}

@(test)
enters_trigger_reads_the_spells_x :: proc(t: ^testing.T) {
	if !load_db() do return
	// Ajani's Anguish ({X}{R}): "When this enchantment enters, it deals X damage to any target." CR 107.3m: an
	// enters-the-battlefield ability of the permanent uses the X its spell was cast with.
	testing.expect(t, game.card_supported(&card(t, "Ajani's Anguish").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
	anguish := add(t, g, "Ajani's Anguish", 0, .Hand)
	testing.expectf(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = anguish.id}), "cast: %s", game.rejection)
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseX{value = 2}))
	for _ in 0 ..< 10 {
		#partial switch _ in s.waiting_for {
		case types.WaitingFor_TriggerTargetSelection, types.WaitingFor_TargetSelection:
			game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}})
			continue
		}
		if types.pvec_len(s.stack) == 0 && anguish.zone == .Battlefield do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expectf(t, s.players[1].life == 18, "2 damage, life %d", s.players[1].life)
}

@(test)
sacrifice_it_unless_you_pay :: proc(t: ^testing.T) {
	if !load_db() do return
	// Archway Commons: "When this land enters, sacrifice it unless you pay {1}." CR 118.12a: its controller may pay;
	// if they don't, it's sacrificed. With no mana to pay, it's sacrificed without asking (CR 118.3).
	testing.expect(t, game.card_supported(&card(t, "Archway Commons").face))
	for pay in ([]bool{true, false}) {
		g := new_game()
		s := &g.state
		add(t, g, "Forest", 0, .Battlefield)
		commons := add(t, g, "Archway Commons", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = commons.id}))
		for _ in 0 ..< 8 {
			if _, asked := s.waiting_for.(types.WaitingFor_UnlessPayment); asked {
				testing.expect(t, game.apply(g, 0, types.GameAction_PayUnlessCost{pay = pay}))
				continue
			}
			if types.pvec_len(s.stack) == 0 do break
			game.apply(g, s.priority_player, types.GameAction_PassPriority{})
		}
		testing.expectf(t, (commons.zone == .Battlefield) == pay, "paid %v: %v", pay, commons.zone)
	}
	g := new_game()
	commons := add(t, g, "Archway Commons", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = commons.id}))
	settle_stack(g)
	testing.expect(t, commons.zone == .Graveyard, "nothing to pay with: sacrificed")
}

@(test)
when_enchanted_creature_dies :: proc(t: ^testing.T) {
	if !load_db() do return
	// Angelic Destiny: "When enchanted creature dies, return this card to its owner's hand." The creature's last
	// known information has the Aura attached (CR 603.10a); the Aura goes to the graveyard (CR 704.5m), and its
	// ability returns it from there.
	testing.expect(t, game.card_supported(&card(t, "Angelic Destiny").face))
	g := new_game()
	s := &g.state
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	destiny := add(t, g, "Angelic Destiny", 0, .Battlefield)
	game.attach(s, destiny, bears)
	other := add(t, g, "Grizzly Bears", 0, .Battlefield)
	game.move_object(g, bears.id, .Graveyard)
	game.give_priority(g, 0)
	settle_stack(g)
	testing.expectf(t, destiny.zone == .Hand, "returned to hand: %v", destiny.zone)
	// Another creature dying doesn't trigger it.
	g2 := new_game()
	host := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	d2 := add(t, g2, "Angelic Destiny", 0, .Battlefield)
	game.attach(&g2.state, d2, host)
	o2 := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	game.move_object(g2, o2.id, .Graveyard)
	game.give_priority(g2, 0)
	settle_stack(g2)
	testing.expect(t, d2.zone == .Battlefield, "not for another creature")
	_ = other
}

@(test)
triggers_only_once_each_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// Battle-Scarred Survivalist: "Whenever another creature dies, put a +1/+1 counter on this creature. This ability
	// triggers only once each turn." Two deaths in one turn: one counter; a new turn, it can trigger again.
	testing.expect(t, game.card_supported(&card(t, "Battle-Scarred Survivalist").face))
	g := new_game()
	s := &g.state
	survivalist := add(t, g, "Battle-Scarred Survivalist", 0, .Battlefield)
	for _ in 0 ..< 2 {
		bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
		game.move_object(g, bears.id, .Graveyard)
		game.give_priority(g, 0)
		settle_stack(g)
	}
	testing.expect(t, game.counter_count(survivalist, types.CounterType_Plus1Plus1{}) == 1, "once this turn")
	game.begin_turn(g, 1)
	s.waiting_for = types.WaitingFor_Priority{player = 1}
	s.priority_player = 1
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.move_object(g, bears.id, .Graveyard)
	game.give_priority(g, 1)
	settle_stack(g)
	testing.expect(t, game.counter_count(survivalist, types.CounterType_Plus1Plus1{}) == 2, "again the next turn")
}
