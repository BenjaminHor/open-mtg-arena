// Predefined tokens (CR 111.10): a Treasure, Food, Clue, Shard or Heartwood token has the abilities the CR gives
// it; the card data names the token but doesn't list them. Other predefined tokens (Gold, Blood, Powerstone, Map,
// Junk, Lander, Mutagen, Vibranium, Incubator, Roles) aren't made yet, so effects creating them are unsupported.
package game

import types "../types"

PREDEFINED_TOKENS :: [?]string{"Treasure", "Food", "Gold", "Shard", "Clue", "Blood", "Powerstone", "Incubator", "Role", "Map", "Junk", "Lander", "Mutagen", "Vibranium", "Heartwood"}
MADE_TOKENS :: [?]string{"Treasure", "Food", "Clue", "Shard", "Heartwood", "Powerstone", "Blood", "Lander", "Mutagen"}

// The predefined kind a token is, if any (by its subtypes).
predefined_kind :: proc(subtypes: []string) -> string {
	for t in subtypes do for k in PREDEFINED_TOKENS do if t == k do return k
	return ""
}

predefined_token_supported :: proc(e: types.Effect_Token) -> bool {
	kind := predefined_kind(e.types[:])
	if kind == "" do return true
	for k in MADE_TOKENS do if k == kind do return true
	return false
}

// CR 111.10a, b, e, f, g, h, u, v, x.
predefined_abilities :: proc(kind: string) -> [dynamic]types.AbilityDefinition {
	out: [dynamic]types.AbilityDefinition
	switch kind {
	case "Treasure":
		// "{T}, Sacrifice this token: Add one mana of any color."
		append(&out, ability(composite(tap(), sac_self()), types.Effect_Mana{produced = types.ManaProduction_AnyOneColor{count = fixed(1)}}))
	case "Food":
		// "{2}, {T}, Sacrifice this token: You gain 3 life."
		append(&out, ability(composite(mana(2), tap(), sac_self()), types.Effect_GainLife{amount = fixed(3), player = types.TargetFilter_Controller{}}))
	case "Clue":
		// "{2}, Sacrifice this token: Draw a card."
		append(&out, ability(composite(mana(2), sac_self()), types.Effect_Draw{count = fixed(1), target = types.TargetFilter_Controller{}}))
	case "Shard":
		// "{2}, Sacrifice this token: Scry 1, then draw a card."
		draw := new(types.AbilityDefinition)
		draw^ = ability(nil, types.Effect_Draw{count = fixed(1), target = types.TargetFilter_Controller{}})
		draw.kind = .Spell
		draw.sub_link = .SequentialSibling
		a := ability(composite(mana(2), sac_self()), types.Effect_Scry{count = fixed(1), target = types.TargetFilter_Controller{}})
		a.sub_ability = draw
		append(&out, a)
	case "Heartwood":
		// "{T}: Add {R} or {G}."
		p := types.ManaProduction_AnyOneColor{count = fixed(1)}
		append(&p.color_options, types.ManaColor.Red, types.ManaColor.Green)
		append(&out, ability(tap(), types.Effect_Mana{produced = p}))
	case "Powerstone":
		// CR 111.10h: "{T}: Add {C}. This mana can't be spent to cast a nonartifact spell": it pays for artifact
		// spells and for abilities, nothing else.
		m := types.Effect_Mana{produced = types.ManaProduction_Colorless{count = fixed(1)}}
		append(&m.restrictions, types.ManaSpendRestriction(types.ManaSpendRestriction_SpellTypeOrAbilityActivation{spell_type = "Artifact", ability = .Any}))
		append(&out, ability(tap(), m))
	case "Blood":
		// CR 111.10g: "{1}, {T}, Discard a card, Sacrifice this token: Draw a card."
		discard := types.AbilityCost_Discard{count = fixed(1), selection = .Chosen, self_scope = .FromHand}
		append(&out, ability(composite(mana(1), tap(), discard, sac_self()), types.Effect_Draw{count = fixed(1), target = types.TargetFilter_Controller{}}))
	case "Lander":
		// CR 111.10u: "{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the
		// battlefield tapped, then shuffle."
		basic_land: types.TypedFilter
		append(&basic_land.type_filters, types.TypeFilter(types.TypeFilter_Land{}))
		append(&basic_land.properties, types.FilterProp(types.FilterProp_HasSupertype{value = .Basic}))
		shuffle := spell_step(types.Effect_Shuffle{target = types.TargetFilter_Controller{}})
		put := spell_step(types.Effect_ChangeZone{origin = types.Zone.Library, destination = .Battlefield, target = types.TargetFilter_Any{}, enter_tapped = .Tapped})
		put.sub_ability = shuffle
		a := ability(composite(mana(2), tap(), sac_self()), types.Effect_SearchLibrary{filter = types.TargetFilter_Typed{basic_land}, count = fixed(1)})
		a.sub_ability = put
		append(&out, a)
	case "Mutagen":
		// CR 111.10v: "{1}, {T}, Sacrifice this token: Put a +1/+1 counter on target creature. Activate only as a
		// sorcery."
		creature: types.TypedFilter
		append(&creature.type_filters, types.TypeFilter(types.TypeFilter_Creature{}))
		a := ability(composite(mana(1), tap(), sac_self()), types.Effect_PutCounter{counter_type = types.CounterType_Plus1Plus1{}, count = fixed(1), target = types.TargetFilter_Typed{creature}})
		append(&a.activation_restrictions, types.ActivationRestriction(types.ActivationRestriction_AsSorcery{}))
		append(&out, a)
	}
	return out
}

@(private = "file")
ability :: proc(cost: Maybe(types.AbilityCost), effect: types.Effect) -> types.AbilityDefinition {
	a: types.AbilityDefinition
	a.kind = .Activated
	a.effect = new(types.Effect)
	a.effect^ = effect
	a.cost = cost
	return a
}

// The next instruction of an ability ("put it onto the battlefield", "then shuffle"), in sequence (CR 608.2c).
@(private = "file")
spell_step :: proc(effect: types.Effect) -> ^types.AbilityDefinition {
	a := new(types.AbilityDefinition)
	a^ = ability(nil, effect)
	a.kind = .Spell
	a.sub_link = .SequentialSibling
	return a
}

@(private = "file")
fixed :: proc(n: i32) -> types.QuantityExpr {return types.QuantityExpr_Fixed{value = n}}

@(private = "file")
tap :: proc() -> types.AbilityCost {return types.AbilityCost_Tap{}}

@(private = "file")
sac_self :: proc() -> types.AbilityCost {
	return types.AbilityCost_Sacrifice{types.SacrificeCost{target = types.TargetFilter_SelfRef{}, requirement = types.SacrificeRequirement_Count{count = 1}}}
}

@(private = "file")
mana :: proc(generic: u32) -> types.AbilityCost {return types.AbilityCost_Mana{cost = types.ManaCost_Cost{generic = generic}}}

@(private = "file")
composite :: proc(parts: ..types.AbilityCost) -> types.AbilityCost {
	c: types.AbilityCost_Composite
	append(&c.costs, ..parts)
	return c
}
