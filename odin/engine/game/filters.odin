// Describing objects: "nonland permanent", "creature with flying", "attacking creature", "creature with mana value 3
// or less", "Goblin", "creature an opponent controls". One matcher serves targets (CR 115), static abilities' affected
// objects (CR 611.3) and the permanents triggers watch (CR 603.2).
package game

import "core:reflect"
import "core:strings"
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
	case types.FilterProp_WasDealtDamageThisTurn:
		return true // "that was dealt damage this turn": the turn's damage record (dealt_damage_this_turn)
	case types.FilterProp_DealtDamageThisTurn:
		return x.kind == .Any && x.recipient == nil // "that dealt damage this turn"
	case types.FilterProp_InZone:
		return x.zone == .Battlefield // "you control" on the battlefield (graveyard filters are read by graveyard_filter)
	case types.FilterProp_Targets:
		// "A spell that targets this creature" (CR 601.2c: its targets are chosen as it's cast).
		// "That targets you or a creature you control" too (target_fits_description).
		return x.filter != nil && spell_targets_filter_supported(x.filter^)
	case types.FilterProp_Another, types.FilterProp_Tapped, types.FilterProp_Untapped, types.FilterProp_Token,
	     types.FilterProp_NonToken, types.FilterProp_HasColor, types.FilterProp_NotColor, types.FilterProp_HasSupertype,
	     types.FilterProp_NotSupertype, types.FilterProp_Blocking, types.FilterProp_Named:
		return true
	case types.FilterProp_Owned:
		// "A card an opponent owns", "from your graveyard" (CR 108.3).
		#partial switch _ in x.controller {
		case types.ControllerRef_You, types.ControllerRef_Opponent:
			return true
		}
		return false
	case types.FilterProp_Attacking:
		return x.defender == nil
	case types.FilterProp_Historic, types.FilterProp_NotHistoric, types.FilterProp_WasKicked, types.FilterProp_ColorCount,
	     types.FilterProp_HasAdventure, types.FilterProp_Modified:
		return true
	case types.FilterProp_Counters:
		// "With a +1/+1 counter on it", "with three or more counters on it".
		if m, of_type := x.counters.(types.CounterMatch_OfType); of_type && !counter_kind_supported(m._0) do return false
		return quantity_supported(x.count) && !quantity_reads_target(x.count)
	case types.FilterProp_IsChosenCreatureType, types.FilterProp_IsChosenColor, types.FilterProp_IsChosenCardType:
		return true // the source's choice as it entered (entry_choice.odin)
	case types.FilterProp_AnyOf:
		// "That's black or red": any one of them.
		for q in x.props do if !property_supported(q) do return false
		return len(x.props) > 0
	case types.FilterProp_Not:
		// "That isn't [...]": the opposite of a property this engine reads (one about the object itself).
		if x.prop == nil do return false
		#partial switch _ in x.prop^ {
		case types.FilterProp_InZone, types.FilterProp_Another, types.FilterProp_Owned:
			return false
		}
		return property_supported(x.prop^)
	case types.FilterProp_WithKeyword:
		return keyword_supported(x.value)
	case types.FilterProp_WithoutKeyword:
		return keyword_supported(x.value)
	case types.FilterProp_Cmc:
		return quantity_supported(x.value) && !quantity_reads_target(x.value)
	case types.FilterProp_PtComparison:
		// "Power greater than target creature's power" would need the target: not read here.
		return quantity_supported(x.value) && !quantity_reads_target(x.value) && x.stat != .TotalPowerToughness
	case types.FilterProp_EnteredThisTurn, types.FilterProp_Prepared:
		return true
	}
	return false
}

// A property of the ability's own source: also "if this creature attacked this turn" (as this object). Not read for
// other objects: "each creature that attacked this turn" also counts ones that have left the battlefield since.
source_property_supported :: proc(p: types.FilterProp) -> bool {
	if a, attacked := p.(types.FilterProp_AttackedThisTurn); attacked do return a.defender == nil
	return property_supported(p)
}

typed_supported :: proc(f: types.TypedFilter) -> bool {
	// A typed filter naming no types (and controlled by someone) describes a player, which isn't modelled here;
	// "a card named X" names a card by its name alone, and "a token you control" a permanent by being a token.
	if len(f.type_filters) == 0 && !(len(f.properties) == 1 && is_named(f.properties[0]) && f.controller == nil) && !names_token(f) do return false
	for t in f.type_filters do if !type_filter_supported(t) do return false
	for p in f.properties do if !property_supported(p) do return false
	if c, has := f.controller.?; has {
		#partial switch _ in c {
		case types.ControllerRef_You, types.ControllerRef_Opponent, types.ControllerRef_DefendingPlayer:
		case:
			return false
		}
	}
	return true
}

