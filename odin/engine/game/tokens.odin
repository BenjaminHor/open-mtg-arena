// Token-creating effects beyond a token for its creator (CR 111): "target opponent creates ...", "that player creates
// ..."; copies with exceptions (CR 707.9); and Role tokens, created attached to a creature (CR 111.10j-r, 303.7).
package game

import "core:slice"
import "core:strings"
import types "../types"

// The player an effect names to create a token, when it isn't the effect's controller: a target player or opponent
// ("target opponent creates a 3/3 green Dinosaur", CR 115.1), or the player its trigger event is about ("that player
// creates", CR 608.2c). That player is the token's owner and controller (CR 111.2).
other_token_maker :: proc(owner: types.TargetFilter) -> bool {
	#partial switch x in owner {
	case types.TargetFilter_Player, types.TargetFilter_Opponent, types.TargetFilter_TriggeringPlayer:
		return true
	case types.TargetFilter_Typed:
		return is_an_opponent(owner) // "target opponent", written as a player filter
	}
	return false
}

// A token another player creates is read only with numbers that don't depend on who "you" are: its count and its
// power and toughness are fixed, and it isn't attached to anything or put onto the battlefield attacking. "That
// player" only in a trigger whose event names a player.
other_maker_token_supported :: proc(e: types.Effect_Token) -> bool {
	_, fixed_count := fixed_quantity(e.count)
	_, fixed_power := e.power.(types.PtValue_Fixed)
	_, fixed_toughness := e.toughness.(types.PtValue_Fixed)
	if _, that_player := e.owner.(types.TargetFilter_TriggeringPlayer); that_player && !filter_supported(e.owner) do return false
	return fixed_count && fixed_power && fixed_toughness && e.attach_to == nil && !e.enters_attacking
}

// ---- Copies with exceptions (CR 707.9) ----------------------------------------------------------------------

// "Create a token that's a copy of ..., except it isn't legendary / it's a 1/1 green Frog / it has haste and 'At
// the beginning of the end step, sacrifice this token'": the exceptions this engine makes part of the token's
// copiable values (CR 707.9a-b, apply_copy_exception), and "it enters with an additional +1/+1 counter", an
// additional effect as it enters (CR 707.9e, 122.6).
copy_token_exception_supported :: proc(m: types.ContinuousModification) -> bool {
	#partial switch x in m {
	case types.ContinuousModification_AddSubtype, types.ContinuousModification_AddType,
	     types.ContinuousModification_SetPower, types.ContinuousModification_SetToughness,
	     types.ContinuousModification_SetColor, types.ContinuousModification_AddColor,
	     types.ContinuousModification_RemoveSupertype:
		return true
	case types.ContinuousModification_RemoveAllSubtypes:
		return x.set == .Creature // "it's a Frog": its creature types replaced
	case types.ContinuousModification_GrantTrigger:
		return x.trigger != nil && trigger_supported(x.trigger^)
	case types.ContinuousModification_AddKeyword:
		return keyword_supported(x.keyword)
	case types.ContinuousModification_AddCounterOnEnter:
		_, fixed := fixed_quantity(x.count)
		return fixed && x.if_type == nil && counter_kind_supported(x.counter_type)
	}
	return false
}

