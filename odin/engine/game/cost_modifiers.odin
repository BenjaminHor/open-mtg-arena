// Effects that change what spells cost (CR 601.2f): "this spell costs {2} less to cast if ...", "instant and
// sorcery spells you cast cost {1} less", "spells your opponents cast cost {1} more", "this spell costs {U} less to
// cast if ..." (CR 118.7). The total can't go below {0}.
package game

import types "../types"

cost_modifier_supported :: proc(st: types.StaticDefinition) -> bool {
	m, ok := st.mode.(types.StaticMode_ModifyCost)
	if !ok || len(st.modifications) > 0 || st.affected_zone != nil || st.effect_zone != nil || st.per_player_condition != nil do return false
	amount, is_cost := m.amount.(types.ManaCost_Cost)
	if !is_cost || (amount.generic == 0 && len(amount.shards) == 0) do return false
	affected, has := st.affected.?
	if !has do return false
	_, of_itself := affected.(types.TargetFilter_SelfRef)
	// Colored or colorless mana (CR 118.7b-c): "this spell costs {U} less", of a spell's own cost only, by a number
	// that isn't multiplied.
	for shard in amount.shards {
		if !of_itself || m.dynamic_count != nil do return false
		#partial switch shard {
		case .White, .Blue, .Black, .Red, .Green, .Colorless:
		case:
			return false
		}
	}
	if q, has := m.dynamic_count.?; has && !quantity_supported(types.QuantityExpr_Ref{q}) do return false
	if f, has := m.spell_filter.?; has && !cost_spell_filter_supported(f) do return false
	if c, has := st.condition.?; has && !cost_condition_supported(c, of_itself) do return false
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

// CR 601.2f: the total cost is worked out after the targets are chosen (601.2c), so a change "if it targets a tapped
// creature" or "spells that target this creature" reads them. The spell being cast and its chosen targets, while its
// cost is worked out; spell_targets_one reads them. When the cost is asked for a spell without its targets (is it
// castable at all, how large can X be), it's the best case: a reduction counts if some legal target would earn it,
// an increase only if it can't be avoided (a required target whose every legal choice fits). A target choice that
// then leaves the cost unpayable reverses the cast (CR 734).
Cost_Targets :: struct {
	spell:       types.ObjectId,
	caster:      types.PlayerId,
	targets:     []types.TargetRef,
	best_case:   bool,
	unavoidable: bool, // in the best case, for an increase: every legal choice of some required target fits
}

@(thread_local)
cost_targets: Cost_Targets

// Whether the spell has a target among `cost_targets` that fits; in the best case, whether some legal target of
// its would.
cost_target_fits :: proc(s: ^types.GameState, spell: ^types.GameObject, f: types.TargetFilter, chooser: types.PlayerId, source: types.ObjectId) -> bool {
	fits :: target_fits_description
	if !cost_targets.best_case {
		for t in cost_targets.targets do if fits(s, t, f, chooser, source) do return true
		return false
	}
	for slot in spell_slot_list(spell) {
		legal := legal_targets(s, slot.filter, cost_targets.caster, spell.id)
		if cost_targets.unavoidable {
			if slot.optional || len(legal) == 0 do continue
			all := true
			for t in legal do if !fits(s, t, f, chooser, source) do all = false
			if all do return true
		} else {
			for t in legal do if fits(s, t, f, chooser, source) do return true
		}
	}
	return false
}

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

// "Spells you cast from your graveyard": a spell filter that may say where the spell is cast from (the card is still
// there while its cost is worked out, CR 601.2a, 601.2f).
@(private = "file")
cost_spell_filter_supported :: proc(f: types.TargetFilter) -> bool {
	typed, is_typed := f.(types.TargetFilter_Typed)
	if !is_typed do return spell_filter_supported(f)
	plain := typed
	plain._0.properties = make([dynamic]types.FilterProp, context.temp_allocator)
	for p in typed._0.properties {
		if z, in_zone := p.(types.FilterProp_InZone); in_zone {
			#partial switch z.zone {
			case .Graveyard, .Exile, .Hand:
				continue
			}
			return false
		}
		append(&plain._0.properties, p)
	}
	return spell_filter_supported(plain)
}

// The conditions of a cost change: those of any static ability (condition_supported), and for a spell's own
// "this spell costs {2} less to cast if evidence was collected" (CR 601.2b: announced before the cost is worked out)
// or "if an opponent has three or more poison counters"; "during turns other than yours", "if you control a Human
// creature and a non-Human creature".
@(private = "file")
cost_condition_supported :: proc(c: types.StaticCondition, of_itself: bool) -> bool {
	#partial switch x in c {
	case types.StaticCondition_AdditionalCostPaid:
		return of_itself
	case types.StaticCondition_OpponentPoisonAtLeast:
		return true
	case types.StaticCondition_Not:
		return x.condition != nil && cost_condition_supported(x.condition^, of_itself)
	case types.StaticCondition_And:
		for y in x.conditions do if !cost_condition_supported(y, of_itself) do return false
		return len(x.conditions) > 0
	case types.StaticCondition_Or:
		for y in x.conditions do if !cost_condition_supported(y, of_itself) do return false
		return len(x.conditions) > 0
	}
	return condition_supported(c)
}

