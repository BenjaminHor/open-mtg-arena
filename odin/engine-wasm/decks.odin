// Deck checks for the deck builder and the match setup: which cards are unknown, the deck's colors, its legality
// in each format, and whether it meets the selected format's construction rules (CR 100.2a, 100.4, 100.5, 100.6).
//
// Constructed formats are checked in full against the format's registry config. The Commander family (CR 903) gets
// a simplified check for Commander itself; the other multiplayer and casual variants answer "no opinion" (null), as
// the Rust engine does for a format it can't resolve, until the Odin engine grows their rules.
package engine_odin

import "core:fmt"
import "core:slice"
import "core:strings"
import json "../engine/json"
import types "../engine/types"

// The formats with a legality table, by the key the card data and the client use (LegalityFormat::ALL in Rust).
LEGALITY_KEYS := [?]string {
	"brawl",
	"commander",
	"duel",
	"historic",
	"legacy",
	"modern",
	"oathbreaker",
	"pauper",
	"paupercommander",
	"pioneer",
	"premodern",
	"standard",
	"standardbrawl",
	"timeless",
	"vintage",
}

// Constructed formats checked by the general constructed rules.
CONSTRUCTED_FORMATS := [?]string {
	"Standard",
	"Pioneer",
	"Modern",
	"Premodern",
	"Legacy",
	"Vintage",
	"Historic",
	"Timeless",
	"Pauper",
	"Freeform",
	"Dandan",
}

Deck_Request :: struct {
	main_deck, sideboard, commander, companion, planar_deck, scheme_deck, signature_spell: []string,
	selected_format:                                                                         string, // "" when none
	selected_match_type:                                                                     string,
	summary_only:                                                                            bool,
}

// A card by the name a deck list spells it: the database is keyed by lowercase name, and a composite
// "Front // Back" spelling names its front face.
find_card :: proc(name: string) -> (^types.CardExportEntry, bool) {
	key := strings.to_lower(name, context.temp_allocator)
	if e, ok := &cards[key]; ok do return e, true
	if i := strings.index(key, " // "); i >= 0 {
		if e, ok := &cards[key[:i]]; ok do return e, true
	}
	if i := strings.index(key, "//"); i >= 0 {
		if e, ok := &cards[strings.trim_space(key[:i])]; ok do return e, true
	}
	return nil, false
}

@(private = "file")
string_list :: proc(v: json.Value, key: string) -> []string {
	list, _ := json.get(v, key)
	out := make([]string, len(list.items))
	for item, i in list.items do out[i] = item.text
	return out
}

@(private = "file")
decode_request :: proc(v: json.Value) -> Deck_Request {
	r: Deck_Request
	r.main_deck = string_list(v, "main_deck")
	r.sideboard = string_list(v, "sideboard")
	r.commander = string_list(v, "commander")
	r.companion = string_list(v, "companion")
	r.planar_deck = string_list(v, "planar_deck")
	r.scheme_deck = string_list(v, "scheme_deck")
	r.signature_spell = string_list(v, "signature_spell")
	if f, ok := json.get(v, "selected_format"); ok && f.kind == .String do r.selected_format = f.text
	if m, ok := json.get(v, "selected_match_type"); ok && m.kind == .String do r.selected_match_type = m.text
	if s, ok := json.get(v, "summary_only"); ok do r.summary_only = s.boolean
	return r
}

// Every card the deck is built from: main deck, sideboard, commanders, signature spell and companion.
@(private = "file")
deck_cards :: proc(r: Deck_Request) -> [dynamic]string {
	out := make([dynamic]string)
	for list in ([?][]string{r.main_deck, r.sideboard, r.commander, r.signature_spell, r.companion}) {
		append(&out, ..list)
	}
	return out
}

// Sorted, without repeats (the Rust engine reports names from a BTreeSet).
@(private = "file")
sorted_set :: proc(names: [dynamic]string) -> []string {
	s := names[:]
	slice.sort(s)
	return slice.unique(s)
}

@(private = "file")
summarize_cards :: proc(prefix: string, names: []string) -> string {
	MAX_NAMES :: 6
	b := strings.builder_make()
	strings.write_string(&b, prefix)
	strings.write_string(&b, ": ")
	for name, i in names[:min(len(names), MAX_NAMES)] {
		if i > 0 do strings.write_string(&b, ", ")
		strings.write_string(&b, name)
	}
	if len(names) > MAX_NAMES do fmt.sbprintf(&b, ", +%d more", len(names) - MAX_NAMES)
	return strings.to_string(b)
}

Legality :: enum {
	Legal,
	Restricted,
	Not_Legal,
	Banned,
}

legality_of :: proc(name: string, format_key: string) -> Legality {
	e, ok := find_card(name)
	if !ok do return .Not_Legal
	switch e.legalities[format_key] {
	case "legal":
		return .Legal
	case "restricted":
		return .Restricted
	case "banned":
		return .Banned
	}
	return .Not_Legal
}

