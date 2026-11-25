// Rules tests for mana abilities with costs that choose or extra effects (CR 605), and for library effects: searching
// (CR 701.23), shuffling (CR 701.24) and looking at the top cards ("dig"), each naming the CR rule it checks.
package game_test

import "core:testing"
import game "../../engine/game"
import types "../../engine/types"

// ---- Helpers ----------------------------------------------------------------------------------------------------

@(private = "file")
pick :: proc(ids: ..types.ObjectId) -> types.GameAction {
	cards: [dynamic]types.ObjectId
	append(&cards, ..ids)
	return types.GameAction_SelectCards{cards = cards}
}

@(private = "file")
choose_color :: proc(c: types.ManaType) -> types.GameAction {
	return types.GameAction_ChooseManaColor{choice = types.ManaChoice_SingleColor{c}, count = 1}
}

@(private = "file")
activate :: proc(g: ^game.Game, o: ^types.GameObject, index: int, p: types.PlayerId = 0) -> bool {
	return game.apply(g, p, types.GameAction_ActivateAbility{source_id = o.id, ability_index = index})
}

// How much mana of a type is in the player's pool.
@(private = "file")
pool_count :: proc(g: ^game.Game, p: types.PlayerId, c: types.ManaType) -> int {
	n := 0
	for u in game.player(&g.state, p).mana_pool.mana do if u.color == c do n += 1
	return n
}

@(private = "file")
pool_size :: proc(g: ^game.Game, p: types.PlayerId) -> int {
	return len(game.player(&g.state, p).mana_pool.mana)
}

@(private = "file")
stack_empty :: proc(g: ^game.Game) -> bool {
	return types.pvec_len(g.state.stack) == 0
}

@(private = "file")
has_priority :: proc(g: ^game.Game, p: types.PlayerId) -> bool {
	w, ok := g.state.waiting_for.(types.WaitingFor_Priority)
	return ok && w.player == p
}

@(private = "file")
supported :: proc(t: ^testing.T, name: string) -> bool {
	return game.card_supported(&card(t, name).face)
}

// ---- Mana abilities whose cost has the player choose (CR 605.3a-b, 602.2b, 601.2h) ------------------------------

@(test)
springleaf_drum_taps_a_creature_for_mana :: proc(t: ^testing.T) {
	if !load_db() do return
	// Springleaf Drum: "{T}, Tap an untapped creature you control: Add one mana of any color." CR 605.1a: a mana
	// ability; CR 605.3b: it doesn't use the stack and resolves at once; CR 602.2b, 601.2h: its cost is paid as any
	// ability's, the player choosing the creature. The Drum's ruling: a creature that just came under its
	// controller's control can be tapped for it (CR 302.6 is about {T} costs).
	testing.expect(t, supported(t, "Springleaf Drum"))
	g := new_game()
	drum := add(t, g, "Springleaf Drum", 0, .Battlefield)
	testing.expect(t, !game.can_activate(g, 0, drum, 0), "no creature to tap: the cost can't be paid (CR 118.3)")
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	bears.summoning_sick = true
	theirs := add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, activate(g, drum, 0))
	w, asked := g.state.waiting_for.(types.WaitingFor_PayCost)
	testing.expect(t, asked && w.count == 1, "asked which creature to tap")
	if !asked do return
	for id in w.choices do testing.expect(t, id != theirs.id, "not the opponent's")
	testing.expect(t, !game.apply(g, 0, pick(theirs.id)), "the opponent's creature isn't a choice")
	testing.expect(t, game.apply(g, 0, pick(bears.id)))
	testing.expect(t, drum.tapped && bears.tapped, "the Drum and the creature are tapped")
	_, choosing := g.state.waiting_for.(types.WaitingFor_ChooseManaColor)
	testing.expect(t, choosing, "the color is chosen as it resolves")
	testing.expect(t, game.apply(g, 0, choose_color(.Blue)))
	testing.expect_value(t, pool_count(g, 0, .Blue), 1)
	testing.expect(t, stack_empty(g) && has_priority(g, 0), "nothing on the stack; its player has priority again")
}

@(test)
drum_isnt_used_by_automatic_payment :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 605.3a: the player activates such a mana ability on their own; the automatic payment doesn't choose a creature
	// to tap for them. Its mana, once in the pool, pays (CR 106.4).
	g := new_game()
	drum := add(t, g, "Springleaf Drum", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	opt := add(t, g, "Opt", 0, .Hand) // {U}
	testing.expect(t, !game.castable(&g.state, 0, opt, lookup), "the Drum isn't tapped automatically")
	testing.expect(t, activate(g, drum, 0))
	testing.expect(t, game.apply(g, 0, pick(bears.id)))
	testing.expect(t, game.apply(g, 0, choose_color(.Blue)))
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = opt.id}), "the floating {U} pays for Opt")
	testing.expect_value(t, pool_size(g, 0), 0)
}

