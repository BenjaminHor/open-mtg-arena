// Mana (CR 106) and paying costs (CR 601.2g-h): a player's mana sources and the automatic payment of a mana cost.
package game

import "core:fmt"
import "core:reflect"
import "core:slice"
import "core:strings"
import types "../types"

// One untapped permanent's {T}: add mana abilities, and the mana they can make; or one mana already in the
// player's mana pool (CR 106.4), with no object.
Mana_Source :: struct {
	object:  ^types.GameObject,
	pip:     types.ManaPipId, // the pool's mana, when object is nil
	colors:  bit_set[types.ManaType], // the types it can produce (one of them per activation)
	amount:  int,
	options: [dynamic]Mana_Option, // its abilities usable in this payment
}

// What else a mana ability does or costs, besides {T}, from the most to the least welcome: "This land deals 1
// damage to you" (painlands), "Pay 1 life", "Sacrifice this", "Exile this" (Abyssal Lotus).
Mana_Rider :: enum {
	None,
	Damage,
	Life,
	Sacrifice,
	Exile,
}

Mana_Option :: struct {
	colors:       bit_set[types.ManaType],
	amount:       int,
	rider:        Mana_Rider,
	rider_amount: int,
	taps:         bool,
	// "{1}, {T}: Add one mana of any color": mana paid to activate it (CR 605.3a). Automatic payment doesn't use
	// such abilities; the player activates them on their own.
	mana_cost:    types.ManaCost,
	// "Spend this mana only to cast a creature spell" (CR 106.6): what the mana may pay for.
	restrictions: []types.ManaRestriction,
	index:        int, // the ability's index on its object, for "only once each turn" (CR 602.5b)
	// "Add {W}{U}": every listed symbol at once, not one of them. The player activates such abilities on their own;
	// automatic payment doesn't use them yet.
	each:         bool,
	symbols:      []types.ManaColor, // those symbols, in order, when `each`
	// CR 702.51a: convoke, tapping a creature instead of paying {1} or one mana of its color. Not mana, and not a
	// mana ability: no rider, nothing recorded, nothing left in the pool.
	convoke:      bool,
	// What else the ability does as it resolves (CR 605.3b), after its mana: "You gain 1 life", "put a stash counter
	// on this" (mana_extras). The instructions after the mana, nil when there are none.
	extras:       ^types.AbilityDefinition,
	// Whether one of those does the player harm ("each player loses 1 life", "each opponent gains 1 life"):
	// automatic payment then ranks the ability with the painlands (option_rank).
	harmful:      bool,
}

// How unwelcome an ability is to automatic payment: its rider, or a painland's if what else it does harms its
// player.
option_rank :: proc(option: Mana_Option) -> Mana_Rider {
	if option.harmful && option.rider < .Damage do return .Damage
	return option.rider
}

// The mana abilities the player activates on their own, which automatic payment doesn't use (CR 605.3a): those that
// cost mana ("{1}, {T}: Add one mana of any color"), that don't tap their permanent ("Sacrifice this creature: Add
// {C}"), and those that add several symbols at once ("Add {W}{U}").
player_activated_only :: proc(option: Mana_Option) -> bool {
	return option.mana_cost != nil || !option.taps || option.each || option.rider == .Exile
}

// CR 605.1a: an activated ability is a mana ability if it doesn't require a target, could add mana as it resolves,
// isn't a loyalty ability, and its cost and effect don't move a card to or from a library. Any other ability that
// adds mana ("[+1]: Add {R}{R}", "{T}: Exile target land card from a graveyard. Add one mana of any color", "Add one
// mana of any color. Draw a card") goes on the stack like other activated abilities (CR 605.5a).
is_mana_ability :: proc(a: types.AbilityDefinition) -> bool {
	if a.kind != .Activated || !adds_mana(a) do return false
	if cost, has := a.cost.?; has {
		parts := make([dynamic]types.AbilityCost, context.temp_allocator)
		cost_parts_of(cost, &parts)
		for part in parts {
			#partial switch _ in part {
			case types.AbilityCost_Loyalty, types.AbilityCost_Mill:
				return false
			}
		}
	}
	if a.effect != nil && !mana_instruction_allowed(a.effect^, a.target_choice_timing) do return false
	for x := a.sub_ability; x != nil; x = x.sub_ability {
		if x.effect != nil && !mana_instruction_allowed(x.effect^, x.target_choice_timing) do return false
	}
	return true
}

// An instruction a mana ability may have (CR 605.1a): one that targets nothing and moves no card to or from a library.
@(private = "file")
mana_instruction_allowed :: proc(e: types.Effect, timing: types.TargetChoiceTiming) -> bool {
	if _, targets := instruction_target(e, timing); targets do return false
	#partial switch x in e {
	case types.Effect_Draw, types.Effect_Dig, types.Effect_SearchLibrary, types.Effect_Mill, types.Effect_PutAtLibraryPosition,
	     types.Effect_ExileTop:
		return false
	case types.Effect_ChangeZone:
		if origin, has := x.origin.?; has && origin == .Library do return false
		return x.destination != .Library
	}
	return true
}

// Whether a mana ability's "activate only ..." restrictions allow it now (CR 602.5).
mana_restrictions_met :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, index: int, a: types.AbilityDefinition) -> bool {
	for r in a.activation_restrictions do if !restriction_met(s, p, o, index, r) do return false
	return true
}

// Counts the activation for "only once each turn" and "only once" (CR 602.5b).
record_mana_activation :: proc(s: ^types.GameState, o: ^types.GameObject, index: int) {
	if o.abilities == nil || index < 0 || index >= len(o.abilities^) || len(o.abilities^[index].activation_restrictions) == 0 do return
	record_activation(&s.activated_abilities_this_turn, o, index)
	record_activation(&s.activated_abilities_this_game, o, index)
}

// What a payment is for, which mana with a spending restriction reads (CR 106.6): a spell being cast, or an
// ability of `object` being activated. Unknown (the zero value), restricted mana isn't spent.
Payment :: struct {
	object:   ^types.GameObject,
	is_spell: bool,
}

