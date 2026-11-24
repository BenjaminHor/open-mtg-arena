// Hand-written codecs and helpers for the types whose serde is hand-written in Rust, each ported from the impl
// named above it (odingen lists them; docs/odin-port.md, "O-1 data model design").
package types

import "base:runtime"
import "core:reflect"
import "core:strconv"
import "core:strings"
import "core:unicode"
import "../json"

// ---------------------------------------------------------------------------------------- ExileConcealment ---

// phase-ast types/ability.rs `impl Serialize for ExileConcealment`: a bool, true when face down.
decode_ExileConcealment :: proc(v: json.Value, out: ^ExileConcealment) -> bool {
	when COVERAGE do cov_hit("hand:ExileConcealment")
	if v.kind != .Bool do return fail("ExileConcealment: expected a bool")
	out^ = v.boolean ? .FaceDown : .Public
	return true
}

encode_ExileConcealment :: proc(b: ^strings.Builder, x: ExileConcealment) {
	strings.write_string(b, x == .FaceDown ? "true" : "false")
}

// --------------------------------------------------------------------------------------------- SacrificeCost ---

// types/ability.rs `impl Serialize for SacrificeCost`: {"target": ..., "count": n} for a count requirement,
// {"target": ..., "requirement": ...} otherwise.
decode_SacrificeCost :: proc(v: json.Value, out: ^SacrificeCost) -> bool {
	when COVERAGE do cov_hit("hand:SacrificeCost")
	if v.kind != .Object do return fail("SacrificeCost: not an object")
	t, has_target := json.get(v, "target")
	if !has_target || !decode_TargetFilter(t, &out.target) do return fail("SacrificeCost.target")
	if c, ok := json.get(v, "count"); ok {
		n: u32
		if !decode_u32(c, &n) do return fail("SacrificeCost.count")
		out.requirement = SacrificeRequirement_Count{count = n}
	} else if r, ok2 := json.get(v, "requirement"); ok2 {
		if !decode_SacrificeRequirement(r, &out.requirement) do return fail("SacrificeCost.requirement")
	} else {
		return fail("SacrificeCost: needs count or requirement")
	}
	return true
}

encode_SacrificeCost :: proc(b: ^strings.Builder, x: SacrificeCost) {
	strings.write_byte(b, '{')
	f := true
	encode_SacrificeCost_members(b, x, &f)
	strings.write_byte(b, '}')
}

encode_SacrificeCost_members :: proc(b: ^strings.Builder, x: SacrificeCost, first: ^bool) {
	member(b, first, "target"); encode_TargetFilter(b, x.target)
	if c, ok := x.requirement.(SacrificeRequirement_Count); ok {
		member(b, first, "count"); encode_u32(b, c.count)
	} else {
		member(b, first, "requirement"); encode_SacrificeRequirement(b, x.requirement)
	}
}

// ----------------------------------------------------------------------------------------------- CounterType ---

// types/counter.rs KEYWORD_COUNTERS: the keyword counters' serialized names (CR 122.1b).
@(rodata)
KEYWORD_COUNTERS := [?]struct {
	name: string,
	kind: KeywordKind,
}{
	{"indestructible", .Indestructible},
	{"double strike", .DoubleStrike},
	{"first strike", .FirstStrike},
	{"deathtouch", .Deathtouch},
	{"vigilance", .Vigilance},
	{"hexproof", .Hexproof},
	{"lifelink", .Lifelink},
	{"decayed", .Decayed},
	{"exalted", .Exalted},
	{"trample", .Trample},
	{"flying", .Flying},
	{"menace", .Menace},
	{"shadow", .Shadow},
	{"haste", .Haste},
	{"reach", .Reach},
}

// types/counter.rs `format_counter_delta`: "+N"/"-N", and "-0" for a zero paired with a negative.
@(private)
write_counter_delta :: proc(b: ^strings.Builder, value, paired: i32) {
	if value == 0 && paired < 0 {
		strings.write_string(b, "-0")
		return
	}
	if value >= 0 do strings.write_byte(b, '+')
	strings.write_i64(b, i64(value))
}

// types/counter.rs `CounterType::as_str`.
counter_type_as_str :: proc(b: ^strings.Builder, x: CounterType) {
	switch y in x {
	case CounterType_Plus1Plus1: strings.write_string(b, "P1P1")
	case CounterType_Minus1Minus1: strings.write_string(b, "M1M1")
	case CounterType_PowerToughness:
		write_counter_delta(b, y.power, y.toughness)
		strings.write_byte(b, '/')
		write_counter_delta(b, y.toughness, y.power)
	case CounterType_Loyalty: strings.write_string(b, "loyalty")
	case CounterType_Defense: strings.write_string(b, "defense")
	case CounterType_Stun: strings.write_string(b, "stun")
	case CounterType_Lore: strings.write_string(b, "lore")
	case CounterType_Time: strings.write_string(b, "time")
	case CounterType_Fade: strings.write_string(b, "fade")
	case CounterType_Age: strings.write_string(b, "age")
	case CounterType_Shield: strings.write_string(b, "shield")
	case CounterType_Finality: strings.write_string(b, "finality")
	case CounterType_Keyword:
		for k in KEYWORD_COUNTERS do if k.kind == y._0 { strings.write_string(b, k.name); return }
		panic("KeywordKind stored in CounterType.Keyword must be in KEYWORD_COUNTERS")
	case CounterType_Generic: strings.write_string(b, y._0)
	}
}

// types/counter.rs `parse_signed_counter_delta`: "+N" or "-N".
@(private)
parse_signed_counter_delta :: proc(text: string) -> (i32, bool) {
	t := strings.trim_space(text)
	if len(t) < 2 do return 0, false
	magnitude, ok := strconv.parse_i64_of_base(t[1:], 10)
	if !ok || magnitude > i64(max(i32)) || magnitude < i64(min(i32)) do return 0, false
	switch t[0] {
	case '+': return i32(magnitude), true
	case '-': return -i32(magnitude), true
	}
	return 0, false
}

@(private)
trim_counter_suffix :: proc(text: string) -> string {
	t := strings.trim_space(text)
	for strings.has_suffix(t, " counter") do t = t[:len(t) - len(" counter")]
	return strings.trim_space(t)
}

// types/counter.rs `try_parse_counter_type`.
try_parse_counter_type :: proc(text: string) -> (CounterType, bool) {
	trimmed := trim_counter_suffix(text)
	if trimmed == "" do return nil, false
	switch trimmed {
	case "P1P1", "p1p1", "+1/+1", "plus1plus1": return CounterType_Plus1Plus1{}, true
	case "M1M1", "m1m1", "-1/-1", "minus1minus1": return CounterType_Minus1Minus1{}, true
	case "LOYALTY", "loyalty": return CounterType_Loyalty{}, true
	case "defense", "DEFENSE": return CounterType_Defense{}, true
	case "stun": return CounterType_Stun{}, true
	case "lore", "LORE": return CounterType_Lore{}, true
	case "time", "TIME": return CounterType_Time{}, true
	case "fade", "FADE": return CounterType_Fade{}, true
	case "age": return CounterType_Age{}, true
	case "shield": return CounterType_Shield{}, true
	case "finality": return CounterType_Finality{}, true
	}
	if slash := strings.index_byte(trimmed, '/'); slash >= 0 {
		p, okp := parse_signed_counter_delta(trimmed[:slash])
		t, okt := parse_signed_counter_delta(trimmed[slash + 1:])
		if okp && okt do return CounterType_PowerToughness{power = p, toughness = t}, true
	}
	lower := strings.to_lower(trimmed)
	for k in KEYWORD_COUNTERS do if k.name == lower do return CounterType_Keyword{_0 = k.kind}, true
	// A bare single-word remainder is a custom counter name; more words are leftover text.
	words := 0
	in_word := false
	for r in lower {
		if unicode.is_white_space(r) {
			in_word = false
		} else if !in_word {
			in_word = true
			words += 1
		}
	}
	if words == 1 do return CounterType_Generic{_0 = lower}, true
	return nil, false
}

