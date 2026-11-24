// Mana (CR 106) and paying costs (CR 601.2g-h): a player's mana sources and the automatic payment of a mana cost.
package game

import "core:slice"
import types "../types"

// One untapped permanent's {T}: add mana abilities, and the mana they can make.
Mana_Source :: struct {
	object:  ^types.GameObject,
	colors:  bit_set[types.ManaType], // the types it can produce (one of them per activation)
	amount:  int,
	options: [dynamic]Mana_Option, // its abilities usable in this payment
}

// What else a mana ability does or costs, besides {T}, from the most to the least welcome: "This land deals 1
// damage to you" (painlands), "Pay 1 life", "Sacrifice this".
Mana_Rider :: enum {
	None,
	Damage,
	Life,
	Sacrifice,
}

Mana_Option :: struct {
	colors:       bit_set[types.ManaType],
	amount:       int,
	rider:        Mana_Rider,
	rider_amount: int,
}

// A {T} ability whose only effect is to add mana (CR 605.1a), and what it adds.
tap_mana_ability :: proc(a: types.AbilityDefinition) -> (colors: bit_set[types.ManaType], amount: int, ok: bool) {
	o, is_mana := mana_ability_option(a)
	return o.colors, o.amount, is_mana
}

mana_ability_option :: proc(a: types.AbilityDefinition) -> (option: Mana_Option, ok: bool) {
	if a.kind != .Activated || a.effect == nil do return
	// Not yet: "activate only if" (CR 602.5), spending restrictions (CR 106.6), extra effects other than damage to
	// you. Such abilities aren't supported rather than half done.
	if len(a.activation_restrictions) > 0 || a.condition != nil || a.activation_zone != nil do return
	if sub := a.sub_ability; sub != nil {
		// "This land deals 1 damage to you."
		if sub.sub_ability != nil || sub.condition != nil || sub.effect == nil do return
		dmg, is_damage := sub.effect^.(types.Effect_DealDamage)
		n, fixed := fixed_quantity(dmg.amount)
		if !is_damage || !fixed || !is_controller(dmg.target) || dmg.damage_source != nil do return
		option.rider, option.rider_amount = .Damage, n
	}
	cost, has_cost := a.cost.?
	if !has_cost do return
	taps := false
	parts: []types.AbilityCost = {cost}
	if comp, composite := cost.(types.AbilityCost_Composite); composite do parts = comp.costs[:]
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Tap:
			taps = true
		case types.AbilityCost_PayLife:
			n, fixed := fixed_quantity(x.amount)
			if !fixed || option.rider != .None do return
			option.rider, option.rider_amount = .Life, n
		case types.AbilityCost_Sacrifice:
			count, is_count := x._0.requirement.(types.SacrificeRequirement_Count)
			if !is_self(x._0.target) || !is_count || count.count != 1 || option.rider != .None do return
			option.rider = .Sacrifice
		case:
			return
		}
	}
	if !taps do return
	colors, amount := produced_mana(a)
	option.colors, option.amount = colors, amount
	return option, amount > 0
}

