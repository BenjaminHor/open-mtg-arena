// Casting, countering, copying and what spells cost: counterspells of every kind (CR 701.6), alternative and optional
// ways to cast a spell (CR 118.9, 601.2b, 702.8), cost changes (CR 601.2f), copies of spells (CR 707.10) and spells
// cast while another resolves (CR 608.2g).
package game_test

import "core:testing"
import game "../../engine/game"
import types "../../engine/types"

// Casts a spell and chooses its targets in order (each the next asked for).
@(private = "file")
cast_with :: proc(t: ^testing.T, g: ^game.Game, p: types.PlayerId, spell: ^types.GameObject, targets: ..types.TargetRef) -> bool {
	if !game.apply(g, p, types.GameAction_CastSpell{object_id = spell.id}) do return false
	for target in targets {
		_, asked := g.state.waiting_for.(types.WaitingFor_TargetSelection)
		testing.expect(t, asked, "a target to choose")
		if !asked || !game.apply(g, p, types.GameAction_ChooseTarget{target = target}) do return false
	}
	return true
}

@(private = "file")
id_list :: proc(xs: ..types.ObjectId) -> [dynamic]types.ObjectId {
	out := make([dynamic]types.ObjectId)
	append(&out, ..xs)
	return out
}

@(private = "file")
id_ints :: proc(xs: ..int) -> [dynamic]int {
	out := make([dynamic]int)
	append(&out, ..xs)
	return out
}

@(private = "file")
obj :: proc(o: ^types.GameObject) -> types.TargetRef {return types.TargetRef_Object{o.id}}

@(private = "file")
plr :: proc(p: types.PlayerId) -> types.TargetRef {return types.TargetRef_Player{p}}

// Whether the object is among the legal targets offered now.
@(private = "file")
offered :: proc(g: ^game.Game, id: types.ObjectId) -> bool {
	w, asked := g.state.waiting_for.(types.WaitingFor_TargetSelection)
	if !asked do return false
	for t in w.selection.current_legal_targets do if x, is_object := t.(types.TargetRef_Object); is_object && x._0 == id do return true
	return false
}

// Passes priority (whoever has it) until the stack is empty or a player is asked something else.
@(private = "file")
resolve_all :: proc(g: ^game.Game) {
	for _ in 0 ..< 20 {
		if types.pvec_len(g.state.stack) == 0 do return
		if _, priority := g.state.waiting_for.(types.WaitingFor_Priority); !priority do return
		game.apply(g, g.state.priority_player, types.GameAction_PassPriority{})
	}
}

// Passes priority once, from player 0 to player 1 with the stack as it is.
@(private = "file")
pass_to_opponent :: proc(t: ^testing.T, g: ^game.Game) {
	testing.expect(t, game.apply(g, 0, types.GameAction_PassPriority{}))
	testing.expect(t, g.state.priority_player == 1, "player 1 has priority")
}

@(private = "file")
lands :: proc(t: ^testing.T, g: ^game.Game, name: string, owner: types.PlayerId, n: int) {
	for _ in 0 ..< n do add(t, g, name, owner, .Battlefield)
}

// ---- Counterspells (CR 701.6) ------------------------------------------------------------------------------------

@(test)
counter_spell_with_mana_value :: proc(t: ^testing.T) {
	if !load_db() do return
	// Disdainful Stroke: "Counter target spell with mana value 4 or greater." CR 115.1, 202.3: a spell with mana
	// value 2 isn't a legal target; one with mana value 6 is, and it's countered (CR 701.6a).
	testing.expect(t, game.card_supported(&card(t, "Disdainful Stroke").face))
	g := new_game()
	lands(t, g, "Forest", 0, 8)
	lands(t, g, "Island", 1, 2)
	bears := add(t, g, "Grizzly Bears", 0, .Hand)
	dreadmaw := add(t, g, "Colossal Dreadmaw", 0, .Hand)
	stroke := add(t, g, "Disdainful Stroke", 1, .Hand)
	testing.expect(t, cast_with(t, g, 0, bears))
	pass_to_opponent(t, g)
	testing.expect(t, !game.castable(&g.state, 1, stroke, g.card_db), "Grizzly Bears has mana value 2")
	resolve_all(g)
	testing.expect(t, bears.zone == .Battlefield)
	testing.expect(t, cast_with(t, g, 0, dreadmaw))
	pass_to_opponent(t, g)
	testing.expect(t, cast_with(t, g, 1, stroke, obj(dreadmaw)))
	resolve_all(g)
	testing.expect(t, dreadmaw.zone == .Graveyard && stroke.zone == .Graveyard, "Colossal Dreadmaw countered")
}

@(test)
counter_target_triggered_ability :: proc(t: ^testing.T) {
	if !load_db() do return
	// Stifle: "Counter target activated or triggered ability." CR 701.6a: the ability is removed from the stack and
	// does nothing (Elvish Visionary's "When this creature enters, draw a card"). A spell isn't an ability: with only
	// a spell on the stack, there's nothing to target.
	testing.expect(t, game.card_supported(&card(t, "Stifle").face))
	g := new_game()
	lands(t, g, "Forest", 0, 2)
	lands(t, g, "Island", 1, 1)
	visionary := add(t, g, "Elvish Visionary", 0, .Hand)
	stifle := add(t, g, "Stifle", 1, .Hand)
	testing.expect(t, cast_with(t, g, 0, visionary))
	pass_to_opponent(t, g)
	testing.expect(t, !game.castable(&g.state, 1, stifle, g.card_db), "no ability on the stack")
	testing.expect(t, game.apply(g, 1, types.GameAction_PassPriority{})) // the creature resolves; its trigger goes on the stack
	testing.expect(t, visionary.zone == .Battlefield)
	testing.expect(t, types.pvec_len(g.state.stack) == 1, "the enters trigger is on the stack")
	trigger := types.pvec_get(g.state.stack, 0).id
	hand_before := types.pvec_len(game.player(&g.state, 0).hand)
	pass_to_opponent(t, g)
	testing.expect(t, cast_with(t, g, 1, stifle, types.TargetRef_Object{trigger}))
	resolve_all(g)
	testing.expect(t, types.pvec_len(g.state.stack) == 0)
	testing.expect(t, types.pvec_len(game.player(&g.state, 0).hand) == hand_before, "no card drawn")
}

