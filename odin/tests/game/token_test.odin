// Rules tests for token-creating effects (CR 111, 707): who creates them, what they're created with, predefined
// tokens and copies with exceptions. Same helpers as game_test.odin.
package game_test

import "core:testing"
import game "../../engine/game"
import types "../../engine/types"

// The first token effect in a card's abilities or triggers, as the card data has it.
@(private = "file")
token_effect_of :: proc(t: ^testing.T, name: string) -> (types.Effect_Token, bool) {
	face := &card(t, name).face
	find :: proc(a: ^types.AbilityDefinition) -> (types.Effect_Token, bool) {
		for x := a; x != nil; x = x.sub_ability {
			if x.effect == nil do continue
			if tok, is_token := x.effect^.(types.Effect_Token); is_token do return tok, true
		}
		return {}, false
	}
	for &a in face.abilities do if tok, ok := find(&a); ok do return tok, true
	for &tr in face.triggers do if tok, ok := find(tr.execute); ok do return tok, true
	return {}, false
}

// Creates the card's token for a player, as its effect describes it; the newest permanent.
@(private = "file")
make_token :: proc(t: ^testing.T, g: ^game.Game, name: string, p: types.PlayerId) -> ^types.GameObject {
	e, ok := token_effect_of(t, name)
	testing.expectf(t, ok, "%s makes a token", name)
	game.create_token(g, e, p)
	ids := game.ids_of(g.state.battlefield)
	o := game.object(&g.state, ids[len(ids) - 1])
	o.summoning_sick = false
	return o
}

@(private = "file")
pass_until_empty :: proc(g: ^game.Game) {
	for _ in 0 ..< 10 {
		if types.pvec_len(g.state.stack) == 0 do return
		game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
	}
}

@(private = "file")
newest_token :: proc(g: ^game.Game) -> ^types.GameObject {
	out: ^types.GameObject
	for id in game.ids_of(g.state.battlefield) do if o := game.object(&g.state, id); o.is_token do out = o
	return out
}

@(test)
pilot_token_crews_as_though_power_were_two_greater :: proc(t: ^testing.T) {
	if !load_db() do return
	// Country Roads: "{1}{W}, {T}, Sacrifice this land: Create a 1/1 colorless Pilot creature token with 'This
	// token saddles Mounts and crews Vehicles as though its power were 2 greater.'" CR 702.122a: crew N taps
	// creatures with total power N or greater; the Pilot (power 1) counts as 3. Reckoner Bankbuster has crew 3.
	for name in ([]string{"Country Roads", "Reckoner Bankbuster", "Back on Track", "Hotshot Mechanic", "Giant Ox"}) {
		testing.expectf(t, game.card_supported(&card(t, name).face), "%s is supported", name)
	}
	g := new_game()
	s := &g.state
	bankbuster := add(t, g, "Reckoner Bankbuster", 0, .Battlefield)
	pilot := make_token(t, g, "Country Roads", 0)
	pilot.summoning_sick = true // crewing isn't a {T} cost (CR 302.6 doesn't apply)
	testing.expect(t, pilot.power.? == 1 && game.crew_value(pilot) == 3, "power 1, crews as 3")
	testing.expect(t, game.apply(g, 0, types.GameAction_CrewVehicle{vehicle_id = bankbuster.id}))
	crew: [dynamic]types.ObjectId
	append(&crew, pilot.id)
	testing.expect(t, game.apply(g, 0, types.GameAction_CrewVehicle{vehicle_id = bankbuster.id, creature_ids = crew}), "the Pilot alone crews 3")
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, game.is_type(bankbuster, .Creature), "crewed")

	// Without the ability, a 2-power creature alone can't crew 3.
	g2 := new_game()
	bankbuster2 := add(t, g2, "Reckoner Bankbuster", 0, .Battlefield)
	add(t, g2, "Grizzly Bears", 0, .Battlefield)
	testing.expect(t, !game.apply(g2, 0, types.GameAction_CrewVehicle{vehicle_id = bankbuster2.id}), "Grizzly Bears can't crew 3")
	// Giant Ox: "crews Vehicles using its toughness rather than its power" (0/6).
	ox := add(t, g2, "Giant Ox", 0, .Battlefield)
	testing.expect(t, game.crew_value(ox) == 6, "the Ox crews as 6")
}

@(test)
token_that_can_block_only_fliers :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 509.1b: a restriction on blocking. Into the Fae Court's Faerie: "This token can block only creatures with
	// flying." Realm of Koh's Spirit: "This token can't block or be blocked by non-Spirit creatures."
	for name in ([]string{"Into the Fae Court", "Station Monitor", "Realm of Koh", "Lost in the Spirit World", "Rishadan Airship", "Hinterland Drake"}) {
		testing.expectf(t, game.card_supported(&card(t, name).face), "%s is supported", name)
	}
	g := new_game()
	faerie := make_token(t, g, "Into the Fae Court", 1)
	spirit := make_token(t, g, "Realm of Koh", 1)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	drake := add(t, g, "Wind Drake", 0, .Battlefield) // a 2/2 flier
	testing.expect(t, !game.can_block(g, faerie, bears), "the Faerie can't block a creature without flying")
	testing.expect(t, game.can_block(g, faerie, drake), "but can block a flier")
	testing.expect(t, !game.can_block(g, spirit, bears), "the Spirit can't block a non-Spirit")
	their_spirit := make_token(t, g, "Realm of Koh", 0)
	testing.expect(t, game.can_block(g, spirit, their_spirit), "it can block a Spirit")
	their_bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	testing.expect(t, !game.can_block(g, their_bears, their_spirit), "a non-Spirit can't block the Spirit")
	testing.expect(t, game.can_block(g, their_bears, bears), "while Grizzly Bears block Grizzly Bears as ever")
	// Hinterland Drake, printed: "This creature can't block artifact creatures."
	hinterland := add(t, g, "Hinterland Drake", 1, .Battlefield)
	construct := add(t, g, "Ornithopter", 0, .Battlefield) // an 0/2 artifact creature with flying
	testing.expect(t, !game.can_block(g, hinterland, construct) && game.can_block(g, hinterland, drake), "not artifact creatures")
}