// Whether what a token copies could be an Aura: a copy of an Aura enters without being cast, and its controller
// would choose what it enchants as it enters (CR 303.4f), which isn't done yet; such copies are refused. A creature,
// land, artifact or "non-Aura" permanent isn't an Aura (CR 303.4d: an Aura that's also a creature can't enchant
// anything); "target token you control" may be one (a Role). Nor is a Dragon or a Zombie: the only Auras with
// creature types are kindred ones (CR 308.2), KINDRED_AURA_TYPES. "It" is what the instruction before targeted.
copy_may_be_aura :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		for t in x._0.type_filters {
			#partial switch y in t {
			case types.TypeFilter_Creature, types.TypeFilter_Land, types.TypeFilter_Artifact, types.TypeFilter_Planeswalker, types.TypeFilter_Battle:
				return false
			case types.TypeFilter_Subtype:
				kindred := KINDRED_AURA_TYPES
				if subtype_in_set(y._0, .Creature) && !slice.contains(kindred[:], y._0) do return false
				if subtype_in_set(y._0, .Land) do return false
			case types.TypeFilter_Non:
				#partial switch z in y._0^ {
				case types.TypeFilter_Enchantment:
					return false
				case types.TypeFilter_Subtype:
					if z._0 == "Aura" do return false
				}
			}
		}
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if copy_may_be_aura(y) do return true
		return false
	case types.TargetFilter_ParentTarget:
		return previous_instruction == nil || copy_may_be_aura(effect_target_filter(previous_instruction^))
	case types.TargetFilter_SelfRef:
		return false // this permanent
	case types.TargetFilter_TriggeringSource:
		// What the trigger event was about: "whenever another nontoken creature you control dies" names a creature.
		if triggering_filter == nil || is_self(triggering_filter) do return triggering_filter == nil
		return copy_may_be_aura(triggering_filter)
	}
	return true
}

// The creature types of the kindred Auras in the card data (Bound in Silence, Eldrazi Conscription, Lignify,
// Tarmogoyf Nest: a scan of card-data.json on 2026-11-25 for Auras with creature types or changeling).
KINDRED_AURA_TYPES :: [?]string{"Rebel", "Eldrazi", "Treefolk", "Lhurgoyf"}

// While a trigger's support is checked, what its event is about (its valid card or source): what "it" and "that
// creature" can be.
@(thread_local)
triggering_filter: types.TargetFilter

// The exceptions of a CopyTokenOf, as modifications of the copy's values: the keywords it "has" (CR 707.9a) and the
// rest, without the counters it enters with (not a copiable value, CR 707.9e).
copy_token_exceptions :: proc(x: types.Effect_CopyTokenOf) -> [dynamic]types.ContinuousModification {
	out := make([dynamic]types.ContinuousModification, context.temp_allocator)
	for m in x.additional_modifications {
		if _, counters := m.(types.ContinuousModification_AddCounterOnEnter); counters do continue
		append(&out, m)
	}
	for k in x.extra_keywords do append(&out, types.ContinuousModification(types.ContinuousModification_AddKeyword{keyword = k}))
	return out
}

// "Except it enters with an additional +1/+1 counter on it" (Littjara Mirrorlake): put on it as it enters
// (CR 122.6), before anything looks at it.
copy_token_entry_counters :: proc(o: ^types.GameObject, x: types.Effect_CopyTokenOf) {
	for m in x.additional_modifications {
		c, counters := m.(types.ContinuousModification_AddCounterOnEnter)
		if !counters do continue
		n, _ := fixed_quantity(c.count)
		add_counters(o, c.counter_type, u32(max(n, 0)))
	}
}

// ---- Role tokens (CR 111.10j-r, 303.7) ----------------------------------------------------------------------

// The Roles this engine makes. Virtuous (CR 111.10p, "+1/+1 for each enchantment you control") isn't yet.
Role :: enum {
	None,
	Cursed,
	Monster,
	Royal,
	Sorcerer,
	Wicked,
	Young_Hero,
}

ROLE_NAMES := [Role]string {
	.None       = "",
	.Cursed     = "Cursed",
	.Monster    = "Monster",
	.Royal      = "Royal",
	.Sorcerer   = "Sorcerer",
	.Wicked     = "Wicked",
	.Young_Hero = "Young Hero",
}

// The Role a token effect creates, by the name the card data gives it ("Royal Role").
role_of :: proc(e: types.Effect_Token) -> Role {
	if predefined_kind(e.types[:]) != "Role" || !strings.has_suffix(e.name, " Role") do return .None
	kind := strings.trim_suffix(e.name, " Role")
	for name, r in ROLE_NAMES do if r != .None && kind == name do return r
	return .None
}

