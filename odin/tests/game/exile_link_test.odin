// Exile linked to the object that exiled it: "exile ... until this leaves the battlefield" (CR 610.3) and "the exiled
// card" / "cards exiled with this" (CR 607.2a). odin/engine/game/exile_links.odin.
package game_test

import "core:testing"
import game "../../engine/game"
import types "../../engine/types"

// Passes priority until the stack is empty, choosing `target` for whatever asks for one and accepting "you may".
@(private = "file")
resolve_answering :: proc(t: ^testing.T, g: ^game.Game, target: types.ObjectId = 0) {
	s := &g.state
	for _ in 0 ..< 16 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_TriggerTargetSelection, types.WaitingFor_TargetSelection:
			testing.expect(t, game.apply(g, s.priority_player, types.GameAction_ChooseTarget{target = types.TargetRef_Object{target}}), "the target is legal")
			continue
		case types.WaitingFor_OptionalEffectChoice:
			testing.expect(t, game.apply(g, w.player, types.GameAction_DecideOptionalEffect{accept = true}))
			continue
		}
		if types.pvec_len(s.stack) == 0 do return
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
}

// Casts a permanent spell from player 0's hand and resolves it; its enters trigger targets `target` (accepted when
// it's a "may"). The stack is left empty.
@(private = "file")
cast_and_resolve :: proc(t: ^testing.T, g: ^game.Game, spell: ^types.GameObject, target: types.ObjectId) {
	ok := game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id})
	testing.expectf(t, ok, "the spell is cast: %v %v", spell.name, game.rejection)
	resolve_answering(t, g, target)
}

// Casts a permanent spell and lets it resolve, stopping once its enters trigger is on the stack with its target
// chosen (the stack holds just the trigger).
@(private = "file")
cast_until_trigger :: proc(t: ^testing.T, g: ^game.Game, spell: ^types.GameObject, target: types.ObjectId) {
	s := &g.state
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}), "the spell is cast")
	for _ in 0 ..< 8 {
		if _, asked := s.waiting_for.(types.WaitingFor_TriggerTargetSelection); asked {
			testing.expect(t, game.apply(g, s.priority_player, types.GameAction_ChooseTarget{target = types.TargetRef_Object{target}}), "the target is legal")
			continue
		}
		if spell.zone == .Battlefield && types.pvec_len(s.stack) == 1 do return // the trigger (its only target taken)
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, false, "the enters trigger is on the stack")
}

// A permanent leaves the battlefield as an effect or a state-based action would make it.
@(private = "file")
destroy_now :: proc(g: ^game.Game, o: ^types.GameObject) {
	game.action_events = &g.events
	game.destroy(g, o)
	game.action_events = nil
}

@(private = "file")
plains :: proc(t: ^testing.T, g: ^game.Game, n: int) {
	for _ in 0 ..< n do add(t, g, "Plains", 0, .Battlefield)
}

@(private = "file")
linked_count :: proc(g: ^game.Game, source: types.ObjectId) -> int {
	n := 0
	for l in g.state.exile_links do if l.source_id == source do n += 1
	return n
}

// The supported cards, and refusals of what isn't read: an exile made as a cost (Fear of Abduction, CR 607.2q), "all
// other cards exiled with this" (Mirror of Life Trapping: "other" than the card just exiled, which the data doesn't
// say), a duration other than "until this leaves" on a zone change (Storrev's "that wasn't put there this combat"), and
// "put all cards exiled with it onto the battlefield" (Underworld Sentinel: under the control of the player putting them
// there, CR 110.2a and its ruling, which the data doesn't tell from "under its owner's control").
@(test)
exile_link_support :: proc(t: ^testing.T) {
	if !load_db() do return
	for name in ([]string{"Banishing Light", "Journey to Nowhere", "Fiend Hunter", "Temporary Lockdown", "Bag of Holding", "Leonin Relic-Warder", "Chained to the Rocks", "Endless Sands"}) {
		testing.expectf(t, game.card_supported(&card(t, name).face), "%s is supported", name)
	}
	for name in ([]string{"Fear of Abduction", "Mirror of Life Trapping", "Storrev, Devkarin Lich", "Mysterious Limousine", "Underworld Sentinel"}) {
		testing.expectf(t, !game.card_supported(&card(t, name).face), "%s is refused", name)
	}
}

