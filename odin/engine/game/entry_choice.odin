package game

// "As this enters, choose a color / a creature type / ..." (CR 614.12, 614.1c): a replacement effect that makes a
// choice as the permanent enters; the choice is kept on the permanent (its chosen attributes) for its other
// abilities to read ("of the chosen color", "creatures of the chosen type"). CR 400.7: a new object, after a zone
// change, has no chosen attributes.

import "core:slice"
import "core:strings"
import types "../types"

// The choice an entry replacement asks for, when it's one this engine can ask.
entry_choice :: proc(r: types.ReplacementDefinition) -> (types.ChoiceType, bool) {
	if _, mandatory := r.mode.(types.ReplacementMode_Mandatory); !mandatory do return nil, false
	if r.condition != nil || r.execute == nil || r.execute.effect == nil || r.execute.sub_ability != nil || r.execute.condition != nil do return nil, false
	if dest, has := r.destination_zone.?; !has || dest != .Battlefield do return nil, false
	if f, has := r.valid_card.?; !has || !is_self(f) do return nil, false
	c, is_choose := r.execute.effect^.(types.Effect_Choose)
	if !is_choose do return nil, false
	if c.chooser != nil {
		if _, you := c.chooser.(types.ControllerRef_You); !you do return nil, false
	}
	#partial switch x in c.choice_type {
	case types.ChoiceType_Color, types.ChoiceType_CreatureType, types.ChoiceType_BasicLandType, types.ChoiceType_Labeled:
		return c.choice_type, true
	case types.ChoiceType_CardType:
		return c.choice_type, len(x.options) > 0
	}
	return nil, false
}

entry_choice_of :: proc(o: ^types.GameObject) -> (types.ChoiceType, bool) {
	if o.replacement_definitions == nil do return nil, false
	for r in (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^ do if c, ok := entry_choice(r); ok do return c, true
	return nil, false
}

// The names offered for a choice, in the order a player sees them.
choice_options :: proc(c: types.ChoiceType) -> [dynamic]string {
	out := make([dynamic]string)
	#partial switch x in c {
	case types.ChoiceType_Color:
		// CR 105.1: white, blue, black, red and green; "a color other than red" leaves one out.
		for color in types.ManaColor do if !slice.contains(x.excluded[:], color) do append(&out, color_word(color))
	case types.ChoiceType_CreatureType:
		if len(x.options) > 0 {
			for name in x.options do append(&out, name)
		} else {
			for name in CREATURE_TYPES do append(&out, name) // CR 205.3m
		}
	case types.ChoiceType_BasicLandType:
		for t in types.BasicLandType do append(&out, basic_land_word(t)) // CR 305.6
	case types.ChoiceType_Labeled:
		for name in x.options do append(&out, name)
	case types.ChoiceType_CardType:
		for t in x.options do append(&out, core_type_word(t))
	}
	return out
}

color_word :: proc(c: types.ManaColor) -> string {
	switch c {
	case .White: return "White"
	case .Blue: return "Blue"
	case .Black: return "Black"
	case .Red: return "Red"
	case .Green: return "Green"
	}
	return ""
}

basic_land_word :: proc(t: types.BasicLandType) -> string {
	switch t {
	case .Plains: return "Plains"
	case .Island: return "Island"
	case .Swamp: return "Swamp"
	case .Mountain: return "Mountain"
	case .Forest: return "Forest"
	}
	return ""
}

core_type_word :: proc(t: types.CoreType) -> string {
	#partial switch t {
	case .Artifact: return "Artifact"
	case .Creature: return "Creature"
	case .Enchantment: return "Enchantment"
	case .Instant: return "Instant"
	case .Land: return "Land"
	case .Planeswalker: return "Planeswalker"
	case .Sorcery: return "Sorcery"
	case .Battle: return "Battle"
	case .Kindred: return "Kindred"
	}
	return ""
}