// types/counter.rs `parse_counter_type`: unrecognized text becomes a Generic counter of the lowercased text.
parse_counter_type :: proc(text: string) -> CounterType {
	if c, ok := try_parse_counter_type(text); ok do return c
	return CounterType_Generic{_0 = strings.to_lower(trim_counter_suffix(text))}
}

decode_CounterType :: proc(v: json.Value, out: ^CounterType) -> bool {
	when COVERAGE do cov_hit("hand:CounterType")
	if v.kind != .String do return fail("CounterType: expected a string")
	out^ = parse_counter_type(v.text)
	return true
}

encode_CounterType :: proc(b: ^strings.Builder, x: CounterType) {
	tmp := strings.builder_make(context.temp_allocator)
	counter_type_as_str(&tmp, x)
	json.write_string(b, strings.to_string(tmp))
}

// ------------------------------------------------------------------------------------------------ ChoiceType ---

// types/ability.rs `impl Deserialize for ChoiceType`: a bare variant name (the unrestricted, default form of the
// variants that have data), or an externally tagged object.
decode_ChoiceType :: proc(v: json.Value, out: ^ChoiceType) -> bool {
	when COVERAGE do cov_hit("hand:ChoiceType")
	if v.kind == .String {
		switch v.text {
		case "CreatureType": out^ = ChoiceType_CreatureType{}
		case "Color": out^ = ChoiceType_Color{}
		case "OddOrEven": out^ = ChoiceType_OddOrEven{}
		case "BasicLandType": out^ = ChoiceType_BasicLandType{}
		case "CardType": out^ = ChoiceType_CardType{}
		case "CardName": out^ = ChoiceType_CardName{}
		case "LandType": out^ = ChoiceType_LandType{}
		case "Opponent": out^ = ChoiceType_Opponent{}
		case "Player": out^ = ChoiceType_Player{}
		case "TwoColors": out^ = ChoiceType_TwoColors{}
		case "Word": out^ = ChoiceType_Word{}
		case "Artist": out^ = ChoiceType_Artist{}
		case: return fail("ChoiceType: unknown unit variant")
		}
		return true
	}
	if v.kind != .Object || len(v.members) != 1 do return fail("ChoiceType: expected a string or a one-key object")
	name, d := v.members[0].key, v.members[0].value
	if d.kind != .Object do return fail("ChoiceType: variant data must be an object")
	opt :: proc(d: json.Value, key: string, out: ^$T, dec: proc(v: json.Value, out: ^T) -> bool) -> bool {
		if f, ok := json.get(d, key); ok do return dec(f, out)
		return true // #[serde(default)]
	}
	req :: proc(d: json.Value, key: string, out: ^$T, dec: proc(v: json.Value, out: ^T) -> bool) -> bool {
		if f, ok := json.get(d, key); ok do return dec(f, out)
		return fail(key)
	}
	switch name {
	case "CreatureType":
		x: ChoiceType_CreatureType
		if !opt(d, "options", &x.options, dec_dyn_string) do return false
		out^ = x
	case "Color":
		x: ChoiceType_Color
		if !opt(d, "excluded", &x.excluded, dec_dyn_ManaColor) do return false
		out^ = x
	case "CardType":
		// The legacy `excluded` form isn't written by today's Rust; reading it isn't ported.
		x: ChoiceType_CardType
		if _, legacy := json.get(d, "excluded"); legacy do return fail("ChoiceType.CardType: legacy excluded not supported")
		if !opt(d, "options", &x.options, dec_dyn_CoreType) do return false
		out^ = x
	case "CardName":
		x: ChoiceType_CardName
		if !opt(d, "options", &x.options, dec_dyn_string) || !opt(d, "distinctness", &x.distinctness, decode_NameDistinctness) do return false
		out^ = x
	case "NumberRange":
		x: ChoiceType_NumberRange
		if !req(d, "min", &x.min, decode_u32) || !opt(d, "max", &x.max, dec_opt_u32) || !opt(d, "distinctness", &x.distinctness, decode_NumberDistinctness) do return false
		out^ = x
	case "Labeled":
		x: ChoiceType_Labeled
		if !req(d, "options", &x.options, dec_dyn_string) do return false
		out^ = x
	case "CardPredicate":
		x: ChoiceType_CardPredicate
		if !req(d, "options", &x.options, dec_dyn_CardPredicateChoice) do return false
		out^ = x
	case "CardPredicateGuess":
		x: ChoiceType_CardPredicateGuess
		if !req(d, "options", &x.options, dec_dyn_CardPredicateChoice) do return false
		out^ = x
	case "Opponent":
		x: ChoiceType_Opponent
		if !opt(d, "restriction", &x.restriction, dec_ptr_PlayerFilter) || !opt(d, "distinctness", &x.distinctness, decode_PlayerChoiceDistinctness) do return false
		out^ = x
	case "Player":
		x: ChoiceType_Player
		if !opt(d, "distinctness", &x.distinctness, decode_PlayerChoiceDistinctness) do return false
		out^ = x
	case "Keyword":
		x := ChoiceType_Keyword{count = 1} // default_keyword_choice_count
		if !req(d, "options", &x.options, dec_dyn_Keyword) || !opt(d, "count", &x.count, decode_int) do return false
		out^ = x
	case "CounterKind":
		x: ChoiceType_CounterKind
		if !req(d, "options", &x.options, dec_dyn_CounterType) do return false
		out^ = x
	case: return fail("ChoiceType: unknown variant")
	}
	return true
}

