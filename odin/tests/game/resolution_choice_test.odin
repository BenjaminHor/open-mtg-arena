// Rules tests for what an instruction acts on without targeting it (CR 608.2d, 115.10): permanents chosen as the
// instruction resolves ("put a +1/+1 counter on a creature you control", "untap up to three lands"), the permanent an
// ability's source is attached to ("tap enchanted creature"), sacrifices ("target opponent sacrifices a creature",
// "sacrifice another creature or artifact") and tapping or untapping all of a kind. Same helpers as game_test.odin.
package game_test

import "core:testing"
import game "../../engine/game"
import types "../../engine/types"

// Passes priority until the game asks something other than priority, or the stack is empty. The question asked.
@(private = "file")
pass_until_asked :: proc(g: ^game.Game) -> types.WaitingFor {
	for _ in 0 ..< 12 {
		if _, priority := g.state.waiting_for.(types.WaitingFor_Priority); !priority do return g.state.waiting_for
		if types.pvec_len(g.state.stack) == 0 do return g.state.waiting_for
		game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
	}
	return g.state.waiting_for
}

@(private = "file")
ids :: proc(objects: ..^types.GameObject) -> [dynamic]types.ObjectId {
	out := make([dynamic]types.ObjectId, context.temp_allocator)
	for o in objects do append(&out, o.id)
	return out
}

@(private = "file")
offers :: proc(cards: []types.ObjectId, o: ^types.GameObject) -> bool {
	for id in cards do if id == o.id do return true
	return false
}

// Blood Curdle: "Destroy target creature. Put a menace counter on a creature you control." CR 115.10a: only the
// creature to destroy is a target; the one that gets the counter is chosen as the spell resolves (CR 608.2d), among
// all its controller's creatures, shroud or not (shroud stops targeting only, CR 702.18a). CR 122.1b: a menace counter
// gives menace.
@(test)
blood_curdle_counter_on_a_creature_you_control :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Blood Curdle").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 4 do add(t, g, "Swamp", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	enchantress := add(t, g, "Argothian Enchantress", 0, .Battlefield) // shroud
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	other := add(t, g, "Hill Giant", 1, .Battlefield)
	curdle := add(t, g, "Blood Curdle", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = curdle.id}))
	w, targeting := s.waiting_for.(types.WaitingFor_TargetSelection)
	testing.expect(t, targeting && len(w.target_slots) == 1, "one target: the creature to destroy")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{theirs.id}}))
	choice, asked := pass_until_asked(g).(types.WaitingFor_ChooseFromZoneChoice)
	testing.expect(t, asked, "the creature for the counter is chosen as it resolves")
	if !asked do return
	testing.expect(t, theirs.zone == .Graveyard, "the target was destroyed first")
	testing.expect(t, choice.player == 0 && choice.count == 1 && !choice.up_to && len(choice.cards) == 2, "one of its controller's two creatures")
	testing.expect(t, offers(choice.cards[:], bears) && offers(choice.cards[:], enchantress), "shroud doesn't stop a choice")
	testing.expect(t, !game.apply(g, 0, types.GameAction_SelectCards{cards = ids(other)}), "not the opponent's creature")
	testing.expect(t, !game.apply(g, 0, types.GameAction_SelectCards{}), "one must be chosen")
	testing.expect(t, !game.apply(g, 1, types.GameAction_SelectCards{cards = ids(bears)}), "its controller chooses")
	// The AI puts a counter that helps on its own creature.
	if action, ok := game.ai_action(g, 0); ok {
		pick, is_pick := action.(types.GameAction_SelectCards)
		testing.expect(t, is_pick && len(pick.cards) == 1 && (pick.cards[0] == bears.id || pick.cards[0] == enchantress.id), "the AI picks one of its own")
	}
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = ids(enchantress)}))
	menace := types.CounterType(types.CounterType_Keyword{.Menace})
	testing.expect(t, game.counter_count(enchantress, menace) == 1 && game.counter_count(bears, menace) == 0, "the counter on the chosen creature")
	testing.expect(t, curdle.zone == .Graveyard && types.pvec_len(s.stack) == 0, "the spell finished resolving")

	// Without a creature of its own, the rest still happens: the target is destroyed (CR 609.3).
	g2 := new_game()
	for _ in 0 ..< 4 do add(t, g2, "Swamp", 0, .Battlefield)
	theirs2 := add(t, g2, "Grizzly Bears", 1, .Battlefield)
	curdle2 := add(t, g2, "Blood Curdle", 0, .Hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = curdle2.id}))
	testing.expect(t, game.apply(g2, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{theirs2.id}}))
	_, still_priority := pass_until_asked(g2).(types.WaitingFor_Priority)
	testing.expect(t, still_priority && theirs2.zone == .Graveyard && game.counter_count(theirs2, menace) == 0, "nothing to choose, no counter")
}