@(test)
countered_spell_put_into_hand_instead :: proc(t: ^testing.T) {
	if !load_db() do return
	// Remand: "Counter target spell. If that spell is countered this way, put it into its owner's hand instead of into
	// that player's graveyard. Draw a card." A flashback spell is exiled all the same (CR 702.34a: exiled instead of
	// going anywhere else; CR 616.1f: whichever replacement applies first, it ends in exile).
	testing.expect(t, game.card_supported(&card(t, "Remand").face))
	g := new_game()
	lands(t, g, "Forest", 0, 2)
	lands(t, g, "Island", 0, 3)
	lands(t, g, "Island", 1, 4)
	bears := add(t, g, "Grizzly Bears", 0, .Hand)
	think := add(t, g, "Think Twice", 0, .Graveyard)
	remand := add(t, g, "Remand", 1, .Hand)
	remand2 := add(t, g, "Remand", 1, .Hand)
	testing.expect(t, cast_with(t, g, 0, bears))
	pass_to_opponent(t, g)
	testing.expect(t, cast_with(t, g, 1, remand, obj(bears)))
	resolve_all(g)
	testing.expect(t, bears.zone == .Hand, "back in its owner's hand")
	testing.expect(t, remand.zone == .Graveyard)
	// Think Twice by flashback ({2}{U}).
	testing.expect(t, cast_with(t, g, 0, think))
	pass_to_opponent(t, g)
	testing.expect(t, cast_with(t, g, 1, remand2, obj(think)))
	resolve_all(g)
	testing.expect(t, think.zone == .Exile, "a flashback spell is exiled")
}

@(test)
counter_unless_pays_or_instead :: proc(t: ^testing.T) {
	if !load_db() do return
	// Stubborn Denial: "Counter target noncreature spell unless its controller pays {1}. Ferocious — If you control a
	// creature with power 4 or greater, counter that spell instead." CR 118.12a: without a big creature, Shock's
	// controller may pay {1} and Shock resolves; with one, it's countered outright (CR 608.2c: "instead").
	testing.expect(t, game.card_supported(&card(t, "Stubborn Denial").face))
	g := new_game()
	lands(t, g, "Mountain", 0, 4)
	lands(t, g, "Island", 1, 2)
	shock := add(t, g, "Shock", 0, .Hand)
	shock2 := add(t, g, "Shock", 0, .Hand)
	denial := add(t, g, "Stubborn Denial", 1, .Hand)
	denial2 := add(t, g, "Stubborn Denial", 1, .Hand)
	testing.expect(t, cast_with(t, g, 0, shock, plr(1)))
	pass_to_opponent(t, g)
	testing.expect(t, cast_with(t, g, 1, denial, obj(shock)))
	resolve_all(g)
	w, asked := g.state.waiting_for.(types.WaitingFor_UnlessPayment)
	testing.expect(t, asked && w.player == 0, "Shock's controller is asked to pay {1}")
	testing.expect(t, game.apply(g, 0, types.GameAction_PayUnlessCost{pay = true}))
	resolve_all(g)
	testing.expect(t, game.player(&g.state, 1).life == 18, "Shock resolved")
	// Now with a 4-power creature: countered outright, nothing asked.
	add(t, g, "Colossal Dreadmaw", 1, .Battlefield)
	testing.expect(t, cast_with(t, g, 0, shock2, plr(1)))
	pass_to_opponent(t, g)
	testing.expect(t, cast_with(t, g, 1, denial2, obj(shock2)))
	resolve_all(g)
	_, asked_again := g.state.waiting_for.(types.WaitingFor_UnlessPayment)
	testing.expect(t, !asked_again, "no payment offered")
	testing.expect(t, shock2.zone == .Graveyard && game.player(&g.state, 1).life == 18, "Shock countered")
}

@(test)
counter_spell_that_targets_your_permanent :: proc(t: ^testing.T) {
	if !load_db() do return
	// Keep Safe: "Counter target spell that targets a permanent you control. Draw a card." CR 115.1: a Shock aimed at
	// a player isn't a legal target; one aimed at Keep Safe's caster's creature is.
	testing.expect(t, game.card_supported(&card(t, "Keep Safe").face))
	g := new_game()
	lands(t, g, "Mountain", 0, 2)
	lands(t, g, "Island", 1, 2)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	shock := add(t, g, "Shock", 0, .Hand)
	shock2 := add(t, g, "Shock", 0, .Hand)
	keep := add(t, g, "Keep Safe", 1, .Hand)
	testing.expect(t, cast_with(t, g, 0, shock, plr(1)))
	pass_to_opponent(t, g)
	testing.expect(t, !game.castable(&g.state, 1, keep, g.card_db), "Shock targets a player")
	resolve_all(g)
	testing.expect(t, cast_with(t, g, 0, shock2, obj(bears)))
	pass_to_opponent(t, g)
	testing.expect(t, cast_with(t, g, 1, keep, obj(shock2)))
	resolve_all(g)
	testing.expect(t, shock2.zone == .Graveyard && bears.zone == .Battlefield, "Shock countered")
}

// ---- Casting options (CR 118.9, 601.3) --------------------------------------------------------------------------

@(private = "file")
untapped_lands :: proc(g: ^game.Game, p: types.PlayerId) -> int {
	n := 0
	for id in game.ids_of(g.state.battlefield) {
		o := game.object(&g.state, id)
		if o.controller == p && game.is_type(o, .Land) && !o.tapped do n += 1
	}
	return n
}

// Answers the choice between the alternative cost (0) and the mana cost (1).
@(private = "file")
pick_cost :: proc(t: ^testing.T, g: ^game.Game, p: types.PlayerId, index: int) -> bool {
	_, asked := g.state.waiting_for.(types.WaitingFor_OptionalCostChoice)
	testing.expect(t, asked, "the alternative cost is offered")
	return asked && game.apply(g, p, types.GameAction_DecideOptionalCost{index = index})
}