// CR 610.3, 610.3c, 400.7: Banishing Light exiles the permanent until it leaves; then the card returns at once, a new
// object (no counters, summoning sick) under its owner's control, even though another player controlled it.
@(test)
banishing_light_returns_the_card_as_a_new_object :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 3)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield) // owned by player 0, controlled by player 1
	bears.controller = 1
	game.add_counters(bears, types.CounterType_Plus1Plus1{}, 1)
	light := add(t, g, "Banishing Light", 0, .Hand)
	cast_and_resolve(t, g, light, bears.id)
	testing.expect(t, bears.zone == .Exile, "the Bears are exiled")
	testing.expect(t, linked_count(g, light.id) == 1, "linked to Banishing Light")
	exiled_as := bears.incarnation
	destroy_now(g, light)
	testing.expect(t, light.zone == .Graveyard, "Banishing Light is gone")
	testing.expect(t, bears.zone == .Battlefield, "the Bears returned immediately (CR 610.3)")
	testing.expect(t, bears.incarnation == exiled_as + 1, "as a new object (CR 400.7)")
	testing.expect(t, bears.controller == 0, "under its owner's control (CR 610.3c)")
	testing.expect(t, game.counter_count(bears, types.CounterType_Plus1Plus1{}) == 0 && bears.summoning_sick, "without its counters, summoning sick")
	testing.expect(t, len(s.exile_links) == 0, "no link left")
}

// CR 111.8: a token exiled this way ceases to exist; it doesn't come back when Banishing Light leaves.
@(test)
banishing_light_token_does_not_return :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	plains(t, g, 3)
	token := add(t, g, "Grizzly Bears", 1, .Battlefield)
	token.is_token = true
	light := add(t, g, "Banishing Light", 0, .Hand)
	cast_and_resolve(t, g, light, token.id)
	testing.expect(t, token.zone == .Exile, "the token was exiled")
	destroy_now(g, light)
	testing.expect(t, token.zone != .Battlefield, "the token doesn't return")
	for id in game.ids_of(g.state.battlefield) do testing.expect(t, id != token.id, "not on the battlefield")
}

// CR 610.3b: Banishing Light leaves before its enters ability resolves: the target isn't exiled at all.
@(test)
banishing_light_gone_before_its_trigger_resolves :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 3)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	light := add(t, g, "Banishing Light", 0, .Hand)
	cast_until_trigger(t, g, light, bears.id)
	testing.expect(t, types.pvec_len(s.stack) == 1, "the enters trigger waits on the stack")
	destroy_now(g, light)
	resolve_answering(t, g)
	testing.expect(t, bears.zone == .Battlefield, "nothing was exiled (CR 610.3b)")
	testing.expect(t, len(s.exile_links) == 0, "no link")
}

// Banishing Light left and came back (the same card, a new object, CR 400.7) before the old object's enters ability
// resolves: that ability exiles nothing (CR 610.3b); the new object's own enters ability does, linked to it.
@(test)
banishing_light_back_as_new_object_before_its_trigger :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 3)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	elves := add(t, g, "Llanowar Elves", 1, .Battlefield)
	light := add(t, g, "Banishing Light", 0, .Hand)
	cast_until_trigger(t, g, light, bears.id)
	game.action_events = &g.events
	game.move_object(g, light.id, .Hand)
	game.move_object(g, light.id, .Battlefield)
	game.action_events = nil
	game.give_priority(g, 0) // the new object's enters ability triggers
	_, asked := s.waiting_for.(types.WaitingFor_TriggerTargetSelection)
	testing.expect(t, asked, "the new object's enters ability asks for its target")
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{elves.id}}))
	resolve_answering(t, g)
	testing.expect(t, bears.zone == .Battlefield, "the old object's ability exiled nothing")
	testing.expect(t, elves.zone == .Exile && linked_count(g, light.id) == 1, "the new object's ability exiled the Elves")
	destroy_now(g, light)
	testing.expect(t, elves.zone == .Battlefield, "and they return when it leaves")
}