@(test)
target_opponent_creates_the_token :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 111.2: the player who creates a token is its owner and controller. Wanted Scoundrels: "When this creature
	// dies, target opponent creates two Treasure tokens."
	for name in ([]string{"Wanted Scoundrels", "Baffling End", "Dowsing Dagger", "The Sentry, Golden Guardian", "Gravedig", "Relic Robber"}) {
		testing.expectf(t, game.card_supported(&card(t, name).face), "%s is supported", name)
	}
	g := new_game()
	s := &g.state
	scoundrels := add(t, g, "Wanted Scoundrels", 0, .Battlefield)
	game.destroy(g, scoundrels)
	game.give_priority(g, 0)
	if _, asked := s.waiting_for.(types.WaitingFor_TriggerTargetSelection); asked {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Player{1}}))
	}
	for types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	treasures := 0
	for id in game.ids_of(s.battlefield) do if o := game.object(s, id); o.is_token {
		testing.expect(t, o.controller == 1 && o.owner == 1 && o.name == "Treasure", "the opponent's Treasure")
		treasures += 1
	}
	testing.expect(t, treasures == 2, "two Treasures")

	// A token another player creates with an amount counted for "you" isn't read.
	e, _ := token_effect_of(t, "Wanted Scoundrels")
	e.count = types.QuantityExpr_Ref{qty = types.QuantityRef_HandSize{}}
	testing.expect(t, !game.effect_supported(e, nil), "a counted number of tokens for another player: refused")
}

@(test)
relic_robber_that_player_creates :: proc(t: ^testing.T) {
	if !load_db() do return
	// Relic Robber: "Whenever this creature deals combat damage to a player, that player creates a 0/1 colorless
	// Goblin Construct artifact creature token with 'This token can't block' and 'At the beginning of your upkeep,
	// this token deals 1 damage to you.'" (CR 608.2c: "that player" is the damaged player.)
	g := new_game()
	s := &g.state
	robber := add(t, g, "Relic Robber", 0, .Battlefield)
	game.begin_step(g, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{robber.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	for _ in 0 ..< 12 {
		if s.phase == .PostCombatMain do break
		game.apply(g, s.priority_player, types.GameAction_PassPriority{})
		if _, blocks := s.waiting_for.(types.WaitingFor_DeclareBlockers); blocks {
			game.apply(g, 1, types.GameAction_DeclareBlockers{})
		}
	}
	construct := newest_token(g)
	testing.expect(t, construct != nil && construct.controller == 1 && construct.name == "Goblin Construct", "the damaged player's token")
}

@(test)
gold_and_vibranium_tokens :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 111.10c: a Gold token has "Sacrifice this token: Add one mana of any color." CR 111.10w: a Vibranium token
	// has indestructible and "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell."
	testing.expect(t, game.card_supported(&card(t, "The First Iroan Games").face))
	testing.expect(t, game.card_supported(&card(t, "T'Challa, the Black Panther").face))
	// Map tokens (CR 111.10s: "target creature you control explores") aren't made: explore isn't carried out.
	testing.expect(t, !game.card_supported(&card(t, "Restless Anchorage").face), "a Map token: refused")
	g := new_game()
	e: types.Effect_Token
	e.name = "Gold"
	append(&e.types, "Artifact", "Gold")
	e.power, e.toughness = types.PtValue_Fixed{0}, types.PtValue_Fixed{0}
	game.create_token(g, e, 0)
	gold := newest_token(g)
	testing.expect(t, gold != nil && gold.abilities != nil && len(gold.abilities^) == 1, "Gold has its ability")
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = gold.id, ability_index = 0}), "sacrificed for mana")
	if w, asked := g.state.waiting_for.(types.WaitingFor_ChooseManaColor); asked {
		_ = w
		game.apply(g, 0, types.GameAction_ChooseManaColor{choice = types.ManaChoice_SingleColor{.Red}})
	}
	testing.expect(t, gold.zone != .Battlefield, "Gold is sacrificed")
	testing.expect(t, len(game.player(&g.state, 0).mana_pool.mana) == 1, "one mana")

	vibranium := make_token(t, g, "T'Challa, the Black Panther", 0)
	testing.expect(t, vibranium.name == "Vibranium" && vibranium.tapped, "a tapped Vibranium token")
	testing.expect(t, game.has_keyword(vibranium, types.Keyword_Indestructible), "indestructible")
	testing.expect(t, vibranium.abilities != nil && len(vibranium.abilities^) == 1, "with its mana ability")
}