@(test)
alternative_mana_cost :: proc(t: ^testing.T) {
	if !load_db() do return
	// Bringer of the Blue Dawn: "You may pay {W}{U}{B}{R}{G} rather than pay this spell's mana cost." CR 118.9, 601.2b:
	// announced as it's cast; with five lands its {7}{U}{U} can't be paid (that choice is refused), the alternative can.
	testing.expect(t, game.card_supported(&card(t, "Bringer of the Blue Dawn").face))
	g := new_game()
	for name in ([]string{"Plains", "Island", "Swamp", "Mountain", "Forest"}) do add(t, g, name, 0, .Battlefield)
	bringer := add(t, g, "Bringer of the Blue Dawn", 0, .Hand)
	testing.expect(t, game.castable(&g.state, 0, bringer, g.card_db), "castable for its alternative cost")
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = bringer.id}))
	testing.expect(t, !game.apply(g, 0, types.GameAction_DecideOptionalCost{index = 1}), "the mana cost can't be paid")
	testing.expect(t, pick_cost(t, g, 0, 0))
	testing.expect(t, bringer.zone == .Stack && untapped_lands(g, 0) == 0, "cast for {W}{U}{B}{R}{G}")
	resolve_all(g)
	testing.expect(t, bringer.zone == .Battlefield)
	// CR 118.9c: its mana cost is still {7}{U}{U}.
	testing.expect(t, game.mana_value(bringer.mana_cost) == 9)
}

@(test)
alternative_cost_sacrifice :: proc(t: ^testing.T) {
	if !load_db() do return
	// Fireblast: "You may sacrifice two Mountains rather than pay this spell's mana cost." CR 601.2h: the Mountains are
	// sacrificed as the cost is paid. With one Mountain, neither cost can be paid.
	testing.expect(t, game.card_supported(&card(t, "Fireblast").face))
	g := new_game()
	m1 := add(t, g, "Mountain", 0, .Battlefield)
	blast := add(t, g, "Fireblast", 0, .Hand)
	testing.expect(t, !game.castable(&g.state, 0, blast, g.card_db), "one Mountain")
	m2 := add(t, g, "Mountain", 0, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = blast.id}))
	testing.expect(t, pick_cost(t, g, 0, 0))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = plr(1)}))
	w, asked := g.state.waiting_for.(types.WaitingFor_PayCost)
	testing.expect(t, asked && w.count == 2, "two Mountains to sacrifice")
	if asked do testing.expect(t, game.apply(g, 0, types.GameAction_SelectCards{cards = id_list(m1.id, m2.id)}))
	testing.expect(t, m1.zone == .Graveyard && m2.zone == .Graveyard && blast.zone == .Stack)
	resolve_all(g)
	testing.expect(t, game.player(&g.state, 1).life == 16)
}

@(test)
alternative_cost_exile_from_hand :: proc(t: ^testing.T) {
	if !load_db() do return
	// Force of Will: "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.
	// Counter target spell." CR 601.2a: Force of Will itself is on the stack, not in the hand, so it can't be the card
	// exiled: with no other blue card, there's no paying.
	testing.expect(t, game.card_supported(&card(t, "Force of Will").face))
	g := new_game()
	lands(t, g, "Island", 0, 3)
	divination := add(t, g, "Divination", 0, .Hand)
	force := add(t, g, "Force of Will", 1, .Hand)
	testing.expect(t, cast_with(t, g, 0, divination))
	pass_to_opponent(t, g)
	testing.expect(t, !game.castable(&g.state, 1, force, g.card_db), "no other blue card to exile")
	counterspell := add(t, g, "Counterspell", 1, .Hand)
	testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = force.id}))
	testing.expect(t, pick_cost(t, g, 1, 0))
	testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = obj(divination)}))
	w, asked := g.state.waiting_for.(types.WaitingFor_PayCost)
	testing.expect(t, asked && len(w.choices) == 1, "the other blue card is the only choice")
	if asked do testing.expect(t, game.apply(g, 1, types.GameAction_SelectCards{cards = id_list(counterspell.id)}))
	testing.expect(t, counterspell.zone == .Exile && game.player(&g.state, 1).life == 19, "1 life and a blue card")
	resolve_all(g)
	testing.expect(t, divination.zone == .Graveyard && force.zone == .Graveyard, "Divination countered")
}

@(test)
countered_spell_exiled_instead :: proc(t: ^testing.T) {
	if !load_db() do return
	// Force of Negation: "Counter target noncreature spell. If that spell is countered this way, exile it instead of
	// putting it into its owner's graveyard." CR 614.1a, 701.6a: a replacement: the card goes straight to exile.
	testing.expect(t, game.card_supported(&card(t, "Force of Negation").face))
	g := new_game()
	lands(t, g, "Island", 0, 3)
	lands(t, g, "Island", 1, 3)
	divination := add(t, g, "Divination", 0, .Hand)
	force := add(t, g, "Force of Negation", 1, .Hand)
	testing.expect(t, cast_with(t, g, 0, divination))
	pass_to_opponent(t, g)
	testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = force.id}))
	testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = obj(divination)}))
	resolve_all(g)
	testing.expect(t, divination.zone == .Exile, "exiled, not put into the graveyard")
	saw_graveyard := false
	for e in g.events do if e.kind == .Zone_Change && e.object == divination.id && e.to == .Graveyard do saw_graveyard = true
	testing.expect(t, !saw_graveyard, "it never went to the graveyard")
}

@(test)
cast_without_paying_with_a_commander :: proc(t: ^testing.T) {
	if !load_db() do return
	// Deadly Rollick: "If you control a commander, you may cast this spell without paying its mana cost." CR 118.9.
	testing.expect(t, game.card_supported(&card(t, "Deadly Rollick").face))
	g := new_game()
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	mine := add(t, g, "Grizzly Bears", 0, .Battlefield)
	rollick := add(t, g, "Deadly Rollick", 0, .Hand)
	testing.expect(t, !game.castable(&g.state, 0, rollick, g.card_db), "no commander, no mana")
	mine.is_commander = true
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = rollick.id}))
	testing.expect(t, pick_cost(t, g, 0, 0))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = obj(bears)}))
	resolve_all(g)
	testing.expect(t, bears.zone == .Exile)
}