// CR 610.3d: two Banishing Lights destroyed at once: both cards return at the same time, right after (one event
// group, after the Lights left), and survive what destroyed the Lights.
@(test)
two_hosts_leaving_together_return_together :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	plains(t, g, 6)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	elves := add(t, g, "Llanowar Elves", 1, .Battlefield)
	first := add(t, g, "Banishing Light", 0, .Hand)
	second := add(t, g, "Banishing Light", 0, .Hand)
	cast_and_resolve(t, g, first, bears.id)
	cast_and_resolve(t, g, second, elves.id)
	testing.expect(t, bears.zone == .Exile && elves.zone == .Exile, "both exiled")
	clear(&g.events)
	game.action_events = &g.events
	together := game.begin_together()
	game.destroy(g, first)
	game.destroy(g, second)
	testing.expect(t, bears.zone == .Exile && elves.zone == .Exile, "not back while the Lights are still leaving")
	game.end_together(together)
	game.action_events = nil
	testing.expect(t, bears.zone == .Battlefield && elves.zone == .Battlefield, "both returned")
	leave_group, return_group := -1, -1
	for e in g.events do if e.kind == .Zone_Change {
		if e.object == first.id do leave_group = e.group
		if e.object == bears.id && e.to == .Battlefield do return_group = e.group
		if e.object == elves.id && e.to == .Battlefield do testing.expect(t, e.group == return_group, "the returns are simultaneous")
	}
	testing.expect(t, return_group != leave_group, "the returns come after the Lights left, as a second event")
}

// CR 607.2a: Journey to Nowhere's leaves-the-battlefield ability returns the card its enters ability exiled, under
// its owner's control.
@(test)
journey_to_nowhere_returns_the_exiled_card :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	plains(t, g, 2)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	journey := add(t, g, "Journey to Nowhere", 0, .Hand)
	cast_and_resolve(t, g, journey, bears.id)
	testing.expect(t, bears.zone == .Exile, "exiled by the enters ability")
	destroy_now(g, journey)
	testing.expect(t, bears.zone == .Exile, "not yet: the return is a triggered ability")
	game.give_priority(g, 0)
	resolve_answering(t, g)
	testing.expect(t, bears.zone == .Battlefield && bears.controller == 1, "returned under its owner's control")
}

// CR 607.2a: each Journey returns only the card its own ability exiled.
@(test)
journey_returns_only_its_own_card :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	plains(t, g, 4)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	elves := add(t, g, "Llanowar Elves", 1, .Battlefield)
	first := add(t, g, "Journey to Nowhere", 0, .Hand)
	second := add(t, g, "Journey to Nowhere", 0, .Hand)
	cast_and_resolve(t, g, first, bears.id)
	cast_and_resolve(t, g, second, elves.id)
	destroy_now(g, first)
	game.give_priority(g, 0)
	resolve_answering(t, g)
	testing.expect(t, bears.zone == .Battlefield, "the first Journey's card returned")
	testing.expect(t, elves.zone == .Exile, "the other Journey's card stays")
}

// CR 400.7: the exiled card left exile and was exiled again (by something else): a new object, not "the exiled card".
@(test)
journey_card_that_left_exile_is_not_returned :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	plains(t, g, 2)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	journey := add(t, g, "Journey to Nowhere", 0, .Hand)
	cast_and_resolve(t, g, journey, bears.id)
	game.action_events = &g.events
	game.move_object(g, bears.id, .Graveyard)
	game.move_object(g, bears.id, .Exile)
	game.action_events = nil
	testing.expect(t, len(g.state.exile_links) == 0, "the link ended as the card left exile")
	destroy_now(g, journey)
	game.give_priority(g, 0)
	resolve_answering(t, g)
	testing.expect(t, bears.zone == .Exile, "the new object stays in exile")
}

// Fiend Hunter leaves before its enters ability resolves: its leaves ability resolves first and returns nothing;
// then the enters ability exiles the creature for good (Fiend Hunter's rulings; not an "until" exile, CR 610.3).
@(test)
fiend_hunter_leaving_in_response_exiles_for_good :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 3)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	hunter := add(t, g, "Fiend Hunter", 0, .Hand)
	cast_until_trigger(t, g, hunter, bears.id)
	destroy_now(g, hunter)
	game.give_priority(g, 0) // the leaves ability goes on the stack, above the enters ability
	testing.expect(t, types.pvec_len(s.stack) == 2, "both abilities wait")
	resolve_answering(t, g)
	testing.expect(t, bears.zone == .Exile, "exiled for good")
	testing.expect(t, len(s.exile_links) == 0, "linked to no object")
}