// types/ability.rs `impl Serialize for ChoiceType`: variants whose data is empty or default are written as their
// bare name; the others as {"Variant": {fields}}, leaving out default fields.
encode_ChoiceType :: proc(b: ^strings.Builder, x: ChoiceType) {
	unit :: proc(b: ^strings.Builder, name: string) { json.write_string(b, name) }
	open :: proc(b: ^strings.Builder, name: string) -> bool {
		strings.write_byte(b, '{'); json.write_string(b, name); strings.write_string(b, ":{")
		return true
	}
	close :: proc(b: ^strings.Builder) { strings.write_string(b, "}}") }
	switch y in x {
	case ChoiceType_CreatureType:
		if len(y.options) == 0 { unit(b, "CreatureType"); return }
		f := !open(b, "CreatureType"); f = true; member(b, &f, "options"); enc_dyn_string(b, y.options); close(b)
	case ChoiceType_Color:
		if len(y.excluded) == 0 { unit(b, "Color"); return }
		f := !open(b, "Color"); f = true; member(b, &f, "excluded"); enc_dyn_ManaColor(b, y.excluded); close(b)
	case ChoiceType_OddOrEven: unit(b, "OddOrEven")
	case ChoiceType_BasicLandType: unit(b, "BasicLandType")
	case ChoiceType_CardType:
		if len(y.options) == 0 { unit(b, "CardType"); return }
		f := !open(b, "CardType"); f = true; member(b, &f, "options"); enc_dyn_CoreType(b, y.options); close(b)
	case ChoiceType_CardName:
		non_default := y.distinctness != .Repeatable
		if len(y.options) == 0 && !non_default { unit(b, "CardName"); return }
		f := !open(b, "CardName"); f = true
		member(b, &f, "options"); enc_dyn_string(b, y.options)
		if non_default { member(b, &f, "distinctness"); encode_NameDistinctness(b, y.distinctness) }
		close(b)
	case ChoiceType_NumberRange:
		f := !open(b, "NumberRange"); f = true
		member(b, &f, "min"); encode_u32(b, y.min)
		if m, ok := y.max.?; ok { member(b, &f, "max"); encode_u32(b, m) }
		if y.distinctness != .Repeatable { member(b, &f, "distinctness"); encode_NumberDistinctness(b, y.distinctness) }
		close(b)
	case ChoiceType_Labeled:
		f := !open(b, "Labeled"); f = true; member(b, &f, "options"); enc_dyn_string(b, y.options); close(b)
	case ChoiceType_LandType: unit(b, "LandType")
	case ChoiceType_CardPredicate:
		f := !open(b, "CardPredicate"); f = true; member(b, &f, "options"); enc_dyn_CardPredicateChoice(b, y.options); close(b)
	case ChoiceType_CardPredicateGuess:
		f := !open(b, "CardPredicateGuess"); f = true; member(b, &f, "options"); enc_dyn_CardPredicateChoice(b, y.options); close(b)
	case ChoiceType_Opponent:
		non_default := y.distinctness != .Independent
		if y.restriction == nil && !non_default { unit(b, "Opponent"); return }
		f := !open(b, "Opponent"); f = true
		member(b, &f, "restriction"); enc_ptr_PlayerFilter(b, y.restriction)
		if non_default { member(b, &f, "distinctness"); encode_PlayerChoiceDistinctness(b, y.distinctness) }
		close(b)
	case ChoiceType_Player:
		if y.distinctness == .Independent { unit(b, "Player"); return }
		f := !open(b, "Player"); f = true; member(b, &f, "distinctness"); encode_PlayerChoiceDistinctness(b, y.distinctness); close(b)
	case ChoiceType_TwoColors: unit(b, "TwoColors")
	case ChoiceType_Word: unit(b, "Word")
	case ChoiceType_Artist: unit(b, "Artist")
	case ChoiceType_Keyword:
		f := !open(b, "Keyword"); f = true
		member(b, &f, "options"); enc_dyn_Keyword(b, y.options)
		if y.count != 1 { member(b, &f, "count"); encode_int(b, y.count) }
		close(b)
	case ChoiceType_CounterKind:
		f := !open(b, "CounterKind"); f = true; member(b, &f, "options"); enc_dyn_CounterType(b, y.options); close(b)
	}
}

// -------------------------------------------------------------------------------------- AbilityDefinition ---

// types/ability.rs `impl Serialize for AbilityDefinition` appends two computed members after the fields:
// `consumes_source` (AbilityDefinition::consumes_source) and `is_mana_ability` (`is_mana_ability`, CR 605.1a).
// is_mana_ability walks the whole ability (produces_mana_on_activation and the library-move visitors) and is left
// for the translator; until then it isn't written, and the round-trip check skips that key (docs/status.md).
encode_AbilityDefinition_computed :: proc(b: ^strings.Builder, x: AbilityDefinition, first: ^bool) {
	if c, ok := x.cost.?; ok && ability_cost_consumes_source(c) {
		member(b, first, "consumes_source")
		strings.write_string(b, "true")
	}
}

// types/ability.rs `AbilityCost::consumes_source`: whether paying the cost destroys or moves the source itself
// (Cycling, Channel: "Discard this card").
ability_cost_consumes_source :: proc(c: AbilityCost) -> bool {
	#partial switch y in c {
	case AbilityCost_Discard: return y.self_scope == .SourceCard
	case AbilityCost_Composite: for sub in y.costs do if ability_cost_consumes_source(sub) do return true
	case AbilityCost_OneOf: for sub in y.costs do if ability_cost_consumes_source(sub) do return true
	case AbilityCost_PerCounter: return y.base != nil && ability_cost_consumes_source(y.base^)
	}
	return false
}

// ------------------------------------------------------------------------ defaults and skip predicates by hand ---

// types/ability.rs `ObjectSelectionCardinality::SINGLE` = Exactly { count: 1 }.
hand_ObjectSelectionCardinality_single :: proc() -> ObjectSelectionCardinality {
	return ObjectSelectionCardinality_Exactly{count = 1}
}

hand_ObjectSelectionCardinality_is_single :: proc(x: ObjectSelectionCardinality) -> bool {
	e, ok := x.(ObjectSelectionCardinality_Exactly)
	return ok && e.count == 1
}

// types/ability.rs `default_target_filter_permanent` = TargetFilter::Typed(TypedFilter::permanent()), and
// `TypedFilter::new` leaves controller and properties empty.
hand_default_target_filter_permanent :: proc() -> TargetFilter {
	return TargetFilter_Typed{_0 = TypedFilter{type_filters = dynamic_from([]TypeFilter{TypeFilter_Permanent{}})}}
}

// types/card.rs `CardMetadata::is_empty`.
hand_CardMetadata_is_empty :: proc(x: CardMetadata) -> bool {
	return x.forge_abilities == 0 && x.forge_triggers == 0 && x.forge_statics == 0 && x.forge_replacements == 0 &&
		len(x.related_token_ids) == 0 && len(x.source_printing_ids) == 0 && len(x.spellbook) == 0 &&
		x.off_stack_mana_value_override == nil && len(x.off_stack_mana_costs) == 0 && x.confirmed_misparse == nil
}

// types/ability.rs `PendingEntersModifications::is_empty`.
hand_PendingEntersModifications_is_empty :: proc(x: PendingEntersModifications) -> bool {
	return len(x.modifications) == 0
}

// types/ability.rs `is_default_library_shuffle_mode` = `LibraryShuffleMode::is_per_object`.
hand_is_default_library_shuffle_mode :: proc(x: LibraryShuffleMode) -> bool {
	return x == .PerObject
}

// types/ability.rs `is_default_search_zones`: exactly [Library].
hand_is_default_search_zones :: proc(x: [dynamic]Zone) -> bool {
	return len(x) == 1 && x[0] == .Library
}

// ------------------------------------------------------------------------------------ field adapters (with) ---

// Five Rust adapters write a two-variant enum as the legacy bool (types/zones.rs etb_tap_bool_compat;
// types/ability.rs card_selection_bool_compat, additional_cost_repeatability_bool_compat,
// discard_self_scope_bool_compat, source_exclusion_bool_compat).
@(private)
decode_bool_as :: proc(v: json.Value, out: ^$E, if_true, if_false: E) -> bool {
	if v.kind != .Bool do return fail("expected a legacy bool")
	out^ = v.boolean ? if_true : if_false
	return true
}

decode_with_etb_tap_bool_compat :: proc(v: json.Value, out: ^EtbTapState) -> bool {
	when COVERAGE do cov_hit("hand:with_etb_tap_bool_compat")
	return decode_bool_as(v, out, EtbTapState.Tapped, EtbTapState.Unspecified) // EtbTapState::from_legacy_bool
}
encode_with_etb_tap_bool_compat :: proc(b: ^strings.Builder, x: EtbTapState) {
	encode_bool(b, x == .Tapped) // is_tapped (Untapped is runtime-only and never written here)
}