// A {T} ability whose only effect is to add mana (CR 605.1a), and what it adds.
tap_mana_ability :: proc(a: types.AbilityDefinition) -> (colors: bit_set[types.ManaType], amount: int, ok: bool) {
	o, is_mana := mana_ability_option(a)
	return o.colors, o.amount, is_mana
}

// A mana ability whose costs mana_ability_option pays itself ({T}, mana, life, sacrificing the permanent), and what
// it makes and does. Abilities whose cost has the player choose ("{T}, Tap an untapped creature you control",
// "Sacrifice a Goblin") or removes counters are activated like other abilities (mana_ability_by_activation).
// `s` and `o`: the state and the ability's object, to work out an amount that's counted ("Add X mana of any one
// color, where X is ..."); without them (checking support) it's assumed to be at least one.
mana_ability_option :: proc(a: types.AbilityDefinition, s: ^types.GameState = nil, o: ^types.GameObject = nil) -> (option: Mana_Option, ok: bool) {
	produced: bool
	option, produced = mana_ability_effects(a, s, o)
	if !produced do return option, false
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
		case types.AbilityCost_Exile:
			// "Exile this artifact" from the battlefield (CR 701.13a), paid as the sacrifice is.
			f, has_filter := x.filter.?
			if !has_filter || !is_self(f) || x.zone != nil || x.count != 1 || option.rider != .None do return
			option.rider = .Exile
		case types.AbilityCost_Mana:
			if option.mana_cost != nil || has_x(x.cost) do return
			if _, is_cost := x.cost.(types.ManaCost_Cost); !is_cost do return
			option.mana_cost = x.cost
		case:
			return
		}
	}
	// "Sacrifice this creature: Add {C}" (an Eldrazi Spawn): no {T}, activated by the player (CR 605.3a).
	if !taps && option.mana_cost == nil && option.rider != .Sacrifice do return
	option.taps = taps
	return option, true
}

// What a mana ability (CR 605.1a) makes and does as it resolves, whatever it costs: the mana it adds (CR 106.4), "...
// instead" if a condition holds then (CR 608.2c), what may be spent of it on what (CR 106.6), and what else it does
// (CR 605.3b): damage to its controller (the painlands' rider), life gained or lost, counters put on it. Not ok when
// this engine can't carry all of it out.
mana_ability_effects :: proc(a: types.AbilityDefinition, s: ^types.GameState = nil, o: ^types.GameObject = nil) -> (option: Mana_Option, ok: bool) {
	if !is_mana_ability(a) || a.effect == nil do return
	// "Activate only if you control a Swamp", "only once each turn" (CR 602.5): checked where the ability is used,
	// with the state at hand (mana_restrictions_met). Not yet: conditions on the ability itself, other zones.
	for r in a.activation_restrictions do if !restriction_supported(r) do return
	if a.condition != nil || a.activation_zone != nil do return
	effect, is_mana := a.effect.(types.Effect_Mana)
	if !is_mana do return
	colors, amount, counted := produced_mana(a, s, o)
	if colors == {} do return
	next := a.sub_ability
	// "Add {G}. If you control four or more creatures, add {G}{G} instead": the second instruction replaces the first
	// when its condition holds as the ability resolves (CR 608.2c).
	if next != nil && is_mana_instead(next^) {
		up_colors, up_amount, up_counted := produced_mana(next^, s, o)
		if up_colors == {} do return
		if s != nil && o != nil && ability_condition_holds(s, next.condition.?, o.controller, o.id, nil) {
			colors, amount, counted = up_colors, up_amount, up_counted
			effect = next.effect.(types.Effect_Mana)
		}
		next = next.sub_ability
	}
	option.colors, option.amount = colors, amount
	if fixed, is_fixed := effect.produced.(types.ManaProduction_Fixed); is_fixed && card(colors) > 1 {
		option.each = true
		option.symbols = fixed.colors[:]
	}
	if len(effect.restrictions) > 0 {
		rs := make([]types.ManaRestriction, len(effect.restrictions), context.temp_allocator)
		for r, i in effect.restrictions do rs[i] = pool_restriction(r, o)
		option.restrictions = rs
	}
	option.extras = next
	for x := next; x != nil; x = x.sub_ability {
		if x.effect == nil do return
		if dmg, is_damage := x.effect^.(types.Effect_DealDamage); is_damage {
			// "This land deals 1 damage to you": the painlands' rider, at most one.
			n, fixed := fixed_quantity(dmg.amount)
			if !fixed || !is_controller(dmg.target) || dmg.damage_source != nil || option.rider != .None || x.condition != nil || x.player_scope != nil || x.optional do return
			option.rider, option.rider_amount = .Damage, n
			continue
		}
		harmful, extra_ok := mana_extra_supported(x^)
		if !extra_ok do return
		if harmful do option.harmful = true
	}
	return option, amount > 0 || (counted && colors != {}) // a counted amount can be 0 now (CR 106.4)
}

// "Add {G}{G} instead": a mana instruction that replaces the one before when its condition holds.
@(private = "file")
is_mana_instead :: proc(x: types.AbilityDefinition) -> bool {
	if x.effect == nil do return false
	if _, is_mana := x.effect.(types.Effect_Mana); !is_mana do return false
	c, has := x.condition.?
	if !has do return false
	instead, is_instead := c.(types.AbilityCondition_ConditionInstead)
	return is_instead && instead.inner != nil && ability_condition_supported(instead.inner^) && !depends_on_cost_paid(instead.inner^) &&
		x.sub_link != .SequentialSibling && !x.optional && x.player_scope == nil
}