// The usual case: Fiend Hunter exiles, then dies; its leaves ability returns the card.
@(test)
fiend_hunter_returns_the_card_when_it_leaves :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	plains(t, g, 3)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	hunter := add(t, g, "Fiend Hunter", 0, .Hand)
	cast_and_resolve(t, g, hunter, bears.id)
	testing.expect(t, bears.zone == .Exile, "exiled")
	destroy_now(g, hunter)
	game.give_priority(g, 0)
	resolve_answering(t, g)
	testing.expect(t, bears.zone == .Battlefield, "returned")
}

// CR 303.4f: an Aura exiled until Banishing Light leaves returns with what it enchants chosen by its owner (who
// controls it), among what it could enchant; nothing targets.
@(test)
aura_returning_from_banishing_light_chooses_its_host :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 3)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	other := add(t, g, "Llanowar Elves", 0, .Battlefield)
	pacifism := add(t, g, "Pacifism", 1, .Battlefield)
	game.attach(s, pacifism, mine)
	light := add(t, g, "Banishing Light", 0, .Hand)
	cast_and_resolve(t, g, light, pacifism.id)
	testing.expect(t, pacifism.zone == .Exile, "the Aura is exiled")
	destroy_now(g, light)
	testing.expect(t, pacifism.zone == .Exile, "waiting for its owner's choice")
	game.give_priority(g, 0)
	w, asked := s.waiting_for.(types.WaitingFor_ReturnAsAuraTarget)
	testing.expect(t, asked && w.player == 1 && len(w.legal_targets) == 2, "its owner chooses between the two creatures")
	if !asked do return
	testing.expect(t, !game.apply(g, 1, types.GameAction_ChooseTarget{target = types.TargetRef_Object{light.id}}), "not something it can't enchant")
	testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = types.TargetRef_Object{other.id}}))
	testing.expect(t, pacifism.zone == .Battlefield && pacifism.controller == 1, "returned under its owner's control")
	testing.expect(t, game.host_of(s, pacifism) == other, "enchanting the chosen creature")
	_, priority := s.waiting_for.(types.WaitingFor_Priority)
	testing.expect(t, priority, "then a player receives priority")
}

// CR 303.4g: with nothing it could enchant, the Aura stays in exile.
@(test)
aura_with_nothing_to_enchant_stays_exiled :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 3)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	pacifism := add(t, g, "Pacifism", 1, .Battlefield)
	game.attach(s, pacifism, bears)
	light := add(t, g, "Banishing Light", 0, .Hand)
	cast_and_resolve(t, g, light, pacifism.id)
	destroy_now(g, bears)
	destroy_now(g, light)
	game.give_priority(g, 0)
	testing.expect(t, pacifism.zone == .Exile, "it stays in exile")
	_, priority := s.waiting_for.(types.WaitingFor_Priority)
	testing.expect(t, priority, "nothing to ask")
	testing.expect(t, len(g.exile_returns) == 0, "nothing left to return")
}

// CR 303.4f, 607.2a: Leonin Relic-Warder's leaves ability returns the exiled Aura; its owner chooses the host as it
// resolves.
@(test)
relic_warder_returns_an_aura_choosing_its_host :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	for _ in 0 ..< 2 do add(t, g, "Plains", 0, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	other := add(t, g, "Llanowar Elves", 1, .Battlefield)
	pacifism := add(t, g, "Pacifism", 1, .Battlefield)
	game.attach(s, pacifism, mine)
	warder := add(t, g, "Leonin Relic-Warder", 0, .Hand)
	cast_and_resolve(t, g, warder, pacifism.id)
	testing.expect(t, pacifism.zone == .Exile, "exiled")
	destroy_now(g, warder)
	game.give_priority(g, 0)
	asked := false
	for _ in 0 ..< 8 {
		if w, ok := s.waiting_for.(types.WaitingFor_ReturnAsAuraTarget); ok {
			asked = true
			testing.expect(t, w.player == 1, "its owner chooses")
			testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = types.TargetRef_Object{other.id}}))
			continue
		}
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, asked, "asked what it enchants")
	testing.expect(t, pacifism.zone == .Battlefield && game.host_of(s, pacifism) == other, "returned onto the chosen creature")
}