@(private = "file")
produced_mana :: proc(a: types.AbilityDefinition) -> (colors: bit_set[types.ManaType], amount: int) {
	effect, is_mana := a.effect.(types.Effect_Mana)
	if !is_mana || len(effect.restrictions) > 0 || len(effect.grants) > 0 || effect.expiry != nil || effect.target != nil do return
	switch p in effect.produced {
	case types.ManaProduction_Fixed:
		// "Add {G}" (one color, once per symbol) or "Add {W}{U}" (each listed symbol).
		for c in p.colors do colors += {types.ManaType(c)}
		amount = len(p.colors)
		if card(colors) > 1 do return {}, 0 // several different symbols at once: not yet
		return colors, amount
	case types.ManaProduction_Colorless:
		n, fixed := fixed_quantity(p.count)
		if !fixed do return {}, 0
		return {.Colorless}, n
	case types.ManaProduction_AnyOneColor:
		n, fixed := fixed_quantity(p.count)
		if !fixed do return {}, 0
		for c in p.color_options do colors += {types.ManaType(c)}
		if len(p.color_options) == 0 do colors = {.White, .Blue, .Black, .Red, .Green}
		return colors, n
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

mana_sources :: proc(s: ^types.GameState, p: types.PlayerId, exclude: types.ObjectId = 0, worst: Mana_Rider = .None, others: []types.ObjectId = nil) -> [dynamic]Mana_Source {
	out := make([dynamic]Mana_Source, context.temp_allocator)
	for o in permanents_of(s, p) {
		if o.id == exclude || slice.contains(others, o.id) || !can_tap_for_cost(o) || o.abilities == nil do continue
		// CR 605.3a: any of its mana abilities; each costs {T}, so one per tap. Only those whose rider is no worse
		// than `worst`.
		src := Mana_Source{object = o, options = make([dynamic]Mana_Option, context.temp_allocator)}
		for a in o.abilities^ {
			option, ok := mana_ability_option(a)
			// CR 119.4: life can be paid only up to the player's life total.
			if ok && option.rider == .Life && int(player(s, p).life) < option.rider_amount do ok = false
			if ok && option.rider <= worst {
				src.colors += option.colors
				src.amount = option.amount if src.amount == 0 else min(src.amount, option.amount)
				append(&src.options, option)
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
// `exclude` and `others`: permanents that can't pay, because they pay another part of the cost (CR 601.2h).
plan_payment :: proc(s: ^types.GameState, p: types.PlayerId, cost: types.ManaCost, exclude: types.ObjectId = 0, others: []types.ObjectId = nil) -> (taps: [dynamic]^types.GameObject, ok: bool) {
	taps = make([dynamic]^types.GameObject, context.temp_allocator)
	plan, payable := plan_mana_taps(s, p, cost, exclude, others)
	for t in plan do append(&taps, t.object)
	return taps, payable
}

// A permanent tapped for mana, and the rider of the ability used.
Mana_Tap :: struct {
	object: ^types.GameObject,
	option: Mana_Option,
}

// CR 601.2g-h: which permanents to tap, and with which abilities, to pay the cost. Abilities without a rider are
// tried first, then those that deal damage or cost life, then those that sacrifice the source.
plan_mana_taps :: proc(s: ^types.GameState, p: types.PlayerId, cost: types.ManaCost, exclude: types.ObjectId = 0, others: []types.ObjectId = nil) -> (taps: [dynamic]Mana_Tap, ok: bool) {
	taps = make([dynamic]Mana_Tap, context.temp_allocator)
	c, is_cost := cost.(types.ManaCost_Cost)
	if !is_cost do return taps, false
	colored := make([dynamic]bit_set[types.ManaType], context.temp_allocator)
	for shard in c.shards {
		payers, _, payable := shard_payers(shard)
		if !payable do return taps, false
		if payers != {} do append(&colored, payers)
	}
	for worst in Mana_Rider {
		if worst == .Life do continue // tried together with Damage
		sources := mana_sources(s, p, exclude, .Life if worst == .Damage else worst, others)
		// Preference order: noncreatures first, then sources that make fewer kinds of mana.
		slice.sort_by(sources[:], proc(a, b: Mana_Source) -> bool {
			ac, bc := is_type(a.object, .Creature), is_type(b.object, .Creature)
			if ac != bc do return !ac
			return card(a.colors) < card(b.colors)
		})
		used := make([]int, len(sources), context.temp_allocator) // mana taken from each source so far
		assigned := make([]int, len(colored), context.temp_allocator) // the source paying each colored symbol
		if !assign_colored(sources[:], colored[:], 0, used, assigned) do continue
		generic := int(c.generic)
		for src, i in sources do if used[i] > 0 do generic -= src.amount - used[i] // the rest of a tapped source's mana
		for src, i in sources {
			if generic <= 0 do break
			if used[i] == 0 {
				used[i] = src.amount
				generic -= src.amount
			}
		}
		if generic > 0 do continue
		for src, i in sources do if used[i] > 0 {
			// The ability with the mildest rider that makes every symbol this source pays.
			best := -1
			for option, j in src.options {
				fits := true
				for k in 0 ..< len(colored) do if assigned[k] == i && option.colors & colored[k] == {} do fits = false
				if fits && (best < 0 || option.rider < src.options[best].rider) do best = j
			}
			if best < 0 do best = 0
			append(&taps, Mana_Tap{src.object, src.options[best]})
		}
		return taps, true
	}
	return taps, false
}

// Pays a mana cost: taps the planned permanents, then carries out their abilities' riders (CR 605.3b: a mana
// ability resolves at once): damage to the player, life paid, the source sacrificed.
pay_mana :: proc(g: ^Game, p: types.PlayerId, cost: types.ManaCost, exclude: types.ObjectId = 0, others: []types.ObjectId = nil) -> bool {
	taps, ok := plan_mana_taps(&g.state, p, cost, exclude, others)
	if !ok do return false
	for t in taps do t.object.tapped = true
	for t in taps {
		switch t.option.rider {
		case .None:
		case .Damage:
			deal_damage(g, t.object.id, types.TargetRef_Player{p}, t.option.rider_amount)
		case .Life:
			lose_life(&g.state, p, t.option.rider_amount) // CR 119.4: paying life is losing it
		case .Sacrifice:
			move_object(g, t.object.id, .Graveyard)
		}
	}
	return true
}

// Backtracking: symbol k onward, each paid from a source that can make it and still has mana.
@(private = "file")
assign_colored :: proc(sources: []Mana_Source, colored: []bit_set[types.ManaType], k: int, used: []int, assigned: []int) -> bool {
	if k == len(colored) do return true
	for src, i in sources {
		if used[i] >= src.amount || (src.colors & colored[k]) == {} do continue
		used[i] += 1
		assigned[k] = i
		if assign_colored(sources, colored, k + 1, used, assigned) do return true
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

// CR 202.3e: an object's mana value, X counted as the announced value while it's on the stack (0 elsewhere).
object_mana_value :: proc(o: ^types.GameObject) -> int {
	n := mana_value(o.mana_cost)
	if o.zone == .Stack {
		if c, ok := o.mana_cost.(types.ManaCost_Cost); ok {
			x := int(o.cost_x_paid.? or_else 0)
			for shard in c.shards do if shard == .X do n += x
		}
	}
	return n
}