@(test)
copy_token_with_exceptions :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 707.9b: Croaking Counterpart: "Create a token that's a copy of target non-Frog creature, except it's a 1/1
	// green Frog." The exceptions are its copiable values: a Clone copying the token is a 1/1 green Frog too.
	for name in ([]string{"Croaking Counterpart", "Multiversal Recruitment", "Urza, Prince of Kroog", "Heat Shimmer", "Electroduplicate", "Impostor Syndrome", "Ratadrabik of Urborg", "Rebuild the City", "Littjara Mirrorlake"}) {
		testing.expectf(t, game.card_supported(&card(t, name).face), "%s is supported", name)
	}
	// "Except it's a Food artifact ... and it loses all other card types" (Shelob): not carried out yet.
	testing.expect(t, !game.card_supported(&card(t, "Shelob, Child of Ungoliant").face), "Shelob: refused")
	g := new_game()
	s := &g.state
	for _ in 0 ..< 5 do add(t, g, "Island", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	counterpart := add(t, g, "Croaking Counterpart", 0, .Hand) // {1}{G}{U}
	add(t, g, "Forest", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = counterpart.id}))
	if _, targeting := s.waiting_for.(types.WaitingFor_TargetSelection); targeting {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	}
	pass_until_empty(g)
	frog := newest_token(g)
	testing.expect(t, frog != nil && frog.controller == 0, "the caster's token")
	if frog == nil do return
	testing.expect(t, frog.name == "Grizzly Bears" && frog.power.? == 1 && frog.toughness.? == 1, "named Grizzly Bears, 1/1")
	testing.expect(t, game.has_subtype(frog, "Frog") && !game.has_subtype(frog, "Bear"), "a Frog, not a Bear")
	testing.expect(t, len(frog.color) == 1 && frog.color[0] == .Green, "green")
	testing.expect(t, bears.power.? == 2 && game.has_subtype(bears, "Bear"), "the original is unchanged")
	// A copy of the token takes its exceptions (CR 707.9b).
	second := game.create_copy_token(g, frog, 0, false)
	testing.expect(t, second.power.? == 1 && game.has_subtype(second, "Frog") && !game.has_subtype(second, "Bear"), "a copy of the copy: a 1/1 Frog too")
}

@(test)
copy_exception_drops_the_defining_ability :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 707.9d: an exception giving power and toughness a value means the copied characteristic-defining ability
	// for them isn't copied. Nightmare Shepherd copies are 1/1 ("except it's 1/1 and it's a Nightmare"): a copy of
	// Tarmogoyf stays 1/1 with cards in graveyards. Without the exception, a copy has the ability.
	g := new_game()
	goyf := add(t, g, "Tarmogoyf", 0, .Battlefield)
	add(t, g, "Lightning Bolt", 0, .Graveyard)
	add(t, g, "Grizzly Bears", 1, .Graveyard)
	game.apply_continuous_effects(g)
	mods: [dynamic]types.ContinuousModification
	append(&mods, types.ContinuousModification(types.ContinuousModification_SetPower{value = 1}))
	append(&mods, types.ContinuousModification(types.ContinuousModification_SetToughness{value = 1}))
	append(&mods, types.ContinuousModification(types.ContinuousModification_AddSubtype{subtype = "Nightmare"}))
	shepherd_copy := game.create_copy_token(g, goyf, 0, false, mods[:])
	plain_copy := game.create_copy_token(g, goyf, 0, false)
	game.apply_continuous_effects(g)
	testing.expect(t, goyf.power.? == 2 && goyf.toughness.? == 3, "Tarmogoyf: instant and creature, 2/3")
	testing.expect(t, shepherd_copy.power.? == 1 && shepherd_copy.toughness.? == 1, "the excepted copy: 1/1")
	testing.expect(t, game.has_subtype(shepherd_copy, "Nightmare"), "and a Nightmare")
	testing.expect(t, plain_copy.power.? == 2 && plain_copy.toughness.? == 3, "the plain copy has the ability")
}

@(test)
electroduplicate_copy_with_haste_sacrificed_at_end_step :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 707.9a: Electroduplicate: "Create a token that's a copy of target creature you control, except it has haste
	// and 'At the beginning of the end step, sacrifice this token.'" The original doesn't gain either.
	g := new_game()
	s := &g.state
	for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	spell := add(t, g, "Electroduplicate", 0, .Hand) // {2}{R}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	if _, targeting := s.waiting_for.(types.WaitingFor_TargetSelection); targeting {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	}
	pass_until_empty(g)
	copy := newest_token(g)
	testing.expect(t, copy != nil && game.has_keyword(copy, types.Keyword_Haste) && !game.has_keyword(bears, types.Keyword_Haste), "the copy has haste")
	if copy == nil do return
	testing.expect(t, game.can_attack(g, copy), "and can attack this turn")
	game.begin_step(g, .End)
	for _ in 0 ..< 6 do if types.pvec_len(s.stack) > 0 do game.apply(g, s.priority_player, types.GameAction_PassPriority{})
	testing.expect(t, copy.zone != .Battlefield && bears.zone == .Battlefield, "the copy is sacrificed at the end step")
}