// Temporary Lockdown: "exile each nonland permanent with mana value 2 or less until this enchantment leaves the
// battlefield" (CR 610.3): every one returns when it leaves, a land doesn't move.
@(test)
temporary_lockdown_returns_everything_it_exiled :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	plains(t, g, 3)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	elves := add(t, g, "Llanowar Elves", 0, .Battlefield)
	big := add(t, g, "Hill Giant", 1, .Battlefield) // mana value 4
	lockdown := add(t, g, "Temporary Lockdown", 0, .Hand)
	cast_and_resolve(t, g, lockdown, 0)
	testing.expect(t, bears.zone == .Exile && elves.zone == .Exile, "mana value 2 or less exiled")
	testing.expect(t, big.zone == .Battlefield, "not the Giant")
	destroy_now(g, lockdown)
	testing.expect(t, bears.zone == .Battlefield && elves.zone == .Battlefield, "all returned")
	testing.expect(t, bears.controller == 1 && elves.controller == 0, "each under its owner's control")
}

// Bag of Holding: cards exiled by its discard trigger are "cards exiled with this artifact"; its sacrifice ability
// (whose source has left by the time it resolves) returns them to their owner's hand (CR 607.2a, 603.10a).
@(test)
bag_of_holding_returns_the_cards_it_exiled :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	for _ in 0 ..< 6 do add(t, g, "Forest", 0, .Battlefield)
	bag := add(t, g, "Bag of Holding", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Hand)
	elsewhere := add(t, g, "Llanowar Elves", 0, .Exile) // exiled by something else: not "with this"
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = bag.id, ability_index = 0}))
	for _ in 0 ..< 12 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_DiscardChoice:
			chosen := make([dynamic]types.ObjectId, context.temp_allocator)
			append(&chosen, bears.id)
			testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = chosen}))
			continue
		}
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, bears.zone == .Exile, "the discarded card was exiled")
	testing.expect(t, linked_count(g, bag.id) == 1, "linked to the Bag")
	bag.tapped = false
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = bag.id, ability_index = 1}), "{4}, {T}, sacrifice")
	resolve_answering(t, g)
	testing.expect(t, bag.zone == .Graveyard, "sacrificed")
	testing.expect(t, bears.zone == .Hand, "returned to its owner's hand")
	testing.expect(t, elsewhere.zone == .Exile, "a card exiled otherwise stays")
}

// Shire Shirriff: "you may sacrifice a token. When you do, exile target creature an opponent controls until this
// creature leaves the battlefield": the reflexive ability (CR 603.12) is Shirriff's, so the card returns when
// Shirriff leaves (CR 610.3).
@(test)
shire_shirriff_reflexive_exile_until_it_leaves :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 2)
	token := add(t, g, "Grizzly Bears", 0, .Battlefield)
	token.is_token = true
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	shirriff := add(t, g, "Shire Shirriff", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shirriff.id}))
	for _ in 0 ..< 16 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_TriggerTargetSelection, types.WaitingFor_TargetSelection:
			testing.expect(t, game.apply(g, s.priority_player, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
			continue
		case types.WaitingFor_OptionalEffectChoice:
			testing.expect(t, game.apply(g, w.player, types.GameAction_DecideOptionalEffect{accept = true}))
			continue
		case types.WaitingFor_EffectZoneChoice:
			chosen := make([dynamic]types.ObjectId, context.temp_allocator)
			append(&chosen, token.id)
			testing.expect(t, game.apply(g, w.player, types.GameAction_SelectCards{cards = chosen}))
			continue
		}
		if types.pvec_len(s.stack) == 0 && shirriff.zone == .Battlefield do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, token.zone != .Battlefield, "the token was sacrificed")
	testing.expect(t, bears.zone == .Exile, "the Bears were exiled")
	destroy_now(g, shirriff)
	testing.expect(t, bears.zone == .Battlefield, "and returned when Shirriff left")
}

