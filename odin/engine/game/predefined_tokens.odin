// Predefined tokens (CR 111.10): a Treasure, Food, Clue, Shard or Heartwood token has the abilities the CR gives
// it; the card data names the token but doesn't list them. Other predefined tokens (Gold, Blood, Powerstone, Map,
// Junk, Lander, Mutagen, Vibranium, Incubator, Roles) aren't made yet, so effects creating them are unsupported.
package game

import types "../types"

PREDEFINED_TOKENS :: [?]string{"Treasure", "Food", "Gold", "Shard", "Clue", "Blood", "Powerstone", "Incubator", "Role", "Map", "Junk", "Lander", "Mutagen", "Vibranium", "Heartwood"}
MADE_TOKENS :: [?]string{"Treasure", "Food", "Clue", "Shard", "Heartwood"}

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

// CR 111.10a, b, e, f, x.
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