@(test)
copy_of_a_token_and_copies_that_may_be_auras :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 707.2, 111.1: a token's copiable values are those it was created with: a copy of a Pest token is a Pest
	// with its dies trigger.
	g := new_game()
	pest := make_token(t, g, "Pest Summoning", 0)
	copy := game.create_copy_token(g, pest, 0, true)
	testing.expect(t, copy != nil && copy.id != pest.id && copy.name == "Pest" && copy.tapped && copy.is_token, "a tapped Pest token")
	if copy != nil do testing.expect(t, copy.power.? == 1 && copy.trigger_definitions != nil, "with the Pest's values")
	// Replicator: "{2}, {T}: Create a tapped token that's a copy of target token you control." The token could be a
	// Role, an Aura: its copy would enter without being cast, its controller choosing what it enchants (CR 303.4f),
	// which isn't done yet. Refused, like "another target nonland permanent you control" (Extravagant Replication).
	for name in ([]string{"Replicator", "Esika's Chariot", "Specimen Collector", "Three Blind Mice", "Extravagant Replication"}) {
		testing.expectf(t, !game.card_supported(&card(t, name).face), "%s: refused", name)
	}
	// "Target non-Aura permanent you control" (Applied Geometry), a creature, a dying creature: never an Aura.
	for name in ([]string{"Applied Geometry", "Multiversal Recruitment", "Nightmare Shepherd", "Impostor Syndrome", "Miirym, Sentinel Wyrm", "Necroduality"}) {
		testing.expectf(t, game.card_supported(&card(t, name).face), "%s is supported", name)
	}
	// "Whenever an enchantment you control enters, create a token that's a copy of it" (Ondu Spiritdancer): it may
	// be an Aura. A Dragon or a Zombie can't (the kindred Auras are Rebels, Eldrazi, Treefolk and Lhurgoyfs).
	testing.expect(t, !game.card_supported(&card(t, "Ondu Spiritdancer").face), "Ondu Spiritdancer: refused")
	// "Target token an opponent controls" is a permanent (Kraul Whipcracker: "destroy target token ...").
	testing.expect(t, game.card_supported(&card(t, "Kraul Whipcracker").face))
}

@(test)
nightmare_shepherd_copies_the_exiled_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	// Nightmare Shepherd: "Whenever another nontoken creature you control dies, you may exile it. If you do, create
	// a token that's a copy of that creature, except it's 1/1 and it's a Nightmare in addition to its other types."
	// CR 608.2h: the creature has left the battlefield; the copy uses its last known information.
	for accept in ([]bool{true, false}) {
		g := new_game()
		s := &g.state
		add(t, g, "Nightmare Shepherd", 0, .Battlefield)
		bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
		game.destroy(g, bears)
		game.give_priority(g, 0)
		for _ in 0 ..< 10 {
			if _, may := s.waiting_for.(types.WaitingFor_OptionalEffectChoice); may {
				game.apply(g, s.priority_player, types.GameAction_DecideOptionalEffect{accept = accept})
				continue
			}
			if types.pvec_len(s.stack) == 0 do break
			game.apply(g, s.priority_player, types.GameAction_PassPriority{})
		}
		copy := newest_token(g)
		if !accept {
			testing.expect(t, copy == nil && bears.zone == .Graveyard, "declined: no exile, no token")
			continue
		}
		testing.expect(t, bears.zone == .Exile, "exiled")
		testing.expect(t, copy != nil, "a token copy")
		if copy == nil do continue
		testing.expect(t, copy.name == "Grizzly Bears" && copy.power.? == 1 && copy.toughness.? == 1, "a 1/1 Grizzly Bears")
		testing.expect(t, game.has_subtype(copy, "Nightmare") && game.has_subtype(copy, "Bear"), "a Nightmare Bear")
	}
}

// The Role attached to a creature, if one is.
@(private = "file")
role_on :: proc(g: ^game.Game, host: ^types.GameObject) -> ^types.GameObject {
	for id in host.attachments do if o := game.object(&g.state, id); o != nil && game.has_subtype(o, "Role") do return o
	return nil
}

@(test)
monster_role_attached_to_the_target :: proc(t: ^testing.T) {
	if !load_db() do return
	// Monstrous Rage: "Target creature gets +2/+0 until end of turn. Create a Monster Role token attached to it."
	// CR 111.10k: a colorless Aura Role enchantment token named Monster with enchant creature and "Enchanted creature
	// gets +1/+1 and has trample." CR 303.4i: it's created attached to that creature.
	for name in ([]string{"Monstrous Rage", "Royal Treatment", "Return Triumphant", "Charmed Clothier", "Redtooth Genealogist", "Spiteful Hexmage", "Embereth Veteran", "The Witch's Vanity"}) {
		testing.expectf(t, game.card_supported(&card(t, name).face), "%s is supported", name)
	}
	g := new_game()
	s := &g.state
	add(t, g, "Mountain", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	rage := add(t, g, "Monstrous Rage", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = rage.id}))
	if _, targeting := s.waiting_for.(types.WaitingFor_TargetSelection); targeting {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = types.TargetRef_Object{bears.id}}))
	}
	pass_until_empty(g)
	role := role_on(g, bears)
	testing.expect(t, role != nil, "a Role on the Bears")
	if role == nil do return
	testing.expect(t, role.name == "Monster" && role.is_token && role.controller == 0 && len(role.color) == 0, "a colorless token named Monster")
	testing.expect(t, game.is_type(role, .Enchantment) && game.has_subtype(role, "Aura") && game.is_aura(role), "an Aura Role enchantment with enchant creature")
	testing.expect(t, bears.power.? == 5 && bears.toughness.? == 3, "+2/+0 and +1/+1: 5/3")
	testing.expect(t, game.has_keyword(bears, types.Keyword_Trample), "trample")
	// The creature dies: the Role goes to the graveyard (CR 704.5m) and ceases to exist (CR 704.5d).
	game.destroy(g, bears)
	game.check_state_based_actions(g)
	testing.expect(t, role.zone != .Battlefield, "the Role is gone with its creature")
}