// "Target token you control": a permanent (tokens exist only on the battlefield, CR 111.7, 111.8).
names_token :: proc(f: types.TypedFilter) -> bool {
	for p in f.properties do if _, token := p.(types.FilterProp_Token); token do return true
	return false
}

is_named :: proc(p: types.FilterProp) -> bool {
	_, named := p.(types.FilterProp_Named)
	return named
}

has_subtype :: proc(o: ^types.GameObject, name: string) -> bool {
	for s in o.card_types.subtypes do if s == name do return true
	// CR 702.73a: changeling, "this object is every creature type", everywhere.
	if has_keyword(o, types.Keyword_Changeling) && subtype_in_set(name, .Creature) do return true
	// "This is every creature type" as a characteristic-defining ability: true in every zone (CR 604.3).
	if o.static_definitions != nil && subtype_in_set(name, .Creature) {
		for st in o.static_definitions^ do if st.characteristic_defining {
			for m in st.modifications do if _, all := m.(types.ContinuousModification_AddAllCreatureTypes); all do return true
		}
	}
	return false
}

// CR 700.6: artifacts, legendaries and Sagas are historic.
is_historic :: proc(o: ^types.GameObject) -> bool {
	return is_type(o, .Artifact) || has_supertype(o, .Legendary) || has_subtype(o, "Saga")
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
		case types.ControllerRef_DefendingPlayer:
			// "A creature defending player controls": CR 506.2, in a two-player game the nonactive player, during
			// combat (outside it there's no defending player).
			if s.combat == nil || o.controller == s.active_player do return false
		}
	}
	for p in f.properties {
		#partial switch x in p {
		case types.FilterProp_Another:
			if o.id == source do return false
		case types.FilterProp_AnyOf:
			one := types.TypedFilter{properties = make([dynamic]types.FilterProp, 1, context.temp_allocator)}
			fits := false
			for q in x.props {
				one.properties[0] = q
				if object_matches(s, o, one, chooser, source) {
					fits = true
					break
				}
			}
			if !fits do return false
		case types.FilterProp_Not:
			one := types.TypedFilter{properties = make([dynamic]types.FilterProp, 1, context.temp_allocator)}
			one.properties[0] = x.prop^
			if object_matches(s, o, one, chooser, source) do return false
		case types.FilterProp_IsChosenCreatureType:
			// "Creatures of the chosen type": the type chosen for the ability's source (CR 614.12, 607.2d); none chosen, none.
			name, chosen := chosen_creature_type(chooser_of(s, source))
			if !chosen || !has_subtype(o, name) do return false
		case types.FilterProp_IsChosenColor:
			c, chosen := chosen_color(chooser_of(s, source))
			if !chosen || !has_color(o, c) do return false
		case types.FilterProp_IsChosenCardType:
			t, chosen := chosen_card_type(chooser_of(s, source))
			if !chosen || !is_type(o, t) do return false
		case types.FilterProp_Named:
			if !strings.equal_fold(o.name, x.name) do return false // CR 201.2 (the card data writes some names in lowercase)
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
		case types.FilterProp_Historic:
			if !is_historic(o) do return false
		case types.FilterProp_NotHistoric:
			if is_historic(o) do return false
		case types.FilterProp_WasKicked:
			if !kicked(o) do return false // CR 702.33d
		case types.FilterProp_ColorCount:
			if !compare(len(o.color), x.comparator, int(x.count)) do return false // "multicolored": two or more (CR 105.4)
		case types.FilterProp_HasAdventure:
			if !has_adventure(o) && !showing_adventure(o) do return false // CR 716.2a
		case types.FilterProp_Modified:
			if !modified(s, o) do return false
		case types.FilterProp_Counters:
			n := 0
			#partial switch m in x.counters {
			case types.CounterMatch_OfType:
				n = int(counter_count(o, m._0))
			case types.CounterMatch_Any:
				n = int(o.loyalty.? or_else 0) // loyalty is kept apart from the other counters (add_counters)
				for c in o.counters do n += int(c._1)
			}
			if !compare(n, x.comparator, quantity_value(s, x.count, chooser, source, 0)) do return false
		case types.FilterProp_EnchantedBy, types.FilterProp_EquippedBy:
			// "Enchanted/equipped creature": the permanent the source is attached to.
			src := object(s, source)
			if src == nil do return false
			host := host_of(s, src)
			if host == nil || host.id != o.id do return false
		case types.FilterProp_Targets:
			if !spell_targets_one(s, o.id, x.filter^, chooser, source) do return false
		case types.FilterProp_WasDealtDamageThisTurn:
			if !in_damage_record(s, o, dealt = false) do return false
		case types.FilterProp_DealtDamageThisTurn:
			if !in_damage_record(s, o, dealt = true) do return false
		case types.FilterProp_InZone:
			if o.zone != x.zone do return false
		case types.FilterProp_EnteredThisTurn:
			// "That entered this turn": this object (CR 400.7) entered the battlefield this turn.
			turn, entered := o.entered_battlefield_turn.?
			if !entered || turn != s.turn_number || o.zone != .Battlefield do return false
		case types.FilterProp_Prepared:
			if o.prepared == nil do return false // CR 723.3a: the "prepared" designation
		case types.FilterProp_AttackedThisTurn:
			// CR 508.1: declared as an attacker this turn, as this object (CR 400.7).
			attacked := false
			for rec in s.attacker_declarations_this_turn do if rec.object_id == o.id && (rec.incarnation.? or_else 0) == o.incarnation do attacked = true
			if !attacked do return false
		case types.FilterProp_Owned:
			// "A card an opponent owns" (CR 108.3).
			_, you := x.controller.(types.ControllerRef_You)
			if (o.owner == chooser) != you do return false
		}
	}
	return true
}