@(test)
sentinel_cant_tap_itself_twice :: proc(t: ^testing.T) {
	if !load_db() do return
	// Jaspera Sentinel: "{T}, Tap an untapped creature you control: Add one mana of any color." Its {T} taps it, so
	// it can't also be the untapped creature tapped for the rest of the cost (CR 118.3, 701.26a).
	g := new_game()
	sentinel := add(t, g, "Jaspera Sentinel", 0, .Battlefield)
	testing.expect(t, !game.can_activate(g, 0, sentinel, 0), "only itself to tap")
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, game.can_activate(g, 0, sentinel, 0))
	testing.expect(t, activate(g, sentinel, 0))
	w, asked := g.state.waiting_for.(types.WaitingFor_PayCost)
	testing.expect(t, asked && len(w.choices) == 1 && w.choices[0] == bears.id, "only the other creature is offered")
	// CR 302.6: a summoning-sick Sentinel can't pay {T}.
	g2 := new_game()
	sick := add(t, g2, "Jaspera Sentinel", 0, .Battlefield)
	sick.summoning_sick = true
	add(t, g2, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, !game.can_activate(g2, 0, sick, 0), "summoning sick")
}

@(test)
altar_sacrifices_a_creature_for_mana :: proc(t: ^testing.T) {
	if !load_db() do return
	// Ashnod's Altar: "Sacrifice a creature: Add {C}{C}." CR 605.3b: no stack; CR 701.21a: the player's own creature.
	testing.expect(t, supported(t, "Ashnod's Altar"))
	g := new_game()
	altar := add(t, g, "Ashnod's Altar", 0, .Battlefield)
	testing.expect(t, !game.can_activate(g, 0, altar, 0), "nothing to sacrifice")
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, activate(g, altar, 0))
	w, asked := g.state.waiting_for.(types.WaitingFor_PayCost)
	testing.expect(t, asked && len(w.choices) == 1, "its controller's creature only")
	testing.expect(t, game.apply(g, 0, pick(bears.id)))
	testing.expect(t, bears.zone == .Graveyard, "sacrificed")
	testing.expect_value(t, pool_count(g, 0, .Colorless), 2)
	testing.expect(t, stack_empty(g) && has_priority(g, 0))
}

@(test)
skirk_prospector_needs_a_goblin :: proc(t: ^testing.T) {
	if !load_db() do return
	// Skirk Prospector: "Sacrifice a Goblin: Add {R}." Only a Goblin is a choice; the Prospector is one itself.
	g := new_game()
	prospector := add(t, g, "Skirk Prospector", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, activate(g, prospector, 0))
	w, asked := g.state.waiting_for.(types.WaitingFor_PayCost)
	testing.expect(t, asked && len(w.choices) == 1 && w.choices[0] == prospector.id, "only the Goblin")
	testing.expect(t, !game.apply(g, 0, pick(bears.id)), "the Bears aren't a Goblin")
	testing.expect(t, game.apply(g, 0, pick(prospector.id)))
	testing.expect_value(t, pool_count(g, 0, .Red), 1)
}

@(test)
molt_tender_exiles_from_the_graveyard_for_mana :: proc(t: ^testing.T) {
	if !load_db() do return
	// Molt Tender: "{T}, Exile a card from your graveyard: Add one mana of any color." CR 404.1: its controller's own
	// graveyard.
	g := new_game()
	tender := add(t, g, "Molt Tender", 0, .Battlefield)
	testing.expect(t, !game.can_activate(g, 0, tender, 1), "an empty graveyard")
	add(t, g, "Forest", 1, .Graveyard)
	testing.expect(t, !game.can_activate(g, 0, tender, 1), "not the opponent's graveyard")
	card := add(t, g, "Forest", 0, .Graveyard)
	testing.expect(t, activate(g, tender, 1))
	testing.expect(t, game.apply(g, 0, pick(card.id)))
	testing.expect(t, card.zone == .Exile)
	testing.expect(t, game.apply(g, 0, choose_color(.Black)))
	testing.expect_value(t, pool_count(g, 0, .Black), 1)
}

@(test)
core_removes_a_charge_counter_for_mana :: proc(t: ^testing.T) {
	if !load_db() do return
	// Mirrodin's Core: "{T}, Remove a charge counter from this land: Add one mana of any color." CR 118.3: with no
	// counter to remove, the cost can't be paid.
	g := new_game()
	core := add(t, g, "Mirrodin's Core", 0, .Battlefield)
	testing.expect(t, !game.can_activate(g, 0, core, 2), "no charge counter")
	game.add_counters(core, types.CounterType_Generic{"charge"}, 1)
	testing.expect(t, activate(g, core, 2))
	testing.expect(t, game.apply(g, 0, choose_color(.Red)))
	testing.expect_value(t, pool_count(g, 0, .Red), 1)
	testing.expect(t, core.tapped && game.counter_count(core, types.CounterType_Generic{"charge"}) == 0, "tapped, the counter removed")
}

@(test)
abyssal_lotus_exiles_itself_for_mana :: proc(t: ^testing.T) {
	if !load_db() do return
	// Abyssal Lotus: "Descend 8 — {T}, Exile this artifact: Add three mana of any one color. Activate only if there
	// are eight or more permanent cards in your graveyard." CR 602.5: not before; CR 605.3a: the player activates it
	// (automatic payment doesn't spend it).
	testing.expect(t, supported(t, "Abyssal Lotus"))
	g := new_game()
	lotus := add(t, g, "Abyssal Lotus", 0, .Battlefield)
	for _ in 0 ..< 7 do add(t, g, "Forest", 0, .Graveyard)
	testing.expect(t, !activate(g, lotus, 0), "seven permanent cards")
	add(t, g, "Forest", 0, .Graveyard)
	elves := add(t, g, "Llanowar Elves", 0, .Hand)
	testing.expect(t, !game.castable(&g.state, 0, elves, lookup), "not spent automatically")
	testing.expect(t, activate(g, lotus, 0))
	testing.expect(t, game.apply(g, 0, choose_color(.Green)))
	testing.expect_value(t, pool_count(g, 0, .Green), 3)
	testing.expect(t, lotus.zone == .Exile, "exiled")
}