decode_with_card_selection_bool_compat :: proc(v: json.Value, out: ^CardSelectionMode) -> bool {
	when COVERAGE do cov_hit("hand:with_card_selection_bool_compat")
	return decode_bool_as(v, out, CardSelectionMode.Random, CardSelectionMode.Chosen)
}
encode_with_card_selection_bool_compat :: proc(b: ^strings.Builder, x: CardSelectionMode) {
	encode_bool(b, x == .Random)
}

decode_with_additional_cost_repeatability_bool_compat :: proc(v: json.Value, out: ^AdditionalCostRepeatability) -> bool {
	when COVERAGE do cov_hit("hand:with_additional_cost_repeatability_bool_compat")
	return decode_bool_as(v, out, AdditionalCostRepeatability.Repeatable, AdditionalCostRepeatability.Once)
}
encode_with_additional_cost_repeatability_bool_compat :: proc(b: ^strings.Builder, x: AdditionalCostRepeatability) {
	encode_bool(b, x == .Repeatable)
}

decode_with_discard_self_scope_bool_compat :: proc(v: json.Value, out: ^DiscardSelfScope) -> bool {
	when COVERAGE do cov_hit("hand:with_discard_self_scope_bool_compat")
	return decode_bool_as(v, out, DiscardSelfScope.SourceCard, DiscardSelfScope.FromHand)
}
encode_with_discard_self_scope_bool_compat :: proc(b: ^strings.Builder, x: DiscardSelfScope) {
	encode_bool(b, x == .SourceCard)
}

decode_with_source_exclusion_bool_compat :: proc(v: json.Value, out: ^SourceExclusion) -> bool {
	when COVERAGE do cov_hit("hand:with_source_exclusion_bool_compat")
	return decode_bool_as(v, out, SourceExclusion.Exclude, SourceExclusion.Include)
}
encode_with_source_exclusion_bool_compat :: proc(b: ^strings.Builder, x: SourceExclusion) {
	encode_bool(b, x == .Exclude)
}

// types/ability.rs serialize_multi_target_min / deserialize_multi_target_min: a fixed minimum is a bare number.
decode_with_multi_target_min :: proc(v: json.Value, out: ^QuantityExpr) -> bool {
	when COVERAGE do cov_hit("hand:with_multi_target_min")
	if v.kind == .Number {
		n: i32
		if !decode_i32(v, &n) do return false
		out^ = QuantityExpr_Fixed{value = n}
		return true
	}
	return decode_QuantityExpr(v, out)
}
encode_with_multi_target_min :: proc(b: ^strings.Builder, x: QuantityExpr) {
	if f, ok := x.(QuantityExpr_Fixed); ok do encode_i32(b, f.value)
	else do encode_QuantityExpr(b, x)
}

// types/ability.rs serialize_damage_amount_compat / deserialize_damage_amount_compat: a per-source threshold is
// written as the legacy [comparator, threshold] pair; whole-event thresholds as the struct.
decode_with_damage_amount_compat :: proc(v: json.Value, out: ^Maybe(DamageAmountThreshold)) -> bool {
	when COVERAGE do cov_hit("hand:with_damage_amount_compat")
	#partial switch v.kind {
	case .Null:
		out^ = nil
		return true
	case .Array:
		if len(v.items) != 2 do return fail("damage_amount: expected [comparator, threshold]")
		t := DamageAmountThreshold{scope = .PerSource}
		if !decode_Comparator(v.items[0], &t.comparator) || !decode_u32(v.items[1], &t.threshold) do return false
		out^ = t
		return true
	}
	t: DamageAmountThreshold
	if !decode_DamageAmountThreshold(v, &t) do return false
	out^ = t
	return true
}
encode_with_damage_amount_compat :: proc(b: ^strings.Builder, x: Maybe(DamageAmountThreshold)) {
	t, ok := x.?
	if !ok {
		strings.write_string(b, "null")
		return
	}
	if t.scope == .PerSource {
		strings.write_byte(b, '[')
		encode_Comparator(b, t.comparator)
		strings.write_byte(b, ',')
		encode_u32(b, t.threshold)
		strings.write_byte(b, ']')
	} else {
		encode_DamageAmountThreshold(b, t)
	}
}

// bin/oracle_gen.rs `is_clean_signals` = database/bracket_lists.rs `BracketSignals::is_clean`.
hand_is_clean_signals :: proc(x: BracketSignals) -> bool {
	return !x.game_changer && !x.mass_land_denial && !x.extra_turn && !x.efficient_tutor
}

// types/mana.rs `impl Default for ManaCost` = ManaCost::zero() = Cost { shards: [], generic: 0 }.
hand_default_ManaCost :: proc() -> ManaCost {
	return ManaCost_Cost{}
}

// types/ability.rs `impl Default for CostObjectCount` = CostObjectCount::exactly(1).
hand_default_CostObjectCount :: proc() -> CostObjectCount {
	return CostObjectCount_Exactly{count = 1}
}

// game/game_object.rs `is_default<T>(value) = *value == T::default()`, for the field types that use it.
hand_is_default :: proc {
	hand_is_default_ManaCost,
	hand_is_default_PhaseStatus,
	hand_is_default_CardType,
	hand_is_default_TriggerOccurrenceState,
}

// phase-ast types/card_type.rs CardType derives Default: no supertypes, core types or subtypes.
hand_is_default_CardType :: proc(x: CardType) -> bool {
	return len(x.supertypes) == 0 && len(x.core_types) == 0 && len(x.subtypes) == 0
}

// phase-ast types/ability.rs `impl Default for TriggerOccurrenceState`: next_grant_instance =
// initial_next_grant_instance() = 1, no active grants.
hand_is_default_TriggerOccurrenceState :: proc(x: TriggerOccurrenceState) -> bool {
	return x.next_grant_instance == 1 && len(x.active_grants) == 0
}

// ManaCost's Default is ManaCost::zero() = Cost { shards: [], generic: 0 } (types/mana.rs).
hand_is_default_ManaCost :: proc(x: ManaCost) -> bool {
	c, ok := x.(ManaCost_Cost)
	return ok && len(c.shards) == 0 && c.generic == 0
}

// PhaseStatus's #[default] is PhasedIn (game/game_object.rs).
hand_is_default_PhaseStatus :: proc(x: PhaseStatus) -> bool {
	return is_variant(x, PhaseStatus_PhasedIn)
}

// types/ability.rs `AttachTargetBindings::is_empty`: no inner record, or one with nothing in it.
hand_AttachTargetBindings_is_empty :: proc(x: AttachTargetBindings) -> bool {
	return x.inner == nil || (len(x.inner.attachment_targets) == 0 && x.inner.host_target == nil && len(x.inner.attachment_candidates) == 0)
}

// types/format.rs `FormatConfig::standard()`. Its GameFormat calls, for Standard: no 2HG, so the poison
// threshold is INDIVIDUAL_POISON_LOSS_THRESHOLD (10, CR 104.3d); sideboard_policy is Limited(15);
// default_deck_copy_limit is UpTo(4) (CR 100.2a).
hand_FormatConfig_standard :: proc() -> FormatConfig {
	return FormatConfig {
		format = GameFormat_Standard{},
		starting_life = 20,
		min_players = 2,
		max_players = 2,
		deck_size = DeckSizeRule_Minimum{_0 = 60},
		poison_counter_threshold = u8(10),
		sideboard_policy = SideboardPolicy_Limited{_0 = 15},
		default_deck_copy_limit = DeckCopyLimit_UpTo{_0 = 4},
	}
}

// ------------------------------------------------------------------------------------ game-state hand codecs ---