// The chosen attribute an answer names.
chosen_attribute :: proc(c: types.ChoiceType, answer: string) -> (types.ChosenAttribute, bool) {
	#partial switch x in c {
	case types.ChoiceType_Color:
		for color in types.ManaColor do if color_word(color) == answer && !slice.contains(x.excluded[:], color) do return types.ChosenAttribute_Color{color}, true
	case types.ChoiceType_CreatureType:
		for name in choice_options(c) do if name == answer do return types.ChosenAttribute_CreatureType{strings.clone(answer)}, true
	case types.ChoiceType_BasicLandType:
		for t in types.BasicLandType do if basic_land_word(t) == answer do return types.ChosenAttribute_BasicLandType{t}, true
	case types.ChoiceType_Labeled:
		for name in x.options do if name == answer do return types.ChosenAttribute_Label{strings.clone(answer)}, true
	case types.ChoiceType_CardType:
		for t in x.options do if core_type_word(t) == answer do return types.ChosenAttribute_CardType{t}, true
	}
	return nil, false
}

// CR 614.12: its controller chooses as it enters; asked before the next player would receive priority, like the
// other entry choices (replacements.odin), nothing being done with it in between.
ask_entry_name :: proc(g: ^Game, after: types.PlayerId) -> bool {
	s := &g.state
	for len(g.entry_names) > 0 {
		o := object(s, g.entry_names[0])
		c: types.ChoiceType
		ok := false
		if o != nil do c, ok = entry_choice_of(o)
		if !ok || o.zone != .Battlefield {
			ordered_remove(&g.entry_names, 0)
			continue
		}
		g.entry_after = after
		s.priority_player = o.controller
		s.waiting_for = types.WaitingFor_NamedChoice{player = o.controller, choice_type = c, options = choice_options(c), decision_subject_id = o.id}
		return true
	}
	return false
}

answer_entry_name :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_NamedChoice, answer: string) -> bool {
	s := &g.state
	if p != w.player do return false
	id, has := w.decision_subject_id.?
	if !has do return false
	o := object(s, id)
	if o == nil do return false
	attr, ok := chosen_attribute(w.choice_type, answer)
	if !ok do return false
	append(&o.chosen_attributes, attr)
	after := s.active_player // a restored game: the prompt alone, priority to the active player
	if len(g.entry_names) > 0 && g.entry_names[0] == id {
		ordered_remove(&g.entry_names, 0)
		after = g.entry_after
	}
	s.waiting_for = nil
	apply_continuous_effects(g)
	give_priority(g, after)
	return true
}

chosen_color :: proc(o: ^types.GameObject) -> (types.ManaColor, bool) {
	if o == nil do return {}, false
	for a in o.chosen_attributes do if c, ok := a.(types.ChosenAttribute_Color); ok do return c._0, true
	return {}, false
}

chosen_creature_type :: proc(o: ^types.GameObject) -> (string, bool) {
	if o == nil do return "", false
	for a in o.chosen_attributes do if c, ok := a.(types.ChosenAttribute_CreatureType); ok do return c._0, true
	return "", false
}

chosen_label :: proc(o: ^types.GameObject) -> (string, bool) {
	if o == nil do return "", false
	for a in o.chosen_attributes do if c, ok := a.(types.ChosenAttribute_Label); ok do return c._0, true
	return "", false
}

chosen_card_type :: proc(o: ^types.GameObject) -> (types.CoreType, bool) {
	if o == nil do return {}, false
	for a in o.chosen_attributes do if c, ok := a.(types.ChosenAttribute_CardType); ok do return c._0, true
	return {}, false
}

// The AI's answer: the color its permanents and hand show most, the creature type its creatures share most, else
// the first option.
ai_entry_name :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_NamedChoice) -> string {
	s := &g.state
	if len(w.options) == 0 do return ""
	best, best_n := w.options[0], -1
	for name in w.options {
		n := 0
		for id in ids_of(player(s, p).hand) do n += name_weight(object(s, id), w.choice_type, name)
		for o in permanents_of(s, p) do n += name_weight(o, w.choice_type, name)
		if n > best_n do best, best_n = name, n
	}
	return best
}

@(private = "file")
name_weight :: proc(o: ^types.GameObject, c: types.ChoiceType, name: string) -> int {
	#partial switch _ in c {
	case types.ChoiceType_Color:
		for color in types.ManaColor do if color_word(color) == name && has_color(o, color) do return 1
	case types.ChoiceType_CreatureType:
		if is_type(o, .Creature) && has_subtype(o, name) do return 1
	}
	return 0
}

