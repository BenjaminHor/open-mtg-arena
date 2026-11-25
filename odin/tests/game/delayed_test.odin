// Delayed triggered abilities (CR 603.7) beyond "at the beginning of the next end step": "that token", "return it",
// "your next upkeep", "when that creature dies this turn", "whenever ... this turn", "until your next turn".
package game_test

import "core:testing"
import game "../../engine/game"
import types "../../engine/types"

@(private = "file")
cast_targeting :: proc(t: ^testing.T, g: ^game.Game, spell: ^types.GameObject, target: types.ObjectId) {
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	if _, asked := g.state.waiting_for.(types.WaitingFor_TargetSelection); asked {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{target}}))
	}
	settle(g)
}

// Chooses the object as the next target of the spell being cast.
@(private = "file")
pick :: proc(t: ^testing.T, g: ^game.Game, id: types.ObjectId) {
	_, asked := g.state.waiting_for.(types.WaitingFor_TargetSelection)
	testing.expect(t, asked && game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{id}}), "a target to choose")
}

// Passes priority until the stack is empty.
@(private = "file")
settle :: proc(g: ^game.Game) {
	for _ in 0 ..< 12 {
		if types.pvec_len(g.state.stack) == 0 do return
		game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
	}
}

// Taps a permanent as an effect would: an event abilities trigger on (CR 701.26a).
@(private = "file")
tap_now :: proc(g: ^game.Game, o: ^types.GameObject) {
	game.action_events = &g.events
	game.tap_permanent(o)
	game.action_events = nil
}

@(private = "file")
tokens_of :: proc(g: ^game.Game, p: types.PlayerId) -> [dynamic]^types.GameObject {
	out := make([dynamic]^types.GameObject, context.temp_allocator)
	for id in game.ids_of(g.state.battlefield) do if o := game.object(&g.state, id); o.is_token && o.controller == p do append(&out, o)
	return out
}

@(test)
delayed_sacrifice_that_token :: proc(t: ^testing.T) {
	if !load_db() do return
	// Hungry for More: "Create a 3/1 ... Vampire creature token with trample, lifelink, and haste. Sacrifice it at
	// the beginning of the next end step." CR 603.7c: the delayed ability acts on the token the spell made, and on
	// nothing else (another token stays); CR 603.7b: it triggers once.
	testing.expect(t, game.card_supported(&card(t, "Hungry for More").face))
	g := new_game()
	s := &g.state
	add(t, g, "Swamp", 0, .Battlefield)
	add(t, g, "Mountain", 0, .Battlefield)
	spell := add(t, g, "Hungry for More", 0, .Hand)
	cast_targeting(t, g, spell, 0)
	made := tokens_of(g, 0)
	testing.expect(t, len(made) == 1 && len(s.delayed_triggers) == 1, "a Vampire, and the delayed ability waiting")
	if len(made) != 1 do return
	vampire := made[0].id
	// Another token, made by something else, isn't "it".
	other := types.Effect_Token{name = "Soldier", power = types.PtValue_Fixed{1}, toughness = types.PtValue_Fixed{1}, types = make([dynamic]string), count = types.QuantityExpr_Fixed{1}}
	append(&other.types, "Creature", "Soldier")
	game.create_token(g, other, 0)
	game.begin_step(g, .End)
	testing.expect(t, types.pvec_len(s.stack) == 1 && len(s.delayed_triggers) == 0, "it triggered at the end step, once")
	settle(g)
	left := tokens_of(g, 0)
	testing.expect(t, len(left) == 1 && left[0].id != vampire, "the Vampire was sacrificed; the other token stays")
	game.begin_step(g, .End)
	testing.expect(t, types.pvec_len(s.stack) == 0, "nothing triggers at a later end step")
}