// ---- Mana that can be spent only on some things (CR 106.6) ------------------------------------------------------

@(test)
pillar_mana_only_for_the_chosen_creature_type :: proc(t: ^testing.T) {
	if !load_db() do return
	// Pillar of Origins: "As this artifact enters, choose a creature type. {T}: Add one mana of any color. Spend this
	// mana only to cast a creature spell of the chosen type." Secluded Courtyard's wider wording ("or activate an
	// ability of a creature source of the chosen type") is written the same way in the data, so it's refused.
	testing.expect(t, supported(t, "Pillar of Origins"))
	testing.expect(t, !supported(t, "Secluded Courtyard"), "Secluded Courtyard: not read yet")
	g := new_game()
	pillar := add(t, g, "Pillar of Origins", 0, .Battlefield)
	append(&pillar.chosen_attributes, types.ChosenAttribute_CreatureType{"Bear"})
	lions := add(t, g, "Savannah Lions", 0, .Hand) // {W}, a Cat
	testing.expect(t, !game.castable(&g.state, 0, lions, lookup), "not a Bear")
	g2 := new_game()
	pillar2 := add(t, g2, "Pillar of Origins", 0, .Battlefield)
	append(&pillar2.chosen_attributes, types.ChosenAttribute_CreatureType{"Cat"})
	lions2 := add(t, g2, "Savannah Lions", 0, .Hand)
	testing.expect(t, game.castable(&g2.state, 0, lions2, lookup), "a Cat")
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = lions2.id}))
	testing.expect(t, pillar2.tapped)
}

@(test)
emperor_mana_only_for_noncreature_spells :: proc(t: ^testing.T) {
	if !load_db() do return
	// The Emperor of Palamecia: "{T}: Add {U} or {R}. Spend this mana only to cast a noncreature spell."
	g := new_game()
	add(t, g, "The Emperor of Palamecia", 0, .Battlefield)
	sailor := add(t, g, "Spectral Sailor", 0, .Hand) // {U} creature
	opt := add(t, g, "Opt", 0, .Hand) // {U} instant
	testing.expect(t, !game.castable(&g.state, 0, sailor, lookup), "a creature spell")
	testing.expect(t, game.castable(&g.state, 0, opt, lookup), "a noncreature spell")
}

@(test)
embercat_mana_for_any_of_two_kinds :: proc(t: ^testing.T) {
	if !load_db() do return
	// Chandra's Embercat: "{T}: Add {R}. Spend this mana only to cast an Elemental spell or a Chandra planeswalker
	// spell." Either kind may be paid for (CR 106.6).
	testing.expect(t, supported(t, "Chandra's Embercat"))
	g := new_game()
	add(t, g, "Chandra's Embercat", 0, .Battlefield)
	elemental := add(t, g, "Spark Elemental", 0, .Hand) // {R}, an Elemental
	goblin := add(t, g, "Goblin Guide", 0, .Hand) // {R}, a Goblin
	testing.expect(t, game.castable(&g.state, 0, elemental, lookup), "an Elemental spell")
	testing.expect(t, !game.castable(&g.state, 0, goblin, lookup), "not a Goblin")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = elemental.id}))
}

@(test)
throne_of_makindi_removes_a_counter_for_restricted_mana :: proc(t: ^testing.T) {
	if !load_db() do return
	// Throne of Makindi: "{T}, Remove a charge counter from this land: Add two mana of any one color. Spend this mana
	// only to cast kicked spells." Activated like other abilities (its counter), then resolved at once (CR 605.3b);
	// the mana keeps its restriction in the pool (CR 106.6).
	testing.expect(t, supported(t, "Throne of Makindi"))
	g := new_game()
	throne := add(t, g, "Throne of Makindi", 0, .Battlefield)
	testing.expect(t, !game.can_activate(g, 0, throne, 2), "no charge counter")
	game.add_counters(throne, types.CounterType_Generic{"charge"}, 1)
	testing.expect(t, activate(g, throne, 2))
	testing.expect(t, game.apply(g, 0, choose_color(.Red)))
	testing.expect_value(t, pool_count(g, 0, .Red), 2)
	pool := game.player(&g.state, 0).mana_pool.mana
	testing.expect(t, len(pool) == 2 && len(pool[0].restrictions) == 1, "only for kicked spells")
	shock := add(t, g, "Shock", 0, .Hand) // {R}, not kicked
	testing.expect(t, !game.castable(&g.state, 0, shock, lookup), "the restricted mana doesn't pay for Shock")
}

// ---- Mana abilities that do more than add mana (CR 605.3b) ------------------------------------------------------

@(test)
pristine_talisman_gains_life_when_it_pays :: proc(t: ^testing.T) {
	if !load_db() do return
	// Pristine Talisman: "{T}: Add {C}. You gain 1 life." The automatic payment uses it, and the whole ability
	// resolves at once (CR 605.3b). Unused, it does nothing.
	testing.expect(t, supported(t, "Pristine Talisman"))
	g := new_game()
	talisman := add(t, g, "Pristine Talisman", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Hand) // {1}{G}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = bears.id}))
	testing.expect(t, talisman.tapped, "the Talisman paid {1}")
	testing.expect_value(t, game.player(&g.state, 0).life, 21)

	g2 := new_game()
	add(t, g2, "Pristine Talisman", 0, .Battlefield)
	add(t, g2, "Forest", 0, .Battlefield)
	elves := add(t, g2, "Llanowar Elves", 0, .Hand) // {G}
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = elves.id}))
	testing.expect_value(t, game.player(&g2.state, 0).life, 20)
}