// The instructions a mana ability may do besides adding mana, carried out at once (mana_extras): "you gain N
// life" or "each opponent gains N life", "each player loses N life", "put N [kind] counters on this", possibly "if"
// a condition holds. `harmful`: it costs its player life or gives an opponent some.
@(private = "file")
mana_extra_supported :: proc(x: types.AbilityDefinition) -> (harmful: bool, ok: bool) {
	if x.effect == nil || x.optional || x.multi_target != nil || x.repeat_for != nil || x.unless_pay != nil || x.modal != nil do return
	if x.distribute != nil || x.else_ability != nil || x.duration != nil do return
	if c, has := x.condition.?; has {
		_, is_outcome := outcome_wanted(c)
		#partial switch _ in c {
		case types.AbilityCondition_ConditionInstead, types.AbilityCondition_AdditionalCostPaidInstead, types.AbilityCondition_WhenYouDo:
			return
		}
		if is_outcome || !ability_condition_supported(c) || depends_on_cost_paid(c) do return
	}
	opponents := false
	if scope, has := x.player_scope.?; has {
		#partial switch _ in scope {
		case types.PlayerFilter_All:
		case types.PlayerFilter_Opponent:
			opponents = true
		case:
			return
		}
	}
	#partial switch e in x.effect^ {
	case types.Effect_GainLife:
		_, fixed := fixed_quantity(e.amount)
		if !fixed || (e.player != nil && !is_controller(e.player)) do return
		return opponents, true
	case types.Effect_LoseLife:
		_, fixed := fixed_quantity(e.amount)
		if t, has := e.target.?; !fixed || (has && !is_controller(t)) do return
		return true, true
	case types.Effect_PutCounter:
		_, fixed := fixed_quantity(e.count)
		if !fixed || !is_self(e.target) || !counter_kind_supported(e.counter_type) || x.player_scope != nil do return
		return false, true
	}
	return
}

// What else the mana ability does as it resolves (CR 605.3b), in order. Carried out here rather than by do_effect:
// a mana ability can resolve while a spell or ability is resolving (paying for "unless"), and do_effect reads that
// one's source as "this".
@(private = "file")
mana_extras :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, option: Mana_Option) {
	s := &g.state
	for x := option.extras; x != nil; x = x.sub_ability {
		if x.effect == nil do continue
		if _, is_damage := x.effect^.(types.Effect_DealDamage); is_damage do continue // the rider (mana_rider)
		// CR 608.2c: "if you control another Mutant, you gain 1 life".
		if c, has := x.condition.?; has && !ability_condition_holds(s, c, p, o.id, nil) do continue
		players := make([dynamic]types.PlayerId, context.temp_allocator)
		if scope, scoped := x.player_scope.?; scoped do append(&players, ..scope_players(s, scope, p)[:])
		else do append(&players, p)
		#partial switch e in x.effect^ {
		case types.Effect_GainLife:
			n, _ := fixed_quantity(e.amount)
			for who in players do gain_life(s, who, n)
		case types.Effect_LoseLife:
			n, _ := fixed_quantity(e.amount)
			for who in players do lose_life(s, who, n) // CR 119.3
		case types.Effect_PutCounter:
			// On this permanent, while it's still there (CR 400.7).
			n, _ := fixed_quantity(e.count)
			if o.zone == .Battlefield && n > 0 {
				add_counters(o, e.counter_type, u32(n))
				apply_continuous_effects(g)
			}
		}
	}
}

// A mana ability activated like other activated abilities: its cost has the player choose what to tap, sacrifice
// or exile ("{T}, Tap an untapped creature you control", "Sacrifice a Goblin", "{T}, Exile a card from your
// graveyard"), collect evidence, or remove counters from it. Its costs are paid as any ability's (CR 602.2b,
// 601.2h); then it resolves at once instead of going on the stack (CR 605.3b, resolve_mana_ability). Its mana is a
// fixed amount, and its cost doesn't take the permanent itself away, so what it makes is the same before and after
// the cost is paid.
mana_ability_by_activation :: proc(a: types.AbilityDefinition) -> bool {
	if _, simple := mana_ability_option(a); simple do return false
	option, ok := mana_ability_effects(a)
	if !ok do return false
	if effect, is_mana := a.effect.(types.Effect_Mana); is_mana && !mana_amount_fixed(effect) do return false
	if next := a.sub_ability; next != nil && is_mana_instead(next^) && !mana_amount_fixed(next.effect.(types.Effect_Mana)) do return false
	if option.rider != .None do return false // a painland's damage with a chosen cost: none known yet
	cost, has := a.cost.?
	if !has || !cost_supported(cost) do return false
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts_of(cost, &parts)
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Sacrifice:
			if is_self(x._0.target) do return false
		case types.AbilityCost_Exile:
			if f, has_filter := x.filter.?; has_filter && is_self(f) do return false
		case types.AbilityCost_Discard:
			if x.self_scope == .SourceCard do return false
		case types.AbilityCost_ReturnToHand, types.AbilityCost_EffectCost:
			return false
		}
	}
	return true
}

// Why a mana ability isn't supported, for the gap report: the part of it mana_ability_effects or the cost reading
// refuses.
mana_ability_gap :: proc(a: types.AbilityDefinition) -> string {
	variant :: proc(v: any) -> string {
		full := fmt.tprintf("%v", reflect.union_variant_typeid(v))
		if i := strings.last_index_byte(full, '_'); i >= 0 do full = full[i + 1:]
		return full
	}
	prefix :: "activated: mana ability"
	for r in a.activation_restrictions do if !restriction_supported(r) do return fmt.tprintf("%s (restriction %s)", prefix, variant(r))
	if a.activation_zone != nil do return fmt.tprintf("%s (from %v)", prefix, a.activation_zone)
	if a.condition != nil do return fmt.tprintf("%s (condition)", prefix)
	if effect, is_mana := a.effect.(types.Effect_Mana); is_mana {
		if len(effect.grants) > 0 do return fmt.tprintf("%s (mana that grants %s)", prefix, variant(effect.grants[0]))
		if effect.expiry != nil do return fmt.tprintf("%s (mana that lasts)", prefix)
		for r in effect.restrictions do if !spend_restriction_supported(r, a.description.? or_else "") do return fmt.tprintf("%s (spend restriction %s)", prefix, variant(r))
		if colors, _, _ := produced_mana(a, nil, nil); colors == {} do return fmt.tprintf("%s (%s)", prefix, variant(effect.produced))
	} else {
		return fmt.tprintf("%s (mana added after another instruction)", prefix)
	}
	for x := a.sub_ability; x != nil; x = x.sub_ability {
		if x.effect == nil || is_mana_instead(x^) do continue
		if _, is_damage := x.effect^.(types.Effect_DealDamage); is_damage do continue
		if _, ok := mana_extra_supported(x^); !ok do return fmt.tprintf("%s (extra effect %s)", prefix, variant(x.effect^))
	}
	if cost, has := a.cost.?; has {
		parts := make([dynamic]types.AbilityCost, context.temp_allocator)
		cost_parts_of(cost, &parts)
		for part in parts do if !cost_supported(part) do return fmt.tprintf("%s (cost %s)", prefix, variant(part))
	}
	return fmt.tprintf("%s (its cost or amount)", prefix)
}

