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
	mongrel := add(t, g, "Wild Mongrel", 0, .Battlefield) // Discard a card: +1/+1 and becomes the color of your choice
	hand := game.player(&g.state, 0).hand
	for types.pvec_len(hand) > 0 do game.move_object(g, types.pvec_get(hand, 0), .Library)
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