// CR 100.2a: how many copies of a card a deck may hold under a format's copy limit. Basic lands are exempt; a card
// that says a deck can have any number (or up to some number) of cards with its name sets its own limit.
copy_ceiling :: proc(e: ^types.CardExportEntry, format_limit: int) -> int {
	if slice.contains(e.face.card_type.supertypes[:], types.Supertype.Basic) do return max(int)
	text := strings.to_lower(e.face.oracle_text.? or_else "", context.temp_allocator)
	if strings.contains(text, "a deck can have any number of cards named") do return max(int)
	if strings.contains(text, "a deck can have up to seven cards named") do return 7
	if strings.contains(text, "a deck can have up to nine cards named") do return 9
	return format_limit
}

Check :: struct {
	compatible: bool,
	reasons:    [dynamic]string,
}

// CR 100.2a, 100.4, 100.5, 100.6: a constructed deck under its format's config (deck size, sideboard, copy limit)
// and card pool (the legality table under legality_key).
@(private = "file")
check_constructed :: proc(r: Deck_Request, unknown: []string, config: json.Value, legality_key, label: string) -> Check {
	c: Check
	if len(unknown) > 0 do append(&c.reasons, summarize_cards("Unknown cards", unknown))
	if len(r.commander) > 0 do append(&c.reasons, fmt.aprintf("%s decks do not use a commander slot", label))

	size := json.get_or_null(config, "deck_size")
	size_kind := json.get_or_null(size, "type").text
	size_n, _ := json.to_i64(json.get_or_null(size, "data"))
	found := len(r.main_deck)
	if size_kind == "Minimum" && i64(found) < size_n {
		append(&c.reasons, fmt.aprintf("%s deck must have at least %d cards (found %d)", label, size_n, found))
	} else if size_kind == "Exactly" && i64(found) != size_n {
		append(&c.reasons, fmt.aprintf("%s deck must have exactly %d cards (found %d)", label, size_n, found))
	}

	policy := json.get_or_null(config, "sideboard_policy")
	switch json.get_or_null(policy, "type").text {
	case "Forbidden":
		if len(r.sideboard) > 0 do append(&c.reasons, fmt.aprintf("%s does not allow a sideboard", label))
	case "Limited":
		max_sb, _ := json.to_i64(json.get_or_null(policy, "data"))
		if i64(len(r.sideboard)) > max_sb {
			append(&c.reasons, fmt.aprintf("Sideboard has %d cards (maximum %d)", len(r.sideboard), max_sb))
		}
	}

	// Copies by card, main deck and sideboard together (CR 100.4a).
	counts := make(map[string]int)
	for list in ([?][]string{r.main_deck, r.sideboard}) {
		for name in list {
			// An unknown card counts under its lowercase spelling, as the database would key it.
			e, ok := find_card(name)
			counts[e.face.name if ok else strings.to_lower(name)] += 1
		}
	}
	limit := json.get_or_null(config, "default_deck_copy_limit")
	format_limit := max(int)
	if json.get_or_null(limit, "type").text == "UpTo" {
		n, _ := json.to_i64(json.get_or_null(limit, "data"))
		format_limit = int(n)
	}
	over := make([dynamic]string)
	for name, n in counts {
		e, known := find_card(name)
		if n > (copy_ceiling(e, format_limit) if known else format_limit) do append(&over, fmt.aprintf("%s (%d copies)", name, n))
	}
	if len(over) > 0 {
		append(&c.reasons, summarize_cards(fmt.aprintf("More than %d copies (main + sideboard combined)", format_limit), sorted_set(over)))
	}

	illegal := make([dynamic]string)
	restricted := make([dynamic]string)
	if legality_key != "" {
		all := deck_cards(r)
		for name in all {
			if slice.contains(unknown, name) do continue
			e, _ := find_card(name)
			switch legality_of(name, legality_key) {
			case .Legal:
			case .Restricted:
				if counts[e.face.name] > 1 do append(&restricted, e.face.name)
			case .Banned:
				append(&illegal, fmt.aprintf("%s (banned)", e.face.name))
			case .Not_Legal:
				append(&illegal, fmt.aprintf("%s (not legal in %s)", e.face.name, label))
			}
		}
	}
	if len(illegal) > 0 do append(&c.reasons, summarize_cards(fmt.aprintf("Not %s legal", label), sorted_set(illegal)))
	if len(restricted) > 0 do append(&c.reasons, summarize_cards("More than 1 copy of a restricted card", sorted_set(restricted)))
	c.compatible = len(c.reasons) == 0
	return c
}