// types/game_state.rs `impl Serialize for StackResolutionBudget`: the cap as a u32, 0 meaning no cap
// (from_legacy_max_resolutions). CR 117.3d + CR 117.4.
decode_StackResolutionBudget :: proc(v: json.Value, out: ^StackResolutionBudget) -> bool {
	when COVERAGE do cov_hit("hand:StackResolutionBudget")
	n: u32
	if !decode_u32(v, &n) do return false
	out^ = n == 0 ? StackResolutionBudget(StackResolutionBudget_Unlimited{}) : StackResolutionBudget(StackResolutionBudget_Limited{_0 = n})
	return true
}
encode_StackResolutionBudget :: proc(b: ^strings.Builder, x: StackResolutionBudget) {
	l, limited := x.(StackResolutionBudget_Limited)
	encode_u32(b, limited ? l._0 : 0)
}

// types/game_state.rs SearchFoundVisibility: `from/into = "bool"`, true = Public (CR 701.23e).
decode_SearchFoundVisibility :: proc(v: json.Value, out: ^SearchFoundVisibility) -> bool {
	when COVERAGE do cov_hit("hand:SearchFoundVisibility")
	return decode_bool_as(v, out, SearchFoundVisibility.Public, SearchFoundVisibility.Private)
}
encode_SearchFoundVisibility :: proc(b: ^strings.Builder, x: SearchFoundVisibility) { encode_bool(b, x == .Public) }

// types/game_state.rs EntryEventReplay: `from/into = "bool"`, true = Required.
decode_EntryEventReplay :: proc(v: json.Value, out: ^EntryEventReplay) -> bool {
	when COVERAGE do cov_hit("hand:EntryEventReplay")
	return decode_bool_as(v, out, EntryEventReplay.Required, EntryEventReplay.AlreadyDelivered)
}
encode_EntryEventReplay :: proc(b: ^strings.Builder, x: EntryEventReplay) { encode_bool(b, x == .Required) }

// types/game_state.rs `impl Serialize for FaceState`: a bool, true = FaceDown (CR 110.5, CR 708.2).
decode_FaceState :: proc(v: json.Value, out: ^FaceState) -> bool {
	when COVERAGE do cov_hit("hand:FaceState")
	return decode_bool_as(v, out, FaceState.FaceDown, FaceState.FaceUp)
}
encode_FaceState :: proc(b: ^strings.Builder, x: FaceState) { encode_bool(b, x == .FaceDown) }

// types/format.rs GameFormat: its Display string ("Standard", ..., "Custom:<id>"), read back by FromStr.
decode_GameFormat :: proc(v: json.Value, out: ^GameFormat) -> bool {
	when COVERAGE do cov_hit("hand:GameFormat")
	if v.kind != .String do return fail("GameFormat: expected a string")
	if strings.has_prefix(v.text, "Custom:") {
		n, ok := strconv.parse_u64_of_base(v.text[len("Custom:"):], 10)
		if !ok || n > u64(max(u16)) do return fail("GameFormat: invalid Custom format id")
		out^ = GameFormat_Custom{_0 = CustomFormatId(n)}
		return true
	}
	// Every other format's string is its variant name, which is how the derived unit-variant codec reads it.
	return decode_GameFormat_named(v, out)
}
encode_GameFormat :: proc(b: ^strings.Builder, x: GameFormat) {
	if c, ok := x.(GameFormat_Custom); ok {
		strings.write_string(b, "\"Custom:")
		strings.write_u64(b, u64(c._0))
		strings.write_byte(b, '"')
		return
	}
	encode_GameFormat_named(b, x)
}

// types/ability.rs CostPaidObjectRecord: Captured writes the bare snapshot (an object), MembershipOnly the bare
// object id (a number); reading goes by the JSON shape (CR 601.2h, CR 602.2b).
decode_CostPaidObjectRecord :: proc(v: json.Value, out: ^CostPaidObjectRecord) -> bool {
	when COVERAGE do cov_hit("hand:CostPaidObjectRecord")
	if v.kind == .Object {
		c: CostPaidObjectRecord_Captured
		if !decode_CostPaidObjectSnapshot(v, &c._0) do return false
		out^ = c
		return true
	}
	m: CostPaidObjectRecord_MembershipOnly
	if !decode_ObjectId(v, &m._0) do return false
	out^ = m
	return true
}
encode_CostPaidObjectRecord :: proc(b: ^strings.Builder, x: CostPaidObjectRecord) {
	switch y in x {
	case CostPaidObjectRecord_Captured: encode_CostPaidObjectSnapshot(b, y._0)
	case CostPaidObjectRecord_MembershipOnly: encode_ObjectId(b, y._0)
	}
}

// types/game_state.rs LiminalEntrant: written as the projected GameObject; read back as Token when its is_token
// is set (CR 111.1), else Card.
decode_LiminalEntrant :: proc(v: json.Value, out: ^LiminalEntrant) -> bool {
	when COVERAGE do cov_hit("hand:LiminalEntrant")
	o: GameObject
	if !decode_GameObject(v, &o) do return false
	out^ = o.is_token ? LiminalEntrant(LiminalEntrant_Token{_0 = TokenProjection(o)}) : LiminalEntrant(LiminalEntrant_Card{_0 = o})
	return true
}
encode_LiminalEntrant :: proc(b: ^strings.Builder, x: LiminalEntrant) {
	switch y in x {
	case LiminalEntrant_Token: encode_GameObject(b, GameObject(y._0))
	case LiminalEntrant_Card: encode_GameObject(b, y._0)
	}
}

// analysis/resource.rs PeriodSignature: `from/into = "SignatureWire"`, the period's own fields (flattened) plus
// `"scope": "OneRepetition"` for a one-repetition signature; absent scope reads as EveryRepetition (CR 732.2a).
decode_PeriodSignature :: proc(v: json.Value, out: ^PeriodSignature) -> bool {
	when COVERAGE do cov_hit("hand:PeriodSignature")
	p: PeriodicDelta
	if !decode_PeriodicDelta(v, &p) do return false
	scope, has := json.get(v, "scope")
	if has && (scope.kind != .String || (scope.text != "EveryRepetition" && scope.text != "OneRepetition")) do return fail("PeriodSignature.scope")
	out^ = has && scope.text == "OneRepetition" ? PeriodSignature(PeriodSignature_OneRepetition{_0 = p}) : PeriodSignature(PeriodSignature_EveryRepetition{_0 = p})
	return true
}
encode_PeriodSignature :: proc(b: ^strings.Builder, x: PeriodSignature) {
	strings.write_byte(b, '{')
	f := true
	switch y in x {
	case PeriodSignature_EveryRepetition: encode_PeriodicDelta_members(b, y._0, &f)
	case PeriodSignature_OneRepetition:
		encode_PeriodicDelta_members(b, y._0, &f)
		member(b, &f, "scope")
		json.write_string(b, "OneRepetition")
	}
	strings.write_byte(b, '}')
}