@(test)
flash_while_you_control_a_merfolk :: proc(t: ^testing.T) {
	if !load_db() do return
	// Crashing Tide: "This spell has flash as long as you control a Merfolk." CR 601.3d: castable at instant speed
	// only while the condition holds.
	testing.expect(t, game.card_supported(&card(t, "Crashing Tide").face))
	g := new_game()
	lands(t, g, "Island", 1, 3)
	bears := add(t, g, "Grizzly Bears", 0, .Battlefield)
	tide := add(t, g, "Crashing Tide", 1, .Hand)
	pass_to_opponent(t, g) // player 1 has priority on player 0's turn
	testing.expect(t, !game.castable(&g.state, 1, tide, g.card_db), "a sorcery on another player's turn")
	add(t, g, "Lord of Atlantis", 1, .Battlefield)
	testing.expect(t, cast_with(t, g, 1, tide, obj(bears)))
	resolve_all(g)
	testing.expect(t, bears.zone == .Hand)
}

@(test)
flash_for_an_extra_cost :: proc(t: ^testing.T) {
	if !load_db() do return
	// Rout ({3}{W}{W}): "You may cast this spell as though it had flash if you pay {2} more to cast it." CR 601.3c: on
	// another player's turn it costs {5}{W}{W}; in its controller's main phase, {3}{W}{W} as usual.
	testing.expect(t, game.card_supported(&card(t, "Rout").face))
	g := new_game()
	lands(t, g, "Plains", 1, 6)
	rout := add(t, g, "Rout", 1, .Hand)
	pass_to_opponent(t, g)
	testing.expect(t, !game.castable(&g.state, 1, rout, g.card_db), "six lands can't pay {5}{W}{W}")
	add(t, g, "Plains", 1, .Battlefield)
	testing.expect(t, game.castable(&g.state, 1, rout, g.card_db))
	testing.expect(t, cast_with(t, g, 1, rout))
	testing.expect(t, untapped_lands(g, 1) == 0, "paid {5}{W}{W}")
	resolve_all(g)
	testing.expect(t, rout.zone == .Graveyard)
	// In its own main phase: {3}{W}{W}.
	g2 := new_game()
	lands(t, g2, "Plains", 0, 5)
	rout2 := add(t, g2, "Rout", 0, .Hand)
	testing.expect(t, cast_with(t, g2, 0, rout2))
	testing.expect(t, rout2.zone == .Stack, "cast for {3}{W}{W}")
}

// ---- Cost changes (CR 601.2f) -----------------------------------------------------------------------------------

// The total cost to cast it now: its generic mana and colored symbols.
@(private = "file")
cost_now :: proc(g: ^game.Game, p: types.PlayerId, o: ^types.GameObject) -> (generic: int, shards: int) {
	c := game.spell_cost(&g.state, o, p).(types.ManaCost_Cost)
	return int(c.generic), len(c.shards)
}

@(test)
colored_cost_reduction :: proc(t: ^testing.T) {
	if !load_db() do return
	// Stormwing Entity ({3}{U}{U}): "This spell costs {2}{U} less to cast if you've cast an instant or sorcery spell this
	// turn." CR 118.7c: {U} off the blue symbols, {2} off the generic part: {1}{U}. Not before an instant is cast.
	testing.expect(t, game.card_supported(&card(t, "Stormwing Entity").face))
	g := new_game()
	lands(t, g, "Island", 0, 3)
	entity := add(t, g, "Stormwing Entity", 0, .Hand)
	opt := add(t, g, "Opt", 0, .Hand)
	generic, shards := cost_now(g, 0, entity)
	testing.expect(t, generic == 3 && shards == 2, "{3}{U}{U} before")
	testing.expect(t, !game.castable(&g.state, 0, entity, g.card_db))
	testing.expect(t, cast_with(t, g, 0, opt))
	resolve_all(g)
	if _, scry := g.state.waiting_for.(types.WaitingFor_ScryChoice); scry do game.apply(g, 0, types.GameAction_SelectCards{})
	resolve_all(g)
	generic, shards = cost_now(g, 0, entity)
	testing.expect(t, generic == 1 && shards == 1, "{1}{U} after an instant")
	testing.expect(t, game.castable(&g.state, 0, entity, g.card_db))
}

@(test)
cost_reduction_on_other_turns :: proc(t: ^testing.T) {
	if !load_db() do return
	// Geyser Drake: "During turns other than yours, spells you cast cost {1} less to cast." Divination costs {1}{U} for
	// its controller on another player's turn, {2}{U} on their own.
	testing.expect(t, game.card_supported(&card(t, "Geyser Drake").face))
	g := new_game()
	add(t, g, "Geyser Drake", 1, .Battlefield)
	mine := add(t, g, "Divination", 1, .Hand)
	theirs := add(t, g, "Divination", 0, .Hand)
	generic, _ := cost_now(g, 1, mine)
	testing.expect(t, generic == 1, "player 1's spell on player 0's turn")
	generic, _ = cost_now(g, 0, theirs)
	testing.expect(t, generic == 2, "not the opponent's spells")
	g.state.active_player = 1
	generic, _ = cost_now(g, 1, mine)
	testing.expect(t, generic == 2, "not on its controller's own turn")
}

@(test)
spells_cast_from_graveyard_cost_less :: proc(t: ^testing.T) {
	if !load_db() do return
	// Gravebreaker Lamia: "Spells you cast from your graveyard cost {1} less to cast." Think Twice by flashback ({2}{U})
	// costs {1}{U}; from the hand ({1}{U}), unchanged. CR 601.2f: worked out as it's cast, while the card is still there.
	testing.expect(t, game.card_supported(&card(t, "Gravebreaker Lamia").face))
	g := new_game()
	add(t, g, "Gravebreaker Lamia", 0, .Battlefield)
	from_graveyard := add(t, g, "Think Twice", 0, .Graveyard)
	from_hand := add(t, g, "Think Twice", 0, .Hand)
	generic, _ := cost_now(g, 0, from_graveyard)
	testing.expect(t, generic == 1, "flashback {2}{U} less {1}")
	generic, _ = cost_now(g, 0, from_hand)
	testing.expect(t, generic == 1, "{1}{U} from the hand")
}

