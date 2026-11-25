// Conditions on triggered abilities: intervening "if" clauses (CR 603.4), "one or more" batches (CR 603.2c),
// "whenever you attack with ..." (CR 508.3c-e) and what a trigger event's object was (CR 603.6, 603.10).
package game_test

import "core:testing"
import game "../../engine/game"
import types "../../engine/types"

// Passes priority until the stack is empty.
@(private = "file")
resolve_all :: proc(g: ^game.Game) {
	for _ in 0 ..< 16 {
		if types.pvec_len(g.state.stack) == 0 do return
		game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
	}
}

// The active player (`p`) declares these creatures as attackers of the other player (or of a planeswalker).
@(private = "file")
declare :: proc(t: ^testing.T, g: ^game.Game, p: types.PlayerId, attackers: []^types.GameObject, planeswalker: ^types.GameObject = nil) {
	s := &g.state
	s.active_player, s.priority_player = p, p
	game.begin_step(g, .DeclareAttackers)
	list: [dynamic]types.Tuple2(types.ObjectId, types.AttackTarget)
	for a in attackers {
		target: types.AttackTarget = types.AttackTarget_Player{1 - p}
		if planeswalker != nil do target = types.AttackTarget_Planeswalker{planeswalker.id}
		append(&list, types.Tuple2(types.ObjectId, types.AttackTarget){a.id, target})
	}
	testing.expect(t, game.apply(g, p, types.GameAction_DeclareAttackers{attacks = list}), "attackers declared")
}

@(private = "file")
stack_size :: proc(g: ^game.Game) -> int {return types.pvec_len(g.state.stack)}

@(test)
you_attack_with_one_or_more_lizards :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 508.3c, 603.2c: Hired Claw, "Whenever you attack with one or more Lizards, this creature deals 1 damage to
	// target opponent": once for two Lizards declared, not at all for a Bears alone.
	testing.expect(t, game.card_supported(&card(t, "Hired Claw").face))
	g := new_game()
	claw := add(t, g, "Hired Claw", 0, .Battlefield)
	other := add(t, g, "Hired Claw", 0, .Battlefield)
	declare(t, g, 0, {claw, other})
	testing.expect(t, stack_size(g) == 2, "each Hired Claw's ability once") // one per Hired Claw, not per Lizard
	resolve_all(g)
	testing.expect(t, game.player(&g.state, 1).life == 18)

	g2 := new_game()
	add(t, g2, "Hired Claw", 1, .Battlefield) // the opponent's: not its controller attacking
	add(t, g2, "Hired Claw", 0, .Battlefield) // its controller's, not attacking
	bears := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	declare(t, g2, 0, {bears})
	testing.expect(t, stack_size(g2) == 0, "no Lizard attacked")
}

@(test)
creatures_attack_a_player :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 508.3e: Attuma, "Whenever one or more Merfolk you control attack a player, draw a card": a Merfolk attacking
	// a planeswalker isn't attacking a player.
	testing.expect(t, game.card_supported(&card(t, "Attuma, Atlantean Warlord").face))
	g := new_game()
	add(t, g, "Attuma, Atlantean Warlord", 0, .Battlefield)
	looter := add(t, g, "Merfolk Looter", 0, .Battlefield)
	ajani := add(t, g, "Ajani, Adversary of Tyrants", 1, .Battlefield)
	ajani.loyalty = 4
	declare(t, g, 0, {looter}, ajani)
	testing.expect(t, stack_size(g) == 0, "attacking a planeswalker")

	g2 := new_game()
	add(t, g2, "Attuma, Atlantean Warlord", 0, .Battlefield)
	looter2 := add(t, g2, "Merfolk Looter", 0, .Battlefield)
	hand := types.pvec_len(game.player(&g2.state, 0).hand)
	declare(t, g2, 0, {looter2})
	testing.expect(t, stack_size(g2) == 1, "attacking a player")
	resolve_all(g2)
	testing.expect(t, types.pvec_len(game.player(&g2.state, 0).hand) == hand + 1, "drew a card")
}

@(test)
you_attack_with_three_or_more :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 508.3c: Seasoned Consultant, "Whenever you attack with three or more creatures, this creature gets +2/+0
	// until end of turn". The count is of the creatures declared, settled by the event: one leaving combat before the
	// ability resolves doesn't undo it (it isn't an intervening "if", CR 603.4).
	testing.expect(t, game.card_supported(&card(t, "Seasoned Consultant").face))
	g := new_game()
	consultant := add(t, g, "Seasoned Consultant", 0, .Battlefield)
	a := add(t, g, "Grizzly Bears", 0, .Battlefield)
	declare(t, g, 0, {consultant, a})
	testing.expect(t, stack_size(g) == 0, "two attackers: no trigger")

	g2 := new_game()
	consultant2 := add(t, g2, "Seasoned Consultant", 0, .Battlefield)
	b := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	c := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	declare(t, g2, 0, {consultant2, b, c})
	testing.expect(t, stack_size(g2) == 1, "three attackers")
	game.move_object(g2, c.id, .Graveyard) // one attacker gone before it resolves
	resolve_all(g2)
	testing.expect(t, consultant2.power.? == 3, "+2/+0 all the same")
}