@(test)
grove_gives_the_opponent_life_for_color :: proc(t: ^testing.T) {
	if !load_db() do return
	// Grove of the Burnwillows: "{T}: Add {C}. {T}: Add {R} or {G}. Each opponent gains 1 life." Generic mana comes
	// from the {C} ability; {G} from the other, and the opponent gains 1 life (CR 605.3b).
	g := new_game()
	add(t, g, "Grove of the Burnwillows", 0, .Battlefield)
	ring := add(t, g, "Sol Ring", 0, .Hand) // {1}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = ring.id}))
	testing.expect_value(t, game.player(&g.state, 1).life, 20)

	g2 := new_game()
	add(t, g2, "Grove of the Burnwillows", 0, .Battlefield)
	elves := add(t, g2, "Llanowar Elves", 0, .Hand) // {G}
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = elves.id}))
	testing.expect_value(t, game.player(&g2.state, 1).life, 21)
	testing.expect_value(t, game.player(&g2.state, 0).life, 20)
}

@(test)
doll_puts_a_counter_on_itself :: proc(t: ^testing.T) {
	if !load_db() do return
	// Twitching Doll: "{T}: Add one mana of any color. Put a nest counter on this creature." Both at once (CR 605.3b).
	g := new_game()
	doll := add(t, g, "Twitching Doll", 0, .Battlefield)
	testing.expect(t, activate(g, doll, 0))
	testing.expect(t, game.apply(g, 0, choose_color(.Green)))
	testing.expect_value(t, pool_count(g, 0, .Green), 1)
	testing.expect_value(t, game.counter_count(doll, types.CounterType_Generic{"nest"}), 1)
}

@(test)
black_tom_gains_life_only_with_another_mutant :: proc(t: ^testing.T) {
	if !load_db() do return
	// Black Tom Cassidy: "{T}: Add {G}. If you control another Mutant, you gain 1 life." CR 608.2c: the condition is
	// checked as the ability resolves.
	g := new_game()
	tom := add(t, g, "Black Tom Cassidy", 0, .Battlefield)
	testing.expect(t, activate(g, tom, 0))
	testing.expect_value(t, pool_count(g, 0, .Green), 1)
	testing.expect_value(t, game.player(&g.state, 0).life, 20)
	tom.tapped = false
	add(t, g, "Aeromunculus", 0, .Battlefield) // a Mutant
	testing.expect(t, activate(g, tom, 0))
	testing.expect_value(t, game.player(&g.state, 0).life, 21)
}

@(test)
leafkin_druid_adds_more_with_four_creatures :: proc(t: ^testing.T) {
	if !load_db() do return
	// Leafkin Druid: "{T}: Add {G}. If you control four or more creatures, add {G}{G} instead." CR 608.2c: the
	// replacing instruction applies when its condition holds as the ability resolves.
	g := new_game()
	druid := add(t, g, "Leafkin Druid", 0, .Battlefield)
	for _ in 0 ..< 2 do add(t, g, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, activate(g, druid, 0))
	testing.expect_value(t, pool_count(g, 0, .Green), 1)
	g2 := new_game()
	druid2 := add(t, g2, "Leafkin Druid", 0, .Battlefield)
	for _ in 0 ..< 3 do add(t, g2, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, activate(g2, druid2, 0))
	testing.expect_value(t, pool_count(g2, 0, .Green), 2)
}

@(test)
tower_worker_with_lost_words_is_refused :: proc(t: ^testing.T) {
	if !load_db() do return
	// Tower Worker: "Add {C}{C}{C} instead" reads as a conditional {C}{C} besides the {C}, not "instead": refused
	// rather than guessed at.
	testing.expect(t, !supported(t, "Tower Worker"))
}

// ---- Abilities that add mana but aren't mana abilities (CR 605.1a, 605.5a) ---------------------------------------

@(test)
loyalty_ability_that_adds_mana_uses_the_stack :: proc(t: ^testing.T) {
	if !load_db() do return
	// Chandra, Novice Pyromancer: "[-1]: Add {R}{R}." CR 605.1a: a loyalty ability isn't a mana ability; it goes on
	// the stack (CR 606.3: at sorcery speed) and adds the mana as it resolves.
	testing.expect(t, supported(t, "Chandra, Novice Pyromancer"))
	g := new_game()
	chandra := add(t, g, "Chandra, Novice Pyromancer", 0, .Battlefield)
	chandra.loyalty = 3
	testing.expect(t, !game.is_mana_ability(chandra.abilities^[1]))
	testing.expect(t, activate(g, chandra, 1))
	testing.expect(t, !stack_empty(g) && pool_size(g, 0) == 0, "on the stack, no mana yet")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect_value(t, pool_count(g, 0, .Red), 2)
	testing.expect(t, chandra.loyalty.? == 2)
}