// Frantic Search: "Draw two cards, then discard two cards. Untap up to three lands." CR 701.26b: the lands are chosen
// as the spell resolves, any lands (not only its controller's), up to three (none is a choice too).
@(test)
frantic_search_untaps_up_to_three_lands :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Frantic Search").face))
	g := new_game()
	s := &g.state
	islands := [4]^types.GameObject{}
	for &l in islands do l = add(t, g, "Island", 0, .Battlefield)
	theirs := add(t, g, "Forest", 1, .Battlefield)
	theirs.tapped = true
	search := add(t, g, "Frantic Search", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = search.id}))
	asked_untap: types.WaitingFor_EffectZoneChoice
	for _ in 0 ..< 8 {
		#partial switch w in pass_until_asked(g) {
		case types.WaitingFor_DiscardChoice:
			two := make([dynamic]types.ObjectId, context.temp_allocator)
			append(&two, w.cards[0], w.cards[1])
			testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = two}))
			continue
		case types.WaitingFor_EffectZoneChoice:
			asked_untap = w
		}
		break
	}
	w := asked_untap
	testing.expect(t, w.effect_kind == .Untap && w.player == 0 && w.count == 3 && w.min_count == 0 && w.up_to, "up to three to untap")
	testing.expect(t, len(w.cards) == 5 && offers(w.cards[:], theirs), "any land, the opponent's too")
	if w.effect_kind != .Untap do return
	tapped := make([dynamic]^types.GameObject, context.temp_allocator)
	for l in islands do if l.tapped do append(&tapped, l)
	testing.expect(t, len(tapped) == 3, "three Islands paid for it")
	// The AI untaps its own tapped lands, not the opponent's.
	if action, ok := game.ai_action(g, 0); ok {
		pick, _ := action.(types.GameAction_SelectCards)
		mine := 0
		for id in pick.cards do for l in tapped do if l.id == id do mine += 1
		testing.expect(t, len(pick.cards) == 3 && mine == 3, "the AI untaps its own three")
	}
	testing.expect(t, !game.apply(g, 0, types.GameAction_SelectCards{cards = ids(islands[0], islands[1], islands[2], islands[3])}), "not four")
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = ids(tapped[0], tapped[1])}))
	testing.expect(t, !tapped[0].tapped && !tapped[1].tapped && tapped[2].tapped && theirs.tapped, "the two chosen untapped")
	testing.expect(t, search.zone == .Graveyard && types.pvec_len(s.stack) == 0)
}

// Bitter Chill: "When this Aura enters, tap enchanted creature." CR 303.4, 115.10a: "enchanted creature" isn't a
// target; it's the permanent the Aura is attached to. CR 608.2h: when the Aura has left the battlefield before the
// ability resolves, it's what the Aura was attached to as it last existed there, while that's the same object (CR
// 400.7).
@(test)
bitter_chill_taps_enchanted_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Bitter Chill").face))
	cast_chill :: proc(t: ^testing.T, g: ^game.Game, host: ^types.GameObject) -> ^types.GameObject {
		for _ in 0 ..< 2 do add(t, g, "Island", 0, .Battlefield)
		chill := add(t, g, "Bitter Chill", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = chill.id}))
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{host.id}}))
		// The Aura resolves; its enters ability goes on the stack.
		for _ in 0 ..< 4 {
			if chill.zone == .Battlefield do break
			game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
		}
		testing.expect(t, chill.zone == .Battlefield && types.pvec_len(g.state.stack) == 1, "the Aura's trigger waits on the stack")
		return chill
	}
	g := new_game()
	scout := add(t, g, "Gladecover Scout", 1, .Battlefield) // hexproof: an Aura spell can't target it...
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	chill := cast_chill(t, g, bears)
	_, priority := pass_until_asked(g).(types.WaitingFor_Priority)
	testing.expect(t, priority && bears.tapped && !scout.tapped, "the enchanted creature tapped, nothing asked")
	testing.expect(t, game.host_of(&g.state, chill) == bears)

	// The Aura destroyed in response: the creature it enchanted is still tapped.
	g2 := new_game()
	bears2 := add(t, g2, "Grizzly Bears", 1, .Battlefield)
	chill2 := cast_chill(t, g2, bears2)
	game.move_object(g2, chill2.id, .Graveyard)
	pass_until_asked(g2)
	testing.expect(t, bears2.tapped, "what it was attached to (CR 608.2h)")

	// The Aura gone and the creature blinked: a new object, which the ability doesn't know (CR 400.7).
	g3 := new_game()
	bears3 := add(t, g3, "Grizzly Bears", 1, .Battlefield)
	chill3 := cast_chill(t, g3, bears3)
	game.move_object(g3, chill3.id, .Graveyard)
	game.move_object(g3, bears3.id, .Exile)
	game.move_object(g3, bears3.id, .Battlefield)
	pass_until_asked(g3)
	testing.expect(t, bears3.zone == .Battlefield && !bears3.tapped, "not the new object")
}

