// Hand-written codecs and helpers for the types whose serde is hand-written in Rust, each ported from the impl
// named above it (odingen lists them; docs/odin-port.md, "O-1 data model design").
package types

import "core:strconv"
import "core:strings"
import "core:unicode"
import "../json"

// ---------------------------------------------------------------------------------------- ExileConcealment ---

// phase-ast types/ability.rs `impl Serialize for ExileConcealment`: a bool, true when face down.
decode_ExileConcealment :: proc(v: json.Value, out: ^ExileConcealment) -> bool {
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
	return decode_bool_as(v, out, EtbTapState.Tapped, EtbTapState.Unspecified) // EtbTapState::from_legacy_bool
}
encode_with_etb_tap_bool_compat :: proc(b: ^strings.Builder, x: EtbTapState) {
	encode_bool(b, x == .Tapped) // is_tapped (Untapped is runtime-only and never written here)
}

decode_with_card_selection_bool_compat :: proc(v: json.Value, out: ^CardSelectionMode) -> bool {
	return decode_bool_as(v, out, CardSelectionMode.Random, CardSelectionMode.Chosen)
}
encode_with_card_selection_bool_compat :: proc(b: ^strings.Builder, x: CardSelectionMode) {
	encode_bool(b, x == .Random)
}

decode_with_additional_cost_repeatability_bool_compat :: proc(v: json.Value, out: ^AdditionalCostRepeatability) -> bool {
	return decode_bool_as(v, out, AdditionalCostRepeatability.Repeatable, AdditionalCostRepeatability.Once)
}
encode_with_additional_cost_repeatability_bool_compat :: proc(b: ^strings.Builder, x: AdditionalCostRepeatability) {
	encode_bool(b, x == .Repeatable)
}

decode_with_discard_self_scope_bool_compat :: proc(v: json.Value, out: ^DiscardSelfScope) -> bool {
	return decode_bool_as(v, out, DiscardSelfScope.SourceCard, DiscardSelfScope.FromHand)
}
encode_with_discard_self_scope_bool_compat :: proc(b: ^strings.Builder, x: DiscardSelfScope) {
	encode_bool(b, x == .SourceCard)
}

decode_with_source_exclusion_bool_compat :: proc(v: json.Value, out: ^SourceExclusion) -> bool {
	return decode_bool_as(v, out, SourceExclusion.Exclude, SourceExclusion.Include)
}
encode_with_source_exclusion_bool_compat :: proc(b: ^strings.Builder, x: SourceExclusion) {
	encode_bool(b, x == .Exclude)
}

// types/ability.rs serialize_multi_target_min / deserialize_multi_target_min: a fixed minimum is a bare number.
decode_with_multi_target_min :: proc(v: json.Value, out: ^QuantityExpr) -> bool {
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