@(test)
sphere_that_draws_isnt_a_mana_ability :: proc(t: ^testing.T) {
	if !load_db() do return
	// Chromatic Sphere: "{1}, {T}, Sacrifice this artifact: Add one mana of any color. Draw a card." CR 605.1a: its
	// effect moves a card from the library (a draw), so it isn't a mana ability: it uses the stack.
	g := new_game()
	sphere := add(t, g, "Chromatic Sphere", 0, .Battlefield)
	add(t, g, "Forest", 0, .Battlefield)
	testing.expect(t, !game.is_mana_ability(sphere.abilities^[0]))
	hand := types.pvec_len(game.player(&g.state, 0).hand)
	testing.expect(t, activate(g, sphere, 0))
	testing.expect(t, !stack_empty(g), "on the stack")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, game.apply(g, 0, choose_color(.Black)))
	testing.expect_value(t, pool_count(g, 0, .Black), 1)
	testing.expect_value(t, types.pvec_len(game.player(&g.state, 0).hand), hand + 1)
}

// ---- "Activate only if" (CR 602.5) -----------------------------------------------------------------------------

@(test)
gathering_place_needs_a_basic_land_or_to_have_just_entered :: proc(t: ^testing.T) {
	if !load_db() do return
	// Gathering Place: "{T}: Add {G} or {W}. Activate only if this land entered this turn or if you control a basic
	// land."
	testing.expect(t, supported(t, "Gathering Place"))
	g := new_game()
	place := add(t, g, "Gathering Place", 0, .Battlefield)
	testing.expect(t, !activate(g, place, 1), "neither")
	place.entered_battlefield_turn = g.state.turn_number
	testing.expect(t, activate(g, place, 1), "it entered this turn")
	testing.expect(t, game.apply(g, 0, choose_color(.White)))
	g2 := new_game()
	place2 := add(t, g2, "Gathering Place", 0, .Battlefield)
	add(t, g2, "Plains", 0, .Battlefield)
	testing.expect(t, activate(g2, place2, 1), "a basic land")
}

// ---- Searching a library (CR 701.23) ------------------------------------------------------------------------------

// Casts a spell from the hand with enough lands of the given kind, then passes priority until the spell resolves or
// asks something.
@(private = "file")
cast_and_resolve :: proc(t: ^testing.T, g: ^game.Game, name: string, land: string, lands: int) -> ^types.GameObject {
	for _ in 0 ..< lands do add(t, g, land, 0, .Battlefield)
	spell := add(t, g, name, 0, .Hand)
	testing.expectf(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}), "%s is cast", name)
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	return spell
}

@(test)
cultivate_splits_the_lands_it_finds :: proc(t: ^testing.T) {
	if !load_db() do return
	// Cultivate: "Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield
	// tapped and the other into your hand, then shuffle." The player chooses which goes where (CR 608.2c).
	testing.expect(t, supported(t, "Cultivate"))
	g := new_game()
	s := &g.state
	cast_and_resolve(t, g, "Cultivate", "Forest", 3)
	w, searching := s.waiting_for.(types.WaitingFor_SearchChoice)
	testing.expect(t, searching && w.count == 2 && w.up_to, "up to two")
	if !searching do return
	a, b := w.cards[0], w.cards[1]
	testing.expect(t, game.apply(g, 0, pick(a, b)))
	p, splitting := s.waiting_for.(types.WaitingFor_SearchPartitionChoice)
	testing.expect(t, splitting && p.primary_count == 1 && p.primary_destination == .Battlefield && p.rest_destination == .Hand, "which one onto the battlefield")
	if !splitting do return
	testing.expect(t, !game.apply(g, 0, pick(a, b)), "only one goes onto the battlefield")
	testing.expect(t, game.apply(g, 0, pick(b)))
	testing.expect(t, game.object(s, b).zone == .Battlefield && game.object(s, b).tapped, "onto the battlefield tapped")
	testing.expect(t, game.object(s, a).zone == .Hand, "the other into the hand")
	testing.expect(t, stack_empty(g) && has_priority(g, 0), "resolved")
}

@(test)
cultivate_with_one_land_found_puts_it_onto_the_battlefield :: proc(t: ^testing.T) {
	if !load_db() do return
	// Cultivate's ruling: "If you choose to find only one basic land card, you put it onto the battlefield tapped."
	g := new_game()
	s := &g.state
	cast_and_resolve(t, g, "Cultivate", "Forest", 3)
	w, searching := s.waiting_for.(types.WaitingFor_SearchChoice)
	if !searching do return
	testing.expect(t, game.apply(g, 0, pick(w.cards[0])))
	_, splitting := s.waiting_for.(types.WaitingFor_SearchPartitionChoice)
	testing.expect(t, !splitting, "nothing to choose")
	testing.expect(t, game.object(s, w.cards[0]).zone == .Battlefield && game.object(s, w.cards[0]).tapped)
}

@(test)
final_parting_finds_two_cards :: proc(t: ^testing.T) {
	if !load_db() do return
	// Final Parting: "Search your library for two cards. Put one into your hand and the other into your graveyard.
	// Then shuffle." CR 701.23b: "a card" has no stated quality, so two must be found when the library has them.
	testing.expect(t, supported(t, "Final Parting"))
	g := new_game()
	s := &g.state
	cast_and_resolve(t, g, "Final Parting", "Swamp", 5)
	w, searching := s.waiting_for.(types.WaitingFor_SearchChoice)
	testing.expect(t, searching && w.count == 2 && !w.up_to)
	if !searching do return
	testing.expect(t, !game.apply(g, 0, pick(w.cards[0])), "two cards, not one")
	a, b := w.cards[0], w.cards[1]
	testing.expect(t, game.apply(g, 0, pick(a, b)))
	testing.expect(t, game.apply(g, 0, pick(a)))
	testing.expect(t, game.object(s, a).zone == .Hand && game.object(s, b).zone == .Graveyard)
}