// Path to Redemption: "{5}, Sacrifice this Aura: Exile enchanted creature. Create a 1/1 white Ally creature token.
// Activate only during your turn." The Aura is gone by the time the ability resolves (sacrificed as a cost, CR
// 602.2c, 601.2h), so "enchanted creature" is the creature it was attached to (CR 608.2h). Cooped Up: "{2}{W}: Exile
// enchanted creature": no targeting, so hexproof doesn't stop it (CR 115.10a, 702.11a).
@(test)
aura_exiles_enchanted_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Path to Redemption").face))
	testing.expect(t, game.card_supported(&card(t, "Cooped Up").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 5 do add(t, g, "Plains", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	path := add(t, g, "Path to Redemption", 0, .Battlefield)
	game.attach(s, path, bears)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = path.id, ability_index = 0}))
	testing.expect(t, path.zone == .Graveyard, "sacrificed as the cost")
	pass_until_asked(g)
	testing.expect(t, bears.zone == .Exile, "the creature it enchanted is exiled")
	allies := 0
	for id in game.ids_of(s.battlefield) do if o := game.object(s, id); o.is_token && o.controller == 0 do allies += 1
	testing.expect(t, allies == 1, "and the Ally made")

	g2 := new_game()
	for _ in 0 ..< 3 do add(t, g2, "Plains", 0, .Battlefield)
	scout := add(t, g2, "Gladecover Scout", 1, .Battlefield)
	cooped := add(t, g2, "Cooped Up", 0, .Battlefield)
	game.attach(&g2.state, cooped, scout)
	testing.expect(t, game.apply(g2, 0, types.GameAction_ActivateAbility{source_id = cooped.id, ability_index = 0}))
	pass_until_asked(g2)
	testing.expect(t, scout.zone == .Exile, "the hexproof creature it enchants is exiled")

	// Negative: the Aura and the creature gone before it resolves (the creature a new object): nothing exiled.
	g3 := new_game()
	for _ in 0 ..< 5 do add(t, g3, "Plains", 0, .Battlefield)
	bears3 := add(t, g3, "Grizzly Bears", 1, .Battlefield)
	path3 := add(t, g3, "Path to Redemption", 0, .Battlefield)
	game.attach(&g3.state, path3, bears3)
	testing.expect(t, game.apply(g3, 0, types.GameAction_ActivateAbility{source_id = path3.id, ability_index = 0}))
	game.move_object(g3, bears3.id, .Hand)
	game.move_object(g3, bears3.id, .Battlefield)
	pass_until_asked(g3)
	testing.expect(t, bears3.zone == .Battlefield, "the new object isn't the creature it enchanted (CR 400.7)")
}

// Wicked Guardian: "When this creature enters, you may have it deal 2 damage to another creature you control. If
// you do, draw a card." CR 608.2d: the creature is chosen as the ability resolves; with no other creature the option
// can't be chosen, so there's no card either.
@(test)
wicked_guardian_damages_another_creature_you_control :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Wicked Guardian").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 4 do add(t, g, "Swamp", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	giant := add(t, g, "Hill Giant", 0, .Battlefield)
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	guardian := add(t, g, "Wicked Guardian", 0, .Hand)
	hand := types.pvec_len(game.player(s, 0).hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = guardian.id}))
	asked_may := 0
	for _ in 0 ..< 4 {
		if _, may := pass_until_asked(g).(types.WaitingFor_OptionalEffectChoice); !may do break
		asked_may += 1
		testing.expect(t, game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = true}))
	}
	testing.expect_value(t, asked_may, 1) // "you may", asked once
	choice, asked := s.waiting_for.(types.WaitingFor_ChooseFromZoneChoice)
	testing.expect(t, asked && len(choice.cards) == 2 && offers(choice.cards[:], bears) && offers(choice.cards[:], giant), "another creature you control")
	if !asked do return
	testing.expect(t, !offers(choice.cards[:], guardian) && !offers(choice.cards[:], theirs))
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = ids(bears)}))
	pass_until_asked(g)
	testing.expect(t, bears.zone == .Graveyard && giant.damage_marked == 0, "2 damage to the chosen creature")
	testing.expect(t, types.pvec_len(game.player(s, 0).hand) == hand, "cast one card, drew one")

	g2 := new_game()
	for _ in 0 ..< 4 do add(t, g2, "Swamp", 0, .Battlefield)
	add(t, g2, "Grizzly Bears", 1, .Battlefield)
	guardian2 := add(t, g2, "Wicked Guardian", 0, .Hand)
	hand2 := types.pvec_len(game.player(&g2.state, 0).hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = guardian2.id}))
	_, priority := pass_until_asked(g2).(types.WaitingFor_Priority)
	testing.expect(t, priority && types.pvec_len(g2.state.stack) == 0, "nothing asked: no other creature of its controller's")
	testing.expect(t, types.pvec_len(game.player(&g2.state, 0).hand) == hand2 - 1, "and no card")
}