@(test)
reduction_if_optional_cost_paid :: proc(t: ^testing.T) {
	if !load_db() do return
	// Bite Down on Crime ({3}{G}): "As an additional cost to cast this spell, you may collect evidence 6. This spell
	// costs {2} less to cast if evidence was collected." CR 601.2b, 601.2f: castable with two lands only when there's
	// evidence to collect.
	testing.expect(t, game.card_supported(&card(t, "Bite Down on Crime").face))
	g := new_game()
	lands(t, g, "Forest", 0, 2)
	add(t, g, "Grizzly Bears", 0, .Battlefield)
	add(t, g, "Grizzly Bears", 1, .Battlefield)
	bite := add(t, g, "Bite Down on Crime", 0, .Hand)
	testing.expect(t, !game.castable(&g.state, 0, bite, g.card_db), "no evidence: {3}{G}")
	add(t, g, "Colossal Dreadmaw", 0, .Graveyard)
	testing.expect(t, game.castable(&g.state, 0, bite, g.card_db), "evidence 6 to collect: {1}{G}")
}

// ---- Spells cast while another resolves (CR 608.2g) ---------------------------------------------------------------

// The cards offered by a free-cast window, if one is open.
@(private = "file")
free_cast_offer :: proc(g: ^game.Game) -> ([]types.ObjectId, bool) {
	w, offer := g.state.waiting_for.(types.WaitingFor_CastOffer)
	if !offer do return nil, false
	k, window := w.kind.(types.CastOfferKind_FreeCastWindow)
	return k.candidates[:], window
}

@(private = "file")
accept_may :: proc(t: ^testing.T, g: ^game.Game, p: types.PlayerId) {
	_, asked := g.state.waiting_for.(types.WaitingFor_OptionalEffectChoice)
	testing.expect(t, asked, "a \"you may\" to answer")
	if asked do testing.expect(t, game.apply(g, p, types.GameAction_DecideOptionalEffect{accept = true}))
}

@(test)
cast_from_hand_while_resolving :: proc(t: ^testing.T) {
	if !load_db() do return
	// Sram's Expertise: "Create three 1/1 colorless Servo artifact creature tokens. You may cast a spell with mana value
	// 3 or less from your hand without paying its mana cost." CR 608.2g: Grizzly Bears is cast during the resolution and
	// lands on the stack above it; Colossal Dreadmaw (mana value 6) isn't offered. CR 118.9: nothing more is paid.
	testing.expect(t, game.card_supported(&card(t, "Sram's Expertise").face))
	g := new_game()
	lands(t, g, "Plains", 0, 4)
	expertise := add(t, g, "Sram's Expertise", 0, .Hand)
	bears := add(t, g, "Grizzly Bears", 0, .Hand)
	dreadmaw := add(t, g, "Colossal Dreadmaw", 0, .Hand)
	testing.expect(t, cast_with(t, g, 0, expertise))
	pass_to_opponent(t, g)
	testing.expect(t, game.apply(g, 1, types.GameAction_PassPriority{})) // Sram's Expertise resolves
	accept_may(t, g, 0)
	candidates, offered_cast := free_cast_offer(g)
	testing.expect(t, offered_cast && len(candidates) == 1 && candidates[0] == bears.id, "only Grizzly Bears is offered")
	testing.expect(t, !game.apply(g, 0, types.GameAction_FreeCastWindowChoice{selection = dreadmaw.id}), "mana value 6")
	testing.expect(t, game.apply(g, 0, types.GameAction_FreeCastWindowChoice{selection = bears.id}))
	testing.expect(t, bears.zone == .Stack && expertise.zone == .Graveyard, "cast during the resolution, which then ended")
	testing.expect(t, types.pvec_len(g.state.stack) == 1)
	resolve_all(g)
	testing.expect(t, bears.zone == .Battlefield && dreadmaw.zone == .Hand)
	servos := 0
	for id in game.ids_of(g.state.battlefield) do if o := game.object(&g.state, id); o.is_token && o.controller == 0 do servos += 1
	testing.expect(t, servos == 3)
}

@(test)
cast_target_card_from_graveyard_then_exiled :: proc(t: ^testing.T) {
	if !load_db() do return
	// Torrential Gearhulk: "When this creature enters, you may cast target instant card from your graveyard without
	// paying its mana cost. If that spell would be put into your graveyard, exile it instead." CR 115.1: Grizzly Bears
	// in the graveyard isn't a legal target; Shock is. CR 608.2g: Shock is cast as the ability resolves; resolving, it's
	// exiled instead of going to the graveyard (CR 614.1a).
	testing.expect(t, game.card_supported(&card(t, "Torrential Gearhulk").face))
	g := new_game()
	lands(t, g, "Island", 0, 6)
	gearhulk := add(t, g, "Torrential Gearhulk", 0, .Hand)
	shock := add(t, g, "Shock", 0, .Graveyard)
	bears := add(t, g, "Grizzly Bears", 0, .Graveyard)
	testing.expect(t, cast_with(t, g, 0, gearhulk))
	testing.expect(t, game.apply(g, 0, types.GameAction_PassPriority{}))
	testing.expect(t, game.apply(g, 1, types.GameAction_PassPriority{})) // the Gearhulk resolves; its trigger is put on the stack
	if w, asked := g.state.waiting_for.(types.WaitingFor_TriggerTargetSelection); asked {
		for target in w.selection.current_legal_targets do if x, is_object := target.(types.TargetRef_Object); is_object do testing.expect(t, x._0 != bears.id, "not a creature card")
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = obj(shock)}))
	}
	// The only legal target, Shock (not Grizzly Bears), chosen.
	testing.expect(t, types.pvec_len(g.state.stack) == 1, "the trigger is on the stack")
	if types.pvec_len(g.state.stack) == 1 {
		k, is_trigger := types.pvec_get(g.state.stack, 0).kind.(types.StackEntryKind_TriggeredAbility)
		testing.expect(t, is_trigger && len(k.ability.targets) == 1 && k.ability.targets[0] == obj(shock), "it targets Shock")
	}
	resolve_all(g)
	accept_may(t, g, 0)
	candidates, offered_cast := free_cast_offer(g)
	testing.expect(t, offered_cast && len(candidates) == 1 && candidates[0] == shock.id)
	testing.expect(t, game.apply(g, 0, types.GameAction_FreeCastWindowChoice{selection = shock.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = plr(1)}))
	testing.expect(t, shock.zone == .Stack && shock.zone != .Exile, "the rider didn't exile it")
	resolve_all(g)
	testing.expect(t, game.player(&g.state, 1).life == 18)
	testing.expect(t, shock.zone == .Exile, "exiled instead of put into the graveyard")
	testing.expect(t, bears.zone == .Graveyard)
}