@(private = "file")
mana_amount_fixed :: proc(e: types.Effect_Mana) -> bool {
	#partial switch p in e.produced {
	case types.ManaProduction_Fixed:
		return true
	case types.ManaProduction_Colorless:
		_, fixed := fixed_quantity(p.count)
		return fixed
	case types.ManaProduction_AnyOneColor:
		_, fixed := fixed_quantity(p.count)
		return fixed
	}
	return false
}

@(private = "file")
produced_mana :: proc(a: types.AbilityDefinition, s: ^types.GameState, o: ^types.GameObject) -> (colors: bit_set[types.ManaType], amount: int, counted: bool) {
	// How much: a fixed number, or a count worked out now (CR 107.3, 608.2h).
	how_many :: proc(q: types.QuantityExpr, s: ^types.GameState, o: ^types.GameObject) -> (n: int, counted: bool, ok: bool) {
		if n, fixed := fixed_quantity(q); fixed do return n, false, true
		if !quantity_supported(q) || quantity_reads_target(q) do return 0, true, false
		if s == nil || o == nil do return 1, true, true
		return max(quantity_value(s, q, o.controller, o.id, 0), 0), true, true
	}
	effect, is_mana := a.effect.(types.Effect_Mana)
	if !is_mana || len(effect.grants) > 0 || effect.expiry != nil || effect.target != nil do return
	for r in effect.restrictions do if !spend_restriction_supported(r, a.description.? or_else "") do return
	switch p in effect.produced {
	case types.ManaProduction_Fixed:
		// "Add {G}" (one color, once per symbol) or "Add {W}{U}" (each listed symbol).
		for c in p.colors do colors += {types.ManaType(c)}
		amount = len(p.colors)
		return colors, amount, false
	case types.ManaProduction_Colorless:
		n, is_counted, ok := how_many(p.count, s, o)
		if !ok do return {}, 0, false
		return {.Colorless}, n, is_counted
	case types.ManaProduction_AnyOneColor:
		n, is_counted, ok := how_many(p.count, s, o)
		if !ok do return {}, 0, false
		for c in p.color_options do colors += {types.ManaType(c)}
		if len(p.color_options) == 0 do colors = {.White, .Blue, .Black, .Red, .Green}
		return colors, n, is_counted
	case types.ManaProduction_ChosenColor:
		// "Add one mana of the chosen color" (CR 614.12: chosen as the permanent entered); "add {R} or one mana of
		// the chosen color". Checking support (no object), any color it could be.
		if p.contribution != .Base do return {}, 0, false
		n, is_counted, ok := how_many(p.count, s, o)
		if !ok do return {}, 0, false
		if alt, has := p.fixed_alternative.?; has do colors += {types.ManaType(alt)}
		if o == nil {
			colors += {.White}
		} else if c, chosen := chosen_color(o); chosen {
			colors += {types.ManaType(c)}
		}
		if colors == {} do return {}, 0, false
		return colors, n, is_counted
	case types.ManaProduction_Mixed, types.ManaProduction_AnyCombination,
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

mana_sources :: proc(s: ^types.GameState, p: types.PlayerId, exclude: types.ObjectId = 0, worst: Mana_Rider = .None, others: []types.ObjectId = nil, paying: Payment = {}) -> [dynamic]Mana_Source {
	out := make([dynamic]Mana_Source, context.temp_allocator)
	// CR 106.4: mana in the pool can pay costs; CR 106.6: restricted mana, only what it may be spent on. Mana with
	// a rider isn't spent automatically yet.
	for u in player(s, p).mana_pool.mana {
		if len(u.grants) > 0 || !restrictions_allow(s, u.restrictions[:], paying) do continue
		option := Mana_Option{colors = {u.color}, amount = 1}
		src := Mana_Source{pip = u.pip_id, colors = {u.color}, amount = 1, options = make([dynamic]Mana_Option, context.temp_allocator)}
		append(&src.options, option)
		append(&out, src)
	}
	for o in permanents_of(s, p) {
		if o.id == exclude || slice.contains(others, o.id) || !can_tap_for_cost(o) || o.abilities == nil do continue
		// CR 605.3a: any of its mana abilities; each costs {T}, so one per tap. Only those whose rider is no worse
		// than `worst`.
		src := Mana_Source{object = o, options = make([dynamic]Mana_Option, context.temp_allocator)}
		for a, index in o.abilities^ {
			option, ok := mana_ability_option(a, s, o)
			option.index = index
			if ok && player_activated_only(option) do ok = false // activated by the player, not here
			if ok && !mana_restrictions_met(s, p, o, index, a) do ok = false
			if ok && !restrictions_allow(s, option.restrictions, paying) do ok = false
			// CR 119.4: life can be paid only up to the player's life total.
			if ok && option.rider == .Life && int(player(s, p).life) < option.rider_amount do ok = false
			if ok && option_rank(option) <= worst {
				src.colors += option.colors
				src.amount = option.amount if src.amount == 0 else min(src.amount, option.amount)
				append(&src.options, option)
			}
		}
		if src.amount > 0 do append(&out, src)
	}
	// CR 702.51a: a spell with convoke may be paid for in part by tapping untapped creatures its caster controls,
	// summoning sick or not (it isn't a {T} cost). A creature that's a mana source above is used that way instead.
	if paying.is_spell && paying.object != nil && has_keyword(paying.object, types.Keyword_Convoke) {
		for o in permanents_of(s, p) {
			if o.id == exclude || o.id == paying.object.id || slice.contains(others, o.id) || o.tapped || !is_type(o, .Creature) do continue
			colors: bit_set[types.ManaType]
			for c in o.color do colors += {types.ManaType(c)}
			convoke := Mana_Option{colors = colors, amount = 1, taps = true, convoke = true}
			// A creature that's a mana source too: one more way to tap it (for its mana, or to convoke for its
			// color), each payment choosing one.
			existing := -1
			for src, i in out do if src.object == o do existing = i
			if existing >= 0 {
				out[existing].colors += colors
				append(&out[existing].options, convoke)
				continue
			}
			src := Mana_Source{object = o, colors = colors, amount = 1, options = make([dynamic]Mana_Option, context.temp_allocator)}
			append(&src.options, convoke)
			append(&out, src)
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
plan_payment :: proc(s: ^types.GameState, p: types.PlayerId, cost: types.ManaCost, exclude: types.ObjectId = 0, others: []types.ObjectId = nil, paying: Payment = {}) -> (taps: [dynamic]^types.GameObject, ok: bool) {
	taps = make([dynamic]^types.GameObject, context.temp_allocator)
	plan, payable := plan_mana_taps(s, p, cost, exclude, others, paying)
	for t in plan do if t.object != nil do append(&taps, t.object)
	return taps, payable
}

// A permanent tapped for mana, and the rider of the ability used.
Mana_Tap :: struct {
	object:  ^types.GameObject, // nil: mana from the pool, `pip`
	option:  Mana_Option,
	pip:     types.ManaPipId,
	surplus: int, // mana it makes beyond what the cost needs, left in the pool (CR 106.4)
	paid:    int, // how much of the cost it pays...
	color:   types.ManaType, // ...and in what type of mana (a colored symbol's, or the first it can make)
}

// CR 601.2g-h: which permanents to tap, and with which abilities, to pay the cost. Abilities without a rider are
// tried first, then those that deal damage or cost life, then those that sacrifice the source.
plan_mana_taps :: proc(s: ^types.GameState, p: types.PlayerId, cost: types.ManaCost, exclude: types.ObjectId = 0, others: []types.ObjectId = nil, paying: Payment = {}) -> (taps: [dynamic]Mana_Tap, ok: bool) {
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
		sources := mana_sources(s, p, exclude, .Life if worst == .Damage else worst, others, paying)
		// Preference order: mana already in the pool (it empties at the end of the step, CR 106.4), then
		// noncreatures, then sources that make fewer kinds of mana.
		slice.sort_by(sources[:], proc(a, b: Mana_Source) -> bool {
			if (a.object == nil) != (b.object == nil) do return a.object == nil
			if a.object == nil do return false
			ac, bc := is_type(a.object, .Creature), is_type(b.object, .Creature)
			if ac != bc do return !ac
			return card(a.colors) < card(b.colors)
		})
		used := make([]int, len(sources), context.temp_allocator) // mana taken from each source so far
		assigned := make([]int, len(colored), context.temp_allocator) // the source paying each colored symbol
		if !assign_colored(sources[:], colored[:], 0, used, assigned) do continue
		generic := int(c.generic)
		last := -1 // the source that pays the last of the cost
		for src, i in sources do if used[i] > 0 {
			if src.amount > used[i] do last = i
			generic -= src.amount - used[i] // the rest of a tapped source's mana
		}
		for src, i in sources {
			if generic <= 0 do break
			if used[i] == 0 {
				used[i] = src.amount
				generic -= src.amount
				last = i
			}
		}
		if generic > 0 do continue
		// What's made beyond the cost (Sol Ring's second {C} for {1}) is counted as the source that paid last's.
		surplus := make([]int, len(sources), context.temp_allocator)
		if generic < 0 && last >= 0 do surplus[last] = -generic
		for src, i in sources do if used[i] > 0 {
			// The ability with the mildest rider that makes every symbol this source pays.
			best := -1
			for option, j in src.options {
				fits := true
				for k in 0 ..< len(colored) do if assigned[k] == i && option.colors & colored[k] == {} do fits = false
				if fits && (best < 0 || option_rank(option) < option_rank(src.options[best])) do best = j
			}
			if best < 0 do best = 0
			color: types.ManaType
			for c in src.options[best].colors {
				color = c
				break
			}
			for k in 0 ..< len(colored) do if assigned[k] == i {
				for c in src.options[best].colors & colored[k] {
					color = c
					break
				}
			}
			append(&taps, Mana_Tap{src.object, src.options[best], src.pip, surplus[i], used[i] - surplus[i], color})
		}
		return taps, true
	}
	return taps, false
}

// Pays a mana cost: taps the planned permanents, then carries out their abilities' riders (CR 605.3b: a mana
// ability resolves at once): damage to the player, life paid, the source sacrificed.
pay_mana :: proc(g: ^Game, p: types.PlayerId, cost: types.ManaCost, exclude: types.ObjectId = 0, others: []types.ObjectId = nil, paying: Payment = {}) -> bool {
	taps, ok := plan_mana_taps(&g.state, p, cost, exclude, others, paying)
	if !ok do return false
	for t in taps {
		if t.object == nil do spend_pool_mana(&g.state, p, t.pip)
		else if t.option.convoke {
			tap_permanent(t.object) // CR 702.51c: it convoked the spell
			continue
		} else {
			tap_permanent(t.object)
			record_mana_activation(&g.state, t.object, t.option.index)
		}
		if t.surplus > 0 {
			// CR 106.4: the rest of the mana stays in the pool. A choice of color is the engine's for now, as is the
			// choice of what to tap: the first it could make.
			color: types.ManaType
			for c in t.option.colors {
				color = c
				break
			}
			add_pool_mana(&g.state, p, color, t.object.id if t.object != nil else 0, t.surplus, t.option.restrictions)
		}
	}
	for t in taps do if t.object != nil && !t.option.convoke do mana_rider(g, p, t.object, t.option)
	if paying.is_spell && paying.object != nil do record_mana_spent(paying.object, taps[:])
	return true
}

// What a mana ability does besides adding mana: damage to its controller, life paid, what else it does
// (mana_extras), the source sacrificed last (it may put a counter on itself first).
@(private = "file")
mana_rider :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, option: Mana_Option) {
	switch option.rider {
	case .None, .Sacrifice, .Exile:
	case .Damage:
		deal_damage(g, o.id, types.TargetRef_Player{p}, option.rider_amount)
	case .Life:
		lose_life(&g.state, p, option.rider_amount) // CR 119.4: paying life is losing it
	}
	mana_extras(g, p, o, option)
	if option.rider == .Sacrifice do sacrifice_permanent(g, o.id)
	if option.rider == .Exile do move_object(g, o.id, .Exile)
}

// CR 605.3a-b: a player with priority may activate a mana ability on its own; it doesn't use the stack and
// resolves at once, its mana going into the player's mana pool (CR 106.4) until it's spent or the step ends.
activate_mana_ability :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, a: ^types.AbilityDefinition) -> bool {
	if !mana_ability_activatable(g, p, o, a) do return false
	option, _ := mana_ability_option(a^, &g.state, o)
	record_mana_activation(&g.state, o, ability_index_of(o, a))
	// CR 602.2b, 601.2h: the costs are paid: {T}, and mana for "{1}, {T}: Add ..." (from other sources, CR 605.3a).
	if option.taps do tap_permanent(o)
	if option.mana_cost != nil do pay_mana(g, p, option.mana_cost, o.id, nil, Payment{o, false})
	produce_mana(g, p, o, ability_index_of(o, a), option)
	return true
}

// CR 605.3b: the mana ability resolves at once, its costs paid: its mana into the pool, the player choosing the
// color of "one mana of any color" first.
@(private = "file")
produce_mana :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, index: int, option: Mana_Option) {
	if option.each {
		// "Add {W}{U}": the mana of each symbol, into the mana pool (CR 106.4).
		for c in option.symbols do add_pool_mana(&g.state, p, types.ManaType(c), o.id, 1, option.restrictions)
		mana_rider(g, p, o, option)
		g.state.priority_passes = nil
		give_priority(g, p)
		return
	}
	if card(option.colors) > 1 {
		// "One mana of any color": the color is chosen as it resolves (CR 605.3b), which is at once.
		pending := new(types.PendingManaAbility)
		pending.player = p
		pending.source_id = o.id
		pending.ability_index = index
		options := make([dynamic]types.ManaType)
		for c in option.colors do append(&options, c)
		g.state.waiting_for = types.WaitingFor_ChooseManaColor{player = p, choice = types.ManaChoicePrompt_SingleColor{options = options}, context_ = types.ManaChoiceContext_ManaAbility{pending}}
		return
	}
	color: types.ManaType
	for c in option.colors do color = c
	finish_mana_ability(g, p, o, option, color)
}

// A mana ability activated like other abilities (mana_ability_by_activation), once its costs are paid: it doesn't go
// on the stack but resolves at once (CR 605.3b), and its player gets priority back.
resolve_mana_ability :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, index: int) {
	a := activated_ability(o, index)
	option, _ := mana_ability_effects(a^, &g.state, o)
	produce_mana(g, p, o, index, option)
}

