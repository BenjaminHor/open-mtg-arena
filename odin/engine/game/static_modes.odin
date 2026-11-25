// Static abilities that state a rule for objects or players (CR 604.1, 611.3) rather than change characteristics:
// "can't block", "can't attack", "can't be blocked", "doesn't untap during its controller's untap step", "attacks
// each combat if able", "can attack as though it didn't have defender", "you may cast it as though it had flash",
// "you have no maximum hand size", "you may play an additional land on each of your turns", "can't be countered".
package game

import types "../types"

Rule_Mode :: enum {
	Cant_Block,
	Cant_Attack,
	Cant_Be_Blocked,
	Cant_Untap,
	Must_Attack,
	Attack_With_Defender,
	Flash,
	Cant_Be_Countered,
	No_Max_Hand_Size,
	Extra_Land,
}

// The rule a static ability states, if it's one of these; "can't attack or block" is both.
rule_modes :: proc(m: types.StaticMode) -> (modes: bit_set[Rule_Mode]) {
	#partial switch _ in m {
	case types.StaticMode_CantBlock:
		return {.Cant_Block}
	case types.StaticMode_CantAttack:
		return {.Cant_Attack}
	case types.StaticMode_CantAttackOrBlock:
		return {.Cant_Attack, .Cant_Block}
	case types.StaticMode_CantBeBlocked:
		return {.Cant_Be_Blocked}
	case types.StaticMode_CantUntap:
		return {.Cant_Untap}
	case types.StaticMode_MustAttack:
		return {.Must_Attack}
	case types.StaticMode_CanAttackWithDefender:
		return {.Attack_With_Defender}
	case types.StaticMode_CastWithFlash:
		return {.Flash}
	case types.StaticMode_CantBeCountered:
		return {.Cant_Be_Countered}
	case types.StaticMode_NoMaximumHandSize:
		return {.No_Max_Hand_Size}
	case types.StaticMode_MayPlayAdditionalLand:
		return {.Extra_Land}
	}
	return {}
}

PLAYER_MODES :: bit_set[Rule_Mode]{.No_Max_Hand_Size, .Extra_Land}

static_mode_supported :: proc(st: types.StaticDefinition) -> bool {
	if _, ok := blocked_by_filter(st); ok do return true
	if _, ok := crew_contribution(st); ok do return true // crew.odin
	if _, _, ok := block_restriction(st); ok do return true
	modes := rule_modes(st.mode)
	if modes == {} || st.per_player_condition != nil do return false
	// "As long as ..." (CR 611.3a): checked wherever the rule is read (has_rule, player_rule_count).
	if c, has := st.condition.?; has && (.Flash in modes || !condition_supported(c)) do return false
	if st.affected_zone != nil || st.effect_zone != nil || len(st.active_zones) > 0 || len(st.modifications) > 0 do return false
	affected, has := st.affected.?
	if modes <= PLAYER_MODES {
		// "You have no maximum hand size": the controller.
		return !has || is_controller(affected)
	}
	if .Flash in modes do return has && is_self(affected) // flash for this card only
	return has && affected_supported(affected)
}

// Whether a rule applies to an object: from a static ability of a permanent on the battlefield (CR 611.3), or from
// a resolved effect granting it (CR 611.2).
has_rule :: proc(g: ^Game, o: ^types.GameObject, mode: Rule_Mode) -> bool {
	s := &g.state
	for id in ids_of(s.battlefield) {
		src := object(s, id)
		if src.static_definitions == nil do continue
		for &st in src.static_definitions^ {
			if mode not_in rule_modes(st.mode) || !static_mode_supported(st) || !condition_holds(s, src, st.condition) do continue
			affected, _ := st.affected.?
			#partial switch x in affected {
			case types.TargetFilter_SelfRef:
				if src.id == o.id do return true
			case types.TargetFilter_Typed:
				if object_matches(s, o, x._0, src.controller, src.id) do return true
			}
		}
	}
	// A card's own "as though it had flash" works from the hand.
	if mode == .Flash && o.static_definitions != nil {
		for &st in o.static_definitions^ do if .Flash in rule_modes(st.mode) && static_mode_supported(st) do return true
	}
	// A spell's own "this spell can't be countered" works on the stack (CR 113.6g), its condition read there.
	if o.zone == .Stack && o.static_definitions != nil {
		for &st in o.static_definitions^ {
			if mode in rule_modes(st.mode) && static_mode_supported(st) && condition_holds(s, o, st.condition) do return true
		}
	}
	for t in g.temp_effects do if f, is_rule := t.filter.?; is_rule && o.zone == .Battlefield && object_matches(s, o, f, t.controller, t.source) {
		if mode in t.modes do return true
		for m in t.modifications do if add, ok := m.(types.ContinuousModification_AddStaticMode); ok && mode in rule_modes(add.mode) do return true
	}
	for t in g.temp_effects do if t.object == o.id && t.incarnation == o.incarnation {
		if mode in t.modes do return true
		for m in t.modifications do if add, ok := m.(types.ContinuousModification_AddStaticMode); ok && mode in rule_modes(add.mode) do return true
	}
	return false
}