@(test)
declining_the_cast_leaves_the_card :: proc(t: ^testing.T) {
	if !load_db() do return
	// Torrential Gearhulk declined ("you may", CR 608.2d): Shock stays in the graveyard (its exile rider applies only to
	// a spell cast this way).
	g := new_game()
	lands(t, g, "Island", 0, 6)
	gearhulk := add(t, g, "Torrential Gearhulk", 0, .Hand)
	shock := add(t, g, "Shock", 0, .Graveyard)
	testing.expect(t, cast_with(t, g, 0, gearhulk))
	resolve_all(g)
	if _, asked := g.state.waiting_for.(types.WaitingFor_TriggerTargetSelection); asked {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = obj(shock)}))
	}
	resolve_all(g)
	_, asked := g.state.waiting_for.(types.WaitingFor_OptionalEffectChoice)
	testing.expect(t, asked && game.apply(g, 0, types.GameAction_DecideOptionalEffect{accept = false}))
	resolve_all(g)
	testing.expect(t, shock.zone == .Graveyard, "not exiled")
	testing.expect(t, types.pvec_len(g.state.stack) == 0)
}

// ---- Copies of spells (CR 707.10) -------------------------------------------------------------------------------

@(test)
copy_target_spell_with_new_targets :: proc(t: ^testing.T) {
	if !load_db() do return
	// Flare of Duplication: "Copy target instant or sorcery spell. You may choose new targets for the copy." CR 707.10c:
	// the copy is aimed at Shock's caster instead; it resolves first, then Shock. CR 707.10: the copy isn't cast; CR
	// 704.5e: once resolved it ceases to exist (no card in any graveyard). A creature spell isn't a legal target.
	testing.expect(t, game.card_supported(&card(t, "Flare of Duplication").face))
	g := new_game()
	lands(t, g, "Mountain", 0, 2)
	lands(t, g, "Forest", 0, 2)
	lands(t, g, "Mountain", 1, 3)
	bears := add(t, g, "Grizzly Bears", 0, .Hand)
	shock := add(t, g, "Shock", 0, .Hand)
	flare := add(t, g, "Flare of Duplication", 1, .Hand)
	testing.expect(t, cast_with(t, g, 0, bears))
	pass_to_opponent(t, g)
	testing.expect(t, !game.castable(&g.state, 1, flare, g.card_db), "Grizzly Bears isn't an instant or sorcery")
	resolve_all(g)
	testing.expect(t, cast_with(t, g, 0, shock, plr(1)))
	pass_to_opponent(t, g)
	testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = flare.id}))
	if _, offered := g.state.waiting_for.(types.WaitingFor_OptionalCostChoice); offered do game.apply(g, 1, types.GameAction_DecideOptionalCost{index = 1})
	testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = obj(shock)}))
	casts_before := game.spells_cast_this_turn_by(&g.state, 1)
	resolve_all(g)
	w, asked := g.state.waiting_for.(types.WaitingFor_CopyRetarget)
	testing.expect(t, asked && w.player == 1 && len(w.target_slots) == 1, "the copy's target may change")
	if !asked do return
	testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = plr(0)}))
	copy := w.copy_id
	testing.expect(t, types.pvec_len(g.state.stack) == 2, "the copy on top of Shock")
	testing.expect(t, game.spells_cast_this_turn_by(&g.state, 1) == casts_before, "a copy isn't cast")
	resolve_all(g)
	testing.expect(t, game.player(&g.state, 0).life == 18 && game.player(&g.state, 1).life == 18)
	for id in game.ids_of(game.player(&g.state, 1).graveyard) do testing.expect(t, id != copy, "the copy ceased to exist")
	for id in game.ids_of(game.player(&g.state, 0).graveyard) do testing.expect(t, id != copy, "the copy ceased to exist")
}

@(test)
copy_of_creature_spell_becomes_a_token :: proc(t: ^testing.T) {
	if !load_db() do return
	// Double Major: "Copy target creature spell you control, except it isn't legendary if the spell is legendary." CR
	// 707.10f, 608.3f: the copy resolves into a token permanent; the original into the card's permanent.
	testing.expect(t, game.card_supported(&card(t, "Double Major").face))
	g := new_game()
	lands(t, g, "Forest", 0, 3)
	lands(t, g, "Island", 0, 1)
	bears := add(t, g, "Grizzly Bears", 0, .Hand)
	major := add(t, g, "Double Major", 0, .Hand)
	testing.expect(t, cast_with(t, g, 0, bears))
	testing.expect(t, cast_with(t, g, 0, major, obj(bears)))
	resolve_all(g)
	testing.expect(t, bears.zone == .Battlefield)
	tokens := 0
	for id in game.ids_of(g.state.battlefield) {
		o := game.object(&g.state, id)
		if o.is_token && o.name == "Grizzly Bears" && o.controller == 0 {
			tokens += 1
			testing.expect(t, !o.is_copy, "a token now, no longer a copy of a spell")
		}
	}
	testing.expect(t, tokens == 1, "one token Grizzly Bears")
}