@(test)
shared_summons_finds_different_names :: proc(t: ^testing.T) {
	if !load_db() do return
	// Shared Summons: "Search your library for up to two creature cards with different names, reveal them, put them
	// into your hand, then shuffle." CR 701.23a: the cards found must fit the description, taken together.
	testing.expect(t, supported(t, "Shared Summons"))
	g := new_game()
	s := &g.state
	bears1 := add(t, g, "Grizzly Bears", 0, .Library)
	bears2 := add(t, g, "Grizzly Bears", 0, .Library)
	elves := add(t, g, "Llanowar Elves", 0, .Library)
	cast_and_resolve(t, g, "Shared Summons", "Forest", 5)
	_, searching := s.waiting_for.(types.WaitingFor_SearchChoice)
	testing.expect(t, searching)
	testing.expect(t, !game.apply(g, 0, pick(bears1.id, bears2.id)), "two with the same name")
	testing.expect(t, game.apply(g, 0, pick(bears1.id, elves.id)))
	testing.expect(t, bears1.zone == .Hand && elves.zone == .Hand && bears2.zone == .Library)
	// The AI picks one of each name.
	g2 := new_game()
	add(t, g2, "Grizzly Bears", 0, .Library)
	add(t, g2, "Grizzly Bears", 0, .Library)
	add(t, g2, "Llanowar Elves", 0, .Library)
	cast_and_resolve(t, g2, "Shared Summons", "Forest", 5)
	action, ok := game.ai_action(g2, 0)
	testing.expect(t, ok && game.apply(g2, 0, action), "the AI's pick is legal")
}

@(test)
fblthp_searches_for_up_to_x :: proc(t: ^testing.T) {
	if !load_db() do return
	// Fblthp, Knows the Way ({X}{G}{G}): "When Fblthp enters, search your library for up to X basic land cards with
	// different names". CR 107.3m: X in its enters ability is the X paid to cast it.
	testing.expect(t, supported(t, "Fblthp, Knows the Way"))
	g := new_game()
	s := &g.state
	add(t, g, "Island", 0, .Library)
	for _ in 0 ..< 4 do add(t, g, "Forest", 0, .Battlefield)
	fblthp := add(t, g, "Fblthp, Knows the Way", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = fblthp.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseX{value = 2}))
	for _ in 0 ..< 4 {
		if _, searching := s.waiting_for.(types.WaitingFor_SearchChoice); searching do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	}
	w, searching := s.waiting_for.(types.WaitingFor_SearchChoice)
	testing.expectf(t, searching && w.count == 2 && w.up_to, "up to two: the X paid (%v %v %v)", searching, w.count, s.waiting_for)
}

@(test)
ai_answers_the_split_and_the_bottom_order :: proc(t: ^testing.T) {
	if !load_db() do return
	// The AI answers each prompt these effects raise: which found land goes where (Cultivate), and the order of the
	// rest on the bottom (Lead the Stampede).
	g := new_game()
	s := &g.state
	cast_and_resolve(t, g, "Cultivate", "Forest", 3)
	for _ in 0 ..< 3 {
		if stack_empty(g) && has_priority(g, 0) do break
		action, ok := game.ai_action(g, 0)
		testing.expect(t, ok && game.apply(g, 0, action), "the AI's answer is legal")
	}
	testing.expect(t, stack_empty(g) && has_priority(g, 0), "Cultivate resolved")
	g2 := new_game()
	cast_and_resolve(t, g2, "Lead the Stampede", "Forest", 3)
	for _ in 0 ..< 3 {
		if stack_empty(g2) && has_priority(g2, 0) do break
		action, ok := game.ai_action(g2, 0)
		testing.expect(t, ok && game.apply(g2, 0, action), "the AI's answer is legal")
	}
	testing.expect(t, stack_empty(g2) && has_priority(g2, 0), "Lead the Stampede resolved")
	_ = s
}

@(test)
traverse_the_outlands_counts_the_greatest_power :: proc(t: ^testing.T) {
	if !load_db() do return
	// Traverse the Outlands: "Search your library for up to X basic land cards, where X is the greatest power among
	// creatures you control." CR 608.2h: X is worked out as the search begins.
	testing.expect(t, supported(t, "Traverse the Outlands"))
	g := new_game()
	s := &g.state
	add(t, g, "Grizzly Bears", 0, .Battlefield)
	cast_and_resolve(t, g, "Traverse the Outlands", "Forest", 5)
	w, searching := s.waiting_for.(types.WaitingFor_SearchChoice)
	testing.expect(t, searching && w.count == 2 && w.up_to, "up to two: the Bears' power")
	if !searching do return
	testing.expect(t, !game.apply(g, 0, pick(w.cards[0], w.cards[1], w.cards[2])), "not three")
	testing.expect(t, game.apply(g, 0, pick(w.cards[0], w.cards[1])))
	testing.expect(t, game.object(s, w.cards[0]).zone == .Battlefield && game.object(s, w.cards[0]).tapped)
}