// CR 903.5: a Commander deck: one commander (or two that can partner), exactly 100 cards counting the commanders,
// one copy of each card but basic lands (CR 903.5b), every card within the commander's color identity (CR 903.5c),
// and every card legal in Commander.
@(private = "file")
check_commander :: proc(r: Deck_Request, unknown: []string) -> Check {
	c: Check
	if len(unknown) > 0 do append(&c.reasons, summarize_cards("Unknown cards", unknown))
	if len(r.commander) == 0 || len(r.commander) > 2 {
		append(&c.reasons, fmt.aprintf("Commander decks require 1 or 2 commanders (found %d)", len(r.commander)))
	}
	represented := 0
	for name in r.commander do if slice.contains(r.main_deck, name) do represented += 1
	total := len(r.main_deck) + len(r.commander) - represented
	if total != 100 do append(&c.reasons, fmt.aprintf("Commander deck must have exactly 100 cards (found %d)", total))

	identity: bit_set[types.ManaColor]
	for name in r.commander {
		if e, ok := find_card(name); ok do for color in e.face.color_identity do identity += {color}
	}
	counts := make(map[string]int)
	outside := make([dynamic]string)
	for name in r.main_deck {
		e, ok := find_card(name)
		if !ok {
			counts[strings.to_lower(name)] += 1
			continue
		}
		counts[e.face.name] += 1
		if slice.contains(r.commander, name) do continue
		for color in e.face.color_identity do if color not_in identity {
			append(&outside, e.face.name)
			break
		}
	}
	over := make([dynamic]string)
	for name, n in counts {
		e, known := find_card(name)
		if n > (copy_ceiling(e, 1) if known else 1) do append(&over, fmt.aprintf("%s (%d copies)", name, n))
	}
	if len(over) > 0 do append(&c.reasons, summarize_cards("Singleton violations", sorted_set(over)))
	// CR 903.5e: a Commander deck's sideboard slot is the deck builder's maybeboard, not part of the deck.
	illegal := make([dynamic]string)
	without_sideboard := r
	without_sideboard.sideboard = nil
	for name in deck_cards(without_sideboard) {
		if slice.contains(unknown, name) do continue
		e, _ := find_card(name)
		switch legality_of(name, "commander") {
		case .Legal, .Restricted:
		case .Banned:
			append(&illegal, fmt.aprintf("%s (banned)", e.face.name))
		case .Not_Legal:
			append(&illegal, fmt.aprintf("%s (not legal in Commander)", e.face.name))
		}
	}
	if len(illegal) > 0 do append(&c.reasons, summarize_cards("Not Commander legal", sorted_set(illegal)))
	if len(outside) > 0 do append(&c.reasons, summarize_cards("Cards outside commander's color identity", sorted_set(outside)))
	c.compatible = len(c.reasons) == 0
	return c
}

// The selected format's verdict: true or false with reasons, or no opinion (has = false) for a format the Odin
// engine doesn't check yet.
@(private = "file")
check_selected :: proc(r: Deck_Request, unknown: []string, bo3_ready: bool) -> (c: Check, has: bool) {
	if r.selected_format == "" do return {}, false
	entry, known := format_entry(r.selected_format)
	if !known do return {}, false
	label := json.get_or_null(entry, "label").text
	if r.selected_format == "Commander" {
		c = check_commander(r, unknown)
	} else if slice.contains(CONSTRUCTED_FORMATS[:], r.selected_format) {
		legality_key := json.get_or_null(entry, "legality_key")
		c = check_constructed(r, unknown, json.get_or_null(entry, "default_config"), legality_key.text, label)
	} else {
		return {}, false
	}
	// CR 407.3: when not playing for ante (no format here does), ante cards can't be in a deck or sideboard.
	ante := make([dynamic]string)
	for name in deck_cards(r) {
		e, ok := find_card(name)
		if !ok do continue
		text := strings.to_lower(e.face.oracle_text.? or_else "", context.temp_allocator)
		if strings.contains(text, "playing for ante") do append(&ante, e.face.name)
	}
	if len(ante) > 0 {
		append(&c.reasons, summarize_cards("Can't be in a deck or sideboard unless the game is played for ante", sorted_set(ante)))
		c.compatible = false
	}
	// CR 100.4a: a best-of-three match needs a sideboard.
	if r.selected_match_type == "Bo3" && !bo3_ready {
		append(&c.reasons, "BO3 requires a sideboard")
		c.compatible = false
	}
	return c, true
}

@(private = "file")
write_check :: proc(b: ^strings.Builder, c: Check) {
	fmt.sbprintf(b, `{{"compatible":%v,"reasons":`, c.compatible)
	write_strings(b, c.reasons[:])
	strings.write_byte(b, '}')
}

write_strings :: proc(b: ^strings.Builder, list: []string) {
	strings.write_byte(b, '[')
	for s, i in list {
		if i > 0 do strings.write_byte(b, ',')
		json.write_string(b, s)
	}
	strings.write_byte(b, ']')
}