// Whether the player can activate this mana ability now: they control it on the battlefield, can pay its costs.
mana_ability_activatable :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, a: ^types.AbilityDefinition) -> bool {
	option, is_mana := mana_ability_option(a^, &g.state, o)
	if !is_mana do return false
	if o.zone != .Battlefield || o.controller != p do return refuse("not activatable from its zone")
	if !mana_restrictions_met(&g.state, p, o, ability_index_of(o, a), a^) do return refuse("activation restriction") // CR 602.5
	if option.taps && !can_tap_for_cost(o) do return refuse("can't tap") // CR 302.6
	if option.rider == .Life && int(player(&g.state, p).life) < option.rider_amount do return refuse("not enough life") // CR 119.4
	if option.mana_cost != nil {
		if _, payable := plan_payment(&g.state, p, option.mana_cost, o.id if option.taps else 0, nil, Payment{o, false}); !payable do return refuse("mana cost unpayable")
	}
	return true
}

// The mana ability's result: its mana into the pool (CR 106.4) and what else it does (CR 405.6c), then priority
// back to its player after state-based actions and triggers (CR 405.6c, 117.3c, 117.5), earlier passes no longer
// counting (CR 117.4).
finish_mana_ability :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, option: Mana_Option, color: types.ManaType) {
	add_pool_mana(&g.state, p, color, o.id, option.amount, option.restrictions)
	mana_rider(g, p, o, option)
	g.state.priority_passes = nil
	give_priority(g, p)
}