// "As this land enters, you may reveal a Goblin card from your hand. If you don't, it enters tapped" (CR 614.12,
// 701.20a): the cards that may be revealed.
entry_reveal :: proc(r: types.ReplacementDefinition) -> (types.TargetFilter, bool) {
	if _, mandatory := r.mode.(types.ReplacementMode_Mandatory); !mandatory do return nil, false
	if r.condition != nil || r.execute == nil || r.execute.effect == nil || r.execute.sub_ability != nil || r.execute.condition != nil do return nil, false
	if dest, has := r.destination_zone.?; !has || dest != .Battlefield do return nil, false
	if f, has := r.valid_card.?; !has || !is_self(f) do return nil, false
	rv, is_reveal := r.execute.effect^.(types.Effect_RevealFromHand)
	if !is_reveal || rv.on_decline == nil do return nil, false
	d := rv.on_decline
	if d.sub_ability != nil || d.condition != nil || d.effect == nil do return nil, false
	tap, is_tap := d.effect^.(types.Effect_SetTapState)
	if !is_tap || !is_self(tap.target) || tap.state != .Tap || tap.scope != .Single do return nil, false
	// "A Goblin card", "an Island or Swamp card".
	#partial switch x in rv.filter {
	case types.TargetFilter_Typed:
		return rv.filter, typed_supported(x._0)
	case types.TargetFilter_Or:
		for y in x.filters {
			typed, ok := y.(types.TargetFilter_Typed)
			if !ok || !typed_supported(typed._0) do return nil, false
		}
		return rv.filter, len(x.filters) > 0
	}
	return nil, false
}

// Whether a card in its owner's hand fits the reveal's description.
@(private = "file")
reveal_fits :: proc(s: ^types.GameState, card: ^types.GameObject, f: types.TargetFilter, p: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		plain := x._0
		plain.controller = nil // cards in hand: the player's own
		return object_matches(s, card, plain, p, source)
	case types.TargetFilter_Or:
		for y in x.filters do if reveal_fits(s, card, y, p, source) do return true
	}
	return false
}

entry_reveal_of :: proc(o: ^types.GameObject) -> (types.TargetFilter, bool) {
	if o.replacement_definitions == nil do return nil, false
	for r in (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^ do if f, ok := entry_reveal(r); ok do return f, true
	return nil, false
}

// Asked before the next player gets priority, like the other entry choices; with no such card in hand it simply
// enters tapped.
ask_entry_reveal :: proc(g: ^Game, after: types.PlayerId) -> bool {
	s := &g.state
	for len(g.entry_reveals) > 0 {
		o := object(s, g.entry_reveals[0])
		f: types.TargetFilter
		ok := false
		if o != nil do f, ok = entry_reveal_of(o)
		if !ok || o.zone != .Battlefield {
			ordered_remove(&g.entry_reveals, 0)
			continue
		}
		cards := make([dynamic]types.ObjectId)
		for id in ids_of(player(s, o.controller).hand) do if reveal_fits(s, object(s, id), f, o.controller, o.id) do append(&cards, id)
		if len(cards) == 0 {
			o.tapped = true
			ordered_remove(&g.entry_reveals, 0)
			continue
		}
		g.entry_after = after
		s.priority_player = o.controller
		s.waiting_for = types.WaitingFor_RevealChoice{player = o.controller, cards = cards, filter = f, optional = true, cardinality = types.ObjectSelectionCardinality_Exactly{count = 1}}
		return true
	}
	return false
}

// The answer: one of the cards (revealed; it enters untapped), or none (it enters tapped).
answer_entry_reveal :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_RevealChoice, chosen: []types.ObjectId) -> bool {
	s := &g.state
	if p != w.player || len(chosen) > 1 || len(g.entry_reveals) == 0 do return false
	for id in chosen do if !slice.contains(w.cards[:], id) do return false
	o := object(s, g.entry_reveals[0])
	if o == nil do return false
	if len(chosen) == 0 do o.tapped = true
	ordered_remove(&g.entry_reveals, 0)
	s.waiting_for = nil
	give_priority(g, g.entry_after)
	return true
}