@(test)
one_role_per_controller_on_a_permanent :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 303.7a, 704.5z: if a permanent has more than one Role controlled by the same player attached to it, each
	// but the one with the most recent timestamp goes to its owner's graveyard. Another player's Role stays.
	g := new_game()
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	royal, _ := token_effect_of(t, "Royal Treatment")
	monster, _ := token_effect_of(t, "Monstrous Rage")
	first := game.create_token(g, royal, 0, 0, bears)
	game.check_state_based_actions(g)
	testing.expect(t, first != nil && first.name == "Royal" && game.has_keyword(bears, types.Keyword_Ward), "Royal: ward")
	theirs := game.create_token(g, monster, 1, 0, bears) // another player's Role
	second := game.create_token(g, monster, 0, 0, bears)
	game.check_state_based_actions(g)
	testing.expect(t, first.zone != .Battlefield, "the older Role of the same controller is put into the graveyard")
	testing.expect(t, second.zone == .Battlefield && theirs.zone == .Battlefield, "the newer one and the other player's stay")
	testing.expect(t, bears.power.? == 4 && bears.toughness.? == 4, "two Monster Roles: 4/4")
}

@(test)
cursed_and_wicked_roles :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 111.10j: Cursed: "Enchanted creature has base power and toughness 1/1" (layer 7b). CR 111.10q: Wicked:
	// "Enchanted creature gets +1/+1" and "When this token is put into a graveyard from the battlefield, each
	// opponent loses 1 life."
	g := new_game()
	s := &g.state
	ogre := add(t, g, "Gray Ogre", 1, .Battlefield) // 2/2
	cursed, _ := token_effect_of(t, "Spiteful Hexmage")
	game.create_token(g, cursed, 0, 0, ogre)
	game.apply_continuous_effects(g)
	testing.expect(t, ogre.power.? == 1 && ogre.toughness.? == 1, "Cursed: 1/1")
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	wicked, _ := token_effect_of(t, "Monstrous Rage") // the same Role effect, named Wicked (The Witch's Vanity's)
	wicked.name = "Wicked Role"
	role := game.create_token(g, wicked, 0, 0, bears)
	game.apply_continuous_effects(g)
	testing.expect(t, role != nil && role.name == "Wicked" && bears.power.? == 3, "Wicked: +1/+1")
	game.destroy(g, bears)
	game.check_state_based_actions(g)
	game.give_priority(g, 0)
	pass_until_empty(g)
	testing.expect(t, game.player(s, 1).life == 19 && game.player(s, 0).life == 20, "each opponent loses 1 life")
}

@(test)
young_hero_role_counter_while_toughness_is_three_or_less :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 111.10r: Young Hero: enchanted creature has "Whenever this creature attacks, if its toughness is 3 or less,
	// put a +1/+1 counter on it" (an intervening "if", CR 603.4).
	for big in ([]bool{false, true}) {
		g := new_game()
		attacker := add(t, g, "Grizzly Bears", 0, .Battlefield) // 2/2
		if big do game.add_counters(attacker, types.CounterType_Plus1Plus1{}, 2) // 4/4
		hero, _ := token_effect_of(t, "Return Triumphant")
		game.create_token(g, hero, 0, 0, attacker)
		game.apply_continuous_effects(g)
		game.begin_step(g, .DeclareAttackers)
		attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{attacker.id, types.AttackTarget_Player{1}}}
		testing.expect(t, game.apply(g, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
		pass_until_empty(g)
		counters := game.counter_count(attacker, types.CounterType_Plus1Plus1{})
		if big do testing.expect(t, counters == 2, "toughness 4: no counter")
		else do testing.expect(t, counters == 1, "toughness 2: a +1/+1 counter")
	}
}

@(test)
role_isnt_created_without_a_legal_creature :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 303.4i: an Aura put onto the battlefield attached to an object it can't legally enchant isn't created, if
	// it's a token. A Role on a noncreature, or on a creature card that left the battlefield.
	g := new_game()
	monster, _ := token_effect_of(t, "Monstrous Rage")
	land := add(t, g, "Forest", 0, .Battlefield)
	testing.expect(t, game.create_token(g, monster, 0, 0, land) == nil, "not on a land")
	bears := add(t, g, "Grizzly Bears", 0, .Graveyard)
	testing.expect(t, game.create_token(g, monster, 0, 0, bears) == nil, "not on a card in a graveyard")
	testing.expect(t, newest_token(g) == nil, "no token")
	// "Create a Cursed Role token attached to it" with no earlier target ("it" is the creature itself, Cursed
	// Courtier) isn't read; nor "up to one target creature" where the data lost "up to one" (Cut In); nor the
	// Virtuous Role, not made yet.
	testing.expect(t, !game.card_supported(&card(t, "Cursed Courtier").face), "Cursed Courtier: refused")
	testing.expect(t, !game.card_supported(&card(t, "Cut In").face), "Cut In: refused")
	virtuous := monster
	virtuous.name = "Virtuous Role"
	testing.expect(t, !game.role_token_supported(virtuous), "a Virtuous Role: refused")
}