// Ajani Fells the Godsire, chapter II: "Create a 2/1 white Cat Warrior creature token, then put a vigilance counter on
// a creature you control." CR 608.2c-d: the instructions are carried out in order, so the token just made can be the
// one chosen.
@(test)
ajani_saga_counter_on_the_token_just_made :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Ajani Fells the Godsire").face))
	g := new_game()
	s := &g.state
	saga := add(t, g, "Ajani Fells the Godsire", 0, .Battlefield)
	game.add_counters(saga, types.CounterType_Lore{}, 1)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	game.begin_step(g, .PreCombatMain) // chapter II
	choice, asked := pass_until_asked(g).(types.WaitingFor_ChooseFromZoneChoice)
	testing.expect(t, asked && len(choice.cards) == 2 && offers(choice.cards[:], bears), "the Bears or the new token")
	if !asked do return
	token: ^types.GameObject
	for id in choice.cards do if o := game.object(s, id); o.is_token do token = o
	testing.expect(t, token != nil, "the token is offered")
	if token == nil do return
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = ids(token)}))
	testing.expect(t, game.counter_count(token, types.CounterType_Keyword{.Vigilance}) == 1 && game.keyword_in(token, types.Keyword_Vigilance{}), "a vigilance counter gives vigilance (CR 122.1b)")
}

// Chainer's Edict: "Target player sacrifices a creature of their choice." CR 115.1: the player is the target; CR
// 701.21a, 608.2d: that player sacrifices one of their own creatures, chosen by them as the spell resolves. Hexproof on
// a creature doesn't matter: it isn't targeted (CR 702.11a). Run Afoul ("... a creature of their choice with flying"):
// only a creature that fits can be chosen; with one, there's no choice; with none, nothing happens.
@(test)
edict_target_player_sacrifices :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Chainer's Edict").face))
	testing.expect(t, game.card_supported(&card(t, "Run Afoul").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 2 do add(t, g, "Swamp", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	scout := add(t, g, "Gladecover Scout", 1, .Battlefield) // hexproof
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	edict := add(t, g, "Chainer's Edict", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = edict.id}))
	w, targeting := s.waiting_for.(types.WaitingFor_TargetSelection)
	testing.expect(t, targeting, "a target player")
	if !targeting do return
	legal := w.selection.current_legal_targets[:]
	testing.expect(t, len(legal) == 2, "either player: the target is a player, not a creature")
	for l in legal {
		_, is_player := l.(types.TargetRef_Player)
		testing.expect(t, is_player)
	}
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	choice, asked := pass_until_asked(g).(types.WaitingFor_EffectZoneChoice)
	testing.expect(t, asked && choice.effect_kind == .Sacrifice && choice.player == 1 && choice.count == 1, "the target player chooses")
	if !asked do return
	testing.expect(t, len(choice.cards) == 2 && offers(choice.cards[:], scout) && offers(choice.cards[:], bears), "their own two creatures")
	testing.expect(t, !game.apply(g, 0, types.GameAction_SelectCards{cards = ids(scout)}), "not the caster's choice")
	testing.expect(t, !game.apply(g, 1, types.GameAction_SelectCards{cards = ids(mine)}), "not the caster's creature")
	testing.expect(t, game.apply(g, 1, types.GameAction_SelectCards{cards = ids(scout)}))
	testing.expect(t, scout.zone == .Graveyard && bears.zone == .Battlefield && mine.zone == .Battlefield, "the hexproof one, as chosen")

	g2 := new_game()
	add(t, g2, "Forest", 0, .Battlefield)
	angel := add(t, g2, "Serra Angel", 1, .Battlefield) // flying
	ground := add(t, g2, "Grizzly Bears", 1, .Battlefield)
	afoul := add(t, g2, "Run Afoul", 0, .Hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = afoul.id}))
	w2, targeting2 := g2.state.waiting_for.(types.WaitingFor_TargetSelection)
	testing.expect(t, targeting2 && len(w2.selection.current_legal_targets) == 1, "target opponent: only the opponent")
	if game.apply(g2, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}) {
		_, priority := pass_until_asked(g2).(types.WaitingFor_Priority)
		testing.expect(t, priority && angel.zone == .Graveyard && ground.zone == .Battlefield, "the one creature with flying, no choice asked")
	}

	g3 := new_game()
	add(t, g3, "Forest", 0, .Battlefield)
	ground3 := add(t, g3, "Grizzly Bears", 1, .Battlefield)
	afoul3 := add(t, g3, "Run Afoul", 0, .Hand)
	testing.expect(t, game.apply(g3, 0, types.GameAction_CastSpell{object_id = afoul3.id}))
	game.apply(g3, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}})
	pass_until_asked(g3)
	testing.expect(t, ground3.zone == .Battlefield && afoul3.zone == .Graveyard, "no creature with flying: nothing sacrificed")
}