// "Create a Monster Role token attached to target creature / to it": a Role, created attached to a creature its
// effect names (CR 303.4i), by the effect's controller. The creature is a target ("target creature you control")
// or the one an earlier instruction targeted ("Target creature gets +2/+0 until end of turn. Create a Monster Role
// token attached to it", CR 608.2c). The Role's own abilities must be ones this engine carries out.
role_token_supported :: proc(e: types.Effect_Token) -> bool {
	context.allocator = context.temp_allocator // the Role's abilities, built only to be checked
	r := role_of(e)
	if r == .None do return false
	if _, you := e.owner.(types.TargetFilter_Controller); !you || e.enters_attacking || e.tapped do return false
	if n, fixed := fixed_quantity(e.count); !fixed || n != 1 do return false
	if len(e.static_abilities) > 0 || len(e.keywords) > 0 || len(e.enter_with_counters) > 0 do return false
	host, has := e.attach_to.?
	if !has do return false
	#partial switch x in host {
	case types.TargetFilter_ParentTarget: // ability_supported requires an earlier target
	case types.TargetFilter_Typed:
		if !typed_supported(x._0) || may_name_player(host) do return false
	case:
		return false
	}
	for st in role_statics(r) do if !static_supported(st) do return false
	for t in role_triggers(r) do if !trigger_supported(t.definition) do return false
	return true
}

// CR 111.10j-r: the Role's characteristics: colorless, named for its kind, an Aura Role enchantment with enchant
// creature and its abilities. (The token effect already gave it its types.)
role_characteristics :: proc(o: ^types.GameObject, r: Role) {
	o.name = ROLE_NAMES[r]
	clear(&o.color)
	append(&o.keywords, types.Keyword(types.Keyword_Enchant{creature_filter()}))
	append((^[dynamic]types.StaticDefinition)(o.static_definitions), ..role_statics(r)[:])
	append((^[dynamic]types.TriggerEntry)(o.trigger_definitions), ..role_triggers(r)[:])
}

// Whether a Role (an Aura token) can be created attached to the host: a creature on the battlefield it can legally
// enchant (CR 303.4i: otherwise the token isn't created), protection included (CR 702.16c).
role_host_legal :: proc(s: ^types.GameState, role, host: ^types.GameObject) -> bool {
	if host == nil || host.zone != .Battlefield do return false
	f, _ := enchant_filter(role)
	return aura_can_enchant(s, role, f, host) && !protected_from(host, role)
}

// CR 303.7a, 704.5z: of the Roles a player controls attached to one permanent, all but the one with the most recent
// timestamp go to their owner's graveyard. True when something changed.
role_state_actions :: proc(g: ^Game) -> bool {
	s := &g.state
	extra := make([dynamic]types.ObjectId, context.temp_allocator)
	for id in ids_of(s.battlefield) {
		role := object(s, id)
		if !has_subtype(role, "Role") do continue
		host := host_of(s, role)
		if host == nil do continue
		for other_id in host.attachments {
			other := object(s, other_id)
			if other == nil || other.id == role.id || other.zone != .Battlefield || !has_subtype(other, "Role") do continue
			if other.controller == role.controller && other.timestamp > role.timestamp {
				append(&extra, role.id)
				break
			}
		}
	}
	for id in extra do move_object(g, id, .Graveyard)
	return len(extra) > 0
}

@(private = "file")
creature_filter :: proc(properties: ..types.FilterProp) -> types.TargetFilter {
	f: types.TypedFilter
	append(&f.type_filters, types.TypeFilter(types.TypeFilter_Creature{}))
	append(&f.properties, ..properties)
	return types.TargetFilter_Typed{f}
}

// "Enchanted creature gets/has ...".
@(private = "file")
enchanted_creature_static :: proc(modifications: ..types.ContinuousModification) -> types.StaticDefinition {
	st: types.StaticDefinition
	st.mode = types.StaticMode_Continuous{}
	st.affected = creature_filter(types.FilterProp_EnchantedBy{})
	append(&st.modifications, ..modifications)
	return st
}

@(private = "file")
plus_one :: proc() -> [2]types.ContinuousModification {
	return {types.ContinuousModification_AddPower{value = 1}, types.ContinuousModification_AddToughness{value = 1}}
}