// Plays the stack out: passes priority, says yes to "you may", pays optional costs, and targets `prefer` when it's
// a legal choice (else the first legal one).
@(private = "file")
drive :: proc(t: ^testing.T, g: ^game.Game, prefer: types.ObjectId = 0) {
	s := &g.state
	pick :: proc(legal: []types.TargetRef, prefer: types.ObjectId) -> types.TargetRef {
		for l in legal do if id, ok := l.(types.TargetRef_Object); ok && id._0 == prefer do return l
		return legal[0]
	}
	for _ in 0 ..< 30 {
		#partial switch w in s.waiting_for {
		case types.WaitingFor_OptionalEffectChoice:
			game.apply(g, w.player, types.GameAction_DecideOptionalEffect{accept = true})
		case types.WaitingFor_TriggerTargetSelection:
			if len(w.selection.current_legal_targets) == 0 do return
			game.apply(g, w.player, types.GameAction_ChooseTarget{target = pick(w.selection.current_legal_targets[:], prefer)})
		case types.WaitingFor_TargetSelection:
			if len(w.selection.current_legal_targets) == 0 do return
			game.apply(g, w.player, types.GameAction_ChooseTarget{target = pick(w.selection.current_legal_targets[:], prefer)})
		case types.WaitingFor_PayCost:
			chosen := make([dynamic]types.ObjectId, context.temp_allocator)
			for id in w.choices[:w.count] do append(&chosen, id)
			game.apply(g, w.player, types.GameAction_SelectCards{cards = chosen})
		case:
			if types.pvec_len(s.stack) == 0 do return
			game.apply(g, s.priority_player, types.GameAction_PassPriority{})
		}
	}
}

@(test)
dies_copy_uses_last_known_information :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 608.2h, 707.2: Nightmare Shepherd's token copies the creature as it last existed on the battlefield: a Clone
	// that was copying Grizzly Bears makes a 1/1 Grizzly Bears Nightmare, not a Clone.
	g := new_game()
	add(t, g, "Nightmare Shepherd", 0, .Battlefield)
	clone := add(t, g, "Clone", 0, .Battlefield)
	game.become_copy(clone, &card(t, "Grizzly Bears").face)
	game.apply_continuous_effects(g)
	game.destroy(g, clone)
	game.give_priority(g, 0)
	drive(t, g)
	copy := newest_token(g)
	testing.expect(t, clone.zone == .Exile && copy != nil, "exiled; a token")
	if copy != nil do testing.expect(t, copy.name == "Grizzly Bears" && copy.power.? == 1 && game.has_subtype(copy, "Nightmare"), "a 1/1 Grizzly Bears Nightmare")

	// Ratadrabik of Urborg: "Whenever another legendary creature you control dies, create a token that's a copy of
	// that creature, except it's not legendary and it's a 2/2 black Zombie in addition to its other colors and
	// types." A legendary token that died (CR 111.7: it has ceased to exist) is copied as it last existed.
	g2 := new_game()
	add(t, g2, "Ratadrabik of Urborg", 0, .Battlefield)
	void := make_token(t, g2, "The Sentry, Golden Guardian", 0) // The Void, a legendary 5/5 black Horror Villain
	game.move_object(g2, void.id, .Graveyard) // it dies (indestructible: not destroyed)
	game.check_state_based_actions(g2)
	game.give_priority(g2, 0)
	drive(t, g2)
	zombie := newest_token(g2)
	testing.expect(t, zombie != nil && zombie.id != void.id, "a copy of The Void")
	if zombie == nil || zombie.id == void.id do return
	testing.expect(t, zombie.name == "The Void" && zombie.power.? == 2 && zombie.toughness.? == 2, "The Void, 2/2")
	testing.expect(t, !game.has_supertype(zombie, .Legendary) && game.has_subtype(zombie, "Zombie") && game.has_subtype(zombie, "Horror"), "not legendary, a Zombie Horror")
	testing.expect(t, game.has_color(zombie, .Black) && game.has_keyword(zombie, types.Keyword_Flying), "black, with The Void's flying")
}