// The Sackville-Bagginses: "When The Sackville-Bagginses enter, you may sacrifice another creature or artifact. If
// you do, draw a card and create a Treasure token." CR 701.21a: one of its controller's own permanents of either kind.
// CR 608.2d: with none, the option can't be chosen, so nothing else happens either (CR 608.2c).
@(test)
sacrifice_another_creature_or_artifact :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "The Sackville-Bagginses").face))
	cast_bagginses :: proc(t: ^testing.T, g: ^game.Game) -> ^types.GameObject {
		for _ in 0 ..< 2 do add(t, g, "Swamp", 0, .Battlefield)
		o := add(t, g, "The Sackville-Bagginses", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = o.id}))
		return o
	}
	g := new_game()
	s := &g.state
	stone := add(t, g, "Mind Stone", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	anthem := add(t, g, "Glorious Anthem", 0, .Battlefield)
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	hobbits := cast_bagginses(t, g)
	hand := types.pvec_len(game.player(s, 0).hand)
	choice: types.WaitingFor_EffectZoneChoice
	asked := false
	asked_may := 0
	for _ in 0 ..< 6 {
		#partial switch w in pass_until_asked(g) {
		case types.WaitingFor_OptionalEffectChoice:
			asked_may += 1
			testing.expect(t, game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = true}))
			continue
		case types.WaitingFor_EffectZoneChoice:
			choice, asked = w, true
		}
		break
	}
	testing.expect_value(t, asked_may, 1) // "you may", asked once
	testing.expect(t, asked && choice.effect_kind == .Sacrifice && len(choice.cards) == 2, "the artifact or the other creature")
	if !asked do return
	testing.expect(t, offers(choice.cards[:], stone) && offers(choice.cards[:], bears), "either kind")
	testing.expect(t, !offers(choice.cards[:], hobbits) && !offers(choice.cards[:], anthem) && !offers(choice.cards[:], theirs), "not itself, an enchantment or the opponent's")
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = ids(stone)}))
	pass_until_asked(g)
	treasures := 0
	for id in game.ids_of(s.battlefield) do if o := game.object(s, id); o.is_token && game.has_subtype(o, "Treasure") do treasures += 1
	testing.expect(t, stone.zone == .Graveyard && bears.zone == .Battlefield, "the artifact sacrificed")
	testing.expect(t, types.pvec_len(game.player(s, 0).hand) == hand + 1 && treasures == 1, "a card and a Treasure")

	g2 := new_game()
	add(t, g2, "Glorious Anthem", 0, .Battlefield)
	cast_bagginses(t, g2)
	hand2 := types.pvec_len(game.player(&g2.state, 0).hand)
	for _ in 0 ..< 6 {
		_, may := pass_until_asked(g2).(types.WaitingFor_OptionalEffectChoice)
		if !may do break
		game.apply(g2, 0, types.GameAction_DecideOptionalEffect{accept = true})
	}
	_, priority := g2.state.waiting_for.(types.WaitingFor_Priority)
	testing.expect(t, priority && types.pvec_len(g2.state.stack) == 0, "nothing to sacrifice: nothing asked")
	testing.expect(t, types.pvec_len(game.player(&g2.state, 0).hand) == hand2, "no card")
}