@(test)
any_player_attacks :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 508.3a, 603.2c: Duelist's Heritage, "Whenever one or more creatures attack, you may have target attacking
	// creature gain double strike": any player's attack triggers it, once.
	testing.expect(t, game.card_supported(&card(t, "Duelist's Heritage").face))
	g := new_game()
	add(t, g, "Duelist's Heritage", 0, .Battlefield)
	x := add(t, g, "Grizzly Bears", 1, .Battlefield)
	y := add(t, g, "Grizzly Bears", 1, .Battlefield)
	declare(t, g, 1, {x, y})
	if _, asked := g.state.waiting_for.(types.WaitingFor_TriggerTargetSelection); asked {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{x.id}}))
	}
	testing.expect(t, stack_size(g) == 1, "the opponent's attack: one trigger")
}

@(private = "file")
tokens_named :: proc(g: ^game.Game, name: string) -> int {
	n := 0
	for id in game.ids_of(g.state.battlefield) do if o := game.object(&g.state, id); o.is_token && o.name == name do n += 1
	return n
}

@(test)
land_enters_untapped :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 110.5b, 603.6a: Dwarven Mine, "This land enters tapped unless you control three or more other Mountains.
	// When this land enters untapped, create a 1/1 red Dwarf creature token." Entering tapped, it doesn't trigger.
	testing.expect(t, game.card_supported(&card(t, "Dwarven Mine").face))
	g := new_game()
	mine := add(t, g, "Dwarven Mine", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = mine.id}))
	testing.expect(t, mine.tapped && stack_size(g) == 0, "no other Mountains: tapped, no trigger")

	g2 := new_game()
	for _ in 0 ..< 3 do add(t, g2, "Mountain", 0, .Battlefield)
	mine2 := add(t, g2, "Dwarven Mine", 0, .Hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_PlayLand{object_id = mine2.id}))
	testing.expect(t, !mine2.tapped && stack_size(g2) == 1, "three Mountains: untapped, it triggers")
	resolve_all(g2)
	testing.expect(t, tokens_named(g2, "Dwarf") == 1, "a Dwarf")
}

@(test)
dies_if_it_had_a_counter :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.10a, 603.4: Basri's Lieutenant, "Whenever this creature or another creature you control dies, if it had a
	// +1/+1 counter on it, create a 2/2 white Knight": the creature as it last existed on the battlefield.
	testing.expect(t, game.card_supported(&card(t, "Basri's Lieutenant").face))
	dies :: proc(t: ^testing.T, counter: bool) -> int {
		g := new_game()
		add(t, g, "Basri's Lieutenant", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
		if counter do game.add_counters(bears, types.CounterType_Plus1Plus1{}, 1)
		game.destroy(g, bears)
		game.give_priority(g, 0)
		resolve_all(g)
		return tokens_named(g, "Knight")
	}
	testing.expect(t, dies(t, true) == 1, "it had a counter: a Knight")
	testing.expect(t, dies(t, false) == 0, "no counter: nothing")
}

@(test)
dies_if_it_wasnt_a_demon :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.10a, 603.4: Infernal Vessel, "When this creature dies, if it wasn't a Demon, return it to the
	// battlefield under its owner's control with two +1/+1 counters on it. It's a Demon in addition to its other
	// types." It comes back once: the second time it dies it was a Demon.
	testing.expect(t, game.card_supported(&card(t, "Infernal Vessel").face))
	g := new_game()
	v := add(t, g, "Infernal Vessel", 0, .Battlefield)
	game.destroy(g, v)
	game.give_priority(g, 0)
	resolve_all(g)
	testing.expect(t, v.zone == .Battlefield && game.has_subtype(v, "Demon"), "back as a Demon")
	game.destroy(g, v)
	game.give_priority(g, 0)
	resolve_all(g)
	testing.expect(t, v.zone == .Graveyard, "a Demon as it died: it stays")
}

@(test)
entering_creature_power_compared_again :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.4: Pelt Collector, "Whenever another creature you control enters or dies, if that creature's power is
	// greater than this creature's, put a +1/+1 counter on this creature." Checked as it triggers and again as it
	// resolves; a creature that has left by then is read as it last existed (its rulings).
	testing.expect(t, game.card_supported(&card(t, "Pelt Collector").face))
	g := new_game()
	pelt := add(t, g, "Pelt Collector", 0, .Battlefield) // 1/1
	bears := add(t, g, "Grizzly Bears", 0, .Hand)
	game.move_object(g, bears.id, .Battlefield)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "2 power is greater than 1")
	game.pump(g, pelt, 1, 0) // 2/1 before it resolves
	resolve_all(g)
	testing.expect(t, game.counter_count(pelt, types.CounterType_Plus1Plus1{}) == 0, "no longer greater: nothing")

	g2 := new_game()
	pelt2 := add(t, g2, "Pelt Collector", 0, .Battlefield)
	bears2 := add(t, g2, "Grizzly Bears", 0, .Hand)
	game.move_object(g2, bears2.id, .Battlefield)
	game.give_priority(g2, 0)
	testing.expect(t, stack_size(g2) == 1)
	game.move_object(g2, bears2.id, .Hand) // gone before it resolves: its last power, 2
	resolve_all(g2)
	testing.expect(t, game.counter_count(pelt2, types.CounterType_Plus1Plus1{}) == 1, "a counter")

	other := add(t, g2, "Grizzly Bears", 0, .Hand) // 2 power, not greater than 2
	game.move_object(g2, other.id, .Battlefield)
	game.give_priority(g2, 0)
	testing.expect(t, stack_size(g2) == 0, "2 isn't greater than 2: no trigger")
}