@(test)
role_spells_cast_and_resolved :: proc(t: ^testing.T) {
	if !load_db() do return
	// Return Triumphant: "Return target creature card with mana value 3 or less from your graveyard to the
	// battlefield. Create a Young Hero Role token attached to it." CR 608.2c, 400.7: "it" is the creature the card
	// became on the battlefield.
	g := new_game()
	for _ in 0 ..< 2 do add(t, g, "Plains", 0, .Battlefield)
	bears := add(t, g, "Grizzly Bears", 0, .Graveyard)
	spell := add(t, g, "Return Triumphant", 0, .Hand) // {1}{W}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = spell.id}))
	drive(t, g, bears.id)
	testing.expect(t, bears.zone == .Battlefield, "returned")
	role := role_on(g, bears)
	testing.expect(t, role != nil && role.name == "Young Hero", "with a Young Hero Role")

	// Merry Bards: "When this creature enters, you may pay {1}. When you do, create a Young Hero Role token attached
	// to target creature you control." The Role is made by the reflexive trigger (CR 603.12).
	g2 := new_game()
	for _ in 0 ..< 4 do add(t, g2, "Mountain", 0, .Battlefield)
	bears2 := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	bards := add(t, g2, "Merry Bards", 0, .Hand) // {2}{R}
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = bards.id}))
	drive(t, g2, bears2.id)
	testing.expect(t, bards.zone == .Battlefield, "Merry Bards entered")
	role2 := role_on(g2, bears2)
	testing.expect(t, role2 != nil && role2.name == "Young Hero" && tapped_lands_count(g2) == 4, "paid {1}: a Young Hero Role on the Bears")

	// Applied Geometry: "Create a token that's a copy of target non-Aura permanent you control, except it's a 0/0
	// Fractal creature in addition to its other types. Put six +1/+1 counters on it."
	g3 := new_game()
	for _ in 0 ..< 3 do add(t, g3, "Island", 0, .Battlefield)
	for _ in 0 ..< 2 do add(t, g3, "Forest", 0, .Battlefield)
	ring := add(t, g3, "Sol Ring", 0, .Battlefield)
	geometry := add(t, g3, "Applied Geometry", 0, .Hand) // {2}{G}{U}
	testing.expect(t, game.apply(g3, 0, types.GameAction_CastSpell{object_id = geometry.id}))
	drive(t, g3, ring.id)
	fractal := newest_token(g3)
	testing.expect(t, fractal != nil, "a token")
	if fractal == nil do return
	testing.expect(t, fractal.name == "Sol Ring" && game.is_type(fractal, .Creature) && game.is_type(fractal, .Artifact) && game.has_subtype(fractal, "Fractal"), "a Sol Ring Fractal artifact creature")
	testing.expect(t, fractal.power.? == 6 && fractal.toughness.? == 6, "0/0 with six +1/+1 counters")
}

@(private = "file")
tapped_lands_count :: proc(g: ^game.Game) -> int {
	n := 0
	for id in game.ids_of(g.state.battlefield) do if o := game.object(&g.state, id); game.is_type(o, .Land) && o.tapped do n += 1
	return n
}

@(test)
token_filters_in_costs_triggers_and_statics :: proc(t: ^testing.T) {
	if !load_db() do return
	// "A token" names a permanent (CR 111.1): Hardened Tactician's "{1}, Sacrifice a token: Draw a card", Nadier's
	// Nightblade's "Whenever a token you control leaves the battlefield", Starry-Eyed Skyrider's "Attacking tokens
	// you control have flying", Druid of the Spade's "As long as you control a token".
	g := new_game()
	s := &g.state
	add(t, g, "Forest", 0, .Battlefield)
	tactician := add(t, g, "Hardened Tactician", 0, .Battlefield)
	add(t, g, "Nadier's Nightblade", 0, .Battlefield)
	druid := add(t, g, "Druid of the Spade", 0, .Battlefield) // 2/3
	testing.expect(t, druid.power.? == 2, "no token: 2 power")
	treasure_effect: types.Effect_Token
	treasure_effect.name = "Treasure"
	append(&treasure_effect.types, "Artifact", "Treasure")
	treasure_effect.power, treasure_effect.toughness = types.PtValue_Fixed{0}, types.PtValue_Fixed{0}
	treasure := game.create_token(g, treasure_effect, 0)
	game.apply_continuous_effects(g)
	testing.expect(t, druid.power.? == 4 && game.has_keyword(druid, types.Keyword_Trample), "a token: +2/+0 and trample")
	hand := types.pvec_len(game.player(s, 0).hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_ActivateAbility{source_id = tactician.id, ability_index = 0}), "sacrifice the Treasure")
	drive(t, g)
	testing.expect(t, treasure.zone != .Battlefield && types.pvec_len(game.player(s, 0).hand) == hand + 1, "a card drawn")
	testing.expect(t, game.player(s, 1).life == 19 && game.player(s, 0).life == 21, "the token left: drain 1")
	testing.expect(t, druid.power.? == 2, "no token any more")

	g2 := new_game()
	add(t, g2, "Starry-Eyed Skyrider", 0, .Battlefield)
	pest := make_token(t, g2, "Pest Summoning", 0)
	bears := add(t, g2, "Grizzly Bears", 0, .Battlefield)
	game.begin_step(g2, .DeclareAttackers)
	attacks := []types.Tuple2(types.ObjectId, types.AttackTarget){{pest.id, types.AttackTarget_Player{1}}, {bears.id, types.AttackTarget_Player{1}}}
	testing.expect(t, game.apply(g2, 0, types.GameAction_DeclareAttackers{attacks = attacks_dynamic(attacks)}))
	game.apply_continuous_effects(g2)
	testing.expect(t, game.has_keyword(pest, types.Keyword_Flying) && !game.has_keyword(bears, types.Keyword_Flying), "the attacking token flies")
}

@(private = "file")
tokens_named :: proc(g: ^game.Game, name: string) -> int {
	n := 0
	for id in game.ids_of(g.state.battlefield) do if o := game.object(&g.state, id); o.is_token && o.name == name do n += 1
	return n
}