// types/resolution.rs `impl Serialize for PendingCoinFlip`: the branches go under `bound_branches` {won, lost}
// (required on reading: a parked flip without them is invalid), `branch_context` is left out when empty and
// `trigger_context` when absent. CR 705.
decode_PendingCoinFlip :: proc(v: json.Value, out: ^PendingCoinFlip) -> bool {
	when COVERAGE do cov_hit("hand:PendingCoinFlip")
	if v.kind != .Object do return fail("PendingCoinFlip: expected an object")
	req :: proc(v: json.Value, key: string, out: ^$T, d: proc(json.Value, ^T) -> bool) -> bool {
		m, ok := json.get(v, key)
		if !ok do return fail("PendingCoinFlip: a field is missing")
		return d(m, out)
	}
	opt :: proc(v: json.Value, key: string, out: ^$T, d: proc(json.Value, ^T) -> bool) -> bool {
		m, ok := json.get(v, key)
		return !ok || d(m, out)
	}
	bb: ResolvedCoinBranches
	bbv, has_branches := json.get(v, "bound_branches")
	if !has_branches || bbv.kind == .Null do return fail("PendingCoinFlip: missing bound_branches")
	if !decode_ResolvedCoinBranches(bbv, &bb) do return false
	if !req(v, "source_id", &out.source_id, decode_ObjectId) || !req(v, "controller", &out.controller, decode_PlayerId) ||
	   !opt(v, "flipper", &out.flipper, decode_PlayerId) ||
	   !req(v, "kind", &out.kind, decode_PendingCoinFlipKind) || !opt(v, "chain_root_targets", &out.chain_root_targets, dec_dyn_TargetRef) ||
	   !opt(v, "branch_context", &out.branch_context, decode_FlipBranchContext) ||
	   !opt(v, "trigger_context", &out.trigger_context, dec_opt_ResolvingTriggerContext) {
		return false
	}
	if w, has := bb.won.?; has { out.win_effect = new(ResolvedAbility); out.win_effect^ = w }
	if l, has := bb.lost.?; has { out.lose_effect = new(ResolvedAbility); out.lose_effect^ = l }
	return true
}
encode_PendingCoinFlip :: proc(b: ^strings.Builder, x: PendingCoinFlip) {
	strings.write_byte(b, '{')
	f := true
	member(b, &f, "source_id"); encode_ObjectId(b, x.source_id)
	member(b, &f, "controller"); encode_PlayerId(b, x.controller)
	member(b, &f, "flipper"); encode_PlayerId(b, x.flipper)
	member(b, &f, "bound_branches")
	{
		strings.write_byte(b, '{')
		g := true
		if x.win_effect != nil { member(b, &g, "won"); encode_ResolvedAbility(b, x.win_effect^) }
		if x.lose_effect != nil { member(b, &g, "lost"); encode_ResolvedAbility(b, x.lose_effect^) }
		strings.write_byte(b, '}')
	}
	member(b, &f, "kind"); encode_PendingCoinFlipKind(b, x.kind)
	member(b, &f, "chain_root_targets"); enc_dyn_TargetRef(b, x.chain_root_targets)
	if !flip_branch_context_is_empty(x.branch_context) { member(b, &f, "branch_context"); encode_FlipBranchContext(b, x.branch_context) }
	if t, ok := x.trigger_context.?; ok { member(b, &f, "trigger_context"); encode_ResolvingTriggerContext(b, t) }
	strings.write_byte(b, '}')
}

// types/resolution.rs FlipBranchContext::is_empty.
flip_branch_context_is_empty :: proc(x: FlipBranchContext) -> bool {
	return len(x.chosen_players) == 0 && len(x.parent_occurrences.targets) == 0 && x.forwarded_result_context == nil && x.parent_target_missing_reason == nil
}

// types/card_printing.rs owner_printing_pair: a deck's printing as {set_code, collector_number}, read back as
// CardPrinting::owner (no automatic art catalog version).
decode_with_owner_printing_pair :: proc(v: json.Value, out: ^CardPrinting) -> bool {
	when COVERAGE do cov_hit("hand:with_owner_printing_pair")
	if v.kind != .Object do return fail("printing: expected an object")
	s, ok1 := json.get(v, "set_code")
	c, ok2 := json.get(v, "collector_number")
	if !ok1 || !ok2 do return fail("printing: missing set_code or collector_number")
	out^ = {}
	return decode_string(s, &out.set_code) && decode_string(c, &out.collector_number)
}
encode_with_owner_printing_pair :: proc(b: ^strings.Builder, x: CardPrinting) {
	strings.write_byte(b, '{')
	f := true
	member(b, &f, "set_code"); json.write_string(b, x.set_code)
	member(b, &f, "collector_number"); json.write_string(b, x.collector_number)
	strings.write_byte(b, '}')
}

// game/combat.rs outgoing_attack_wire: Option<Option<ObjectIncarnationRef>> written as the inner option (outer
// None writes null) and read back as Some(inner).
decode_with_outgoing_attack_wire :: proc(v: json.Value, out: ^Maybe(Maybe(ObjectIncarnationRef))) -> bool {
	when COVERAGE do cov_hit("hand:with_outgoing_attack_wire")
	inner: Maybe(ObjectIncarnationRef)
	if !dec_opt_ObjectIncarnationRef(v, &inner) do return false
	out^ = inner
	return true
}
encode_with_outgoing_attack_wire :: proc(b: ^strings.Builder, x: Maybe(Maybe(ObjectIncarnationRef))) {
	inner, _ := x.?
	enc_opt_ObjectIncarnationRef(b, inner)
}

// game/combat.rs blocking_wire (CR 733): None ↔ [], Some([]) ↔ null, Some(ids) ↔ ids.
decode_with_blocking_wire :: proc(v: json.Value, out: ^Maybe([dynamic]ObjectId)) -> bool {
	when COVERAGE do cov_hit("hand:with_blocking_wire")
	if v.kind == .Null {
		out^ = make([dynamic]ObjectId)
		return true
	}
	ids: [dynamic]ObjectId
	if !dec_dyn_ObjectId(v, &ids) do return false
	if len(ids) == 0 do out^ = nil
	else do out^ = ids
	return true
}
encode_with_blocking_wire :: proc(b: ^strings.Builder, x: Maybe([dynamic]ObjectId)) {
	ids, ok := x.?
	if !ok do strings.write_string(b, "[]")
	else if len(ids) == 0 do strings.write_string(b, "null")
	else do enc_dyn_ObjectId(b, ids)
}

// types/game_state.rs stack_bound_reveals_is_empty, types/events.rs latched_doublers_are_empty.
hand_stack_bound_reveals_is_empty :: proc(x: ^map[ObjectId][dynamic]ObjectIncarnationRef) -> bool { return x == nil || len(x^) == 0 }
hand_latched_doublers_are_empty :: proc(x: ^[dynamic]LatchedTriggerDoubler) -> bool { return x == nil || len(x^) == 0 }

// analysis/resource.rs ResourceVector::is_zero: equal to the derived default (no map entries, every count 0).
hand_ResourceVector_is_zero :: proc(x: ResourceVector) -> bool {
	for m in x.mana do if m != 0 do return false
	return len(x.life) == 0 && len(x.damage_dealt) == 0 && len(x.library_delta) == 0 && len(x.poison) == 0 &&
		len(x.energy) == 0 && x.tokens_created == 0 && x.cards_drawn == 0 && x.casts_this_step == 0 &&
		x.landfall_triggers == 0 && x.combat_phases == 0 && x.extra_turns == 0 && x.death_triggers == 0 &&
		x.etb_triggers == 0 && x.ltb_triggers == 0 && x.sac_triggers == 0 && len(x.counters) == 0 &&
		len(x.generic_triggers) == 0
}

// GameFormat's other variants are written as their names; the variant structs are GameFormat_<Name>.
@(private)
decode_GameFormat_named :: proc(v: json.Value, out: ^GameFormat) -> bool {
	when COVERAGE do cov_hit("hand:GameFormat_named")
	u := runtime.type_info_base(type_info_of(GameFormat)).variant.(runtime.Type_Info_Union)
	for vt in u.variants {
		name := vt.variant.(runtime.Type_Info_Named).name[len("GameFormat_"):]
		if name != "Custom" && name == v.text {
			reflect.set_union_variant_typeid(any{out, typeid_of(GameFormat)}, vt.id)
			return true
		}
	}
	return fail("GameFormat: unknown format")
}
@(private)
encode_GameFormat_named :: proc(b: ^strings.Builder, x: GameFormat) {
	x := x
	ti := type_info_of(reflect.union_variant_typeid(x))
	json.write_string(b, ti.variant.(runtime.Type_Info_Named).name[len("GameFormat_"):])
}