// CR 700.9: a permanent is modified if it has one or more counters on it, if it's equipped, or if it's enchanted by
// an Aura its controller controls.
modified :: proc(s: ^types.GameState, o: ^types.GameObject) -> bool {
	if len(o.counters) > 0 || (o.loyalty.? or_else 0) > 0 do return true
	for id in o.attachments {
		a := object(s, id)
		if a == nil do continue
		if has_subtype(a, "Equipment") do return true
		if has_subtype(a, "Aura") && a.controller == o.controller do return true
	}
	return false
}

// Whether a spell on the stack has a target that fits the description ("this creature", "a creature you control").
spell_targets_one :: proc(s: ^types.GameState, spell: types.ObjectId, f: types.TargetFilter, chooser: types.PlayerId, source: types.ObjectId) -> bool {
	// A spell whose cost is being worked out reads the targets it's being cast with (CR 601.2f).
	if cost_targets.spell == spell && spell != 0 do return cost_target_fits(s, object(s, spell), f, chooser, source)
	for i in 0 ..< types.pvec_len(s.stack) {
		e := types.pvec_get(s.stack, i)
		if e.id != spell do continue
		k, is_spell := e.kind.(types.StackEntryKind_Spell)
		if !is_spell || k.ability == nil do return false
		for node := k.ability; node != nil; node = node.sub_ability do for t in node.targets {
			if target_fits_description(s, t, f, chooser, source) do return true
		}
	}
	return false
}

// Whether one target of a spell fits "this creature", "you" (the player `chooser`), "a permanent you control", or
// either of such.
target_fits_description :: proc(s: ^types.GameState, t: types.TargetRef, f: types.TargetFilter, chooser: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Controller:
		p, is_player := t.(types.TargetRef_Player)
		return is_player && p._0 == chooser
	case types.TargetFilter_Or:
		for y in x.filters do if target_fits_description(s, t, y, chooser, source) do return true
		return false
	}
	id, is_object := t.(types.TargetRef_Object)
	if !is_object do return false
	#partial switch x in f {
	case types.TargetFilter_SelfRef:
		return id._0 == source
	case types.TargetFilter_Typed:
		o := object(s, id._0)
		return o != nil && object_matches(s, o, x._0, chooser, source)
	}
	return false
}

// Whether this object (as the object it is now, CR 400.7) was dealt damage this turn, or (`dealt`) dealt damage this
// turn: the turn's damage record (CR 120.3).
in_damage_record :: proc(s: ^types.GameState, o: ^types.GameObject, dealt: bool) -> bool {
	for i in 0 ..< types.pvec_len(s.damage_dealt_this_turn) {
		rec := types.pvec_get(s.damage_dealt_this_turn, i)
		if dealt {
			if rec.source_id == o.id && (rec.source_incarnation.? or_else o.incarnation) == o.incarnation do return true
			continue
		}
		t, is_object := rec.target.(types.TargetRef_Object)
		if is_object && t._0 == o.id && (rec.target_incarnation.? or_else o.incarnation) == o.incarnation do return true
	}
	return false
}