@(test)
copy_that_spell_even_once_countered :: proc(t: ^testing.T) {
	if !load_db() do return
	// Storm of Saruman: "Whenever you cast your second spell each turn, copy it, except the copy isn't legendary. You may
	// choose new targets for the copy." As the rulings of such cards say, a copy is created even if the spell was
	// countered by the time the ability resolves (its last known information, CR 608.2h).
	testing.expect(t, game.card_supported(&card(t, "Storm of Saruman").face))
	g := new_game()
	add(t, g, "Storm of Saruman", 0, .Battlefield)
	lands(t, g, "Mountain", 0, 1)
	lands(t, g, "Island", 0, 1)
	lands(t, g, "Island", 1, 2)
	opt := add(t, g, "Opt", 0, .Hand)
	shock := add(t, g, "Shock", 0, .Hand)
	counterspell := add(t, g, "Counterspell", 1, .Hand)
	testing.expect(t, cast_with(t, g, 0, opt))
	resolve_all(g)
	if _, scry := g.state.waiting_for.(types.WaitingFor_ScryChoice); scry do game.apply(g, 0, types.GameAction_SelectCards{})
	resolve_all(g)
	testing.expect(t, cast_with(t, g, 0, shock, plr(1)))
	testing.expect(t, types.pvec_len(g.state.stack) == 2, "Shock and the trigger above it")
	pass_to_opponent(t, g)
	testing.expect(t, cast_with(t, g, 1, counterspell, obj(shock)))
	testing.expect(t, game.apply(g, 1, types.GameAction_PassPriority{}))
	testing.expect(t, game.apply(g, 0, types.GameAction_PassPriority{})) // Counterspell resolves: Shock is countered
	testing.expect(t, shock.zone == .Graveyard)
	resolve_all(g)
	if _, asked := g.state.waiting_for.(types.WaitingFor_CopyRetarget); asked do game.apply(g, 0, types.GameAction_KeepAllCopyTargets{})
	resolve_all(g)
	testing.expect(t, game.player(&g.state, 1).life == 18, "the copy of Shock resolved")
}

@(test)
copy_this_spell_when_cast :: proc(t: ^testing.T) {
	if !load_db() do return
	// Sage of the Skies: "When you cast this spell, if you've cast another spell this turn, copy this spell. (The copy
	// becomes a token.)" CR 603.4: as the first spell of the turn it doesn't trigger; as the second, the copy resolves
	// into a token (CR 707.10f) beside the card.
	testing.expect(t, game.card_supported(&card(t, "Sage of the Skies").face))
	g := new_game()
	lands(t, g, "Plains", 0, 6)
	sage := add(t, g, "Sage of the Skies", 0, .Hand)
	sage2 := add(t, g, "Sage of the Skies", 0, .Hand)
	testing.expect(t, cast_with(t, g, 0, sage))
	testing.expect(t, types.pvec_len(g.state.stack) == 1, "the first spell this turn: no trigger")
	resolve_all(g)
	testing.expect(t, cast_with(t, g, 0, sage2))
	testing.expect(t, types.pvec_len(g.state.stack) == 2, "the second: its cast trigger")
	resolve_all(g)
	sages, tokens := 0, 0
	for id in game.ids_of(g.state.battlefield) {
		o := game.object(&g.state, id)
		if o.name != "Sage of the Skies" do continue
		sages += 1
		if o.is_token do tokens += 1
	}
	testing.expect(t, sages == 3 && tokens == 1, "two cards and one token")
}

@(test)
copy_keeps_modes_and_x :: proc(t: ^testing.T) {
	if !load_db() do return
	// CR 707.10: a copy has the spell's modes and value of X. Boros Charm's "4 damage to target player" copied deals 4
	// too; Blaze with X = 3 copied deals 3.
	testing.expect(t, game.card_supported(&card(t, "Blaze").face))
	g := new_game()
	lands(t, g, "Mountain", 0, 2)
	lands(t, g, "Plains", 0, 1)
	lands(t, g, "Mountain", 1, 6)
	charm := add(t, g, "Boros Charm", 0, .Hand)
	flare := add(t, g, "Flare of Duplication", 1, .Hand)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = charm.id}))
	testing.expect(t, game.apply(g, 0, types.GameAction_SelectModes{indices = id_ints(0)}))
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = plr(1)}))
	pass_to_opponent(t, g)
	testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = flare.id}))
	if _, offered := g.state.waiting_for.(types.WaitingFor_OptionalCostChoice); offered do game.apply(g, 1, types.GameAction_DecideOptionalCost{index = 1})
	testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = obj(charm)}))
	resolve_all(g)
	testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = plr(0)}))
	resolve_all(g)
	testing.expect(t, game.player(&g.state, 0).life == 16 && game.player(&g.state, 1).life == 16, "4 damage each")
	// X.
	g2 := new_game()
	lands(t, g2, "Mountain", 0, 4)
	lands(t, g2, "Mountain", 1, 3)
	fireball := add(t, g2, "Blaze", 0, .Hand)
	flare2 := add(t, g2, "Flare of Duplication", 1, .Hand)
	testing.expect(t, game.apply(g2, 0, types.GameAction_CastSpell{object_id = fireball.id}))
	testing.expect(t, game.apply(g2, 0, types.GameAction_ChooseX{value = 3}))
	testing.expect(t, game.apply(g2, 0, types.GameAction_ChooseTarget{target = plr(1)}))
	pass_to_opponent(t, g2)
	testing.expect(t, game.apply(g2, 1, types.GameAction_CastSpell{object_id = flare2.id}))
	if _, offered := g2.state.waiting_for.(types.WaitingFor_OptionalCostChoice); offered do game.apply(g2, 1, types.GameAction_DecideOptionalCost{index = 1})
	testing.expect(t, game.apply(g2, 1, types.GameAction_ChooseTarget{target = obj(fireball)}))
	resolve_all(g2)
	testing.expect(t, game.apply(g2, 1, types.GameAction_ChooseTarget{target = plr(0)}))
	resolve_all(g2)
	testing.expect(t, game.player(&g2.state, 0).life == 17 && game.player(&g2.state, 1).life == 17, "X = 3 each")
}