// How many permanents a player controls state a player rule ("you may play an additional land").
player_rule_count :: proc(g: ^Game, p: types.PlayerId, mode: Rule_Mode) -> int {
	s := &g.state
	n := 0
	for o in permanents_of(s, p) {
		if o.static_definitions == nil do continue
		for &st in o.static_definitions^ do if mode in rule_modes(st.mode) && static_mode_supported(st) && condition_holds(s, o, st.condition) do n += 1
	}
	return n
}

// "This creature can't be blocked by creatures with power 2 or less / by Walls / by artifact creatures" (CR 509.1b:
// a restriction on blocking): the creatures that can't block what the ability affects.
blocked_by_filter :: proc(st: types.StaticDefinition) -> (types.TypedFilter, bool) {
	m, ok := st.mode.(types.StaticMode_CantBeBlockedBy)
	if !ok || st.condition != nil || st.per_player_condition != nil do return {}, false
	if st.affected_zone != nil || st.effect_zone != nil || len(st.active_zones) > 0 || len(st.modifications) > 0 do return {}, false
	affected, has := st.affected.?
	if !has || !affected_supported(affected) do return {}, false
	typed, is_typed := m.filter.(types.TargetFilter_Typed)
	if !is_typed || typed._0.controller != nil || !typed_supported(typed._0) do return {}, false
	return typed._0, true
}

// Whether a static ability on the battlefield stops `blocker` from blocking `attacker` (CR 509.1b).
cant_be_blocked_by :: proc(g: ^Game, attacker, blocker: ^types.GameObject) -> bool {
	s := &g.state
	for id in ids_of(s.battlefield) {
		src := object(s, id)
		if src.static_definitions == nil do continue
		for &st in src.static_definitions^ {
			f, ok := blocked_by_filter(st)
			if !ok do continue
			affected, _ := st.affected.?
			#partial switch x in affected {
			case types.TargetFilter_SelfRef:
				if src.id != attacker.id do continue
			case types.TargetFilter_Typed:
				if !object_matches(s, attacker, x._0, src.controller, src.id) do continue
			case:
				continue
			}
			// "Power greater than this creature's": read from the attacker, the ability's source here.
			if object_matches(s, blocker, f, src.controller, attacker.id) do return true
		}
	}
	return false
}

// "This creature can block only creatures with flying" (CR 509.1b: a restriction on blocking), on the creature
// itself. Written as what it can block, or as what it can't ("only creatures that aren't non-Spirit creatures":
// the Spirit tokens' "can't block ... non-Spirit creatures").
block_restriction :: proc(st: types.StaticDefinition) -> (f: types.TypedFilter, negated: bool, ok: bool) {
	m, is_restriction := st.mode.(types.StaticMode_BlockRestriction)
	if !is_restriction || st.condition != nil || st.per_player_condition != nil do return
	if st.affected_zone != nil || st.effect_zone != nil || len(st.active_zones) > 0 || len(st.modifications) > 0 do return
	affected, has := st.affected.?
	if !has || !is_self(affected) do return
	filter := m.filter
	if not, is_not := filter.(types.TargetFilter_Not); is_not {
		if not.filter == nil do return
		filter = not.filter^
		negated = true
	}
	typed, is_typed := filter.(types.TargetFilter_Typed)
	if !is_typed || typed._0.controller != nil || !typed_supported(typed._0) do return
	return typed._0, negated, true
}

// Whether the blocker's own restriction lets it block this attacker (CR 509.1b).
block_restriction_allows :: proc(g: ^Game, blocker, attacker: ^types.GameObject) -> bool {
	s := &g.state
	if blocker.static_definitions == nil do return true
	for &st in blocker.static_definitions^ {
		f, negated, ok := block_restriction(st)
		if !ok do continue
		if object_matches(s, attacker, f, blocker.controller, blocker.id) == negated do return false
	}
	return true
}