@(test)
entered_from_your_graveyard :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.4, 603.6a: Prized Amalgam (in a graveyard), "Whenever a creature enters, if it entered from your
	// graveyard or you cast it from your graveyard, return this card ... at the beginning of the next end step."
	testing.expect(t, game.card_supported(&card(t, "Prized Amalgam").face))
	g := new_game()
	add(t, g, "Prized Amalgam", 0, .Graveyard)
	from_hand := add(t, g, "Grizzly Bears", 0, .Hand)
	game.move_object(g, from_hand.id, .Battlefield)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "from the hand: no trigger")
	from_graveyard := add(t, g, "Grizzly Bears", 0, .Graveyard)
	game.move_object(g, from_graveyard.id, .Battlefield)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "from your graveyard: it triggers")
	theirs := add(t, g, "Grizzly Bears", 1, .Graveyard)
	resolve_all(g)
	game.move_object(g, theirs.id, .Battlefield)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "from an opponent's graveyard: no trigger")
}

@(test)
enters_if_it_isnt_a_token :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.4, 111.1: Gruff Triplets, "When this creature enters, if it isn't a token, create two tokens that are
	// copies of it": the copies' own abilities trigger, but they are tokens, so they do nothing more.
	testing.expect(t, game.card_supported(&card(t, "Gruff Triplets").face))
	g := new_game()
	triplets := add(t, g, "Gruff Triplets", 0, .Hand)
	game.move_object(g, triplets.id, .Battlefield)
	game.give_priority(g, 0)
	resolve_all(g)
	testing.expect(t, tokens_named(g, "Gruff Triplets") == 2 && stack_size(g) == 0, "two copies, and no more")
}

@(test)
each_players_upkeep_and_enchanted_creatures_controller :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.2b: Verdant Kraken, "At the beginning of each player's upkeep, you create a 3/3 ... token": the
	// opponent's upkeep too. Stab Wound, "At the beginning of the upkeep of enchanted creature's controller, that
	// player loses 2 life": only that player's upkeep.
	testing.expect(t, game.card_supported(&card(t, "Verdant Kraken").face))
	testing.expect(t, game.card_supported(&card(t, "Stab Wound").face))
	g := new_game()
	s := &g.state
	add(t, g, "Verdant Kraken", 0, .Battlefield)
	wurm := add(t, g, "Craw Wurm", 1, .Battlefield) // 6/4: it survives -2/-2
	wound := add(t, g, "Stab Wound", 0, .Battlefield)
	game.attach(s, wound, wurm)
	s.active_player, s.priority_player = 0, 0
	game.begin_step(g, .Upkeep)
	testing.expect(t, stack_size(g) == 1, "its controller's upkeep: the Kraken only")
	resolve_all(g)
	s.active_player, s.priority_player = 1, 1
	game.begin_step(g, .Upkeep)
	testing.expect(t, stack_size(g) == 2, "the opponent's upkeep: the Kraken and Stab Wound")
	resolve_all(g)
	testing.expect(t, tokens_named(g, "Forest Tentacle") == 2)
	testing.expect(t, game.player(s, 1).life == 18, "the enchanted creature's controller lost 2")
}

@(test)
nonland_permanents_entered_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.4, 111.1: Lady of Laughter, "At the beginning of your end step, if two or more nonland permanents
	// entered the battlefield under your control this turn, draw a card": tokens created count; lands don't.
	testing.expect(t, game.card_supported(&card(t, "Lady of Laughter").face))
	g := new_game()
	s := &g.state
	add(t, g, "Lady of Laughter", 0, .Battlefield)
	for _ in 0 ..< 2 do game.move_object(g, add(t, g, "Forest", 0, .Hand).id, .Battlefield)
	game.begin_step(g, .End)
	testing.expect(t, stack_size(g) == 0, "two lands: no trigger")
	game.move_object(g, add(t, g, "Grizzly Bears", 0, .Hand).id, .Battlefield)
	bird := types.Effect_Token{name = "Bird", power = types.PtValue_Fixed{1}, toughness = types.PtValue_Fixed{1}}
	append(&bird.types, "Creature", "Bird")
	game.create_token(g, bird, 0)
	game.give_priority(g, 0)
	resolve_all(g)
	game.begin_step(g, .End)
	testing.expect(t, stack_size(g) == 1, "a creature and a token: it triggers")
	_ = s
}

@(test)
no_spell_from_your_hand_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.4, 601.2i: Wrangler of the Damned, "At the beginning of your end step, if you haven't cast a spell from
	// your hand this turn, create a 2/2 white Spirit creature token with flying": a spell cast from elsewhere doesn't
	// count against it.
	testing.expect(t, game.card_supported(&card(t, "Wrangler of the Damned").face))
	g := new_game()
	s := &g.state
	add(t, g, "Wrangler of the Damned", 0, .Battlefield)
	shock := add(t, g, "Shock", 0, .Graveyard)
	game.record_spell_cast(s, 0, shock, .Graveyard)
	game.begin_step(g, .End)
	testing.expect(t, stack_size(g) == 1, "cast from the graveyard: it triggers")
	resolve_all(g)
	game.record_spell_cast(s, 0, shock, .Hand)
	game.begin_step(g, .End)
	testing.expect(t, stack_size(g) == 0, "cast from the hand: no trigger")
}