@(test)
copy_of_an_adventure_spell :: proc(t: ^testing.T) {
	if !load_db() do return
	// Chancellor of Tales: "Whenever you cast an Adventure spell, you may copy it. You may choose new targets for the
	// copy." Petty Theft (Brazen Borrower's Adventure) copied: the copy returns the other permanent; the copy isn't an
	// adventurer card, so only the card goes to exile (CR 715.4, 707.10).
	testing.expect(t, game.card_supported(&card(t, "Chancellor of Tales").face))
	g := new_game()
	lands(t, g, "Island", 0, 2)
	add(t, g, "Chancellor of Tales", 0, .Battlefield)
	borrower := add(t, g, "Brazen Borrower", 0, .Hand)
	bears := add(t, g, "Grizzly Bears", 1, .Battlefield)
	dreadmaw := add(t, g, "Colossal Dreadmaw", 1, .Battlefield)
	testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = borrower.id}))
	if _, offer := g.state.waiting_for.(types.WaitingFor_CastOffer); offer {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseAdventureFace{creature = false}))
	}
	testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = obj(bears)}))
	resolve_all(g)
	accept_may(t, g, 0)
	w, asked := g.state.waiting_for.(types.WaitingFor_CopyRetarget)
	testing.expect(t, asked, "new targets for the copy")
	if asked do testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = obj(dreadmaw)}))
	resolve_all(g)
	testing.expect(t, bears.zone == .Hand && dreadmaw.zone == .Hand, "both returned")
	testing.expect(t, borrower.zone == .Exile, "the card on its adventure")
	testing.expect(t, types.pvec_len(game.player(&g.state, 0).graveyard) == 0, "the copy ceased to exist")
}

@(test)
free_cast_ignores_the_flash_surcharge :: proc(t: ^testing.T) {
	if !load_db() do return
	// Ghitu Fire's "{2} more" buys casting it as though it had flash (CR 601.3c); cast without paying its mana cost
	// while Sram's Expertise resolves (CR 608.2g), there's nothing extra to pay, and X is 0 (CR 107.3b).
	g := new_game()
	lands(t, g, "Plains", 0, 4)
	expertise := add(t, g, "Sram's Expertise", 0, .Hand)
	fire := add(t, g, "Ghitu Fire", 0, .Hand)
	testing.expect(t, cast_with(t, g, 0, expertise))
	resolve_all(g)
	accept_may(t, g, 0)
	candidates, offered := free_cast_offer(g)
	testing.expect(t, offered && len(candidates) == 1 && candidates[0] == fire.id, "Ghitu Fire is offered")
	testing.expect(t, offered && game.apply(g, 0, types.GameAction_FreeCastWindowChoice{selection = fire.id}))
	if _, asked := g.state.waiting_for.(types.WaitingFor_TargetSelection); asked {
		testing.expect(t, game.apply(g, 0, types.GameAction_ChooseTarget{target = plr(1)}))
	}
	testing.expect(t, fire.zone == .Stack, "cast for free")
	resolve_all(g)
	testing.expect(t, fire.zone == .Graveyard)
	testing.expect(t, g.state.players[1].life == 20, "X is 0")
}

@(test)
ai_answers_the_new_prompts :: proc(t: ^testing.T) {
	if !load_db() do return
	// The AI opponent answers each prompt these casts raise with an action the engine accepts.
	ai_step :: proc(t: ^testing.T, g: ^game.Game, p: types.PlayerId, what: string) {
		a, ok := game.ai_action(g, p)
		testing.expectf(t, ok && game.apply(g, p, a), "the AI answers %s", what)
	}
	{
		// The alternative cost (Bringer of the Blue Dawn).
		g := new_game()
		for name in ([]string{"Plains", "Island", "Swamp", "Mountain", "Forest"}) do add(t, g, name, 0, .Battlefield)
		bringer := add(t, g, "Bringer of the Blue Dawn", 0, .Hand)
		testing.expect(t, game.apply(g, 0, types.GameAction_CastSpell{object_id = bringer.id}))
		ai_step(t, g, 0, "the alternative cost")
		testing.expect(t, bringer.zone == .Stack)
	}
	{
		// Exiling a card from the hand (Force of Will), then the counterspell's target.
		g := new_game()
		lands(t, g, "Island", 0, 3)
		divination := add(t, g, "Divination", 0, .Hand)
		force := add(t, g, "Force of Will", 1, .Hand)
		add(t, g, "Counterspell", 1, .Hand)
		testing.expect(t, cast_with(t, g, 0, divination))
		pass_to_opponent(t, g)
		testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = force.id}))
		for _ in 0 ..< 3 do if force.zone != .Stack do ai_step(t, g, 1, "Force of Will's costs and target")
		testing.expect(t, force.zone == .Stack)
	}
	{
		// The free-cast window (Sram's Expertise).
		g := new_game()
		lands(t, g, "Plains", 0, 4)
		expertise := add(t, g, "Sram's Expertise", 0, .Hand)
		bears := add(t, g, "Grizzly Bears", 0, .Hand)
		testing.expect(t, cast_with(t, g, 0, expertise))
		resolve_all(g)
		ai_step(t, g, 0, "\"you may\"")
		ai_step(t, g, 0, "the free-cast window")
		testing.expect(t, bears.zone == .Stack)
	}
	{
		// A copy's new targets (Flare of Duplication on a Shock aimed at the AI).
		g := new_game()
		lands(t, g, "Mountain", 0, 1)
		lands(t, g, "Mountain", 1, 3)
		shock := add(t, g, "Shock", 0, .Hand)
		flare := add(t, g, "Flare of Duplication", 1, .Hand)
		testing.expect(t, cast_with(t, g, 0, shock, plr(1)))
		pass_to_opponent(t, g)
		testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = flare.id}))
		if _, offered := g.state.waiting_for.(types.WaitingFor_OptionalCostChoice); offered do ai_step(t, g, 1, "the cost of Flare")
		testing.expect(t, game.apply(g, 1, types.GameAction_ChooseTarget{target = obj(shock)}))
		resolve_all(g)
		ai_step(t, g, 1, "the copy's target")
		resolve_all(g)
		testing.expect(t, game.player(&g.state, 0).life == 18, "the copy aimed at the other player")
	}
	{
		// A counterspell for an ability (Stifle on Elvish Visionary's trigger).
		g := new_game()
		lands(t, g, "Forest", 0, 2)
		lands(t, g, "Island", 1, 1)
		visionary := add(t, g, "Elvish Visionary", 0, .Hand)
		stifle := add(t, g, "Stifle", 1, .Hand)
		testing.expect(t, cast_with(t, g, 0, visionary))
		pass_to_opponent(t, g)
		testing.expect(t, game.apply(g, 1, types.GameAction_PassPriority{}))
		pass_to_opponent(t, g)
		testing.expect(t, game.apply(g, 1, types.GameAction_CastSpell{object_id = stifle.id}))
		ai_step(t, g, 1, "Stifle's target")
		testing.expect(t, stifle.zone == .Stack)
	}
}
