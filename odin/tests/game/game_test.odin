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
	// Supported means every part is carried out: "activate only if" (CR 602.5), Phyrexian mana (CR 107.4f), and a
	// mass pump misparsed as a single "any target" pump aren't yet. Damage to you as a mana ability resolves (CR
	// 605.3b: Ancient Tomb, the painlands) is.
	for name in ([]string{"Temple of the False God", "Gut Shot", "Defensive Maneuvers"}) {
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