// ---- The host leaving through the game's own actions ----------------------------------------------------------

// Plays until the stack is empty, answering every prompt: targets with `target`, "you may" with yes, a choice of
// cards (a search) with `pick`, a returning Aura's host with `host`.
@(private = "file")
play_out :: proc(t: ^testing.T, g: ^game.Game, target: types.ObjectId = 0, pick: types.ObjectId = 0, host: types.ObjectId = 0) {
	s := &g.state
	for _ in 0 ..< 24 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_TriggerTargetSelection, types.WaitingFor_TargetSelection:
			testing.expect(t, game.apply(g, s.priority_player, types.GameAction_ChooseTarget{target = types.TargetRef_Object{target}}), "the target is legal")
			continue
		case types.WaitingFor_OptionalEffectChoice:
			testing.expect(t, game.apply(g, w.player, types.GameAction_DecideOptionalEffect{accept = true}))
			continue
		case types.WaitingFor_SearchChoice, types.WaitingFor_EffectZoneChoice:
			chosen := make([dynamic]types.ObjectId, context.temp_allocator)
			if pick != 0 do append(&chosen, pick)
			testing.expect(t, game.apply(g, s.priority_player, types.GameAction_SelectCards{cards = chosen}), "the choice is accepted")
			continue
		case types.WaitingFor_ReturnAsAuraTarget:
			testing.expect(t, game.apply(g, w.player, types.GameAction_ChooseTarget{target = types.TargetRef_Object{host}}), "the host is legal")
			continue
		}
		if types.pvec_len(s.stack) == 0 do return
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
}

// Disenchant destroys Banishing Light: the exiled card returns as the spell resolves (CR 610.3).
@(test)
disenchanted_banishing_light_returns_the_card :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	plains(t, g, 5)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	light := add(t, g, "Banishing Light", 0, .Hand)
	disenchant := add(t, g, "Disenchant", 0, .Hand)
	cast_and_resolve(t, g, light, bears.id)
	testing.expect(t, bears.zone == .Exile, "exiled")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = disenchant.id}))
	play_out(t, g, light.id)
	testing.expect(t, light.zone == .Graveyard && disenchant.zone == .Graveyard, "Banishing Light destroyed")
	testing.expect(t, bears.zone == .Battlefield && bears.controller == 1, "the Bears are back under their owner's control")
}

// CR 303.4f: the Aura's owner is asked what it enchants once Disenchant has resolved, before anyone gets priority.
@(test)
disenchanted_banishing_light_returns_an_aura_asking_its_owner :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 5)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	other := add(t, g, "Llanowar Elves", 0, .Battlefield)
	pacifism := add(t, g, "Pacifism", 1, .Battlefield)
	game.attach(s, pacifism, mine)
	light := add(t, g, "Banishing Light", 0, .Hand)
	disenchant := add(t, g, "Disenchant", 0, .Hand)
	cast_and_resolve(t, g, light, pacifism.id)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = disenchant.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{light.id}}))
	asked := false
	for _ in 0 ..< 6 {
		if w, ok := s.waiting_for.(types.WaitingFor_ReturnAsAuraTarget); ok {
			asked = true
			testing.expect(t, w.player == 1, "its owner chooses")
			testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = types.TargetRef_Object{other.id}}))
			break
		}
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, asked, "asked before priority")
	testing.expect(t, pacifism.zone == .Battlefield && game.host_of(s, pacifism) == other, "enchanting the Elves")
}

// Werefox Bodyguard sacrificed to pay its own ability's cost: the card returns at once (CR 610.3), and the sacrifice
// is still recorded as one (CR 701.21a: "if you sacrificed a permanent this turn").
@(test)
sacrificed_werefox_bodyguard_returns_the_card :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 5)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	werefox := add(t, g, "Werefox Bodyguard", 0, .Hand)
	cast_and_resolve(t, g, werefox, bears.id)
	testing.expect(t, bears.zone == .Exile, "exiled")
	werefox.summoning_sick = false
	life := game.player(s, 0).life
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = werefox.id, ability_index = 0}), "{1}{W}, sacrifice")
	testing.expect(t, werefox.zone == .Graveyard && bears.zone == .Battlefield, "returned as the cost was paid")
	sacrificed := false
	for i in 0 ..< types.pvec_len(s.sacrificed_permanents_this_turn) do if types.pvec_get(s.sacrificed_permanents_this_turn, i).object_id == werefox.id do sacrificed = true
	testing.expect(t, sacrificed, "the sacrifice is recorded")
	play_out(t, g)
	testing.expect(t, game.player(s, 0).life == life + 2, "the ability resolves")
}