@(test)
if_this_isnt_prepared :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 723.3a, 603.4: Paradox Shaper, "At the beginning of your upkeep, if this creature isn't prepared, it becomes
	// prepared": once prepared, it doesn't trigger.
	testing.expect(t, game.card_supported(&card(t, "Paradox Shaper // Omit Variables").face))
	g := new_game()
	shaper := add(t, g, "Paradox Shaper", 0, .Battlefield)
	game.begin_step(g, .Upkeep)
	testing.expect(t, stack_size(g) == 1, "not prepared: it triggers")
	resolve_all(g)
	testing.expect(t, shaper.prepared != nil, "prepared")
	game.begin_step(g, .Upkeep)
	testing.expect(t, stack_size(g) == 0, "prepared: no trigger")
}

@(test)
if_this_attacked_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 508.1, 603.4: Targ Wrangler, "At the beginning of your end step, if this creature attacked this turn,
	// sacrifice a nonland permanent".
	testing.expect(t, game.card_supported(&card(t, "Targ Wrangler").face))
	g := new_game()
	wrangler := add(t, g, "Targ Wrangler", 0, .Battlefield)
	game.begin_step(g, .End)
	testing.expect(t, stack_size(g) == 0, "it didn't attack: no trigger")
	declare(t, g, 0, {wrangler})
	resolve_all(g)
	game.begin_step(g, .End)
	testing.expect(t, stack_size(g) == 1, "it attacked: it triggers")
}

@(test)
opponent_casts_when_its_not_their_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.4: March of the World Ooze, "Whenever an opponent casts a spell, if it's not their turn, you create a
	// 3/3 green Elephant creature token": the caster's turn or not.
	testing.expect(t, game.card_supported(&card(t, "March of the World Ooze").face))
	cast_by_opponent :: proc(t: ^testing.T, active: types.PlayerId) -> int {
		g := new_game()
		s := &g.state
		add(t, g, "March of the World Ooze", 0, .Battlefield)
		add(t, g, "Mountain", 1, .Battlefield)
		shock := add(t, g, "Shock", 1, .Hand)
		s.active_player, s.priority_player = active, 1
		s.waiting_for = types.WaitingFor_Priority{player = 1}
		testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = shock.id}))
		testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = types.TargetRef_Player{0}}))
		resolve_all(g)
		return tokens_named(g, "Elephant")
	}
	testing.expect(t, cast_by_opponent(t, 0) == 1, "during your turn: an Elephant")
	testing.expect(t, cast_by_opponent(t, 1) == 0, "during their own turn: nothing")
}

@(test)
first_enchantment_spell_each_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 601.2i: Psemilla, Meletian Poet, "Whenever you cast your first enchantment spell each turn": the first of
	// that kind, whatever was cast before it.
	testing.expect(t, game.card_supported(&card(t, "Psemilla, Meletian Poet").face))
	g := new_game()
	s := &g.state
	add(t, g, "Psemilla, Meletian Poet", 0, .Battlefield)
	shock := add(t, g, "Shock", 0, .Graveyard)
	game.record_spell_cast(s, 0, shock, .Hand) // an instant first
	for _ in 0 ..< 4 do add(t, g, "Plains", 0, .Battlefield)
	cast_aura :: proc(t: ^testing.T, g: ^game.Game) -> int {
		aura := add(t, g, "Pacifism", 0, .Hand)
		bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
		before := stack_size(g)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = aura.id}))
		if _, asked := g.state.waiting_for.(types.WaitingFor_TargetSelection); asked {
			testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
		}
		n := stack_size(g) - before
		resolve_all(g)
		return n
	}
	testing.expect(t, cast_aura(t, g) == 2, "the first enchantment spell: it triggers")
	testing.expect(t, cast_aura(t, g) == 1, "the second: no trigger")
}

@(test)
creature_died_under_your_control_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 700.4, 603.4: Denethor, Ruling Steward, "At the beginning of your end step, if a creature died under your
	// control this turn, create a 1/1 white Human Soldier creature token": an opponent's creature dying doesn't.
	testing.expect(t, game.card_supported(&card(t, "Denethor, Ruling Steward").face))
	g := new_game()
	add(t, g, "Denethor, Ruling Steward", 0, .Battlefield)
	game.destroy(g, add(t, g, "Grizzly Bears", 1, .Battlefield))
	game.give_priority(g, 0)
	game.begin_step(g, .End)
	testing.expect(t, stack_size(g) == 0, "the opponent's creature died: no trigger")
	game.destroy(g, add(t, g, "Grizzly Bears", 0, .Battlefield))
	game.give_priority(g, 0)
	game.begin_step(g, .End)
	testing.expect(t, stack_size(g) == 1, "yours died: it triggers")
}

@(test)
one_or_more_enter_once_each_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.2c, 603.6a: Elvish Warmaster, "Whenever one or more other Elves you control enter, create a 1/1 green
	// Elf Warrior creature token. This ability triggers only once each turn." Two Elves entering this turn, together
	// or not: one trigger; a non-Elf: none.
	testing.expect(t, game.card_supported(&card(t, "Elvish Warmaster").face))
	g := new_game()
	add(t, g, "Elvish Warmaster", 0, .Battlefield)
	game.move_object(g, add(t, g, "Grizzly Bears", 0, .Hand).id, .Battlefield)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "a Bears: no trigger")
	game.move_object(g, add(t, g, "Llanowar Elves", 0, .Hand).id, .Battlefield)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "an Elf: it triggers")
	resolve_all(g) // its Elf Warrior token is an Elf too: the limit holds
	testing.expect(t, tokens_named(g, "Elf Warrior") == 1 && stack_size(g) == 0, "one token, once")
	game.move_object(g, add(t, g, "Llanowar Elves", 0, .Hand).id, .Battlefield)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "a second Elf this turn: not again")
}