// ------------------------------------------------------------------------------------ game-state field adapters ---
// Rust's map adapters write their entries sorted by key (deterministic saves). These write them in model order;
// the round trip compares JSON values, where object member order doesn't matter. Byte-identical output, if a
// later step needs it, sorts here.

// game/game_object.rs unit_marker_option_serde: Option<T> of a marker type written as a bool; true or null reads
// back as Some(T::default()).
decode_with_unit_marker_option_serde :: proc(v: json.Value, out: ^Maybe($T)) -> bool {
	when COVERAGE do cov_hit("hand:with_unit_marker_option_serde")
	#partial switch v.kind {
	case .Null: out^ = T{}; return true
	case .Bool:
		if v.boolean do out^ = T{}
		else do out^ = nil
		return true
	}
	return fail("expected a bool marker")
}
encode_with_unit_marker_option_serde :: proc(b: ^strings.Builder, x: Maybe($T)) { encode_bool(b, x != nil) }

// game/game_object.rs bestow_form_serde (CR 702.103): a bare flag, or the state itself once it records removed
// subtypes; null or true reads as the default state.
decode_with_bestow_form_serde :: proc(v: json.Value, out: ^Maybe(BestowFormState)) -> bool {
	when COVERAGE do cov_hit("hand:with_bestow_form_serde")
	#partial switch v.kind {
	case .Null: out^ = BestowFormState{}; return true
	case .Bool:
		if v.boolean do out^ = BestowFormState{}
		else do out^ = nil
		return true
	}
	s: BestowFormState
	if !decode_BestowFormState(v, &s) do return false
	out^ = s
	return true
}
encode_with_bestow_form_serde :: proc(b: ^strings.Builder, x: Maybe(BestowFormState)) {
	s, ok := x.?
	if ok && len(s.removed_creature_subtypes) > 0 do encode_BestowFormState(b, s)
	else do encode_bool(b, ok)
}

// phase-ast types/mana.rs snow_compat: Option<ManaSupertype> as a bool, true = Snow.
decode_with_snow_compat :: proc(v: json.Value, out: ^Maybe(ManaSupertype)) -> bool {
	when COVERAGE do cov_hit("hand:with_snow_compat")
	if v.kind != .Bool do return fail("snow: expected a bool")
	if v.boolean do out^ = ManaSupertype.Snow
	else do out^ = nil
	return true
}
encode_with_snow_compat :: proc(b: ^strings.Builder, x: Maybe(ManaSupertype)) {
	s, ok := x.?
	encode_bool(b, ok && s == .Snow)
}

// types/object_map.rs serialize_sorted: GameState.objects written as its map in ascending ObjectId order.
encode_with_sorted :: proc(b: ^strings.Builder, x: ObjectMap) { encode_ObjectMap(b, x) }

// phase-ast types/counter.rs counter_map_serde: a map keyed by the counter type's string; reading adds up
// repeated keys (two spellings of one counter type).
decode_with_counter_map_serde :: proc(v: json.Value, out: ^[dynamic]Tuple2(CounterType, u32)) -> bool {
	when COVERAGE do cov_hit("hand:with_counter_map_serde")
	if v.kind != .Object do return fail("counters: expected an object")
	out^ = make([dynamic]Tuple2(CounterType, u32), 0, len(v.members))
	outer: for m in v.members {
		ct: CounterType
		n: u32
		if !decode_CounterType(json.Value{kind = .String, text = m.key}, &ct) || !decode_u32(m.value, &n) do return false
		for &e in out {
			if counter_key(e._0) == counter_key(ct) {
				if u64(e._1) + u64(n) > u64(max(u32)) do return fail("counters: count overflow")
				e._1 += n
				continue outer
			}
		}
		append(out, Tuple2(CounterType, u32){ct, n})
	}
	return true
}
@(private)
counter_key :: proc(x: CounterType) -> string {
	kb := strings.builder_make(context.temp_allocator)
	counter_type_as_str(&kb, x)
	return strings.to_string(kb)
}

encode_with_counter_map_serde :: proc(b: ^strings.Builder, x: [dynamic]Tuple2(CounterType, u32)) {
	strings.write_byte(b, '{')
	for e, i in x {
		if i > 0 do strings.write_byte(b, ',')
		encode_CounterType(b, e._0)
		strings.write_byte(b, ':')
		encode_u32(b, e._1)
	}
	strings.write_byte(b, '}')
}

// types/game_state.rs tuple_key_map: (ObjectId, index) keys written "<object id>_<index>".
decode_with_tuple_key_map :: proc(v: json.Value, out: ^[dynamic]Tuple2(Tuple2(ObjectId, int), u32)) -> bool {
	when COVERAGE do cov_hit("hand:with_tuple_key_map")
	if v.kind != .Object do return fail("tuple-key map: expected an object")
	out^ = make([dynamic]Tuple2(Tuple2(ObjectId, int), u32), len(v.members))
	for m, i in v.members {
		sep := strings.index_byte(m.key, '_')
		if sep < 0 do return fail("tuple-key map: invalid key")
		oid, ok1 := strconv.parse_u64_of_base(m.key[:sep], 10)
		idx, ok2 := strconv.parse_u64_of_base(m.key[sep + 1:], 10)
		if !ok1 || !ok2 do return fail("tuple-key map: invalid key")
		out[i]._0 = {ObjectId(oid), int(idx)}
		if !decode_u32(m.value, &out[i]._1) do return false
	}
	return true
}
encode_with_tuple_key_map :: proc(b: ^strings.Builder, x: [dynamic]Tuple2(Tuple2(ObjectId, int), u32)) {
	strings.write_byte(b, '{')
	for e, i in x {
		if i > 0 do strings.write_byte(b, ',')
		strings.write_byte(b, '"')
		strings.write_u64(b, u64(e._0._0))
		strings.write_byte(b, '_')
		strings.write_u64(b, u64(e._0._1))
		strings.write_string(b, "\":")
		encode_u32(b, e._1)
	}
	strings.write_byte(b, '}')
}

// types/game_state.rs ability_usage_key_map (CR 602.5b, CR 602.5c): AbilityUsageKey written as
// "<source>#<provenance or ->#<0|1>#<fingerprint, % and # escaped>#<grant chain>#<description>", the grant chain
// as comma-separated "<object>.<incarnation>" stamps.
@(private)
write_usage_key :: proc(b: ^strings.Builder, k: AbilityUsageKey) {
	stamp :: proc(b: ^strings.Builder, r: ObjectIncarnationRef) {
		strings.write_u64(b, u64(r.object_id))
		strings.write_byte(b, '.')
		strings.write_u64(b, r.incarnation)
	}
	strings.write_u64(b, u64(k.source))
	strings.write_byte(b, '#')
	if p, ok := k.provenance.?; ok do stamp(b, p)
	else do strings.write_byte(b, '-')
	d, has_d := k.description.?
	strings.write_string(b, has_d ? "#1#" : "#0#")
	for c in transmute([]byte)k.fingerprint {
		switch c {
		case '%': strings.write_string(b, "%25")
		case '#': strings.write_string(b, "%23")
		case: strings.write_byte(b, c)
		}
	}
	strings.write_byte(b, '#')
	for r, i in k.grant_chain {
		if i > 0 do strings.write_byte(b, ',')
		stamp(b, r)
	}
	strings.write_byte(b, '#')
	if has_d do strings.write_string(b, d)
}

