// Effects that change what spells cost (CR 601.2f): "this spell costs {2} less to cast if ...", "instant and
// sorcery spells you cast cost {1} less", "spells your opponents cast cost {1} more". Increases and reductions of
// generic mana only; the total can't go below {0}.
package game

import types "../types"

cost_modifier_supported :: proc(st: types.StaticDefinition) -> bool {
	m, ok := st.mode.(types.StaticMode_ModifyCost)
	if !ok || len(st.modifications) > 0 || st.affected_zone != nil || st.effect_zone != nil || st.per_player_condition != nil do return false
	amount, is_cost := m.amount.(types.ManaCost_Cost)
	if !is_cost || len(amount.shards) > 0 || amount.generic == 0 do return false
	if q, has := m.dynamic_count.?; has && !quantity_supported(types.QuantityExpr_Ref{q}) do return false
	if f, has := m.spell_filter.?; has && (!spell_filter_supported(f) || filter_reads_targets(f)) do return false
	if c, has := st.condition.?; has && !condition_supported(c) do return false
	affected, has := st.affected.?
	if !has do return false
	#partial switch x in affected {
	case types.TargetFilter_SelfRef:
		return true // "this spell": from wherever it's cast
	case types.TargetFilter_Typed:
		// "Spells you cast" / "spells your opponents cast", from a permanent on the battlefield.
		if len(st.active_zones) > 0 do return false
		if len(x._0.properties) > 0 do return false
		for t in x._0.type_filters {
			if _, card := t.(types.TypeFilter_Card); !card do return false
		}
		return true
	}
	return false
}

// A reduction that depends on the spell's targets ("costs {2} less if it targets a creature you control") would
// need the targets chosen before the total cost; that order isn't modelled yet.
@(private = "file")
filter_reads_targets :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		for p in x._0.properties do if _, t := p.(types.FilterProp_Targets); t do return true
	case types.TargetFilter_Or:
		for y in x.filters do if filter_reads_targets(y) do return true
	}
	return false
}

// CR 601.2f: the generic mana a spell's cost is raised (positive) or lowered (negative) by, for player `p` casting
// `spell`.
cost_change :: proc(s: ^types.GameState, p: types.PlayerId, spell: ^types.GameObject) -> int {
	change := 0
	apply :: proc(s: ^types.GameState, st: ^types.StaticDefinition, source, spell: ^types.GameObject) -> int {
		m := st.mode.(types.StaticMode_ModifyCost)
		if f, has := m.spell_filter.?; has && !spell_matches(s, spell, f, source) do return 0
		if !condition_holds(s, source, st.condition) do return 0
		n := int(m.amount.(types.ManaCost_Cost).generic)
		if q, has := m.dynamic_count.?; has do n *= quantity_value(s, types.QuantityExpr_Ref{q}, source.controller, source.id, 0)
		return n if m.mode == .Raise else -n
	}
	// The spell's own "this spell costs ...".
	if spell.static_definitions != nil {
		for &st in spell.static_definitions^ {
			aff, _ := st.affected.?
			if _, self := aff.(types.TargetFilter_SelfRef); self && cost_modifier_supported(st) do change += apply(s, &st, spell, spell)
		}
	}
	// Permanents' "spells you cast cost ...".
	for id in ids_of(s.battlefield) {
		src := object(s, id)
		if src.static_definitions == nil do continue
		for &st in src.static_definitions^ {
			aff, _ := st.affected.?
			typed, is_typed := aff.(types.TargetFilter_Typed)
			if !is_typed || !cost_modifier_supported(st) do continue
			if c, has := typed._0.controller.?; has {
				_, you := c.(types.ControllerRef_You)
				if (p == src.controller) != you do continue
			}
			change += apply(s, &st, src, spell)
		}
	}
	return change
}