@(test)
delayed_exile_that_token_at_end_of_combat :: proc(t: ^testing.T) {
	if !load_db() do return
	// Geist of Saint Traft: "Whenever Geist of Saint Traft attacks, create a 4/4 white Angel creature token with
	// flying that's tapped and attacking. Exile that token at end of combat." (CR 603.7, 511.2.)
	testing.expect(t, game.card_supported(&card(t, "Geist of Saint Traft").face))
	g := new_game()
	s := &g.state
	geist := add(t, g, "Geist of Saint Traft", 0, .Battlefield)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{geist.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	settle(g)
	testing.expect(t, len(tokens_of(g, 0)) == 1 && len(s.delayed_triggers) == 1, "an Angel, the delayed ability waiting")
	game.begin_step(g, .End)
	testing.expect(t, types.pvec_len(s.stack) == 0, "not at the end step: at end of combat")
	game.begin_step(g, .EndCombat)
	settle(g)
	testing.expect(t, len(tokens_of(g, 0)) == 0 && len(s.delayed_triggers) == 0, "the Angel was exiled at end of combat")
}

@(test)
delayed_return_of_the_exiled_card :: proc(t: ^testing.T) {
	if !load_db() do return
	// Aetherling: "{U}: Exile this creature. Return it to the battlefield under its owner's control at the beginning
	// of the next end step." "It" is the exiled card, a new object (CR 400.7) the delayed ability still finds (CR
	// 603.7c); if that card has left exile by then, it's a new object again, and nothing returns.
	testing.expect(t, game.card_supported(&card(t, "Aetherling").face))
	for leaves_exile in ([]bool{false, true}) {
		g := new_game()
		s := &g.state
		add(t, g, "Island", 0, .Battlefield)
		ling := add(t, g, "Aetherling", 0, .Battlefield)
		testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = ling.id, ability_index = 0}))
		settle(g)
		testing.expect(t, ling.zone == .Exile && len(s.delayed_triggers) == 1, "exiled, the return waiting")
		if leaves_exile do game.move_object(g, ling.id, .Graveyard)
		game.begin_step(g, .End)
		settle(g)
		if leaves_exile do testing.expect(t, ling.zone == .Graveyard, "a new object: not returned")
		else do testing.expect(t, ling.zone == .Battlefield && ling.controller == 0, "back under its owner's control")
	}
}