@(test)
leaves_during_your_turn_once_each_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.10a, 603.4: Suki, Courageous Rescuer, "Whenever another permanent you control leaves the battlefield
	// during your turn, create a 1/1 white Ally creature token. This ability triggers only once each turn."
	testing.expect(t, game.card_supported(&card(t, "Suki, Courageous Rescuer").face))
	g := new_game()
	s := &g.state
	add(t, g, "Suki, Courageous Rescuer", 0, .Battlefield)
	s.active_player = 1 // the opponent's turn
	game.destroy(g, add(t, g, "Grizzly Bears", 0, .Battlefield))
	game.give_priority(g, 1)
	testing.expect(t, stack_size(g) == 0, "during an opponent's turn: no trigger")
	s.active_player = 0
	game.destroy(g, add(t, g, "Grizzly Bears", 0, .Battlefield))
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "during your turn: it triggers")
	resolve_all(g)
	game.destroy(g, add(t, g, "Grizzly Bears", 0, .Battlefield))
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "once each turn")
}

@(test)
creature_dealt_damage_by_this_dies :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 120.3, 603.10a: Sengir Vampire, "Whenever a creature dealt damage by this creature this turn dies, put a
	// +1/+1 counter on this creature": the turn's damage records and the creature as it last existed.
	testing.expect(t, game.card_supported(&card(t, "Sengir Vampire").face))
	g := new_game()
	vampire := add(t, g, "Sengir Vampire", 0, .Battlefield)
	other := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.destroy(g, other)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "not dealt damage by it: no trigger")
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.deal_damage(g, vampire.id, types.TargetRef_Object{bears.id}, 1)
	game.destroy(g, bears)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "dealt damage by it: it triggers")
	resolve_all(g)
	testing.expect(t, game.counter_count(vampire, types.CounterType_Plus1Plus1{}) == 1)
}

@(test)
five_other_mountains :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.4: Valakut, the Molten Pinnacle, "Whenever a Mountain you control enters, if you control at least five
	// other Mountains, you may have this land deal 3 damage to any target": the Mountain that entered isn't one of them.
	testing.expect(t, game.card_supported(&card(t, "Valakut, the Molten Pinnacle").face))
	g := new_game()
	add(t, g, "Valakut, the Molten Pinnacle", 0, .Battlefield)
	for _ in 0 ..< 4 do add(t, g, "Mountain", 0, .Battlefield)
	game.move_object(g, add(t, g, "Mountain", 0, .Hand).id, .Battlefield)
	game.give_priority(g, 0)
	_, asked := g.state.waiting_for.(types.WaitingFor_TriggerTargetSelection)
	testing.expect(t, stack_size(g) == 0 && !asked, "four other Mountains: no trigger")
	game.move_object(g, add(t, g, "Mountain", 0, .Hand).id, .Battlefield)
	game.give_priority(g, 0)
	_, asked = g.state.waiting_for.(types.WaitingFor_TriggerTargetSelection)
	testing.expect(t, stack_size(g) == 1 || asked, "five other Mountains: it triggers")
}

@(test)
card_leaves_your_graveyard :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.10a: Vash, Freelance Archaeologist, "Whenever a card leaves your graveyard, draw a card. This ability
	// triggers only once each turn": a card leaving an opponent's graveyard doesn't.
	testing.expect(t, game.card_supported(&card(t, "Vash, Freelance Archaeologist").face))
	g := new_game()
	add(t, g, "Vash, Freelance Archaeologist", 0, .Battlefield)
	game.move_object(g, add(t, g, "Grizzly Bears", 1, .Graveyard).id, .Exile)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "the opponent's graveyard: no trigger")
	game.move_object(g, add(t, g, "Grizzly Bears", 0, .Graveyard).id, .Exile)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "your graveyard: it triggers")
	resolve_all(g)
	game.move_object(g, add(t, g, "Grizzly Bears", 0, .Graveyard).id, .Hand)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "only once each turn")
}

@(test)
source_you_control_deals_noncombat_damage :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 120.2b: Chandra's Pyreling, "Whenever a source you control deals noncombat damage to an opponent": combat
	// damage doesn't trigger it, nor does an opponent's source.
	testing.expect(t, game.card_supported(&card(t, "Chandra's Pyreling").face))
	g := new_game()
	add(t, g, "Chandra's Pyreling", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.deal_damage(g, bears.id, types.TargetRef_Player{1}, 1, combat = true)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "combat damage: no trigger")
	game.deal_damage(g, theirs.id, types.TargetRef_Player{0}, 1)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "the opponent's source, to you: no trigger")
	game.deal_damage(g, bears.id, types.TargetRef_Player{1}, 1)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "noncombat damage from your source: it triggers")
}

@(test)
defending_player_controls_no :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 506.2, 603.4: Fear of the Dark, "Whenever this creature attacks, if defending player controls no Glimmer
	// creatures, it gains menace and deathtouch until end of turn".
	testing.expect(t, game.card_supported(&card(t, "Fear of the Dark").face))
	g := new_game()
	fear := add(t, g, "Fear of the Dark", 0, .Battlefield)
	add(t, g, "Chittering Illuminator", 1, .Battlefield) // a Glimmer
	declare(t, g, 0, {fear})
	testing.expect(t, stack_size(g) == 0, "a Glimmer: no trigger")

	g2 := new_game()
	fear2 := add(t, g2, "Fear of the Dark", 0, .Battlefield)
	add(t, g2, "Chittering Illuminator", 0, .Battlefield) // yours, not the defending player's
	declare(t, g2, 0, {fear2})
	testing.expect(t, stack_size(g2) == 1, "no Glimmer: it triggers")
}

