// Continuous effects and the layer system (CR 611, 613). Each permanent's power, toughness and keywords are worked
// out again from its printed values every time the game looks at them: the static abilities of permanents on the
// battlefield (CR 611.3) and the effects of resolved spells and abilities (CR 611.2) apply in layer order, and
// within a layer in timestamp order (CR 613.7). Nothing is edited in place, so an effect that ends simply stops
// applying.
package game

import "core:reflect"
import "core:slice"
import types "../types"

// ---- What's supported --------------------------------------------------------------------------------------

// "[Permanents of a kind] get +N/+N, have [keyword], are N/N": static abilities that always apply, to this object
// or to permanents of a kind, with fixed numbers.
static_supported :: proc(st: types.StaticDefinition) -> bool {
	if _, continuous := st.mode.(types.StaticMode_Continuous); !continuous do return false
	if st.condition != nil || st.per_player_condition != nil || st.characteristic_defining do return false
	if st.affected_zone != nil || st.effect_zone != nil || len(st.active_zones) > 0 do return false
	affected, has := st.affected.?
	if !has || !affected_supported(affected) do return false
	if len(st.modifications) == 0 do return false
	for m in st.modifications do if !modification_supported(m) do return false
	return true
}

// The changes a continuous effect can make here: types and subtypes added (layer 4), keywords added (layer 6),
// power and toughness set or changed (layer 7b, 7c).
modification_supported :: proc(m: types.ContinuousModification) -> bool {
	#partial switch k in m {
	case types.ContinuousModification_AddPower, types.ContinuousModification_AddToughness,
	     types.ContinuousModification_SetPower, types.ContinuousModification_SetToughness,
	     types.ContinuousModification_AddType, types.ContinuousModification_AddSubtype:
		return true
	case types.ContinuousModification_AddKeyword:
		return keyword_supported(k.keyword)
	}
	return false
}

// This object, or permanents of a kind and controller (optionally "other").
affected_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_SelfRef:
		return true
	case types.TargetFilter_Typed:
		return typed_supported(x._0)
	}
	return false
}

// ---- Applying (CR 613) --------------------------------------------------------------------------------------

@(private = "file")
Static_Effect :: struct {
	source:    ^types.GameObject,
	static:    ^types.StaticDefinition,
	timestamp: u64,
}

// Works out every permanent's power, toughness and keywords.
apply_continuous_effects :: proc(g: ^Game) {
	s := &g.state
	battlefield := ids_of(s.battlefield)
	// The static abilities in effect, in timestamp order (CR 613.7a: a static ability's effect has its object's).
	statics := make([dynamic]Static_Effect, context.temp_allocator)
	for id in battlefield {
		o := object(s, id)
		if o.static_definitions == nil do continue
		for &st in o.static_definitions^ do if static_supported(st) do append(&statics, Static_Effect{o, &st, o.timestamp})
	}
	slice.sort_by(statics[:], proc(a, b: Static_Effect) -> bool {return a.timestamp < b.timestamp})

	for id in battlefield {
		o := object(s, id)
		power, toughness := o.base_power, o.base_toughness
		// Layer 4 (CR 613.1d): types and subtypes added.
		// Built in scratch memory, and copied for keeps only when an effect changed it (this runs after every action).
		card_types := o.base_card_types
		card_types.core_types = slice.clone_to_dynamic(o.base_card_types.core_types[:], context.temp_allocator)
		card_types.subtypes = slice.clone_to_dynamic(o.base_card_types.subtypes[:], context.temp_allocator)
		add_types :: proc(ct: ^types.CardType, mods: []types.ContinuousModification) {
			for m in mods {
				#partial switch k in m {
				case types.ContinuousModification_AddType:
					if !slice.contains(ct.core_types[:], k.core_type) do append(&ct.core_types, k.core_type)
				case types.ContinuousModification_AddSubtype:
					if !slice.contains(ct.subtypes[:], k.subtype) do append(&ct.subtypes, k.subtype)
				}
			}
		}
		keywords := make([dynamic]types.Keyword, context.temp_allocator)
		append(&keywords, ..o.base_keywords[:])
		// The effects of resolved spells and abilities still applying to this object, in the order they were created.
		temps := make([dynamic][]types.ContinuousModification, context.temp_allocator)
		for t in g.temp_effects do if t.object == o.id && t.incarnation == o.incarnation do append(&temps, t.modifications)
		for e in statics do if affects(s, e.source, e.static, o) do add_types(&card_types, e.static.modifications[:])
		for mods in temps do add_types(&card_types, mods)
		o.card_types = o.base_card_types
		if len(card_types.core_types) != len(o.base_card_types.core_types) || len(card_types.subtypes) != len(o.base_card_types.subtypes) {
			o.card_types.core_types = slice.clone_to_dynamic(card_types.core_types[:])
			o.card_types.subtypes = slice.clone_to_dynamic(card_types.subtypes[:])
		}
		// Layer 6 (CR 613.1f): abilities added.
		for e in statics do if affects(s, e.source, e.static, o) {
			for m in e.static.modifications do if k, ok := m.(types.ContinuousModification_AddKeyword); ok && !has_keyword_in(keywords[:], k.keyword) do append(&keywords, k.keyword)
		}
		for mods in temps do for m in mods do if k, ok := m.(types.ContinuousModification_AddKeyword); ok && !has_keyword_in(keywords[:], k.keyword) do append(&keywords, k.keyword)
		// Layer 7b (CR 613.4b): power and toughness set to a number.
		for e in statics do if affects(s, e.source, e.static, o) {
			for m in e.static.modifications {
				#partial switch k in m {
				case types.ContinuousModification_SetPower:
					power = k.value
				case types.ContinuousModification_SetToughness:
					toughness = k.value
				}
			}
		}
		for mods in temps do for m in mods {
			#partial switch k in m {
			case types.ContinuousModification_SetPower:
				power = k.value
			case types.ContinuousModification_SetToughness:
				toughness = k.value
			}
		}
		// Layer 7c (CR 613.4c): modifications, from static abilities, resolved effects and counters.
		dp, dt: i32
		for e in statics do if affects(s, e.source, e.static, o) {
			for m in e.static.modifications {
				#partial switch k in m {
				case types.ContinuousModification_AddPower:
					dp += k.value
				case types.ContinuousModification_AddToughness:
					dt += k.value
				}
			}
		}
		for mods in temps do for m in mods {
			#partial switch k in m {
			case types.ContinuousModification_AddPower:
				dp += k.value
			case types.ContinuousModification_AddToughness:
				dt += k.value
			}
		}
		for p in g.pumps do if p.object == o.id && p.incarnation == o.incarnation {
			dp += p.power
			dt += p.toughness
		}
		for c in o.counters {
			#partial switch _ in c._0 {
			case types.CounterType_Plus1Plus1:
				dp += i32(c._1)
				dt += i32(c._1)
			case types.CounterType_Minus1Minus1:
				dp -= i32(c._1)
				dt -= i32(c._1)
			}
		}
		if p, ok := power.?; ok do power = p + dp
		if t, ok := toughness.?; ok do toughness = t + dt
		o.power, o.toughness = power, toughness
		o.keywords = o.base_keywords
		if len(keywords) != len(o.base_keywords) do o.keywords = slice.clone_to_dynamic(keywords[:])
	}
}