@(test)
eldritch_evolution_reads_the_sacrificed_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	// Eldritch Evolution: "As an additional cost to cast this spell, sacrifice a creature. Search your library for a
	// creature card with mana value X or less, where X is 2 plus the sacrificed creature's mana value. Put that card
	// onto the battlefield, then shuffle. Exile Eldritch Evolution." CR 608.2h: the sacrificed creature as it last
	// existed; CR 608.2n: exiled, not put into the graveyard.
	testing.expect(t, supported(t, "Eldritch Evolution"))
	testing.expect(t, !supported(t, "Neoform"), "Neoform: its +1/+1 counter is lost from the data")
	g := new_game()
	s := &g.state
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield) // mana value 2
	giant := add(t, g, "Hill Giant", 0, .Library) // 4
	angel := add(t, g, "Serra Angel", 0, .Library) // 5
	for _ in 0 ..< 3 do add(t, g, "Forest", 0, .Battlefield)
	spell := add(t, g, "Eldritch Evolution", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	testing.expect(t, game.apply(g, 0, pick(bears.id)), "the Bears sacrificed for the cost")
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	w, searching := s.waiting_for.(types.WaitingFor_SearchChoice)
	testing.expect(t, searching)
	if !searching do return
	found_giant, found_angel := false, false
	for id in w.cards {
		if id == giant.id do found_giant = true
		if id == angel.id do found_angel = true
	}
	testing.expect(t, found_giant && !found_angel, "mana value 4 or less: the Giant, not the Angel")
	testing.expect(t, game.apply(g, 0, pick(giant.id)))
	testing.expect(t, giant.zone == .Battlefield && spell.zone == .Exile)
}

@(test)
vannifar_searches_for_one_more_than_the_sacrificed :: proc(t: ^testing.T) {
	if !load_db() do return
	// Prime Speaker Vannifar: "{T}, Sacrifice another creature: Search your library for a creature card with mana
	// value equal to 1 plus the sacrificed creature's mana value, put that card onto the battlefield, then shuffle.
	// Activate only as a sorcery."
	testing.expect(t, supported(t, "Prime Speaker Vannifar"))
	g := new_game()
	s := &g.state
	vannifar := add(t, g, "Prime Speaker Vannifar", 0, .Battlefield)
	elves := add(t, g, "Llanowar Elves", 0, .Battlefield) // mana value 1
	bears := add(t, g, "Grizzly Bears", 0, .Library) // 2
	giant := add(t, g, "Hill Giant", 0, .Library) // 4
	testing.expect(t, activate(g, vannifar, 0))
	testing.expect(t, game.apply(g, 0, pick(elves.id)))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	w, searching := s.waiting_for.(types.WaitingFor_SearchChoice)
	testing.expect(t, searching && len(w.cards) == 1 && w.cards[0] == bears.id, "only mana value 2")
	if !searching do return
	testing.expect(t, !game.apply(g, 0, pick(giant.id)))
	testing.expect(t, game.apply(g, 0, pick(bears.id)))
	testing.expect(t, bears.zone == .Battlefield)
}

// ---- Looking at the top cards of a library ("dig") ----------------------------------------------------------------

// The library's cards from the bottom (index 0) up.
@(private = "file")
library_at :: proc(g: ^game.Game, p: types.PlayerId, i: int) -> types.ObjectId {
	return types.pvec_get(game.player(&g.state, p).library, i)
}

@(private = "file")
library_top :: proc(g: ^game.Game, p: types.PlayerId) -> types.ObjectId {
	lib := game.player(&g.state, p).library
	return types.pvec_get(lib, types.pvec_len(lib) - 1)
}

@(test)
any_number_and_the_rest_in_any_order :: proc(t: ^testing.T) {
	if !load_db() do return
	// Lead the Stampede: "Look at the top five cards of your library. You may reveal any number of creature cards
	// from among them and put the revealed cards into your hand. Put the rest on the bottom of your library in any
	// order." "Any number" is up to the creature cards there; CR 401.4: the owner chooses the order of the rest.
	g := new_game()
	s := &g.state
	bears1 := add(t, g, "Grizzly Bears", 0, .Library)
	bears2 := add(t, g, "Grizzly Bears", 0, .Library)
	cast_and_resolve(t, g, "Lead the Stampede", "Forest", 3)
	w, digging := s.waiting_for.(types.WaitingFor_DigChoice)
	testing.expect(t, digging && w.keep_count == 2 && len(w.selectable_cards) == 2, "the two creature cards")
	if !digging do return
	testing.expect(t, game.apply(g, 0, pick(bears1.id, bears2.id)))
	testing.expect(t, bears1.zone == .Hand && bears2.zone == .Hand)
	o, ordering := s.waiting_for.(types.WaitingFor_DigBottomOrder)
	testing.expect(t, ordering && len(o.cards) == 3, "the order of the other three")
	if !ordering do return
	testing.expect(t, !game.apply(g, 0, pick(o.cards[0], o.cards[1])), "all three")
	order := []types.ObjectId{o.cards[2], o.cards[0], o.cards[1]}
	testing.expect(t, game.apply(g, 0, pick(..order)))
	// The first named is the top of the three; the last, the bottommost.
	testing.expect(t, library_at(g, 0, 0) == order[2] && library_at(g, 0, 1) == order[1] && library_at(g, 0, 2) == order[0])
	testing.expect(t, stack_empty(g) && has_priority(g, 0), "resolved")
}