// Demon's Disciple: "When this creature enters, each player sacrifices a creature or planeswalker of their choice."
// CR 101.4: each player in turn order chooses one of their own (CR 701.21a), a planeswalker as well as a creature.
@(test)
each_player_sacrifices_a_creature_or_planeswalker :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Demon's Disciple").face))
	g := new_game()
	for _ in 0 ..< 3 do add(t, g, "Swamp", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	jace := add(t, g, "Jace Beleren", 1, .Battlefield)
	jace.loyalty = 3
	giant := add(t, g, "Hill Giant", 1, .Battlefield)
	disciple := add(t, g, "Demon's Disciple", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = disciple.id}))
	asked := [2]bool{}
	for _ in 0 ..< 6 {
		w, choosing := pass_until_asked(g).(types.WaitingFor_EffectZoneChoice)
		if !choosing do break
		asked[w.player] = true
		if w.player == 0 {
			testing.expect(t, len(w.cards) == 2 && offers(w.cards[:], bears) && offers(w.cards[:], disciple), "its controller's two creatures")
			testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = ids(bears)}))
		} else {
			testing.expect(t, len(w.cards) == 2 && offers(w.cards[:], jace) && offers(w.cards[:], giant), "a creature or a planeswalker")
			testing.expect(t, game.apply(g, 1, types.GameAction_SelectCards{cards = ids(jace)}))
		}
	}
	testing.expect(t, asked[0] && asked[1], "both players chose")
	testing.expect(t, bears.zone == .Graveyard && disciple.zone == .Battlefield && jace.zone == .Graveyard && giant.zone == .Battlefield)
}

// Subjugator Angel: "When this creature enters, tap all creatures your opponents control." CR 701.26a: each of them,
// none of its controller's.
@(test)
tap_all_creatures_your_opponents_control :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Subjugator Angel").face))
	g := new_game()
	for _ in 0 ..< 6 do add(t, g, "Plains", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := [2]^types.GameObject{add(t, g, "Grizzly Bears", 1, .Battlefield), add(t, g, "Gladecover Scout", 1, .Battlefield)}
	land := add(t, g, "Forest", 1, .Battlefield)
	angel := add(t, g, "Subjugator Angel", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = angel.id}))
	for _ in 0 ..< 6 do if types.pvec_len(g.state.stack) > 0 do game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, angel.zone == .Battlefield && types.pvec_len(g.state.stack) == 0)
	testing.expect(t, theirs[0].tapped && theirs[1].tapped, "the opponent's creatures, hexproof or not")
	testing.expect(t, !mine.tapped && !angel.tapped && !land.tapped, "not its controller's, nor a land")
}

// Rally to Battle: "Creatures you control get +1/+3 until end of turn. Untap them." CR 608.2c: "them" are the creatures
// the first instruction gave +1/+3, which it found as it resolved (CR 611.2c).
@(test)
untap_the_creatures_just_pumped :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Rally to Battle").face))
	g := new_game()
	for _ in 0 ..< 4 do add(t, g, "Plains", 0, .Battlefield)
	mine := [2]^types.GameObject{add(t, g, "Grizzly Bears", 0, .Battlefield), add(t, g, "Hill Giant", 0, .Battlefield)}
	for m in mine do m.tapped = true
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	theirs.tapped = true
	rally := add(t, g, "Rally to Battle", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = rally.id}))
	pass_until_asked(g)
	testing.expect(t, rally.zone == .Graveyard)
	testing.expect(t, !mine[0].tapped && !mine[1].tapped && game.toughness_of(mine[0]) == 5, "pumped and untapped")
	testing.expect(t, theirs.tapped, "not the opponent's creature")
}

// Crackling Doom: "Crackling Doom deals 2 damage to each opponent. Each opponent sacrifices a creature with the
// greatest power among creatures that player controls." CR 701.21a, 608.2d: the opponent chooses among their own
// creatures tied for the greatest power (not the caster's, however big); with one, there's no choice.
@(test)
sacrifice_the_creature_with_the_greatest_power :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Crackling Doom").face))
	cast_doom :: proc(t: ^testing.T, g: ^game.Game) -> ^types.GameObject {
		for name in ([]string{"Mountain", "Plains", "Swamp"}) do add(t, g, name, 0, .Battlefield)
		add(t, g, "Craw Wurm", 0, .Battlefield) // power 6, the caster's
		doom := add(t, g, "Crackling Doom", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = doom.id}))
		return doom
	}
	g := new_game()
	giants := [2]^types.GameObject{add(t, g, "Hill Giant", 1, .Battlefield), add(t, g, "Hill Giant", 1, .Battlefield)}
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	cast_doom(t, g)
	w, asked := pass_until_asked(g).(types.WaitingFor_EffectZoneChoice)
	testing.expect(t, asked && w.player == 1 && len(w.cards) == 2 && offers(w.cards[:], giants[0]) && offers(w.cards[:], giants[1]), "the two tied for the greatest power")
	if !asked do return
	testing.expect(t, !game.apply(g, 1, types.GameAction_SelectCards{cards = ids(bears)}), "not a smaller one")
	testing.expect(t, game.apply(g, 1, types.GameAction_SelectCards{cards = ids(giants[1])}))
	testing.expect(t, giants[1].zone == .Graveyard && giants[0].zone == .Battlefield && bears.zone == .Battlefield)
	testing.expect_value(t, game.player(&g.state, 1).life, 18)

	g2 := new_game()
	giant := add(t, g2, "Hill Giant", 1, .Battlefield)
	bears2 := add(t, g2, "Grizzly Bears", 1, .Battlefield)
	cast_doom(t, g2)
	_, priority := pass_until_asked(g2).(types.WaitingFor_Priority)
	testing.expect(t, priority && giant.zone == .Graveyard && bears2.zone == .Battlefield, "the one with the greatest power, no choice asked")
}