@(private = "file")
has_keyword_in :: proc(list: []types.Keyword, k: types.Keyword) -> bool {
	for x in list do if reflect.union_variant_typeid(x) == reflect.union_variant_typeid(k) do return true
	return false
}

// Whether a static ability of `source` applies to `o`.
@(private = "file")
affects :: proc(s: ^types.GameState, source: ^types.GameObject, st: ^types.StaticDefinition, o: ^types.GameObject) -> bool {
	affected, _ := st.affected.?
	#partial switch x in affected {
	case types.TargetFilter_SelfRef:
		return o.id == source.id
	case types.TargetFilter_Typed:
		return object_matches(s, o, x._0, source.controller, source.id)
	}
	return false
}

// ---- Effects from resolved spells and abilities (CR 611.2) --------------------------------------------------

// "Target creature gets +1/+0 and gains first strike until end of turn": a continuous effect a resolved spell or
// ability created, on one object (as it was then, CR 611.2c), until the cleanup step (CR 514.2).
Temp_Effect :: struct {
	object:        types.ObjectId,
	incarnation:   u64,
	modifications: []types.ContinuousModification,
	permanent:     bool, // lasts for the game (CR 611.2a) rather than until end of turn
}

generic_effect_supported :: proc(e: types.Effect_GenericEffect) -> bool {
	d, has := e.duration.?
	if !has || e.end_cost != nil do return false
	#partial switch _ in d {
	case types.Duration_UntilEndOfTurn, types.Duration_Permanent:
	case:
		return false
	}
	if t, targets := e.target.?; targets && !(is_self(t) || filter_supported(t)) do return false
	if len(e.static_abilities) == 0 do return false
	for st in e.static_abilities {
		if _, continuous := st.mode.(types.StaticMode_Continuous); !continuous || st.condition != nil do return false
		affected, ok := st.affected.?
		if !ok do return false
		#partial switch _ in affected {
		case types.TargetFilter_ParentTarget, types.TargetFilter_SelfRef:
		case types.TargetFilter_Typed:
			if !mass_filter_supported(affected) do return false
		case:
			return false
		}
		for m in st.modifications do if !modification_supported(m) do return false
	}
	return true
}

// Starts the effect on its objects: the target or the source for "it"/"this", or every permanent of a kind, fixed
// as it begins (CR 611.2c).
add_temp_effect :: proc(g: ^Game, e: types.Effect_GenericEffect, controller: types.PlayerId, source: types.ObjectId, target: ^types.GameObject) {
	s := &g.state
	d, _ := e.duration.?
	_, permanent := d.(types.Duration_Permanent)
	for st in e.static_abilities {
		mods := make([dynamic]types.ContinuousModification)
		append(&mods, ..st.modifications[:])
		affected, _ := st.affected.?
		objects := make([dynamic]^types.GameObject, context.temp_allocator)
		#partial switch _ in affected {
		case types.TargetFilter_ParentTarget:
			if target != nil do append(&objects, target)
		case types.TargetFilter_SelfRef:
			if o := object(s, source); o != nil && o.zone == .Battlefield do append(&objects, o)
		case types.TargetFilter_Typed:
			append(&objects, ..affected_permanents(s, affected, controller, source)[:])
		}
		for o in objects do if o.zone == .Battlefield {
			append(&g.temp_effects, Temp_Effect{object = o.id, incarnation = o.incarnation, modifications = mods[:], permanent = permanent})
		}
	}
	apply_continuous_effects(g)
}