// Banisher Priest dealt lethal damage: it dies as a state-based action and the card returns (CR 704.5g, 610.3).
@(test)
banisher_priest_dying_returns_the_card :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	plains(t, g, 3)
	add(t, g, "Mountain", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	priest := add(t, g, "Banisher Priest", 0, .Hand)
	shock := add(t, g, "Shock", 0, .Hand)
	cast_and_resolve(t, g, priest, bears.id)
	testing.expect(t, bears.zone == .Exile, "exiled")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = shock.id}))
	play_out(t, g, priest.id)
	testing.expect(t, priest.zone == .Graveyard, "the Priest died")
	testing.expect(t, bears.zone == .Battlefield, "the Bears returned")
}

// Cloudshift on Banisher Priest: "exile target creature you control, then return that card". The Bears return once,
// right after the Priest is exiled; the Priest returns as a new object whose enters ability can exile again.
@(test)
flickered_banisher_priest_returns_the_card_once :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 4)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	priest := add(t, g, "Banisher Priest", 0, .Hand)
	cloudshift := add(t, g, "Cloudshift", 0, .Hand)
	cast_and_resolve(t, g, priest, bears.id)
	exiled_as := bears.incarnation
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = cloudshift.id}))
	for _ in 0 ..< 8 {
		#partial switch _ in s.waiting_for {
		case types.WaitingFor_TargetSelection:
			testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{priest.id}}))
			continue
		case types.WaitingFor_TriggerTargetSelection:
		case:
			if cloudshift.zone != .Graveyard {
				game.apply(g, s.priority_player, types.GameAction_PassPriority{})
				continue
			}
		}
		break
	}
	testing.expect(t, cloudshift.zone == .Graveyard && priest.zone == .Battlefield, "the Priest was flickered")
	testing.expect(t, bears.zone == .Battlefield && bears.incarnation == exiled_as + 1, "the Bears returned exactly once")
	play_out(t, g, bears.id)
	testing.expect(t, bears.zone == .Exile && linked_count(g, priest.id) == 1, "the new Priest exiled them again")
}

// ---- What the newly supported cards do besides ----------------------------------------------------------------

// Driftgloom Coyote: "If that creature had power 2 or less, put a +1/+1 counter on this creature": the exiled
// creature's power as it last existed on the battlefield (CR 608.2h).
@(test)
driftgloom_coyote_reads_the_exiled_creatures_power :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	plains(t, g, 10)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield) // power 2
	giant := add(t, g, "Hill Giant", 1, .Battlefield) // power 3
	first := add(t, g, "Driftgloom Coyote", 0, .Hand)
	second := add(t, g, "Driftgloom Coyote", 0, .Hand)
	cast_and_resolve(t, g, first, bears.id)
	testing.expect(t, bears.zone == .Exile && game.counter_count(first, types.CounterType_Plus1Plus1{}) == 1, "power 2: a counter")
	cast_and_resolve(t, g, second, giant.id)
	testing.expect(t, giant.zone == .Exile && game.counter_count(second, types.CounterType_Plus1Plus1{}) == 0, "power 3: none")
}