// Break Under Pressure: "Target opponent sacrifices a creature or planeswalker with the greatest mana value among
// creatures and planeswalkers they control. You gain 2 life." The greatest among both kinds: a planeswalker of mana
// value 3 over a creature of 2.
@(test)
edict_with_the_greatest_mana_value :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Break Under Pressure").face))
	g := new_game()
	for _ in 0 ..< 3 do add(t, g, "Swamp", 0, .Battlefield)
	jace := add(t, g, "Jace Beleren", 1, .Battlefield)
	jace.loyalty = 3
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	spell := add(t, g, "Break Under Pressure", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	_, priority := pass_until_asked(g).(types.WaitingFor_Priority)
	testing.expect(t, priority && jace.zone == .Graveyard && bears.zone == .Battlefield, "the planeswalker, mana value 3")
	testing.expect_value(t, game.player(&g.state, 0).life, 22)
}

// Demon of Loathing: "Whenever this creature deals combat damage to a player, that player sacrifices a creature of
// their choice." CR 603.2: "that player" is the player the event was about, the one dealt damage; CR 701.21a, 608.2d:
// they choose one of their own creatures (none of the attacker's).
@(test)
that_player_sacrifices_a_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Demon of Loathing").face))
	g := new_game()
	s := &g.state
	demon := add(t, g, "Demon of Loathing", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := [2]^types.GameObject{add(t, g, "Grizzly Bears", 1, .Battlefield), add(t, g, "Hill Giant", 1, .Battlefield)}
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{demon.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	asked: types.WaitingFor_EffectZoneChoice
	for i := 0; i < 20 && s.phase != .PostCombatMain; i += 1 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_DeclareBlockers:
			game.apply(g, w.player, types.GameAction_DeclareBlockers{})
		case types.WaitingFor_EffectZoneChoice:
			asked = w
			testing.expect(t, !game.apply(g, 0, types.GameAction_SelectCards{cards = ids(mine)}), "not the attacker's")
			testing.expect(t, game.apply(g, 1, types.GameAction_SelectCards{cards = ids(theirs[1])}))
		case:
			game.apply(g, s.priority_player, types.GameAction_PassPriority{})
		}
	}
	testing.expect(t, asked.player == 1 && asked.effect_kind == .Sacrifice && len(asked.cards) == 2, "the player dealt damage chooses among their two creatures")
	testing.expect(t, theirs[1].zone == .Graveyard && theirs[0].zone == .Battlefield && mine.zone == .Battlefield)
	testing.expect_value(t, game.player(s, 1).life, 13) // a 7/7
}

// Tempest Caller: "When this creature enters, tap all creatures target opponent controls." CR 115.1: the opponent is
// the target; their creatures are tapped, not its controller's.
@(test)
tap_all_creatures_target_opponent_controls :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Tempest Caller").face))
	testing.expect(t, !game.card_supported(&card(t, "Nature's Will").face), "\"that player\" is written the same way: not read as a target")
	g := new_game()
	s := &g.state
	for _ in 0 ..< 4 do add(t, g, "Island", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	theirs := add(t, g, "Hill Giant", 1, .Battlefield)
	land := add(t, g, "Forest", 1, .Battlefield)
	caller := add(t, g, "Tempest Caller", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = caller.id}))
	for _ in 0 ..< 8 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_TriggerTargetSelection:
			testing.expect(t, len(w.selection.current_legal_targets) == 1, "only the opponent")
			testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
			continue
		}
		if caller.zone == .Battlefield && types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, theirs.tapped && !land.tapped && !mine.tapped && !caller.tapped, "the target opponent's creatures only")
}