@(test)
leaving_a_graveyard_looks_back :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.10a: "whenever a card leaves your graveyard" triggers only for an ability on the battlefield just before
	// the event. Vash returned from your graveyard doesn't see itself leave it, nor a card leaving with it.
	g := new_game()
	vash := add(t, g, "Vash, Freelance Archaeologist", 0, .Graveyard)
	other := add(t, g, "Grizzly Bears", 0, .Graveyard)
	together := game.begin_together()
	game.move_object(g, vash.id, .Battlefield)
	game.move_object(g, other.id, .Exile)
	game.end_together(together)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "it wasn't on the battlefield before: no trigger")
	game.move_object(g, add(t, g, "Grizzly Bears", 0, .Graveyard).id, .Exile)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "now on the battlefield: it triggers")
}

@(test)
entering_token_gone_read_as_it_last_was :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.4, 608.2h, 111.7: Pelt Collector (1/1) and a 3/3 token entering: the token ceases to exist before the
	// ability resolves, so its power is read as it last existed on the battlefield.
	g := new_game()
	pelt := add(t, g, "Pelt Collector", 0, .Battlefield)
	beast := types.Effect_Token{name = "Beast", power = types.PtValue_Fixed{3}, toughness = types.PtValue_Fixed{3}}
	append(&beast.types, "Creature", "Beast")
	token := game.create_token(g, beast, 0)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "3 is greater than 1")
	game.move_object(g, token.id, .Hand) // bounced (not dying, which would trigger it again)
	resolve_all(g)
	testing.expect(t, game.counter_count(pelt, types.CounterType_Plus1Plus1{}) == 1, "its last power, 3: a counter")
}

@(test)
entered_or_cast_from_a_graveyard :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.4, 601.2i: Breathless Knight, "Whenever this creature or another creature you control enters, if that
	// creature entered from a graveyard or you cast it from a graveyard, put a +1/+1 counter on this creature": the
	// creature that entered, not the Knight.
	testing.expect(t, game.card_supported(&card(t, "Breathless Knight").face))
	enters :: proc(t: ^testing.T, cast_from: types.Zone) -> int {
		g := new_game()
		knight := add(t, g, "Breathless Knight", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 0, .Hand)
		game.move_object(g, bears.id, .Stack)
		bears.cast_from_zone = cast_from // as if cast from there (spells.odin sets it so)
		game.move_object(g, bears.id, .Battlefield)
		game.give_priority(g, 0)
		resolve_all(g)
		return int(game.counter_count(knight, types.CounterType_Plus1Plus1{}))
	}
	testing.expect(t, enters(t, .Graveyard) == 1, "cast from a graveyard: a counter")
	testing.expect(t, enters(t, .Hand) == 0, "cast from the hand: nothing")
	g := new_game()
	knight := add(t, g, "Breathless Knight", 0, .Battlefield)
	game.move_object(g, add(t, g, "Grizzly Bears", 0, .Graveyard).id, .Battlefield)
	game.give_priority(g, 0)
	resolve_all(g)
	testing.expect(t, game.counter_count(knight, types.CounterType_Plus1Plus1{}) == 1, "entered from a graveyard: a counter")
}

@(test)
if_this_didnt_attack_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 508.1, 603.4: Air Nomad Student, "At the beginning of your end step, if this creature didn't attack this
	// turn, put a +1/+1 counter on it".
	testing.expect(t, game.card_supported(&card(t, "Air Nomad Student").face))
	g := new_game()
	student := add(t, g, "Air Nomad Student", 0, .Battlefield)
	game.begin_step(g, .End)
	testing.expect(t, stack_size(g) == 1, "it didn't attack: it triggers")
	resolve_all(g)
	g2 := new_game()
	student2 := add(t, g2, "Air Nomad Student", 0, .Battlefield)
	declare(t, g2, 0, {student2})
	resolve_all(g2)
	game.begin_step(g2, .End)
	testing.expect(t, stack_size(g2) == 0, "it attacked: no trigger")
	_ = student
}

@(test)
instant_during_your_main_phase :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 505.1: Dovin's Acuity, "Whenever you cast an instant spell during your main phase, you may return this
	// enchantment to its owner's hand": not during combat.
	testing.expect(t, game.card_supported(&card(t, "Dovin's Acuity").face))
	g := new_game()
	s := &g.state
	add(t, g, "Dovin's Acuity", 0, .Battlefield)
	for _ in 0 ..< 2 do add(t, g, "Island", 0, .Battlefield)
	opt := add(t, g, "Opt", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = opt.id}))
	testing.expect(t, stack_size(g) == 2, "main phase: Opt and the trigger")
	game.begin_step(g, .BeginCombat)
	s.priority_player = 0
	s.waiting_for = types.WaitingFor_Priority{player = 0}
	before := stack_size(g)
	opt2 := add(t, g, "Opt", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = opt2.id}))
	testing.expect(t, stack_size(g) == before + 1, "combat: Opt only")
}