// The player's choice of color for a mana ability waiting on it.
choose_mana_color :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ChooseManaColor, choice: types.ManaChoice) -> bool {
	ctx, of_ability := w.context_.(types.ManaChoiceContext_ManaAbility)
	prompt, single := w.choice.(types.ManaChoicePrompt_SingleColor)
	picked, is_single := choice.(types.ManaChoice_SingleColor)
	if !of_ability || ctx._0 == nil || !single || !is_single || !slice.contains(prompt.options[:], picked._0) do return false
	o := object(&g.state, ctx._0.source_id)
	index, has := ctx._0.ability_index.?
	if o == nil || !has do return false
	a := activated_ability(o, index)
	if a == nil do return false
	// The costs are paid by now: for an ability activated like others (mana_ability_by_activation), only what it
	// makes and does is left.
	option, simple := mana_ability_option(a^, &g.state, o)
	if !simple do option, _ = mana_ability_effects(a^, &g.state, o)
	finish_mana_ability(g, p, o, option, picked._0)
	return true
}

ability_index_of :: proc(o: ^types.GameObject, a: ^types.AbilityDefinition) -> int {
	if o.abilities == nil do return -1
	for &x, i in o.abilities^ do if &x == a do return i
	return -1
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
	// CR 712.6d, 202.3b: a transformed permanent's mana value is its front face's mana cost's (kept with its front
	// face's name in back_face); the back face itself has no mana cost.
	if o.transformed do if front, has := o.back_face.?; has do n = mana_value(front.mana_cost)
	if o.zone == .Stack {
		if c, ok := o.mana_cost.(types.ManaCost_Cost); ok {
			x := int(o.cost_x_paid.? or_else 0)
			for shard in c.shards do if shard == .X do n += x
		}
	}
	return n
}

// ---- The mana pool (CR 106.4) -----------------------------------------------------------------------------------