// Containment Construct: "Whenever you discard a card, you may exile that card from your graveyard. If you do, you
// may play that card this turn." The discarded card, exiled from the graveyard, is then cast from exile.
@(test)
containment_construct_exiles_the_discarded_card_to_play :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	for _ in 0 ..< 2 do add(t, g, "Mountain", 0, .Battlefield)
	for _ in 0 ..< 2 do add(t, g, "Forest", 0, .Battlefield)
	add(t, g, "Containment Construct", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Hand)
	elves := add(t, g, "Llanowar Elves", 0, .Hand)
	reunion := add(t, g, "Cathartic Reunion", 0, .Hand) // as an additional cost, discard two cards
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = reunion.id}))
	for _ in 0 ..< 24 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_PayCost, types.WaitingFor_DiscardChoice:
			chosen := make([dynamic]types.ObjectId, context.temp_allocator)
			append(&chosen, bears.id, elves.id)
			testing.expect(t, game.apply(g, s.priority_player, types.GameAction_SelectCards{cards = chosen}), "the discard is the cost")
			continue
		case types.WaitingFor_OptionalEffectChoice:
			testing.expect(t, game.apply(g, w.player, types.GameAction_DecideOptionalEffect{accept = true}))
			continue
		}
		if types.pvec_len(s.stack) == 0 do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, bears.zone == .Exile && elves.zone == .Exile, "both discarded cards exiled from the graveyard")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = bears.id}), "the Bears are cast from exile")
	play_out(t, g)
	testing.expect(t, bears.zone == .Battlefield, "and resolve")
}

// Hoarding Dragon: the artifact its search exiled is "the exiled card" its dies ability puts into its owner's hand
// (CR 607.2a, 603.10a).
@(test)
hoarding_dragon_returns_the_artifact_it_exiled :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	for _ in 0 ..< 5 do add(t, g, "Mountain", 0, .Battlefield)
	splitter := add(t, g, "Bonesplitter", 0, .Library)
	dragon := add(t, g, "Hoarding Dragon", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = dragon.id}))
	play_out(t, g, pick = splitter.id)
	testing.expect(t, splitter.zone == .Exile && linked_count(g, dragon.id) == 1, "the artifact found is exiled, linked")
	destroy_now(g, dragon)
	game.give_priority(g, 0)
	play_out(t, g)
	testing.expect(t, splitter.zone == .Hand, "put into its owner's hand")
}

// Pinnacle Starcage: "Put each card exiled with this artifact into its owner's graveyard, then create a 2/2 Robot
// for each card put into a graveyard this way. Sacrifice this artifact." Nothing returns when it's sacrificed.
@(test)
pinnacle_starcage_buries_what_it_exiled :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 16)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	elves := add(t, g, "Llanowar Elves", 0, .Battlefield)
	giant := add(t, g, "Hill Giant", 1, .Battlefield)
	cage := add(t, g, "Pinnacle Starcage", 0, .Hand)
	cast_and_resolve(t, g, cage, 0)
	testing.expect(t, bears.zone == .Exile && elves.zone == .Exile && giant.zone == .Battlefield, "mana value 2 or less exiled")
	before := len(game.permanents_of(s, 0))
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = cage.id, ability_index = 0}))
	play_out(t, g)
	testing.expect(t, bears.zone == .Graveyard && elves.zone == .Graveyard, "into their owners' graveyards")
	testing.expect(t, cage.zone == .Graveyard, "sacrificed")
	robots := 0
	for o in game.permanents_of(s, 0) do if o.name == "Robot" do robots += 1
	testing.expect(t, robots == 2, "a Robot for each")
	testing.expect(t, len(game.permanents_of(s, 0)) == before - 1 + 2, "nothing else changed")
}

// Flicker of Fate: "exile target creature or enchantment, then return it": "it" is what the exile moved (CR 608.2c),
// so the Bears that Banisher Priest's leaving returned (CR 610.3) aren't "it": they return once, and only the Priest
// is put back by the spell.
@(test)
flicker_of_fate_on_banisher_priest_returns_only_the_priest :: proc(t: ^testing.T) {
	if !load_db() do return
	g := new_game()
	s := &g.state
	plains(t, g, 5)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	priest := add(t, g, "Banisher Priest", 0, .Hand)
	flicker := add(t, g, "Flicker of Fate", 0, .Hand)
	cast_and_resolve(t, g, priest, bears.id)
	exiled_as := bears.incarnation
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = flicker.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{priest.id}}))
	for _ in 0 ..< 6 {
		if flicker.zone == .Graveyard do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	testing.expect(t, flicker.zone == .Graveyard && priest.zone == .Battlefield, "the Priest was flickered")
	testing.expect(t, bears.zone == .Battlefield && bears.incarnation == exiled_as + 1, "the Bears returned exactly once")
}