@(test)
cast_a_spell_with_mana_value_four :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 202.3, 603.4: Rhino, Barreling Brute, "Whenever Rhino attacks, if you've cast a spell with mana value 4 or
	// greater this turn, draw a card".
	testing.expect(t, game.card_supported(&card(t, "Rhino, Barreling Brute").face))
	g := new_game()
	rhino := add(t, g, "Rhino, Barreling Brute", 0, .Battlefield)
	game.record_spell_cast(&g.state, 0, add(t, g, "Opt", 0, .Graveyard), .Hand) // mana value 1
	declare(t, g, 0, {rhino})
	testing.expect(t, stack_size(g) == 0, "mana value 1: no trigger")
	g2 := new_game()
	rhino2 := add(t, g2, "Rhino, Barreling Brute", 0, .Battlefield)
	game.record_spell_cast(&g2.state, 0, add(t, g2, "Rhino, Barreling Brute", 0, .Graveyard), .Hand) // mana value 7
	declare(t, g2, 0, {rhino2})
	testing.expect(t, stack_size(g2) == 1, "mana value 7: it triggers")
}

@(test)
another_creature_entered_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.4: Wary Farmer, "At the beginning of your end step, if another creature entered the battlefield under
	// your control this turn, surveil 1": the Farmer itself entering isn't another.
	testing.expect(t, game.card_supported(&card(t, "Wary Farmer").face))
	g := new_game()
	game.move_object(g, add(t, g, "Wary Farmer", 0, .Hand).id, .Battlefield)
	game.begin_step(g, .End)
	testing.expect(t, stack_size(g) == 0, "only the Farmer entered: no trigger")
	game.move_object(g, add(t, g, "Grizzly Bears", 0, .Hand).id, .Battlefield)
	game.give_priority(g, 0)
	game.begin_step(g, .End)
	testing.expect(t, stack_size(g) == 1, "another creature entered: it triggers")
}

@(test)
one_or_more_artifacts_leave_during_your_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.2c, 603.10a: Oni-Cult Anvil, "Whenever one or more artifacts you control leave the battlefield during
	// your turn, create a 1/1 ... Construct ... This ability triggers only once each turn": two leaving together, once.
	testing.expect(t, game.card_supported(&card(t, "Oni-Cult Anvil").face))
	g := new_game()
	add(t, g, "Oni-Cult Anvil", 0, .Battlefield)
	a := add(t, g, "Ornithopter", 0, .Battlefield)
	b := add(t, g, "Ornithopter", 0, .Battlefield)
	together := game.begin_together()
	game.destroy(g, a)
	game.destroy(g, b)
	game.end_together(together)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "two artifacts at once: one trigger")
}

@(test)
cast_trigger_from_the_graveyard :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 113.6m, 601.2i: Lingering Phantom, "Whenever you cast a historic spell, you may pay {B}. If you do, return
	// this card from your graveyard to your hand": it works from the graveyard (its effect moves it out of there),
	// not from the battlefield; a non-historic spell doesn't trigger it.
	testing.expect(t, game.card_supported(&card(t, "Lingering Phantom").face))
	cast_one :: proc(t: ^testing.T, name: string, zone: types.Zone) -> int {
		g := new_game()
		add(t, g, "Lingering Phantom", 0, zone)
		add(t, g, "Island", 0, .Battlefield)
		spell := add(t, g, name, 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
		return stack_size(g)
	}
	testing.expect(t, cast_one(t, "Ornithopter", .Graveyard) == 2, "an artifact spell, Phantom in the graveyard: it triggers")
	testing.expect(t, cast_one(t, "Opt", .Graveyard) == 1, "an instant: no trigger")
	testing.expect(t, cast_one(t, "Ornithopter", .Battlefield) == 1, "Phantom on the battlefield: no trigger")
}

@(test)
one_or_more_deal_combat_damage_to_a_player :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 510.2, 603.2c: Keeper of Fables, "Whenever one or more non-Human creatures you control deal combat damage to
	// a player, draw a card": once for the combat damage step's damage, however many dealt it; a Human doesn't count,
	// nor does noncombat damage.
	testing.expect(t, game.card_supported(&card(t, "Keeper of Fables").face))
	g := new_game()
	add(t, g, "Keeper of Fables", 0, .Battlefield)
	human := add(t, g, "Elite Vanguard", 0, .Battlefield) // a Human Soldier
	game.deal_damage(g, human.id, types.TargetRef_Player{1}, 2, combat = true)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "a Human: no trigger")
	a := add(t, g, "Grizzly Bears", 0, .Battlefield)
	b := add(t, g, "Grizzly Bears", 0, .Battlefield)
	game.deal_damage(g, a.id, types.TargetRef_Player{1}, 2)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "noncombat damage: no trigger")
	game.deal_damage(g, a.id, types.TargetRef_Player{1}, 2, combat = true)
	game.deal_damage(g, b.id, types.TargetRef_Player{1}, 2, combat = true)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "two Bears at once: one trigger")
}

@(test)
opponent_dealt_noncombat_damage :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 120.2b: Chandra's Spitfire, "Whenever an opponent is dealt noncombat damage, this creature gets +3/+0
	// until end of turn": not combat damage, not damage to you.
	testing.expect(t, game.card_supported(&card(t, "Chandra's Spitfire").face))
	g := new_game()
	spitfire := add(t, g, "Chandra's Spitfire", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.deal_damage(g, bears.id, types.TargetRef_Player{0}, 1)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "damage to you: no trigger")
	game.deal_damage(g, spitfire.id, types.TargetRef_Player{1}, 1, combat = true)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "combat damage: no trigger")
	game.deal_damage(g, bears.id, types.TargetRef_Player{1}, 1)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 1, "noncombat damage to an opponent, from any source: it triggers")
}