// CR 106.4: mana a player adds goes into their mana pool.
add_pool_mana :: proc(s: ^types.GameState, p: types.PlayerId, color: types.ManaType, source: types.ObjectId, n := 1, restrictions: []types.ManaRestriction = nil) {
	pl := player(s, p)
	for _ in 0 ..< n {
		// Each unit's id, for the client to follow it: from 1 up (0 means none). Restricted mana keeps what it may
		// be spent on (CR 106.6).
		if s.next_pip_id == 0 do s.next_pip_id = 1
		kept := slice.clone_to_dynamic(restrictions)
		// A phrase made for the restriction (pool_restriction) lives only until this call into the engine returns.
		for &r in kept do if kind, is_kind := r.(types.ManaRestriction_OnlyForSpellType); is_kind do r = types.ManaRestriction_OnlyForSpellType{strings.clone(kind._0)}
		append(&pl.mana_pool.mana, types.ManaUnit{color = color, source_id = source, pip_id = types.ManaPipId(s.next_pip_id), restrictions = kept})
		s.next_pip_id += 1
	}
}

spend_pool_mana :: proc(s: ^types.GameState, p: types.PlayerId, pip: types.ManaPipId) {
	pool := &player(s, p).mana_pool.mana
	for u, i in pool do if u.pip_id == pip {
		ordered_remove(pool, i)
		return
	}
}

// What was spent to cast a spell ("if at least three mana of the same color was spent", "the amount of mana spent"):
// kept on the object, and on the permanent it becomes. Convoke isn't mana (CR 702.51c), nor counted.
@(private = "file")
record_mana_spent :: proc(o: ^types.GameObject, taps: []Mana_Tap) {
	o.mana_spent_to_cast = true
	for t in taps {
		// CR 702.51c: a creature tapped to pay for it with convoke "convoked" the spell ("for each creature that
		// convoked it"); that isn't mana spent.
		if t.option.convoke && t.object != nil do append(&o.convoked_creatures, t.object.id)
		if t.option.convoke || t.paid <= 0 do continue
		n := u32(t.paid)
		o.mana_spent_to_cast_amount += n
		#partial switch t.color {
		case .White:
			o.colors_spent_to_cast.white += n
		case .Blue:
			o.colors_spent_to_cast.blue += n
		case .Black:
			o.colors_spent_to_cast.black += n
		case .Red:
			o.colors_spent_to_cast.red += n
		case .Green:
			o.colors_spent_to_cast.green += n
		}
	}
}

// CR 106.4: each player's mana pool empties at the end of each step and phase.
empty_mana_pools :: proc(s: ^types.GameState) {
	for &pl in s.players do clear(&pl.mana_pool.mana)
}

// ---- Restricted mana (CR 106.6) --------------------------------------------------------------------------------

// The spending restrictions this engine reads: "only to cast [a kind of] spell(s)", optionally "or activate
// abilities [of that kind]"; "only to cast a creature spell of the chosen type". `description`: the ability's text,
// since the data writes the chosen type's restriction the same way for wider ones ("or activate an ability of a
// creature source of the chosen type"), which aren't read yet.
spend_restriction_supported :: proc(r: types.ManaSpendRestriction, description := "") -> bool {
	#partial switch x in r {
	case types.ManaSpendRestriction_SpellType:
		return spell_type_phrase_supported(x._0)
	case types.ManaSpendRestriction_SpellTypeOrAbilityActivation:
		return spell_type_phrase_supported(x.spell_type)
	case types.ManaSpendRestriction_ChosenCreatureType:
		return strings.has_suffix(description, "Spend this mana only to cast a creature spell of the chosen type.")
	case types.ManaSpendRestriction_Any:
		// "Only to cast a Dragon spell or an Omen spell": kinds of spell, any of them.
		for y in x._0 {
			kind, is_kind := y.(types.ManaSpendRestriction_SpellType)
			if !is_kind || !spell_type_phrase_supported(kind._0) do return false
		}
		return len(x._0) > 0
	}
	return false
}

// The card's wording of a restriction as the mana in the pool carries it (only the supported kinds). `o`: the
// permanent whose ability made it, for "the chosen type" (CR 614.12: chosen as it entered).
@(private = "file")
pool_restriction :: proc(r: types.ManaSpendRestriction, o: ^types.GameObject) -> types.ManaRestriction {
	#partial switch x in r {
	case types.ManaSpendRestriction_SpellType:
		return types.ManaRestriction_OnlyForSpellType{x._0}
	case types.ManaSpendRestriction_SpellTypeOrAbilityActivation:
		return types.ManaRestriction_OnlyForTypeSpellsOrAbilities{spell_type = x.spell_type, ability = x.ability}
	case types.ManaSpendRestriction_ChosenCreatureType:
		if o != nil do for c in o.chosen_attributes do if t, is_type := c.(types.ChosenAttribute_CreatureType); is_type do return types.ManaRestriction_OnlyForCreatureType{t._0}
	case types.ManaSpendRestriction_Any:
		// The kinds as one phrase of alternatives ("Dragon or Omen"); add_pool_mana keeps a copy with the mana.
		kinds := make([dynamic]string, context.temp_allocator)
		for y in x._0 do append(&kinds, y.(types.ManaSpendRestriction_SpellType)._0)
		return types.ManaRestriction_OnlyForSpellType{strings.join(kinds[:], " or ", context.temp_allocator)}
	}
	return types.ManaRestriction_Impossible{}
}

// Whether every restriction lets the mana pay for this (CR 106.6: it can be spent only as it says).
restrictions_allow :: proc(s: ^types.GameState, rs: []types.ManaRestriction, paying: Payment) -> bool {
	for r in rs {
		if paying.object == nil do return false
		#partial switch x in r {
		case types.ManaRestriction_OnlyForSpellType:
			if !paying.is_spell || !spell_type_phrase_matches(paying.object, x._0) do return false
		case types.ManaRestriction_OnlyForTypeSpellsOrAbilities:
			// "Spend this mana only to cast artifact spells or activate abilities of artifacts."
			if paying.is_spell {
				if !spell_type_phrase_matches(paying.object, x.spell_type) do return false
			} else if x.ability == .OfSpellType && !spell_type_phrase_matches(paying.object, x.spell_type) {
				return false
			}
		case types.ManaRestriction_OnlyForCreatureType:
			// "A creature spell of the chosen type".
			if !paying.is_spell || !is_type(paying.object, .Creature) || !has_subtype(paying.object, x._0) do return false
		case:
			return false
		}
	}
	return true
}