// Tenacity: "Creatures you control get +1/+1 and gain lifelink until end of turn. Untap those creatures." Virtue of
// Loyalty: "At the beginning of your end step, put a +1/+1 counter on each creature you control. Untap those
// creatures." CR 608.2c: "those creatures" are the ones the instruction before acted on.
@(test)
untap_those_creatures_after_a_continuous_effect_or_counters :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Tenacity").face))
	testing.expect(t, game.card_supported(&card(t, "Virtue of Loyalty").face))
	g := new_game()
	for _ in 0 ..< 4 do add(t, g, "Plains", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	mine.tapped = true
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	theirs.tapped = true
	tenacity := add(t, g, "Tenacity", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = tenacity.id}))
	pass_until_asked(g)
	testing.expect(t, tenacity.zone == .Graveyard && !mine.tapped && game.keyword_in(mine, types.Keyword_Lifelink{}), "pumped, lifelink, untapped")
	testing.expect(t, theirs.tapped, "not the opponent's")

	g2 := new_game()
	add(t, g2, "Virtue of Loyalty", 0, .Battlefield)
	bears := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	bears.tapped = true
	other := add(t, g2, "Grizzly Bears", 1, .Battlefield)
	other.tapped = true
	game.begin_step(g2, .End)
	pass_until_asked(g2)
	p1p1 := types.CounterType(types.CounterType_Plus1Plus1{})
	testing.expect(t, game.counter_count(bears, p1p1) == 1 && !bears.tapped, "a counter, then untapped")
	testing.expect(t, game.counter_count(other, p1p1) == 0 && other.tapped, "not the opponent's")
}

// Titan of Industry: "When this creature enters, choose two - ... Create a 4/4 green Rhino Warrior creature token. Put
// a shield counter on a creature you control." CR 700.2: the chosen modes are carried out in printed order, so the
// Rhino just made can get the shield counter, chosen as the ability resolves (CR 608.2d).
@(test)
modal_trigger_mode_chosen_as_it_resolves :: proc(t: ^testing.T) {
	if !load_db() do return
	testing.expect(t, game.card_supported(&card(t, "Titan of Industry").face))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 7 do add(t, g, "Forest", 0, .Battlefield)
	titan := add(t, g, "Titan of Industry", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = titan.id}))
	chose: types.WaitingFor_ChooseFromZoneChoice
	asked := false
	for _ in 0 ..< 10 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_AbilityModeChoice:
			modes := make([dynamic]int, context.temp_allocator)
			append(&modes, 2, 3)
			testing.expect(t, game.apply(g, 0, types.GameAction_SelectModes{indices = modes}))
			continue
		case types.WaitingFor_ChooseFromZoneChoice:
			chose, asked = w, true
		}
		if asked do break
		if types.pvec_len(s.stack) == 0 && titan.zone == .Battlefield do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, asked && len(chose.cards) == 2 && offers(chose.cards[:], titan), "the Titan or the Rhino")
	if !asked do return
	rhino: ^types.GameObject
	for id in chose.cards do if o := game.object(s, id); o.is_token do rhino = o
	testing.expect(t, rhino != nil)
	if rhino == nil do return
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = ids(rhino)}))
	shield := types.CounterType(types.CounterType_Shield{})
	testing.expect(t, game.counter_count(rhino, shield) == 1 && game.counter_count(titan, shield) == 0)
}

// Still refused. The data lost words: Feint ("blocking target attacking creature"), Riptide Chronologist ("of the
// creature type of your choice"), Wasitora ("if the player can't"), The Promise of Kahless ("all other" read as other
// than the spell). A "spell" ability on a permanent card is an ability the data didn't recognise (CR 113.3a: only
// instants and sorceries have spell abilities): Murkfiend Liege, Advancing the Spirit. A condition about "it" or about
// "equipped creature" next to "equipped creature" (Ring of Kalonia, Blade of the Bloodchief): read live, not as the
// Equipment last was. "Any opponent may sacrifice" (Desecration Demon): the order the opponents are asked in needs the
// card's rulings. "Tap all lands that player controls" (Nature's Will) is written as "target player". "Half the
// creatures they control" (Zodiark) and "that many permanents" (Phyrexian Obliterator) aren't fixed numbers.
@(test)
resolution_choice_shapes_still_refused :: proc(t: ^testing.T) {
	if !load_db() do return
	for name in ([]string{"Feint", "Riptide Chronologist", "Wasitora, Nekoru Queen", "The Promise of Kahless", "Murkfiend Liege", "Advancing the Spirit", "Ring of Kalonia", "Blade of the Bloodchief", "Desecration Demon", "Nature's Will", "Zodiark, Umbral God", "Phyrexian Obliterator"}) {
		testing.expectf(t, !game.card_supported(&card(t, name).face), "%s stays unsupported", name)
	}
}