// "Whenever this creature attacks, ...", the trigger a Role gives the enchanted creature.
@(private = "file")
attack_trigger :: proc(effect: types.Effect) -> ^types.TriggerDefinition {
	t := new(types.TriggerDefinition)
	t.mode = types.TriggerMode_Attacks{}
	t.valid_card = types.TargetFilter_SelfRef{}
	append(&t.trigger_zones, types.Zone.Battlefield)
	t.execute = new(types.AbilityDefinition)
	t.execute.kind = .Spell
	t.execute.effect = new(types.Effect)
	t.execute.effect^ = effect
	return t
}

// CR 111.10j, k, m, n, q, r: what the Role gives the creature it enchants.
role_statics :: proc(r: Role) -> [dynamic]types.StaticDefinition {
	out := make([dynamic]types.StaticDefinition, context.temp_allocator)
	p := plus_one()
	switch r {
	case .None:
	case .Cursed:
		// "Enchanted creature has base power and toughness 1/1" (layer 7b).
		append(&out, enchanted_creature_static(types.ContinuousModification_SetPower{value = 1}, types.ContinuousModification_SetToughness{value = 1}))
	case .Monster:
		// "Enchanted creature gets +1/+1 and has trample."
		append(&out, enchanted_creature_static(p[0], p[1], types.ContinuousModification_AddKeyword{keyword = types.Keyword_Trample{}}))
	case .Royal:
		// "Enchanted creature gets +1/+1 and has ward {1}."
		ward := types.Keyword_Ward{types.WardCost_Mana{types.ManaCost_Cost{generic = 1}}}
		append(&out, enchanted_creature_static(p[0], p[1], types.ContinuousModification_AddKeyword{keyword = ward}))
	case .Sorcerer:
		// "Enchanted creature gets +1/+1 and has 'Whenever this creature attacks, scry 1.'"
		scry := attack_trigger(types.Effect_Scry{count = types.QuantityExpr_Fixed{value = 1}, target = types.TargetFilter_Controller{}})
		append(&out, enchanted_creature_static(p[0], p[1], types.ContinuousModification_GrantTrigger{trigger = scry}))
	case .Wicked:
		// "Enchanted creature gets +1/+1."
		append(&out, enchanted_creature_static(p[0], p[1]))
	case .Young_Hero:
		// "Enchanted creature has 'Whenever this creature attacks, if its toughness is 3 or less, put a +1/+1 counter
		// on it.'" (an intervening "if", CR 603.4).
		counter := attack_trigger(types.Effect_PutCounter{counter_type = types.CounterType_Plus1Plus1{}, count = types.QuantityExpr_Fixed{value = 1}, target = types.TargetFilter_SelfRef{}})
		toughness := types.QuantityExpr_Ref{qty = types.QuantityRef_Toughness{scope = types.ObjectScope_Source{}}}
		counter.condition = types.TriggerCondition_QuantityComparison{lhs = toughness, comparator = .LE, rhs = types.QuantityExpr_Fixed{value = 3}}
		append(&out, enchanted_creature_static(types.ContinuousModification_GrantTrigger{trigger = counter}))
	}
	return out
}

// CR 111.10q: the Wicked Role's own "When this token is put into a graveyard from the battlefield, each opponent
// loses 1 life."
role_triggers :: proc(r: Role) -> [dynamic]types.TriggerEntry {
	out := make([dynamic]types.TriggerEntry, context.temp_allocator)
	if r != .Wicked do return out
	t: types.TriggerDefinition
	t.mode = types.TriggerMode_ChangesZone{}
	t.valid_card = types.TargetFilter_SelfRef{}
	t.origin = types.Zone.Battlefield
	t.destination = types.Zone.Graveyard
	append(&t.trigger_zones, types.Zone.Graveyard)
	t.execute = new(types.AbilityDefinition)
	t.execute.kind = .Spell
	t.execute.effect = new(types.Effect)
	t.execute.effect^ = types.Effect_LoseLife{amount = types.QuantityExpr_Fixed{value = 1}}
	t.execute.player_scope = types.PlayerFilter_Opponent{}
	append(&out, types.TriggerEntry{definition = t})
	return out
}