@(test)
token_counts_from_the_graveyard_and_halves :: proc(t: ^testing.T) {
	if !load_db() do return
	// Goblin Gathering: "Create a number of 1/1 red Goblin creature tokens equal to two plus the number of cards named
	// Goblin Gathering in your graveyard." (CR 201.2: a card's name; the opponent's graveyard isn't yours.)
	for name in ([]string{"Goblin Gathering", "Undead Servant", "Rise from the Nether", "Ghoulcaller's Harvest", "The Goose Mother"}) {
		testing.expectf(t, game.card_supported(&card(t, name).face), "%s is supported", name)
	}
	g := new_game()
	for _ in 0 ..< 3 do add(t, g, "Mountain", 0, .Battlefield)
	for _ in 0 ..< 2 do add(t, g, "Goblin Gathering", 0, .Graveyard)
	add(t, g, "Goblin Gathering", 1, .Graveyard) // the opponent's
	add(t, g, "Lightning Bolt", 0, .Graveyard)
	gathering := add(t, g, "Goblin Gathering", 0, .Hand) // {2}{R}
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = gathering.id}))
	pass_until_empty(g)
	testing.expect(t, tokens_named(g, "Goblin") == 4, "two plus two Goblins")

	// Ghoulcaller's Harvest: "Create X 2/2 black Zombie creature tokens with decayed, where X is half the number of
	// creature cards in your graveyard, rounded up." (CR 107.1a: three creature cards: two Zombies.)
	for creatures in ([]int{3, 4}) {
		g2 := new_game()
		for _ in 0 ..< 5 do add(t, g2, "Swamp", 0, .Battlefield)
		for _ in 0 ..< creatures do add(t, g2, "Grizzly Bears", 0, .Graveyard)
		add(t, g2, "Lightning Bolt", 0, .Graveyard) // not a creature card
		harvest := add(t, g2, "Ghoulcaller's Harvest", 0, .Hand) // {B}{G}
		add(t, g2, "Forest", 0, .Battlefield)
		testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = harvest.id}))
		pass_until_empty(g2)
		testing.expectf(t, tokens_named(g2, "Zombie") == 2, "%d creature cards: two Zombies", creatures)
	}
}

@(test)
for_each_creature_a_copy :: proc(t: ^testing.T) {
	if !load_db() do return
	// Multiversal Incursion: "For each nontoken creature you control, create a token that's a copy of that creature,
	// except it isn't legendary." Tokens aren't copied, nor the copies just made; the opponent's creatures neither.
	g := new_game()
	for _ in 0 ..< 7 do add(t, g, "Island", 0, .Battlefield)
	add(t, g, "Grizzly Bears", 0, .Battlefield)
	add(t, g, "Isamaru, Hound of Konda", 0, .Battlefield) // legendary
	make_token(t, g, "Pest Summoning", 0)
	add(t, g, "Grizzly Bears", 1, .Battlefield)
	incursion := add(t, g, "Multiversal Incursion", 0, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = incursion.id}))
	pass_until_empty(g)
	testing.expect(t, tokens_named(g, "Grizzly Bears") == 1 && tokens_named(g, "Isamaru, Hound of Konda") == 1 && tokens_named(g, "Pest") == 1, "one copy of each nontoken creature")
	for id in game.ids_of(g.state.battlefield) do if o := game.object(&g.state, id); o.is_token && o.name == "Isamaru, Hound of Konda" {
		testing.expect(t, !game.has_supertype(o, .Legendary) && o.controller == 0, "the copy isn't legendary")
	}
	// "For each token you control" (Second Harvest) may copy a Role (CR 303.4f): refused.
	testing.expect(t, !game.card_supported(&card(t, "Second Harvest").face), "Second Harvest: refused")
}

@(test)
copy_of_an_enchanted_token_isnt_enchanted :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 707.2: a copy takes the copiable values only: not the Auras attached to the original nor what they give it.
	// A Pest token wearing a Young Hero Role (a granted attack trigger) and a Monster Role of another player (+1/+1
	// and trample): its copy is a plain 1/1 Pest with only its own dies trigger, and the original keeps its Roles.
	g := new_game()
	pest := make_token(t, g, "Pest Summoning", 0)
	own_triggers := len(pest.trigger_definitions^)
	hero, _ := token_effect_of(t, "Return Triumphant")
	monster, _ := token_effect_of(t, "Monstrous Rage")
	game.create_token(g, hero, 0, 0, pest)
	game.create_token(g, monster, 1, 0, pest)
	game.check_state_based_actions(g)
	testing.expect(t, pest.power.? == 2 && game.has_keyword(pest, types.Keyword_Trample) && len(pest.trigger_definitions^) == own_triggers + 1, "the Pest wears both Roles")
	copy := game.create_copy_token(g, pest, 0, false)
	game.check_state_based_actions(g)
	testing.expect(t, copy.power.? == 1 && copy.toughness.? == 1 && !game.has_keyword(copy, types.Keyword_Trample), "the copy: a 1/1 Pest without trample")
	testing.expect(t, len(copy.attachments) == 0 && len(copy.trigger_definitions^) == own_triggers, "no Roles, only its own trigger")
	testing.expect(t, pest.power.? == 2 && len(pest.attachments) == 2 && len(pest.trigger_definitions^) == own_triggers + 1, "the original keeps its Roles")
}