@(private)
parse_stamp :: proc(s: string) -> (ObjectIncarnationRef, bool) {
	dot := strings.index_byte(s, '.')
	if dot < 0 do return {}, false
	oid, ok1 := strconv.parse_u64_of_base(s[:dot], 10)
	inc, ok2 := strconv.parse_u64_of_base(s[dot + 1:], 10)
	return {object_id = ObjectId(oid), incarnation = inc}, ok1 && ok2
}

@(private)
read_usage_key :: proc(raw: string) -> (k: AbilityUsageKey, ok: bool) {
	parts: [6]string
	rest := raw
	for i in 0 ..< 5 {
		sep := strings.index_byte(rest, '#')
		if sep < 0 do return {}, false
		parts[i] = rest[:sep]
		rest = rest[sep + 1:]
	}
	parts[5] = rest
	src, src_ok := strconv.parse_u64_of_base(parts[0], 10)
	if !src_ok do return {}, false
	k.source = ObjectId(src)
	if parts[1] != "-" {
		p, p_ok := parse_stamp(parts[1])
		if !p_ok do return {}, false
		k.provenance = p
	}
	// The fingerprint's escapes: %25 is %, %23 is #; any other escape is invalid.
	fb := strings.builder_make()
	fp := parts[3]
	for i := 0; i < len(fp); i += 1 {
		if fp[i] != '%' { strings.write_byte(&fb, fp[i]); continue }
		if i + 2 >= len(fp) do return {}, false
		switch fp[i + 1:i + 3] {
		case "25": strings.write_byte(&fb, '%')
		case "23": strings.write_byte(&fb, '#')
		case: return {}, false
		}
		i += 2
	}
	k.fingerprint = strings.to_string(fb)
	switch {
	case parts[2] == "0" && parts[5] == "":
	case parts[2] == "1": k.description = parts[5]
	case: return {}, false
	}
	if parts[4] != "" {
		chain := parts[4]
		for seg in strings.split_iterator(&chain, ",") {
			r, r_ok := parse_stamp(seg)
			if !r_ok do return {}, false
			append(&k.grant_chain, r)
		}
	}
	return k, true
}

decode_with_ability_usage_key_map :: proc(v: json.Value, out: ^[dynamic]Tuple2(AbilityUsageKey, u32)) -> bool {
	when COVERAGE do cov_hit("hand:with_ability_usage_key_map")
	if v.kind != .Object do return fail("ability usage map: expected an object")
	out^ = make([dynamic]Tuple2(AbilityUsageKey, u32), len(v.members))
	for m, i in v.members {
		k, ok := read_usage_key(m.key)
		if !ok do return fail("ability usage map: invalid key")
		out[i]._0 = k
		if !decode_u32(m.value, &out[i]._1) do return false
	}
	return true
}
encode_with_ability_usage_key_map :: proc(b: ^strings.Builder, x: [dynamic]Tuple2(AbilityUsageKey, u32)) {
	strings.write_byte(b, '{')
	for e, i in x {
		if i > 0 do strings.write_byte(b, ',')
		kb := strings.builder_make(context.temp_allocator)
		write_usage_key(&kb, e._0)
		json.write_string(b, strings.to_string(kb))
		strings.write_byte(b, ':')
		encode_u32(b, e._1)
	}
	strings.write_byte(b, '}')
}

// types/game_state.rs departed_activation_tally_map (CR 602.5b): (key, incarnation) written
// "<incarnation>#<usage key>".
decode_with_departed_activation_tally_map :: proc(v: json.Value, out: ^[dynamic]Tuple2(Tuple2(AbilityUsageKey, u64), u32)) -> bool {
	when COVERAGE do cov_hit("hand:with_departed_activation_tally_map")
	if v.kind != .Object do return fail("departed tally map: expected an object")
	out^ = make([dynamic]Tuple2(Tuple2(AbilityUsageKey, u64), u32), len(v.members))
	for m, i in v.members {
		sep := strings.index_byte(m.key, '#')
		if sep < 0 do return fail("departed tally map: invalid key")
		inc, ok1 := strconv.parse_u64_of_base(m.key[:sep], 10)
		k, ok2 := read_usage_key(m.key[sep + 1:])
		if !ok1 || !ok2 do return fail("departed tally map: invalid key")
		out[i]._0 = {k, inc}
		if !decode_u32(m.value, &out[i]._1) do return false
	}
	return true
}
encode_with_departed_activation_tally_map :: proc(b: ^strings.Builder, x: [dynamic]Tuple2(Tuple2(AbilityUsageKey, u64), u32)) {
	strings.write_byte(b, '{')
	for e, i in x {
		if i > 0 do strings.write_byte(b, ',')
		kb := strings.builder_make(context.temp_allocator)
		strings.write_u64(&kb, e._0._1)
		strings.write_byte(&kb, '#')
		write_usage_key(&kb, e._0._0)
		json.write_string(b, strings.to_string(kb))
		strings.write_byte(b, ':')
		encode_u32(b, e._1)
	}
	strings.write_byte(b, '}')
}

// types/game_state.rs persisted_checkpoint_state: a payment recovery checkpoint (CR 614.17a, CR 118.12) is
// written through ResolutionStateWire, the versioned persistence form (resolution frames in place of the
// resolution stack, types/resolution.rs). Not ported yet: reading one fails rather than misreading it.
decode_with_persisted_checkpoint_state :: proc(v: json.Value, out: ^^GameState) -> bool {
	when COVERAGE do cov_hit("hand:with_persisted_checkpoint_state")
	_ = v; _ = out
	return fail("payment recovery checkpoint: ResolutionStateWire is not ported yet")
}
encode_with_persisted_checkpoint_state :: proc(b: ^strings.Builder, x: ^GameState) {
	_ = b; _ = x
	panic("payment recovery checkpoint: ResolutionStateWire is not ported yet")
}

// The coverage keys of the hand-written decoders above.
HAND_COVERAGE_KEYS := []string{
	"hand:ExileConcealment",
	"hand:SacrificeCost",
	"hand:CounterType",
	"hand:ChoiceType",
	"hand:with_etb_tap_bool_compat",
	"hand:with_card_selection_bool_compat",
	"hand:with_additional_cost_repeatability_bool_compat",
	"hand:with_discard_self_scope_bool_compat",
	"hand:with_source_exclusion_bool_compat",
	"hand:with_multi_target_min",
	"hand:with_damage_amount_compat",
	"hand:StackResolutionBudget",
	"hand:SearchFoundVisibility",
	"hand:EntryEventReplay",
	"hand:FaceState",
	"hand:GameFormat",
	"hand:CostPaidObjectRecord",
	"hand:LiminalEntrant",
	"hand:PeriodSignature",
	"hand:PendingCoinFlip",
	"hand:with_owner_printing_pair",
	"hand:with_outgoing_attack_wire",
	"hand:with_blocking_wire",
	"hand:GameFormat_named",
	"hand:with_unit_marker_option_serde",
	"hand:with_bestow_form_serde",
	"hand:with_snow_compat",
	"hand:with_counter_map_serde",
	"hand:with_tuple_key_map",
	"hand:with_ability_usage_key_map",
	"hand:with_departed_activation_tally_map",
	"hand:with_persisted_checkpoint_state",
}