// A phrase like "Creature", "Instant or Sorcery", "Noncreature", "Dragon Creature", "Legendary", "Multicolored",
// "Kicked": alternatives joined by "or"/"and" (either kind of spell), each all of its words.
@(private = "file")
spell_type_phrase_supported :: proc(phrase: string) -> bool {
	for alt in phrase_alternatives(phrase) {
		for word in strings.fields(alt, context.temp_allocator) {
			w, _ := phrase_word(word)
			switch w {
			case "Historic", "Outlaw", "Party", "Colorless", "Monocolored", "Permanent":
				return false // kinds that aren't a type or supertype: not read yet
			}
			if len(w) == 0 || !(w[0] >= 'A' && w[0] <= 'Z') do return false
		}
	}
	return true
}

@(private = "file")
spell_type_phrase_matches :: proc(o: ^types.GameObject, phrase: string) -> bool {
	for alt in phrase_alternatives(phrase) {
		all := true
		for word in strings.fields(alt, context.temp_allocator) {
			w, negated := phrase_word(word)
			if word_matches(o, w) == negated do all = false
		}
		if all do return true
	}
	return false
}

@(private = "file")
word_matches :: proc(o: ^types.GameObject, w: string) -> bool {
	switch w {
	case "Multicolored":
		return len(o.color) >= 2
	case "Kicked":
		return kicked(o) // CR 702.33d
	}
	for c in o.card_types.core_types do if fmt.tprintf("%v", c) == w do return true
	for st in o.card_types.supertypes do if fmt.tprintf("%v", st) == w do return true
	return has_subtype(o, w)
}

// A word of the phrase, and whether it's negated: "NonDragon" or "Noncreature" (as the data writes it) is "not a
// Creature".
@(private = "file")
phrase_word :: proc(word: string) -> (w: string, negated: bool) {
	if !strings.has_prefix(word, "Non") || len(word) <= 3 do return word, false
	rest := word[3:]
	if rest[0] >= 'A' && rest[0] <= 'Z' do return rest, true
	if rest[0] >= 'a' && rest[0] <= 'z' do return strings.concatenate({strings.to_upper(rest[:1], context.temp_allocator), rest[1:]}, context.temp_allocator), true
	return word, false
}

// "Instant or Sorcery", "Instant and Sorcery" (either kind of spell): the alternatives.
@(private = "file")
phrase_alternatives :: proc(phrase: string) -> []string {
	either, _ := strings.replace_all(phrase, " and ", " or ", context.temp_allocator)
	return strings.split(either, " or ", context.temp_allocator)
}

// Mana a spell or a triggered ability adds as it resolves: "Add {B}{B}{B}{B}", "When this creature enters, add
// {R}{G}" (CR 605.5a-b: not mana abilities; they use the stack, and the mana goes into the controller's pool, CR
// 106.4). Mana with riders (restrictions, granted abilities, mana that lasts) not yet.
resolving_mana_supported :: proc(x: types.Effect_Mana) -> bool {
	if len(x.restrictions) > 0 || len(x.grants) > 0 || x.expiry != nil || x.target != nil do return false
	#partial switch p in x.produced {
	case types.ManaProduction_Fixed:
		return p.contribution == .Base && len(p.colors) > 0
	case types.ManaProduction_Colorless:
		return quantity_supported(p.count) && !quantity_reads_target(p.count)
	case types.ManaProduction_AnyOneColor:
		return quantity_supported(p.count) && !quantity_reads_target(p.count)
	}
	return false
}

// "Add N mana of any one color" while a spell or ability resolves: how much, for whom, from what, while its
// controller chooses the color.
Mana_Color_Choice :: struct {
	amount:     int,
	controller: types.PlayerId,
	source:     types.ObjectId,
}

// Adds the mana an instruction makes. True while its controller chooses a color (CR 608.2d: the choice is made as
// the instruction is carried out).
add_resolving_mana :: proc(g: ^Game, x: types.Effect_Mana, controller: types.PlayerId, source: types.ObjectId) -> (asked: bool) {
	s := &g.state
	#partial switch p in x.produced {
	case types.ManaProduction_Fixed:
		for c in p.colors do add_pool_mana(s, controller, types.ManaType(c), source, 1)
	case types.ManaProduction_Colorless:
		n := quantity_value(s, p.count, controller, source, 0)
		if n > 0 do add_pool_mana(s, controller, .Colorless, source, n)
	case types.ManaProduction_AnyOneColor:
		n := quantity_value(s, p.count, controller, source, 0)
		if n <= 0 do return false
		options := make([dynamic]types.ManaType)
		for c in p.color_options do append(&options, types.ManaType(c))
		if len(options) == 0 do append(&options, types.ManaType.White, .Blue, .Black, .Red, .Green)
		if len(options) == 1 {
			add_pool_mana(s, controller, options[0], source, n)
			return false
		}
		g.mana_color_choice = {amount = n, controller = controller, source = source}
		s.priority_player = controller
		s.waiting_for = types.WaitingFor_ChooseManaColor{player = controller, choice = types.ManaChoicePrompt_SingleColor{options = options}, context_ = types.ManaChoiceContext_ResolvingEffect{g.resolution.current}}
		return true
	}
	return false
}

// The color chosen; the resolution carries on.
answer_mana_color :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ChooseManaColor, choice: types.ManaChoice) -> bool {
	c, single := choice.(types.ManaChoice_SingleColor)
	prompt, is_single := w.choice.(types.ManaChoicePrompt_SingleColor)
	if !single || !is_single || p != w.player || !slice.contains(prompt.options[:], c._0) do return false
	m := g.mana_color_choice
	add_pool_mana(&g.state, m.controller, c._0, m.source, m.amount)
	g.mana_color_choice = {}
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}
