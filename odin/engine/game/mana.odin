// Mana (CR 106) and paying costs (CR 601.2g-h): a player's mana sources and the automatic payment of a mana cost.
package game

import "core:slice"
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
	// Riders this engine doesn't carry out yet: a second effect (painlands' damage, extra mana), "activate only if"
	// (CR 602.5), spending restrictions (CR 106.6). Such abilities aren't supported rather than half done.
	if a.sub_ability != nil || len(a.activation_restrictions) > 0 || a.condition != nil || a.activation_zone != nil do return
	cost, has_cost := a.cost.?
	if !has_cost do return
	if _, tap := cost.(types.AbilityCost_Tap); !tap do return
	effect, is_mana := a.effect.(types.Effect_Mana)
	if !is_mana || len(effect.restrictions) > 0 || len(effect.grants) > 0 || effect.expiry != nil || effect.target != nil do return
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
		// CR 605.3a: any of its mana abilities; each costs {T}, so one per tap.
		src := Mana_Source{object = o}
		for a in o.abilities^ {
			if colors, amount, ok := tap_mana_ability(a); ok {
				src.colors += colors
				src.amount = amount if src.amount == 0 else min(src.amount, amount)
			}
		}
		if src.amount > 0 do append(&out, src)
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
	case .TwoWhite, .TwoBlue, .TwoBlack, .TwoRed, .TwoGreen,
	     .PhyrexianWhite, .PhyrexianBlue, .PhyrexianBlack, .PhyrexianRed, .PhyrexianGreen,
	     .PhyrexianWhiteBlue, .PhyrexianWhiteBlack, .PhyrexianBlueBlack, .PhyrexianBlueRed, .PhyrexianBlackRed,
	     .PhyrexianBlackGreen, .PhyrexianRedWhite, .PhyrexianRedGreen, .PhyrexianGreenWhite, .PhyrexianGreenBlue,
	     .ColorlessWhite, .ColorlessBlue, .ColorlessBlack, .ColorlessRed, .ColorlessGreen, .Snow, .TwoOrMoreColorSource:
		// CR 107.4e-f: these can be paid another way (two mana, 2 life, colorless); not yet offered.
		return {}, 0, false
	}
	colors := shard_colors(shard)
	if colors == {} do return {}, 0, false
	for c in types.ManaColor do if c in colors do payers += {types.ManaType(c)}
	return payers, 0, true
}

// The sources that pay a mana cost (CR 601.2g-h), chosen automatically: every way of matching the colored symbols to
// sources is tried (CR 601.2h: a cost is payable if any assignment pays it), preferring lands and other noncreature
// sources so creatures stay free to attack and block; the generic part comes from what's left. CR 118.6: an object
// with no mana cost can't be cast by paying one.
plan_payment :: proc(s: ^types.GameState, p: types.PlayerId, cost: types.ManaCost, exclude: types.ObjectId = 0) -> (taps: [dynamic]^types.GameObject, ok: bool) {
	taps = make([dynamic]^types.GameObject, context.temp_allocator)
	c, is_cost := cost.(types.ManaCost_Cost)
	if !is_cost do return taps, false
	sources := mana_sources(s, p, exclude)
	// Preference order: noncreatures first, then sources that make fewer kinds of mana.
	slice.sort_by(sources[:], proc(a, b: Mana_Source) -> bool {
		ac, bc := is_type(a.object, .Creature), is_type(b.object, .Creature)
		if ac != bc do return !ac
		return card(a.colors) < card(b.colors)
	})
	colored := make([dynamic]bit_set[types.ManaType], context.temp_allocator)
	for shard in c.shards {
		payers, _, payable := shard_payers(shard)
		if !payable do return taps, false
		if payers != {} do append(&colored, payers)
	}
	used := make([]int, len(sources), context.temp_allocator) // mana taken from each source so far
	if !assign_colored(sources[:], colored[:], 0, used) do return taps, false
	generic := int(c.generic)
	for src, i in sources do if used[i] > 0 do generic -= src.amount - used[i] // the rest of a tapped source's mana
	for src, i in sources {
		if generic <= 0 do break
		if used[i] == 0 {
			used[i] = src.amount
			generic -= src.amount
		}
	}
	if generic > 0 do return taps, false
	for src, i in sources do if used[i] > 0 do append(&taps, src.object)
	return taps, true
}

// Backtracking: symbol k onward, each paid from a source that can make it and still has mana.
@(private = "file")
assign_colored :: proc(sources: []Mana_Source, colored: []bit_set[types.ManaType], k: int, used: []int) -> bool {
	if k == len(colored) do return true
	for src, i in sources {
		if used[i] >= src.amount || (src.colors & colored[k]) == {} do continue
		used[i] += 1
		if assign_colored(sources, colored, k + 1, used) do return true
		used[i] -= 1
	}
	return false
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