@(test)
this_is_dealt_noncombat_damage :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 120.2b, 120.3: Smaug the Impenetrable (indestructible), "Whenever Smaug is dealt noncombat damage, create
	// that many Treasure tokens".
	testing.expect(t, game.card_supported(&card(t, "Smaug the Impenetrable").face))
	g := new_game()
	smaug := add(t, g, "Smaug the Impenetrable", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.deal_damage(g, bears.id, types.TargetRef_Object{smaug.id}, 2, combat = true)
	game.give_priority(g, 0)
	testing.expect(t, stack_size(g) == 0, "combat damage: no trigger")
	game.deal_damage(g, bears.id, types.TargetRef_Object{smaug.id}, 3)
	game.give_priority(g, 0)
	resolve_all(g)
	testing.expect(t, tokens_named(g, "Treasure") == 3, "3 damage: three Treasures")
}

// Plays out the combat after attackers are declared: no blocks (the AI decides for the defending player), damage.
@(private = "file")
finish_combat :: proc(g: ^game.Game) {
	s := &g.state
	for _ in 0 ..< 40 {
		if s.phase >= .EndCombat do break
		if _, priority := s.waiting_for.(types.WaitingFor_Priority); !priority {
			act, _ := game.ai_action(g, s.priority_player)
			game.apply(g, s.priority_player, act)
			continue
		}
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
}

@(test)
combat_damage_batch_in_a_real_combat :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 510.2, 603.2c: Keeper of Fables with two unblocked Bears: their combat damage is dealt at once, one draw.
	g := new_game()
	s := &g.state
	add(t, g, "Keeper of Fables", 0, .Battlefield)
	a := add(t, g, "Grizzly Bears", 0, .Battlefield)
	b := add(t, g, "Grizzly Bears", 0, .Battlefield)
	hand := types.pvec_len(game.player(s, 0).hand)
	declare(t, g, 0, {a, b})
	finish_combat(g)
	testing.expect(t, game.player(s, 1).life == 16, "4 combat damage")
	testing.expect(t, types.pvec_len(game.player(s, 0).hand) == hand + 1, "one card drawn")
}

@(test)
burn_spell_is_a_source_you_control :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 120.2b, 608.2h: Chandra's Pyreling (1/3) and a Shock at the opponent: the Shock, gone from the stack by
	// then, was a source you controlled dealing noncombat damage.
	g := new_game()
	s := &g.state
	pyreling := add(t, g, "Chandra's Pyreling", 0, .Battlefield)
	add(t, g, "Mountain", 0, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	resolve_all(g)
	testing.expect(t, game.player(s, 1).life == 18 && pyreling.power.? == 2, "+1/+0 from the Shock's damage")
}

@(test)
two_or_more_attack_a_player_not_a_planeswalker :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 508.3e: Landroval, Horizon Witness, "Whenever two or more creatures you control attack a player": one
	// attacking the player and one a planeswalker isn't two attacking a player.
	testing.expect(t, game.card_supported(&card(t, "Landroval, Horizon Witness").face))
	g := new_game()
	s := &g.state
	add(t, g, "Landroval, Horizon Witness", 0, .Battlefield)
	a := add(t, g, "Grizzly Bears", 0, .Battlefield)
	b := add(t, g, "Grizzly Bears", 0, .Battlefield)
	ajani := add(t, g, "Ajani, Adversary of Tyrants", 1, .Battlefield)
	ajani.loyalty = 4
	game.begin_step(g, .DeclareAttackers)
	list: [dynamic]types.Tuple2(types.ObjectId, types.AttackTarget)
	append(&list, types.Tuple2(types.ObjectId, types.AttackTarget){a.id, types.AttackTarget_Player{1}})
	append(&list, types.Tuple2(types.ObjectId, types.AttackTarget){b.id, types.AttackTarget_Planeswalker{ajani.id}})
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = list}))
	_, asked := s.waiting_for.(types.WaitingFor_TriggerTargetSelection)
	testing.expect(t, stack_size(g) == 0 && !asked, "one at the player: no trigger")
}

@(test)
token_with_a_counter_dies :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.10a, 111.7: Basri's Lieutenant and a token with a +1/+1 counter dying: the token as it last existed,
	// though it has ceased to exist by the time the ability is put on the stack.
	g := new_game()
	add(t, g, "Basri's Lieutenant", 0, .Battlefield)
	spirit := types.Effect_Token{name = "Spirit", power = types.PtValue_Fixed{1}, toughness = types.PtValue_Fixed{1}}
	append(&spirit.types, "Creature", "Spirit")
	token := game.create_token(g, spirit, 0)
	game.give_priority(g, 0)
	resolve_all(g)
	game.add_counters(token, types.CounterType_Plus1Plus1{}, 1)
	game.destroy(g, token)
	game.give_priority(g, 0)
	resolve_all(g)
	testing.expect(t, tokens_named(g, "Knight") == 1, "it had a counter: a Knight")
}

@(test)
modal_land_entering_tapped_doesnt_trigger :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 110.5b: Federation Outpost, "This land enters tapped unless you control two or more other lands. When this
	// land enters untapped, choose one — ...": entering tapped, nothing.
	testing.expect(t, game.card_supported(&card(t, "Federation Outpost").face))
	g := new_game()
	outpost := add(t, g, "Federation Outpost", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_PlayLand{object_id = outpost.id}))
	_, choosing := g.state.waiting_for.(types.WaitingFor_Priority)
	testing.expect(t, outpost.tapped && stack_size(g) == 0 && choosing, "tapped: no trigger, no mode to choose")
}