@(test)
delayed_at_the_end_step_of_your_next_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// Kav Landseeker: "When this creature enters, create a Lander token. At the beginning of the end step on your
	// next turn, sacrifice that token." Not this turn's end step, nor the opponent's (CR 603.7b: the next time its
	// event happens, which is on the controller's next turn).
	testing.expect(t, game.card_supported(&card(t, "Kav Landseeker").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 4 do add(t, g, "Mountain", 0, .Battlefield)
	kav := add(t, g, "Kav Landseeker", 0, .Hand)
	cast_targeting(t, g, kav, 0)
	settle(g)
	testing.expect(t, len(tokens_of(g, 0)) == 1 && len(s.delayed_triggers) == 1, "a Lander, the delayed ability waiting")
	game.begin_step(g, .End)
	testing.expect(t, types.pvec_len(s.stack) == 0, "not this turn's end step")
	s.turn_number += 1
	game.begin_turn(g, 1)
	game.begin_step(g, .End)
	testing.expect(t, types.pvec_len(s.stack) == 0, "not the opponent's end step")
	s.turn_number += 1
	game.begin_turn(g, 0)
	testing.expect(t, len(tokens_of(g, 0)) == 1, "still there at the start of the next turn")
	game.begin_step(g, .End)
	settle(g)
	testing.expect(t, len(tokens_of(g, 0)) == 0 && len(s.delayed_triggers) == 0, "sacrificed at the end step of its controller's next turn")
}

@(test)
delayed_at_your_next_upkeep :: proc(t: ^testing.T) {
	if !load_db() do return
	// Casey Jones, Vigilante: "When Casey Jones enters, draw three cards. At the beginning of your next upkeep,
	// discard three cards at random." The opponent's upkeep isn't "your next upkeep" (CR 603.7b).
	testing.expect(t, game.card_supported(&card(t, "Casey Jones, Vigilante").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
	casey := add(t, g, "Casey Jones, Vigilante", 0, .Hand)
	hand := types.pvec_len(game.player(s, 0).hand)
	cast_targeting(t, g, casey, 0)
	settle(g)
	testing.expect(t, types.pvec_len(game.player(s, 0).hand) == hand - 1 + 3, "drew three")
	s.turn_number += 1
	game.begin_turn(g, 1) // the opponent's upkeep
	testing.expect(t, types.pvec_len(s.stack) == 0 && len(s.delayed_triggers) == 1, "not the opponent's upkeep")
	settle(g)
	s.turn_number += 1
	game.begin_turn(g, 0) // untap, then this player's upkeep
	before := types.pvec_len(game.player(s, 0).hand)
	testing.expect(t, types.pvec_len(s.stack) == 1 && len(s.delayed_triggers) == 0, "it triggered at its controller's upkeep")
	settle(g)
	testing.expect(t, types.pvec_len(game.player(s, 0).hand) == before - 3, "three cards discarded")
}

@(test)
delayed_when_that_creature_dies_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// Searing Blood: "Searing Blood deals 2 damage to target creature. When that creature dies this turn, Searing
	// Blood deals 3 damage to the creature's controller." CR 603.7: the delayed ability; CR 608.2h: the controller
	// as the creature last existed.
	testing.expect(t, game.card_supported(&card(t, "Searing Blood").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 2 do add(t, g, "Mountain", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	cast_targeting(t, g, add(t, g, "Searing Blood", 0, .Hand), bears.id)
	settle(g)
	testing.expect(t, bears.zone == .Graveyard, "the Bears died")
	testing.expect(t, game.player(s, 1).life == 17 && game.player(s, 0).life == 20, "3 damage to its controller")
	testing.expect(t, len(s.delayed_triggers) == 0, "once")
}

@(test)
delayed_dies_this_turn_ends_with_the_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// Make Your Mark: "Target creature gets +1/+0 until end of turn. When that creature dies this turn, create a 3/2
	// red and white Spirit creature token." "This turn" ends in the cleanup step (CR 514.2): a creature that dies
	// later makes nothing. The Deck of Many Things' "when that creature dies" (no "this turn") has the same card
	// data, so the Oracle text decides.
	testing.expect(t, game.card_supported(&card(t, "Make Your Mark").face))
	testing.expect(t, !game.card_supported(&card(t, "The Deck of Many Things").face))
	{
		g := new_game()
		s := &g.state
		add(t, g, "Mountain", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
		cast_targeting(t, g, add(t, g, "Make Your Mark", 0, .Hand), bears.id)
		testing.expect(t, len(s.delayed_triggers) == 1, "waiting for it to die")
		game.begin_step(g, .Cleanup)
		testing.expect(t, len(s.delayed_triggers) == 0, "gone at the end of the turn")
		game.move_object(g, bears.id, .Graveyard)
		game.give_priority(g, s.active_player)
		testing.expect(t, types.pvec_len(s.stack) == 0 && len(tokens_of(g, 0)) == 0, "a later death makes no Spirit")
	}
	{
		// The same creature dying this turn: a Spirit. One that left and came back is a new object (CR 400.7): its
		// death isn't "that creature" dying.
		for blinked in ([]bool{false, true}) {
			g := new_game()
			s := &g.state
			add(t, g, "Mountain", 0, .Battlefield)
			bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
			cast_targeting(t, g, add(t, g, "Make Your Mark", 0, .Hand), bears.id)
			if blinked {
				game.move_object(g, bears.id, .Exile)
				game.move_object(g, bears.id, .Battlefield)
				game.give_priority(g, s.active_player)
			}
			game.move_object(g, bears.id, .Graveyard)
			game.give_priority(g, s.active_player)
			settle(g)
			spirits := tokens_of(g, 0)
			if blinked do testing.expect(t, len(spirits) == 0 && len(s.delayed_triggers) == 0, "a new object: nothing")
			else do testing.expect(t, len(spirits) == 1 && spirits[0].power.? == 3, "a 3/2 Spirit")
		}
	}
}

@(test)
delayed_whenever_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// Death Frenzy: "All creatures get -2/-2 until end of turn. Whenever a creature dies this turn, you gain 1 life."
	// It triggers for each creature (CR 603.7b: a stated duration), including those its own -2/-2 kills, and not
	// after the turn ends (CR 514.2).
	testing.expect(t, game.card_supported(&card(t, "Death Frenzy").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Swamp", 0, .Battlefield)
	for _ in 0 ..< 2 do add(t, g, "Forest", 0, .Battlefield)
	add(t, g, "Grizzly Bears", 0, .Battlefield)
	add(t, g, "Grizzly Bears", 1, .Battlefield)
	wurm := add(t, g, "Craw Wurm", 1, .Battlefield) // 6/4: survives
	cast_targeting(t, g, add(t, g, "Death Frenzy", 0, .Hand), 0)
	settle(g)
	testing.expect(t, game.player(s, 0).life == 22, "two creatures died: 2 life")
	testing.expect(t, len(s.delayed_triggers) == 1, "still waiting this turn")
	game.begin_step(g, .Cleanup)
	testing.expect(t, len(s.delayed_triggers) == 0, "gone at the end of the turn")
	game.move_object(g, wurm.id, .Graveyard)
	game.give_priority(g, s.active_player)
	settle(g)
	testing.expect(t, game.player(s, 0).life == 22, "a death next turn gains nothing")
}

@(test)
delayed_ability_ignores_earlier_events :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 603.7a: a delayed triggered ability won't trigger until it has been created, even if its event happened
	// just before. Death Frenzy's "whenever a creature dies this turn", created after a death not yet looked at.
	g := new_game()
	s := &g.state
	frenzy := add(t, g, "Death Frenzy", 0, .Graveyard)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.move_object(g, bears.id, .Graveyard) // the event is waiting to be looked at
	delayed: types.Effect_CreateDelayedTrigger
	for a := &card(t, "Death Frenzy").face.abilities[0]; a != nil; a = a.sub_ability {
		if x, ok := a.effect^.(types.Effect_CreateDelayedTrigger); ok do delayed = x
	}
	game.create_delayed_trigger(g, delayed, 0, frenzy.id)
	game.give_priority(g, 0)
	testing.expect(t, types.pvec_len(s.stack) == 0, "the earlier death doesn't trigger it")
	other := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.move_object(g, other.id, .Graveyard)
	game.give_priority(g, 0)
	testing.expect(t, types.pvec_len(s.stack) == 1, "a later one does")
}

@(test)
delayed_whenever_that_creature_deals_combat_damage :: proc(t: ^testing.T) {
	if !load_db() do return
	// Hunter's Insight: "Choose target creature you control. Whenever that creature deals combat damage to a player
	// or planeswalker this turn, draw that many cards." "That many": the trigger event's amount (CR 603.7, 608.2c);
	// another creature's damage doesn't trigger it.
	testing.expect(t, game.card_supported(&card(t, "Hunter's Insight").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Forest", 0, .Battlefield)
	wurm := add(t, g, "Craw Wurm", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	cast_targeting(t, g, add(t, g, "Hunter's Insight", 0, .Hand), wurm.id)
	hand := types.pvec_len(game.player(s, 0).hand)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{wurm.id, types.AttackTarget_Player{1}}, {bears.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	for _ in 0 ..< 12 {
		if s.phase == .EndCombat || s.phase == .PostCombatMain do break
		if _, blockers := s.waiting_for.(types.WaitingFor_DeclareBlockers); blockers {
			game.apply(g, 1, types.GameAction_DeclareBlockers{})
			continue
		}
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	settle(g)
	testing.expect(t, game.player(s, 1).life == 12, "8 combat damage")
	testing.expect(t, types.pvec_len(game.player(s, 0).hand) == hand + 6, "drew 6 for the Wurm's damage, none for the Bears'")
}

@(test)
delayed_until_your_next_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// Don't Move: "Destroy all tapped creatures. Until your next turn, whenever a creature becomes tapped, destroy
	// it." It lasts through the opponent's turn and ends as its controller's next turn begins.
	testing.expect(t, game.card_supported(&card(t, "Don't Move").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 5 do add(t, g, "Plains", 0, .Battlefield)
	tapped := add(t, g, "Grizzly Bears", 1, .Battlefield)
	tapped.tapped = true
	later := add(t, g, "Grizzly Bears", 1, .Battlefield)
	last := add(t, g, "Grizzly Bears", 1, .Battlefield)
	cast_targeting(t, g, add(t, g, "Don't Move", 0, .Hand), 0)
	testing.expect(t, tapped.zone == .Graveyard && later.zone == .Battlefield, "the tapped creature destroyed")
	s.turn_number += 1
	game.begin_turn(g, 1)
	tap_now(g, later)
	game.give_priority(g, s.active_player)
	settle(g)
	testing.expect(t, later.zone == .Graveyard, "tapped on the opponent's turn: destroyed")
	s.turn_number += 1
	game.begin_turn(g, 0)
	testing.expect(t, len(s.delayed_triggers) == 0, "ended as its controller's turn began")
	tap_now(g, last)
	game.give_priority(g, s.active_player)
	settle(g)
	testing.expect(t, last.zone == .Battlefield, "tapped afterwards: stays")
}

// ---- Damage ----------------------------------------------------------------------------------------------------

@(test)
damage_excess_to_the_creatures_controller :: proc(t: ^testing.T) {
	if !load_db() do return
	// Flame Spill: "Flame Spill deals 4 damage to target creature. Excess damage is dealt to that creature's
	// controller instead." CR 120.4a: the excess over lethal damage, counting damage already marked, goes to the
	// controller; with none in excess, the controller is dealt nothing.
	testing.expect(t, game.card_supported(&card(t, "Flame Spill").face))
	for big in ([]bool{false, true}) {
		g := new_game()
		s := &g.state
		for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
		victim := add(t, g, "Craw Wurm" if big else "Grizzly Bears", 1, .Battlefield)
		if !big do victim.damage_marked = 1 // lethal damage is now 1
		cast_targeting(t, g, add(t, g, "Flame Spill", 0, .Hand), victim.id)
		testing.expect(t, victim.zone == .Graveyard, "the creature died")
		if big do testing.expect(t, game.player(s, 1).life == 20, "4 damage to a 6/4: none in excess")
		else do testing.expect(t, game.player(s, 1).life == 17, "1 was lethal: 3 to its controller")
	}
}

@(test)
damage_excess_with_trample_only :: proc(t: ^testing.T) {
	if !load_db() do return
	// Ram Through: "Target creature you control deals damage equal to its power to target creature you don't
	// control. If the creature you control has trample, excess damage is dealt to that creature's controller
	// instead." (CR 120.4a.)
	testing.expect(t, game.card_supported(&card(t, "Ram Through").face))
	for trample in ([]bool{true, false}) {
		g := new_game()
		s := &g.state
		for _ in 0 ..< 2 do add(t, g, "Forest", 0, .Battlefield)
		mine := add(t, g, "Colossal Dreadmaw" if trample else "Craw Wurm", 0, .Battlefield) // 6/6 trample; 6/4
		bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
		spell := add(t, g, "Ram Through", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
		pick(t, g, mine.id)
		pick(t, g, bears.id)
		settle(g)
		testing.expect(t, bears.zone == .Graveyard, "the Bears died")
		if trample do testing.expect(t, game.player(s, 1).life == 16, "6 to a 2/2 with trample: 4 to its controller")
		else do testing.expect(t, game.player(s, 1).life == 20, "without trample: nothing to its controller")
	}
}

@(test)
damage_equal_to_twice_its_power :: proc(t: ^testing.T) {
	if !load_db() do return
	// Punishing Punch: "Target creature you control deals damage equal to twice its power to target creature an
	// opponent controls." A 2/2 deals 4 (CR 608.2h: its power as the spell resolves).
	testing.expect(t, game.card_supported(&card(t, "Punishing Punch").face))
	g := new_game()
	for _ in 0 ..< 3 do add(t, g, "Forest", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	wurm := add(t, g, "Craw Wurm", 1, .Battlefield) // 6/4
	spell := add(t, g, "Punishing Punch", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	pick(t, g, bears.id)
	pick(t, g, wurm.id)
	settle(g)
	testing.expect(t, wurm.zone == .Graveyard, "4 damage to the 6/4")
	testing.expect(t, bears.zone == .Battlefield && bears.damage_marked == 0, "a one-sided fight")
}

@(test)
damage_to_what_it_attacks :: proc(t: ^testing.T) {
	if !load_db() do return
	// Hellrider: "Whenever a creature you control attacks, this creature deals 1 damage to the player or
	// planeswalker it's attacking." Each attacker's own (Hellrider's ruling); still dealt once the attacker has left
	// combat (Raid Bombardment's ruling, CR 506.4).
	testing.expect(t, game.card_supported(&card(t, "Hellrider").face))
	g := new_game()
	s := &g.state
	rider := add(t, g, "Hellrider", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	jace := add(t, g, "Jace Beleren", 1, .Battlefield)
	jace.loyalty = 3
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{rider.id, types.AttackTarget_Player{1}}, {bears.id, types.AttackTarget_Planeswalker{jace.id}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	testing.expect(t, types.pvec_len(s.stack) == 2, "a trigger for each attacker")
	game.move_object(g, bears.id, .Graveyard) // the Bears leave combat before the triggers resolve
	settle(g)
	testing.expect(t, game.player(s, 1).life == 19, "1 to the attacked player")
	testing.expect(t, jace.loyalty.? == 2, "1 to the attacked planeswalker, its attacker gone")
}

@(test)
damage_to_defending_player :: proc(t: ^testing.T) {
	if !load_db() do return
	// Falkenrath Perforator: "Whenever this creature attacks, it deals 1 damage to defending player." CR 506.2: in a
	// two-player game, the nonactive player.
	testing.expect(t, game.card_supported(&card(t, "Falkenrath Perforator").face))
	g := new_game()
	s := &g.state
	vamp := add(t, g, "Falkenrath Perforator", 0, .Battlefield)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{vamp.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	settle(g)
	testing.expect(t, game.player(s, 1).life == 19 && game.player(s, 0).life == 20, "1 to the defending player")
}

@(test)
target_creature_defending_player_controls :: proc(t: ^testing.T) {
	if !load_db() do return
	// Fiend Binder: "Whenever this creature attacks, tap target creature defending player controls." CR 506.2: the
	// nonactive player's creatures are the legal targets, not the attacker's own.
	testing.expect(t, game.card_supported(&card(t, "Fiend Binder").face))
	g := new_game()
	s := &g.state
	binder := add(t, g, "Fiend Binder", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{binder.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	settle(g)
	testing.expect(t, theirs.tapped && !mine.tapped, "the defending player's creature tapped, the only legal target")
	_ = s
}

// ---- Destroy ---------------------------------------------------------------------------------------------------

@(test)
destroy_a_creature_dealt_damage_this_turn :: proc(t: ^testing.T) {
	if !load_db() do return
	// Mirrodin Avenged: "Destroy target creature that was dealt damage this turn." Only such a creature is a legal
	// target (CR 115.1); one that has left the battlefield and come back is a new object, never dealt damage (CR
	// 400.7).
	testing.expect(t, game.card_supported(&card(t, "Mirrodin Avenged").face))
	g := new_game()
	s := &g.state
	add(t, g, "Mountain", 0, .Battlefield)
	add(t, g, "Swamp", 0, .Battlefield)
	wurm := add(t, g, "Craw Wurm", 1, .Battlefield)
	blinked := add(t, g, "Hill Giant", 1, .Battlefield)
	add(t, g, "Grizzly Bears", 1, .Battlefield) // never dealt damage
	cast_targeting(t, g, add(t, g, "Shock", 0, .Hand), wurm.id)
	game.deal_damage(g, wurm.id, types.TargetRef_Object{blinked.id}, 1)
	game.move_object(g, blinked.id, .Exile)
	game.move_object(g, blinked.id, .Battlefield)
	game.give_priority(g, 0)
	spell := add(t, g, "Mirrodin Avenged", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	w, asked := s.waiting_for.(types.WaitingFor_TargetSelection)
	if asked {
		testing.expect(t, len(w.selection.current_legal_targets) == 1, "only the creature dealt damage this turn")
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{wurm.id}}))
	}
	settle(g)
	testing.expect(t, wurm.zone == .Graveyard, "destroyed")
}

@(test)
destroy_the_creature_it_dealt_damage_to :: proc(t: ^testing.T) {
	if !load_db() do return
	// Vampire Slayer: "Whenever this creature deals damage to a Vampire, destroy that creature." "That creature" is
	// the one dealt damage (CR 603.2, 608.2c); damage to another creature doesn't trigger it.
	testing.expect(t, game.card_supported(&card(t, "Vampire Slayer").face))
	for vampire in ([]bool{true, false}) {
		g := new_game()
		slayer := add(t, g, "Vampire Slayer", 0, .Battlefield)
		victim := add(t, g, "Vampire Nighthawk" if vampire else "Craw Wurm", 1, .Battlefield)
		game.deal_damage(g, slayer.id, types.TargetRef_Object{victim.id}, 1)
		game.give_priority(g, 0)
		settle(g)
		if vampire do testing.expect(t, victim.zone == .Graveyard, "the Vampire destroyed")
		else do testing.expect(t, victim.zone == .Battlefield, "not a Vampire: no trigger")
	}
}

@(test)
destroy_it_cant_be_regenerated :: proc(t: ^testing.T) {
	if !load_db() do return
	// Terminate: "Destroy target creature. It can't be regenerated." CR 701.19c: it stops regeneration shields from
	// applying; no effect this engine supports makes one, so it destroys like any destroy.
	testing.expect(t, game.card_supported(&card(t, "Terminate").face))
	testing.expect(t, game.card_supported(&card(t, "Wrath of God").face))
	g := new_game()
	add(t, g, "Swamp", 0, .Battlefield)
	add(t, g, "Mountain", 0, .Battlefield)
	wurm := add(t, g, "Craw Wurm", 1, .Battlefield)
	cast_targeting(t, g, add(t, g, "Terminate", 0, .Hand), wurm.id)
	testing.expect(t, wurm.zone == .Graveyard, "destroyed")
}

// ---- More shapes the changes above made supported, and their refusals ------------------------------------------

@(test)
delayed_sacrifice_that_copy_token :: proc(t: ^testing.T) {
	if !load_db() do return
	// The Fire Crystal: "{4}{R}{R}, {T}: Create a token that's a copy of target creature you control. Sacrifice it at
	// the beginning of the next end step." (CR 707.2, 603.7c: the copy, not the original.)
	testing.expect(t, game.card_supported(&card(t, "The Fire Crystal").face))
	{
		g := new_game()
		s := &g.state
		for _ in 0 ..< 6 do add(t, g, "Mountain", 0, .Battlefield)
		crystal := add(t, g, "The Fire Crystal", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
		testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = crystal.id, ability_index = 0}))
		if _, asked := s.waiting_for.(types.WaitingFor_TargetSelection); asked {
			game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}})
		}
		settle(g)
		testing.expect(t, len(tokens_of(g, 0)) == 1 && len(s.delayed_triggers) == 1, "a copy, its sacrifice waiting")
		game.begin_step(g, .End)
		settle(g)
		testing.expect(t, len(tokens_of(g, 0)) == 0 && bears.zone == .Battlefield, "the copy sacrificed, the original stays")
	}
}

@(test)
damage_to_each_creature_defending_player_controls :: proc(t: ^testing.T) {
	if !load_db() do return
	// Swathcutter Giant: "Whenever this creature attacks, it deals 1 damage to each creature defending player
	// controls." CR 506.2: the nonactive player's; the attacker's own creatures aren't dealt damage.
	testing.expect(t, game.card_supported(&card(t, "Swathcutter Giant").face))
	g := new_game()
	giant := add(t, g, "Swathcutter Giant", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g, "Craw Wurm", 1, .Battlefield)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{giant.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	settle(g)
	testing.expect(t, theirs.damage_marked == 1 && mine.damage_marked == 0 && giant.damage_marked == 0, "only the defending player's creature")
}

@(test)
costs_that_read_this_turns_damage :: proc(t: ^testing.T) {
	if !load_db() do return
	// Treacherous Greed: "As an additional cost to cast this spell, sacrifice a creature that dealt damage this turn."
	// Bitter Downfall: "This spell costs {3} less to cast if it targets a creature that was dealt damage this turn."
	// (CR 601.2b, 601.2f; the turn's damage, CR 120.3.)
	testing.expect(t, game.card_supported(&card(t, "Treacherous Greed").face))
	testing.expect(t, game.card_supported(&card(t, "Bitter Downfall").face))
	{
		g := new_game()
		s := &g.state
		add(t, g, "Plains", 0, .Battlefield)
		add(t, g, "Swamp", 0, .Battlefield)
		add(t, g, "Swamp", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
		wurm := add(t, g, "Craw Wurm", 1, .Battlefield)
		greed := add(t, g, "Treacherous Greed", 0, .Hand)
		testing.expect(t, !game.castable(s, 0, greed, g.card_db), "no creature of theirs dealt damage this turn")
		game.deal_damage(g, bears.id, types.TargetRef_Object{wurm.id}, 1)
		testing.expect(t, game.castable(s, 0, greed, g.card_db), "the Bears dealt damage: castable")
	}
	{
		g := new_game()
		s := &g.state
		add(t, g, "Swamp", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
		wurm := add(t, g, "Craw Wurm", 1, .Battlefield)
		downfall := add(t, g, "Bitter Downfall", 0, .Hand)
		testing.expect(t, !game.castable(s, 0, downfall, g.card_db), "{3}{B} with one Swamp: not castable")
		game.deal_damage(g, bears.id, types.TargetRef_Object{wurm.id}, 1)
		testing.expect(t, game.castable(s, 0, downfall, g.card_db), "targeting the damaged Wurm it costs {B}")
	}
}

@(test)
delayed_shapes_still_refused :: proc(t: ^testing.T) {
	if !load_db() do return
	// Cards whose data splits or drops part of what the delayed ability does, or whose other parts aren't carried
	// out right, stay unsupported: Thunder of Unity's "and you gain 1 life" and The Naked Time's "and it gains haste"
	// sit outside their "whenever ... this turn" abilities; Nahiri's Resolve reads "exile any number of" as targets;
	// Barret Wallace would count creatures this equips; Rienne's "return it to its owner's hand" moves a card from a
	// graveyard, which a bounce doesn't; Time to Feed's "fights that creature" names the earlier target as the one
	// fought; Tasha Yar's "a copy of this card" is of a card its cost exiled.
	for name in ([]string{"Thunder of Unity", "The Naked Time", "Nahiri's Resolve", "Barret Wallace", "Rienne, Angel of Rebirth", "Time to Feed", "Tasha Yar, Out of Time"}) {
		testing.expectf(t, !game.card_supported(&card(t, name).face), "%s isn't supported", name)
	}
	// "When that creature dies" reads "this turn" from the Oracle text the data drops: the same delayed ability
	// checked as Make Your Mark's (it says "this turn") and as The Deck of Many Things' (it doesn't).
	delayed: types.Effect_CreateDelayedTrigger
	for a := &card(t, "Make Your Mark").face.abilities[0]; a != nil; a = a.sub_ability {
		if x, ok := a.effect^.(types.Effect_CreateDelayedTrigger); ok do delayed = x
	}
	game.checking_face = &card(t, "Make Your Mark").face
	testing.expect(t, game.delayed_trigger_supported(delayed, true), "dies this turn")
	game.checking_face = &card(t, "The Deck of Many Things").face
	testing.expect(t, !game.delayed_trigger_supported(delayed, true), "dies, for good: not read")
	game.checking_face = nil
}

@(test)
this_creature_fights_that_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	// Kraul Harpooner: "When this creature enters, choose up to one target creature you don't control with flying.
	// This creature gets +X/+0 until end of turn, ..., then you may have this creature fight that creature." "That
	// creature" is the one chosen (CR 608.2c); CR 701.14a: each deals damage equal to its power to the other.
	testing.expect(t, game.card_supported(&card(t, "Kraul Harpooner").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 2 do add(t, g, "Forest", 0, .Battlefield)
	drake := add(t, g, "Wind Drake", 1, .Battlefield) // 2/2 flying
	kraul := add(t, g, "Kraul Harpooner", 0, .Hand) // 3/2; no creature cards in the graveyard: +0/+0
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = kraul.id}))
	for _ in 0 ..< 12 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_TriggerTargetSelection:
			testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{drake.id}}))
			continue
		case types.WaitingFor_OptionalEffectChoice:
			testing.expect(t, game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = true}))
			continue
		}
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, drake.zone == .Graveyard && kraul.zone == .Graveyard, "they fought: 3 to the Drake, 2 to the Harpooner")
}