COLOR_LETTERS := [types.ManaColor]string {
	.White = "W",
	.Blue  = "U",
	.Black = "B",
	.Red   = "R",
	.Green = "G",
}

// evaluate_deck_compatibility_js(request): the deck's checks, shaped as the Rust engine's DeckCompatibilityResult.
evaluate_deck_compatibility :: proc(b: ^strings.Builder, request: json.Value) {
	if len(cards) == 0 {
		reply_err(b, "Card database not loaded. Call load_card_database first.")
		return
	}
	r := decode_request(request)
	all := deck_cards(r)

	unknown_list := make([dynamic]string)
	for list in ([?][]string{all[:], r.planar_deck, r.scheme_deck}) {
		for name in list do if _, ok := find_card(name); !ok do append(&unknown_list, name)
	}
	unknown := sorted_set(unknown_list)
	// CR 100.4a / CR 903.5e: a deck is ready for best-of-three with a sideboard, and a Commander deck never is.
	bo3_ready := len(r.sideboard) > 0 && len(r.commander) == 0

	// The deck's color identity (CR 903.4), and the main deck's cards by color.
	identity: bit_set[types.ManaColor]
	for name in all do if e, ok := find_card(name); ok do for color in e.face.color_identity do identity += {color}
	per_color: [types.ManaColor]int
	for name in r.main_deck do if e, ok := find_card(name); ok do for color in e.face.color_identity do per_color[color] += 1
	color_total := 0
	for n in per_color do color_total += n

	selected, has_selected := check_selected(r, unknown, bo3_ready)
	summary := r.summary_only && r.selected_format != ""
	// The summary (the deck lists' quick check) stops at the first failed rule, as the Rust engine's does; a
	// best-of-three without a sideboard is reported after it.
	if summary && len(selected.reasons) > 1 {
		bo3 := selected.reasons[len(selected.reasons) - 1] == "BO3 requires a sideboard"
		resize(&selected.reasons, 1)
		if bo3 && selected.reasons[0] != "BO3 requires a sideboard" do append(&selected.reasons, "BO3 requires a sideboard")
	}

	standard, commander: Check
	if summary {
		standard.compatible = has_selected && selected.compatible && r.selected_format == "Standard"
		commander.compatible = has_selected && selected.compatible && r.selected_format == "Commander"
	} else {
		standard_entry, _ := format_entry("Standard")
		standard = check_constructed(r, unknown, json.get_or_null(standard_entry, "default_config"), "standard", "Standard")
		commander = check_commander(r, unknown)
	}

	strings.write_string(b, `{"ok":{"standard":`)
	write_check(b, standard if !summary else Check{compatible = standard.compatible})
	strings.write_string(b, `,"commander":`)
	write_check(b, commander if !summary else Check{compatible = commander.compatible})
	fmt.sbprintf(b, `,"bo3_ready":%v,"unknown_cards":`, bo3_ready)
	write_strings(b, unknown)
	strings.write_string(b, `,"selected_format_compatible":`)
	if has_selected do fmt.sbprintf(b, "%v", selected.compatible)
	else do strings.write_string(b, "null")
	strings.write_string(b, `,"selected_format_reasons":`)
	write_strings(b, selected.reasons[:] if has_selected else nil)
	strings.write_string(b, `,"color_identity":[`)
	first := true
	for color in types.ManaColor do if color in identity {
		if !first do strings.write_byte(b, ',')
		fmt.sbprintf(b, `"%s"`, COLOR_LETTERS[color])
		first = false
	}
	strings.write_string(b, `],"color_distribution":[`)
	first = true
	for color in types.ManaColor do if per_color[color] > 0 {
		if !first do strings.write_byte(b, ',')
		pct := f64(per_color[color]) / f64(color_total) * 100
		fmt.sbprintf(b, `{{"color":"%v","count":%d,"percentage":%v,"display_percentage":%d}}`, color, per_color[color], pct, int(pct + 0.5))
		first = false
	}
	strings.write_string(b, `],"format_legality":{`)
	if !summary {
		unique := sorted_set(all)
		for key, i in LEGALITY_KEYS {
			// Legal only if every card is; banned if any card is banned.
			worst := Legality.Legal
			for name in unique {
				switch legality_of(name, key) {
				case .Legal, .Restricted:
				case .Not_Legal:
					if worst == .Legal do worst = .Not_Legal
				case .Banned:
					worst = .Banned
				}
			}
			if i > 0 do strings.write_byte(b, ',')
			fmt.sbprintf(b, `"%s":"%s"`, key, worst == .Legal ? "legal" : worst == .Banned ? "banned" : "not_legal")
		}
	}
	strings.write_string(b, "}}}")
}