@(private = "file")
cost_condition_holds :: proc(s: ^types.GameState, source, spell: ^types.GameObject, c: types.StaticCondition) -> bool {
	#partial switch x in c {
	case types.StaticCondition_AdditionalCostPaid:
		// Its optional additional cost, once announced (CR 601.2b). Before the cast begins (is it castable at all?), the
		// best case: paid, if it could be.
		if kicked(spell) do return true
		if _, being_cast := stack_entry_of(s, spell.id); being_cast || !cost_targets.best_case do return false
		return optional_cost_payable(s, cost_targets.caster, spell)
	case types.StaticCondition_OpponentPoisonAtLeast:
		// CR 122.1f: poison counters a player has.
		for pl in s.players do if pl.id != source.controller && pl.poison_counters >= x.count do return true
		return false
	case types.StaticCondition_Not:
		return !cost_condition_holds(s, source, spell, x.condition^)
	case types.StaticCondition_And:
		for y in x.conditions do if !cost_condition_holds(s, source, spell, y) do return false
		return true
	case types.StaticCondition_Or:
		for y in x.conditions do if cost_condition_holds(s, source, spell, y) do return true
		return false
	}
	return condition_holds(s, source, c)
}

// CR 601.2f: how a spell's cost is changed, for player `p` casting `spell`: the generic mana it's raised (positive)
// or lowered (negative) by, and colored or colorless mana it's raised or lowered by (CR 118.7b-c: worked out against
// the cost by spell_cost).
Cost_Change :: struct {
	generic: int,
	more:    [dynamic]types.ManaCostShard,
	less:    [dynamic]types.ManaCostShard,
}

cost_change :: proc(s: ^types.GameState, p: types.PlayerId, spell: ^types.GameObject) -> Cost_Change {
	change := Cost_Change{more = make([dynamic]types.ManaCostShard, context.temp_allocator), less = make([dynamic]types.ManaCostShard, context.temp_allocator)}
	apply :: proc(s: ^types.GameState, st: ^types.StaticDefinition, source, spell: ^types.GameObject, change: ^Cost_Change) {
		m := st.mode.(types.StaticMode_ModifyCost)
		if f, has := m.spell_filter.?; has {
			// The best case before targets are chosen: an increase that depends on them counts only if it can't be
			// avoided.
			unavoidable := cost_targets.best_case && m.mode == .Raise && filter_reads_targets(f)
			cost_targets.unavoidable = unavoidable
			matches := spell_matches(s, spell, f, source)
			cost_targets.unavoidable = false
			if !matches do return
		}
		if c, has := st.condition.?; has && !cost_condition_holds(s, source, spell, c) do return
		amount := m.amount.(types.ManaCost_Cost)
		n := int(amount.generic)
		if q, has := m.dynamic_count.?; has do n *= quantity_value(s, types.QuantityExpr_Ref{q}, source.controller, source.id, 0)
		change.generic += n if m.mode == .Raise else -n
		append(&change.more if m.mode == .Raise else &change.less, ..amount.shards[:])
	}
	// CR 702.41a: affinity for [something], "this spell costs {1} less to cast for each [something] you control",
	// each instance (702.41b).
	for k in spell.keywords {
		a, is_affinity := k.(types.Keyword_Affinity)
		if !is_affinity do continue
		for o in permanents_of(s, p) do if object_matches(s, o, a._0, p, spell.id) do change.generic -= 1
	}
	// The spell's own "this spell costs ...".
	if spell.static_definitions != nil {
		for &st in spell.static_definitions^ {
			aff, _ := st.affected.?
			if _, self := aff.(types.TargetFilter_SelfRef); self && cost_modifier_supported(st) do apply(s, &st, spell, spell, &change)
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
			apply(s, &st, src, spell, &change)
		}
	}
	return change
}

// CR 118.7b-c: a reduction of colored or colorless mana takes away a symbol of that type the cost has, and otherwise
// (the cost doesn't require mana of that type) that much generic mana. Colored reductions are read only for a spell's
// own cost (cost_modifier_supported), none of which has hybrid symbols.
reduce_by_shard :: proc(shards: ^[dynamic]types.ManaCostShard, generic: ^int, less: types.ManaCostShard) {
	for x, i in shards^ do if x == less {
		ordered_remove(shards, i)
		return
	}
	generic^ -= 1
}

// Whether the player could pay the spell's optional additional cost ("you may collect evidence 6"): what it takes is
// there to choose (CR 118.3).
@(private = "file")
optional_cost_payable :: proc(s: ^types.GameState, p: types.PlayerId, spell: ^types.GameObject) -> bool {
	cost, has := object_optional_cost(spell)
	if !has do return false
	c, chooses := object_cost_of(s, p, spell, cost)
	if !chooses do return false
	others := make([dynamic]types.ObjectId, context.temp_allocator)
	for id in c.choices do if id != spell.id do append(&others, id)
	c.choices = others
	return cost_objects_available(s, p, c, nil)
}
