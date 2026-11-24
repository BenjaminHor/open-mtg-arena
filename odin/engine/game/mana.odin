// Mana (CR 106) and paying costs (CR 601.2g-h): a player's mana sources and the automatic payment of a mana cost.
package game

import types "../types"

// One untapped permanent's {T}: add mana ability, and the mana it can make.
Mana_Source :: struct {
	object: ^types.GameObject,
	colors: bit_set[types.ManaType], // the types it can produce (one of them per activation)
	amount: int,
}

// A {T} ability whose only effect is to add mana (CR 605.1a), and what it adds.
tap_mana_ability :: proc(a: types.AbilityDefinition) -> (colors: bit_set[types.ManaType], amount: int, ok: bool) {
	if a.kind != .Activated || a.effect == nil do return
	cost, has_cost := a.cost.?
	if !has_cost do return
	if _, tap := cost.(types.AbilityCost_Tap); !tap do return
	effect, is_mana := a.effect.(types.Effect_Mana)
	if !is_mana do return
	switch p in effect.produced {
	case types.ManaProduction_Fixed:
		// "Add {G}" (one color, once per symbol) or "Add {W}{U}" (each listed symbol).
		for c in p.colors do colors += {types.ManaType(c)}
		amount = len(p.colors)
		if card(colors) > 1 do return {}, 0, false // several different symbols at once: not yet
		return colors, amount, amount > 0
	case types.ManaProduction_Colorless:
		n, fixed := fixed_quantity(p.count)
		return {.Colorless}, n, fixed && n > 0
	case types.ManaProduction_AnyOneColor:
		n, fixed := fixed_quantity(p.count)
		for c in p.color_options do colors += {types.ManaType(c)}
		if len(p.color_options) == 0 do colors = {.White, .Blue, .Black, .Red, .Green}
		return colors, n, fixed && n > 0
	case types.ManaProduction_Mixed, types.ManaProduction_AnyCombination, types.ManaProduction_ChosenColor,
	     types.ManaProduction_NotedType, types.ManaProduction_OpponentLandColors,
	     types.ManaProduction_AnyCombinationOfObjectColors, types.ManaProduction_AnyTypeProduceableBy,
	     types.ManaProduction_ChoiceAmongExiledColors, types.ManaProduction_ChoiceAmongCombinations,
	     types.ManaProduction_AnyInCommandersColorIdentity, types.ManaProduction_DistinctColorsAmongPermanents,
	     types.ManaProduction_AnyOneColorAmongPermanents, types.ManaProduction_TriggerEventManaType:
	}
	return
}

fixed_quantity :: proc(q: types.QuantityExpr) -> (int, bool) {
	if f, ok := q.(types.QuantityExpr_Fixed); ok do return int(f.value), true
	return 0, false
}

// CR 302.6: a creature's {T} ability can't be activated unless it has been under its controller's control since
// their most recent turn began (it isn't "summoning sick"), unless it has haste (CR 702.10).
can_tap_for_cost :: proc(o: ^types.GameObject) -> bool {
	if o.tapped do return false
	if is_type(o, .Creature) && o.summoning_sick && !has_keyword(o, types.Keyword_Haste) do return false
	return true
}

mana_sources :: proc(s: ^types.GameState, p: types.PlayerId, exclude: types.ObjectId = 0) -> [dynamic]Mana_Source {
	out := make([dynamic]Mana_Source, context.temp_allocator)
	for o in permanents_of(s, p) {
		if o.id == exclude || !can_tap_for_cost(o) || o.abilities == nil do continue
		for a in o.abilities^ {
			if colors, amount, ok := tap_mana_ability(a); ok {
				append(&out, Mana_Source{object = o, colors = colors, amount = amount})
				break
			}
		}
	}
	return out
}

// What a mana symbol can be paid with (CR 107.4): its color, either half of a hybrid symbol, generic mana for the
// generic half of a {2/W}, colorless mana for {C}.
shard_payers :: proc(shard: types.ManaCostShard) -> (payers: bit_set[types.ManaType], generic: int, ok: bool) {
	#partial switch shard {
	case .Colorless:
		return {.Colorless}, 0, true
	case .X:
		return {}, 0, true // X is announced as 0 until announcing X is supported
	case .TwoWhite, .TwoBlue, .TwoBlack, .TwoRed, .TwoGreen:
		// Paid with its color, or with two generic: the automatic payment pays the color.
	}
	colors := shard_colors(shard)
	if colors == {} do return {}, 0, false
	for c in types.ManaColor do if c in colors do payers += {types.ManaType(c)}
	return payers, 0, true
}

// The sources that pay a mana cost (CR 601.2g-h), chosen automatically: each colored symbol first, from the sources
// with the fewest other uses, then the generic part from what's left. Nil when the cost can't be paid.
// `exclude`: a permanent that can't help pay, because the cost also taps it.
plan_payment :: proc(s: ^types.GameState, p: types.PlayerId, cost: types.ManaCost, exclude: types.ObjectId = 0) -> (taps: [dynamic]^types.GameObject, ok: bool) {
	taps = make([dynamic]^types.GameObject, context.temp_allocator)
	c, is_cost := cost.(types.ManaCost_Cost)
	if !is_cost do return taps, true // no mana cost: nothing to pay
	sources := mana_sources(s, p, exclude)
	used := make([]bool, len(sources), context.temp_allocator)
	// Each source makes `amount` mana per tap; a planned payment taps whole sources and wastes the rest.
	leftover := make([]int, len(sources), context.temp_allocator)
	generic := int(c.generic)
	for shard in c.shards {
		payers, extra, payable := shard_payers(shard)
		if !payable do return taps, false
		generic += extra
		if payers == {} do continue
		// Mana already made by a tapped source of the right type.
		paid := false
		for &src, i in sources do if used[i] && leftover[i] > 0 && (src.colors & payers) != {} {
			leftover[i] -= 1
			paid = true
			break
		}
		if paid do continue
		best := -1
		for src, i in sources do if !used[i] && (src.colors & payers) != {} {
			if best < 0 || card(src.colors) < card(sources[best].colors) do best = i
		}
		if best < 0 do return taps, false
		used[best] = true
		leftover[best] = sources[best].amount - 1
		append(&taps, sources[best].object)
	}
	for i in 0 ..< len(sources) do if used[i] {
		take := min(leftover[i], generic)
		generic -= take
	}
	for generic > 0 {
		best := -1
		for src, i in sources do if !used[i] {
			if best < 0 || card(src.colors) < card(sources[best].colors) do best = i
		}
		if best < 0 do return taps, false
		used[best] = true
		generic -= sources[best].amount
		append(&taps, sources[best].object)
	}
	return taps, true
}

// CR 106.4: the mana a cost needs in total, its mana value (CR 202.3).
mana_value :: proc(cost: types.ManaCost) -> int {
	c, ok := cost.(types.ManaCost_Cost)
	if !ok do return 0
	n := int(c.generic)
	for shard in c.shards {
		#partial switch shard {
		case .X:
		case .TwoWhite, .TwoBlue, .TwoBlack, .TwoRed, .TwoGreen:
			n += 2
		case:
			n += 1
		}
	}
	return n
}
