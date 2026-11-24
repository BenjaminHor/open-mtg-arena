// Describing objects: "nonland permanent", "creature with flying", "attacking creature", "creature with mana value 3
// or less", "Goblin", "creature an opponent controls". One matcher serves targets (CR 115), static abilities' affected
// objects (CR 611.3) and the permanents triggers watch (CR 603.2).
package game

import "core:reflect"
import types "../types"

type_filter_supported :: proc(t: types.TypeFilter) -> bool {
	#partial switch x in t {
	case types.TypeFilter_Creature, types.TypeFilter_Land, types.TypeFilter_Artifact, types.TypeFilter_Enchantment,
	     types.TypeFilter_Planeswalker, types.TypeFilter_Permanent, types.TypeFilter_Instant, types.TypeFilter_Sorcery,
	     types.TypeFilter_Card, types.TypeFilter_Subtype, types.TypeFilter_Battle:
		return true
	case types.TypeFilter_Non:
		return x._0 != nil && type_filter_supported(x._0^)
	case types.TypeFilter_AnyOf:
		for y in x._0 do if !type_filter_supported(y) do return false
		return true
	}
	return false
}

property_supported :: proc(p: types.FilterProp) -> bool {
	#partial switch x in p {
	case types.FilterProp_EnchantedBy, types.FilterProp_EquippedBy:
		return true
	case types.FilterProp_InZone:
		return x.zone == .Battlefield // "you control" on the battlefield (graveyard filters are read by graveyard_filter)
	case types.FilterProp_Targets:
		// "A spell that targets this creature" (CR 601.2c: its targets are chosen as it's cast).
		if x.filter == nil do return false
		#partial switch y in x.filter^ {
		case types.TargetFilter_SelfRef:
			return true
		case types.TargetFilter_Typed:
			return typed_supported(y._0)
		}
		return false
	case types.FilterProp_Another, types.FilterProp_Tapped, types.FilterProp_Untapped, types.FilterProp_Token,
	     types.FilterProp_NonToken, types.FilterProp_HasColor, types.FilterProp_NotColor, types.FilterProp_HasSupertype,
	     types.FilterProp_NotSupertype, types.FilterProp_Blocking:
		return true
	case types.FilterProp_Attacking:
		return x.defender == nil
	case types.FilterProp_WithKeyword:
		return keyword_supported(x.value)
	case types.FilterProp_WithoutKeyword:
		return keyword_supported(x.value)
	case types.FilterProp_Cmc:
		return quantity_supported(x.value)
	case types.FilterProp_PtComparison:
		return quantity_supported(x.value) && x.stat != .TotalPowerToughness
	}
	return false
}

typed_supported :: proc(f: types.TypedFilter) -> bool {
	// A typed filter naming no types (and controlled by someone) describes a player, which isn't modelled here.
	if len(f.type_filters) == 0 do return false
	for t in f.type_filters do if !type_filter_supported(t) do return false
	for p in f.properties do if !property_supported(p) do return false
	if c, has := f.controller.?; has {
		#partial switch _ in c {
		case types.ControllerRef_You, types.ControllerRef_Opponent:
		case:
			return false
		}
	}
	return true
}

has_subtype :: proc(o: ^types.GameObject, name: string) -> bool {
	for s in o.card_types.subtypes do if s == name do return true
	return false
}

has_supertype :: proc(o: ^types.GameObject, t: types.Supertype) -> bool {
	for s in o.card_types.supertypes do if s == t do return true
	return false
}

has_color :: proc(o: ^types.GameObject, c: types.ManaColor) -> bool {
	for x in o.color do if x == c do return true
	return false
}

keyword_in :: proc(o: ^types.GameObject, k: types.Keyword) -> bool {
	for x in o.keywords do if reflect.union_variant_typeid(x) == reflect.union_variant_typeid(k) do return true
	return false
}

compare :: proc(a: int, c: types.Comparator, b: int) -> bool {
	switch c {
	case .GT:
		return a > b
	case .LT:
		return a < b
	case .GE:
		return a >= b
	case .LE:
		return a <= b
	case .EQ:
		return a == b
	case .NE:
		return a != b
	}
	return false
}