@(test)
put_one_back_on_top_and_the_rest_in_the_graveyard :: proc(t: ^testing.T) {
	if !load_db() do return
	// Sage of Days: "When this creature enters, look at the top three cards of your library. You may put one of
	// those cards back on top of your library. Put the rest into your graveyard."
	testing.expect(t, supported(t, "Sage of Days"))
	g := new_game()
	s := &g.state
	cast_and_resolve(t, g, "Sage of Days", "Island", 3)
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	w, digging := s.waiting_for.(types.WaitingFor_DigChoice)
	testing.expect(t, digging && len(w.cards) == 3 && w.up_to)
	if !digging do return
	keep := w.cards[1]
	testing.expect(t, !game.apply(g, 0, pick(w.cards[0], w.cards[1])), "one at most")
	testing.expect(t, game.apply(g, 0, pick(keep)))
	testing.expect(t, library_top(g, 0) == keep, "back on top")
	testing.expect(t, game.object(s, w.cards[0]).zone == .Graveyard && game.object(s, w.cards[2]).zone == .Graveyard)
}

@(test)
dig_onto_the_battlefield_refuses_auras :: proc(t: ^testing.T) {
	if !load_db() do return
	// Genesis Ultimatum: "Put any number of permanent cards from among them onto the battlefield and the rest into
	// your hand." A permanent card may be an Aura, whose host is chosen as it enters (CR 303.4f), which a dig doesn't
	// ask yet: refused, as are the other digs onto the battlefield that could take one.
	for name in ([]string{"Genesis Ultimatum", "Ajani, Outland Chaperone", "Storm the Festival", "United Battlefront"}) {
		testing.expectf(t, !supported(t, name), "%s: could put an Aura onto the battlefield", name)
	}
}

@(test)
spell_that_exiles_itself :: proc(t: ^testing.T) {
	if !load_db() do return
	// Flood of Recollection: "Return target instant or sorcery card from your graveyard to your hand. Exile Flood of
	// Recollection." It stays on the stack while it resolves, then goes to exile rather than to its owner's graveyard
	// (CR 608.2n).
	g := new_game()
	for _ in 0 ..< 2 do add(t, g, "Island", 0, .Battlefield)
	opt := add(t, g, "Opt", 0, .Graveyard)
	flood := add(t, g, "Flood of Recollection", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = flood.id}))
	if _, targeting := g.state.waiting_for.(types.WaitingFor_TargetSelection); targeting {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{opt.id}}))
	}
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	testing.expect(t, opt.zone == .Hand, "Opt returned")
	testing.expect(t, flood.zone == .Exile, "exiled, not in the graveyard")
}

@(test)
lands_onto_the_battlefield_then_shuffle :: proc(t: ^testing.T) {
	if !load_db() do return
	// Through the Forest Gate: "Look at the top twenty cards of your library, put any number of land cards from among
	// them onto the battlefield tapped, then shuffle. You gain 8 life." The rest stay in the library, which is then
	// shuffled (CR 701.24a).
	testing.expect(t, supported(t, "Through the Forest Gate"))
	g := new_game()
	s := &g.state
	n := types.pvec_len(game.player(s, 0).library)
	cast_and_resolve(t, g, "Through the Forest Gate", "Forest", 8)
	w, digging := s.waiting_for.(types.WaitingFor_DigChoice)
	testing.expect(t, digging && len(w.cards) == 20 && w.keep_count == 20)
	if !digging do return
	testing.expect(t, game.apply(g, 0, pick(w.cards[0], w.cards[5])))
	testing.expect(t, game.object(s, w.cards[0]).zone == .Battlefield && game.object(s, w.cards[5]).tapped, "tapped")
	testing.expect_value(t, types.pvec_len(game.player(s, 0).library), n - 2)
	testing.expect_value(t, game.player(s, 0).life, 28)
	// Data that drops where the rest go ("one into your graveyard, and one on the bottom") is refused.
	testing.expect(t, !supported(t, "Moment of Truth"), "Moment of Truth: lost words")
	testing.expect(t, !supported(t, "Accumulate Wisdom"), "Accumulate Wisdom: lost words")
}

@(test)
put_x_cards_into_the_hand :: proc(t: ^testing.T) {
	if !load_db() do return
	// Stargaze: "Look at twice X cards from the top of your library. Put X cards from among them into your hand and
	// the rest into your graveyard. You lose X life." CR 107.3a: X as announced.
	testing.expect(t, supported(t, "Stargaze"))
	g := new_game()
	s := &g.state
	for _ in 0 ..< 4 do add(t, g, "Swamp", 0, .Battlefield)
	spell := add(t, g, "Stargaze", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseX{value = 2}))
	game.apply(g, 0, types.GameAction_PassPriority{})
	game.apply(g, 1, types.GameAction_PassPriority{})
	w, digging := s.waiting_for.(types.WaitingFor_DigChoice)
	testing.expect(t, digging && len(w.cards) == 4 && w.keep_count == 2 && !w.up_to, "four cards, two kept")
	if !digging do return
	testing.expect(t, !game.apply(g, 0, pick(w.cards[0])), "X cards, not fewer")
	testing.expect(t, game.apply(g, 0, pick(w.cards[0], w.cards[3])))
	testing.expect(t, game.object(s, w.cards[1]).zone == .Graveyard && game.object(s, w.cards[3]).zone == .Hand)
	testing.expect_value(t, game.player(s, 0).life, 18)
}
