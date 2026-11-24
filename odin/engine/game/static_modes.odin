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
	modes := rule_modes(st.mode)
	if modes == {} || st.condition != nil || st.per_player_condition != nil do return false
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
			if mode not_in rule_modes(st.mode) || !static_mode_supported(st) do continue
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
	for t in g.temp_effects do if t.object == o.id && t.incarnation == o.incarnation {
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
		for &st in o.static_definitions^ do if mode in rule_modes(st.mode) && static_mode_supported(st) do n += 1
	}
	return n
}