type_matches :: proc(o: ^types.GameObject, t: types.TypeFilter) -> bool {
	#partial switch x in t {
	case types.TypeFilter_Creature:
		return is_type(o, .Creature)
	case types.TypeFilter_Land:
		return is_type(o, .Land)
	case types.TypeFilter_Artifact:
		return is_type(o, .Artifact)
	case types.TypeFilter_Enchantment:
		return is_type(o, .Enchantment)
	case types.TypeFilter_Planeswalker:
		return is_type(o, .Planeswalker)
	case types.TypeFilter_Battle:
		return is_type(o, .Battle)
	case types.TypeFilter_Instant:
		return is_type(o, .Instant)
	case types.TypeFilter_Sorcery:
		return is_type(o, .Sorcery)
	case types.TypeFilter_Permanent:
		// CR 110.4: on the battlefield every object is a permanent; elsewhere, a permanent card.
		return o.zone == .Battlefield || is_permanent_card(o)
	case types.TypeFilter_Card:
		return !o.is_token
	case types.TypeFilter_Subtype:
		return has_subtype(o, x._0)
	case types.TypeFilter_Non:
		return !type_matches(o, x._0^)
	case types.TypeFilter_AnyOf:
		for y in x._0 do if type_matches(o, y) do return true
		return false
	}
	return false
}

// Whether `o` fits the description, from the point of view of `source` (for "another") and `chooser` (for "you" and
// "an opponent").
object_matches :: proc(s: ^types.GameState, o: ^types.GameObject, f: types.TypedFilter, chooser: types.PlayerId, source: types.ObjectId) -> bool {
	for t in f.type_filters do if !type_matches(o, t) do return false
	if c, has := f.controller.?; has {
		#partial switch _ in c {
		case types.ControllerRef_You:
			if o.controller != chooser do return false
		case types.ControllerRef_Opponent:
			if o.controller == chooser do return false
		}
	}
	for p in f.properties {
		#partial switch x in p {
		case types.FilterProp_Another:
			if o.id == source do return false
		case types.FilterProp_Tapped:
			if !o.tapped do return false
		case types.FilterProp_Untapped:
			if o.tapped do return false
		case types.FilterProp_Token:
			if !o.is_token do return false
		case types.FilterProp_NonToken:
			if o.is_token do return false
		case types.FilterProp_HasColor:
			if !has_color(o, x.color) do return false
		case types.FilterProp_NotColor:
			if has_color(o, x.color) do return false
		case types.FilterProp_HasSupertype:
			if !has_supertype(o, x.value) do return false
		case types.FilterProp_NotSupertype:
			if has_supertype(o, x.value) do return false
		case types.FilterProp_WithKeyword:
			if !keyword_in(o, x.value) do return false
		case types.FilterProp_WithoutKeyword:
			if keyword_in(o, x.value) do return false
		case types.FilterProp_Cmc:
			n := quantity_value(s, x.value, chooser, source, 0) // "mana value less than your life total" too
			if !compare(object_mana_value(o), x.comparator, n) do return false
		case types.FilterProp_PtComparison:
			n := quantity_value(s, x.value, chooser, source, 0)
			v: Maybe(i32)
			switch x.stat {
			case .Power:
				v = o.power if x.scope == .Current else o.base_power
			case .Toughness:
				v = o.toughness if x.scope == .Current else o.base_toughness
			case .TotalPowerToughness:
				return false
			}
			value, has := v.?
			if !has || !compare(int(value), x.comparator, n) do return false
		case types.FilterProp_Attacking:
			c, in_combat := &s.combat.?
			if !in_combat || !is_attacking(c, o.id) do return false
		case types.FilterProp_Blocking:
			c, in_combat := &s.combat.?
			if !in_combat do return false
			if _, blocking := c.blocker_to_attacker[o.id]; !blocking do return false
		case types.FilterProp_EnchantedBy, types.FilterProp_EquippedBy:
			// "Enchanted/equipped creature": the permanent the source is attached to.
			src := object(s, source)
			if src == nil do return false
			host := host_of(s, src)
			if host == nil || host.id != o.id do return false
		case types.FilterProp_Targets:
			if !spell_targets_one(s, o.id, x.filter^, chooser, source) do return false
		case types.FilterProp_InZone:
			if o.zone != x.zone do return false
		case types.FilterProp_Owned:
		// The owner is checked where the candidates are gathered (graveyard_targets).
		}
	}
	return true
}

// Whether a spell on the stack has a target that fits the description ("this creature", "a creature you control").
spell_targets_one :: proc(s: ^types.GameState, spell: types.ObjectId, f: types.TargetFilter, chooser: types.PlayerId, source: types.ObjectId) -> bool {
	for i in 0 ..< types.pvec_len(s.stack) {
		e := types.pvec_get(s.stack, i)
		if e.id != spell do continue
		k, is_spell := e.kind.(types.StackEntryKind_Spell)
		if !is_spell || k.ability == nil do return false
		for node := k.ability; node != nil; node = node.sub_ability do for t in node.targets {
			id, is_object := t.(types.TargetRef_Object)
			if !is_object do continue
			#partial switch x in f {
			case types.TargetFilter_SelfRef:
				if id._0 == source do return true
			case types.TargetFilter_Typed:
				if o := object(s, id._0); o != nil && object_matches(s, o, x._0, chooser, source) do return true
			}
		}
	}
	return false
}
