// Effects that move objects between zones (CR 400.6, 701.4 bounce-style returns, 701.13 exile): "exile target
// creature", "return target creature to its owner's hand", "return target creature card from your graveyard to
// your hand / the battlefield", and the same for "this".
package game

import "core:slice"
import types "../types"

// A target in a graveyard: "target creature card in your graveyard" (CR 115.1, 400.3).
graveyard_filter :: proc(f: types.TargetFilter) -> (types.TypedFilter, bool) {
	t, typed := f.(types.TargetFilter_Typed)
	if !typed do return {}, false
	in_graveyard := false
	for p in t._0.properties {
		#partial switch x in p {
		case types.FilterProp_InZone:
			if x.zone != .Graveyard do return {}, false
			in_graveyard = true
		case types.FilterProp_Owned:
			#partial switch _ in x.controller {
			case types.ControllerRef_You, types.ControllerRef_Opponent:
			case:
				return {}, false
			}
		case:
			if !property_supported(p) do return {}, false
		}
	}
	for tf in t._0.type_filters do if !type_filter_supported(tf) do return {}, false
	return t._0, in_graveyard
}

change_zone_supported :: proc(x: types.Effect_ChangeZone) -> bool {
	if _, controller := x.actor.(types.LibraryInstructionActor_Controller); x.actor != nil && !controller do return false
	if x.owner_library || x.enter_transformed || x.enter_tapped == .Untapped do return false
	if under, has := x.enters_under.?; has {
		// "Under your control": the controller of the ability, as the engine already puts it (CR 110.2).
		if _, you := under.(types.ControllerRef_You); !you do return false
	}
	if among, is_among := x.target.(types.TargetFilter_TrackedSetFiltered); is_among do return among_moved_supported(x, among)
	if x.up_to || len(x.conditional_enter_with_counters) > 0 do return false
	if x.enters_attacking && x.destination != .Battlefield do return false
	// "Return it to the battlefield with a +1/+1 counter on it" (CR 122.6): counters it enters with.
	for c in x.enter_with_counters {
		if x.destination != .Battlefield || !counter_kind_supported(c._0) || !quantity_supported(c._1) || quantity_reads_target(c._1) do return false
	}
	if x.face_down_profile != nil || x.enters_modified_if != nil do return false
	#partial switch x.destination {
	case .Hand, .Battlefield, .Graveyard, .Exile:
	case:
		return false
	}
	origin, has_origin := x.origin.?
	if hand_filter, from_hand := hand_choice(x); from_hand {
		// An Aura put onto the battlefield from the hand needs what it enchants chosen as it enters (CR 303.4f),
		// which the hand choice doesn't ask yet.
		return x.destination != .Hand && (x.destination != .Battlefield || !may_match_aura(types.TargetFilter_Typed{hand_filter}))
	}
	if is_self(x.target) do return true
	if has_origin && origin == .Library && is_any(x.target) {
		// The found cards. An Aura put onto the battlefield needs what it enchants chosen (CR 303.4f), which a search
		// doesn't do yet: a search that could find one (a Rebel search can find Bound in Silence) is refused.
		if x.destination == .Library do return false
		if x.destination == .Battlefield && previous_instruction != nil {
			if search, is_search := previous_instruction^.(types.Effect_SearchLibrary); is_search && copy_may_be_aura(search.filter) do return false
		}
		return true
	}
	// "Return it to the battlefield": the earlier instruction's target, wherever that put it (CR 608.2c), or a delayed
	// ability's "it" (CR 603.7c). An Aura returned has what it enchants chosen as it enters (do_change_zone, CR
	// 303.4f). Onto the battlefield only straight after the instruction that targeted it: after another one (Koya's
	// "if you don't, return that card", which the data puts after its delayed ability instead of in it), "it" isn't
	// what the text means.
	if _, parent := x.target.(types.TargetFilter_ParentTarget); parent {
		if x.destination != .Battlefield || previous_instruction == nil do return true
		_, targeted := effect_target(previous_instruction^)
		return targeted
	}
	// "Exile it, then return that card to the battlefield": what the instruction before moved (CR 400.7j), after one
	// that moves cards.
	if _, tracked := x.target.(types.TargetFilter_TrackedSet); tracked {
		if previous_instruction == nil || !moves_cards(previous_instruction^) do return false
		return instruction_before_previous == nil || !moves_cards(instruction_before_previous^)
	}
	if _, from_graveyard := graveyard_filter(x.target); from_graveyard do return !has_origin || origin == .Graveyard
	if either, is_or := x.target.(types.TargetFilter_Or); is_or && has_origin && origin == .Graveyard {
		// "Target instant or sorcery card from your graveyard".
		for f in either.filters do if _, ok := graveyard_filter(f); !ok do return false
		return len(either.filters) > 0
	}
	// "When enchanted creature dies, return that card to the battlefield": the new object the trigger event's card
	// became in the public zone it moved to (CR 400.7e), while it's that object (event_reference).
	if _, event := x.target.(types.TargetFilter_TriggeringSource); event && x.destination == .Battlefield {
		return event_object_defined && (!has_origin || origin == .Graveyard || origin == .Exile)
	}
	// "Whenever you discard a card, exile that card from your graveyard": the event's card, as the new object it
	// became in the graveyard, while it's that object (CR 400.7, event_reference) and still there (do_change_zone).
	if _, event := x.target.(types.TargetFilter_TriggeringSource); event && x.destination == .Exile && has_origin && origin == .Graveyard {
		return event_object_defined
	}
	// A permanent on the battlefield.
	return (!has_origin || origin == .Battlefield) && x.destination != .Battlefield && filter_supported(x.target) && !may_name_player(x.target)
}

// "Return it to the battlefield ... That creature is a Hero": after the trigger event's card is returned, it's a new
// object (CR 400.7) the event no longer names, so "that creature" after the return isn't read yet.
after_event_card_returned_supported :: proc(a: types.AbilityDefinition) -> bool {
	if a.effect == nil || previous_instruction == nil do return true
	before, moved := previous_instruction^.(types.Effect_ChangeZone)
	if !moved || before.destination != .Battlefield do return true
	if _, event := before.target.(types.TargetFilter_TriggeringSource); !event do return true
	_, names_event := effect_target_filter(a.effect^).(types.TargetFilter_TriggeringSource)
	return !names_event
}

// "Mill three cards, then you may return a creature card from your graveyard to your hand": no "target", so the card
// is chosen as the instruction is carried out (CR 115.10a, 608.2d), after the mill, not as the ability is put on
// the stack (CR 601.2c, 603.3d). The card data marks such an ability with its choice timing; the instruction names
// a zone to choose from (CR 400.1) and no earlier object. Read that way: cards of the player's own hand (hand_choice)
// and graveyard (chosen_from_graveyard); other zones are refused rather than read as targets.
zone_choice_timing_supported :: proc(a: types.AbilityDefinition) -> bool {
	if a.effect == nil do return true
	x, moves := a.effect^.(types.Effect_ChangeZone)
	if !moves do return true
	if _, among := x.target.(types.TargetFilter_TrackedSetFiltered); among {
		// "Up to one ... from among them" is one card (start_among_moved_choice); more isn't read yet.
		m, multi := a.multi_target.?
		if !multi do return true
		most_q, has_max := m.max.?
		most, fixed := fixed_quantity(most_q)
		return has_max && fixed && most == 1
	}
	if a.target_choice_timing == .Stack do return true
	if _, from_hand := hand_choice(x); from_hand do return true
	if chosen_from_graveyard(x, a.target_choice_timing) do return graveyard_choice_supported(x, a)
	#partial switch _ in x.target {
	case types.TargetFilter_Typed, types.TargetFilter_Or, types.TargetFilter_And:
		// "Exile enchanted creature" names no zone to choose from: not a choice.
		_, has_origin := x.origin.?
		return !has_origin && !names_a_zone(x.target)
	}
	return true // "this", "it", "that card": no choice
}

// "Return a creature card from your graveyard to your hand", "you may exile two cards from your graveyard": cards of
// the controller's own graveyard chosen as the instruction is carried out, not targets (zone_choice_timing_supported).
chosen_from_graveyard :: proc(x: types.Effect_ChangeZone, timing: types.TargetChoiceTiming) -> bool {
	if timing != .Resolution do return false
	if origin, has := x.origin.?; !has || origin != .Graveyard do return false
	parts: []types.TargetFilter
	#partial switch y in x.target {
	case types.TargetFilter_Typed:
		parts = []types.TargetFilter{x.target}
	case types.TargetFilter_Or:
		parts = y.filters[:]
	case:
		return false
	}
	for p in parts {
		typed, in_graveyard := graveyard_filter(p)
		if !in_graveyard || !own_graveyard(typed) do return false
	}
	return len(parts) > 0
}

// A graveyard filter naming the chooser's own graveyard ("from your graveyard"): its controller or owner is "you".
@(private = "file")
own_graveyard :: proc(f: types.TypedFilter) -> bool {
	if c, has := f.controller.?; has {
		_, you := c.(types.ControllerRef_You)
		return you
	}
	for p in f.properties do if owned, ok := p.(types.FilterProp_Owned); ok {
		_, you := owned.controller.(types.ControllerRef_You)
		return you
	}
	return false
}

// What a choice from the graveyard can carry out: one card, or a fixed number ("two cards", "up to two"), chosen by
// the player or one at random (CR 608.2d); to the hand, exile or the battlefield (as it is, under its owner's
// control, or tapped). An Aura put onto the battlefield needs what it enchants chosen (CR 303.4f): not yet.
@(private = "file")
graveyard_choice_supported :: proc(x: types.Effect_ChangeZone, a: types.AbilityDefinition) -> bool {
	if x.up_to || len(x.enter_with_counters) > 0 || len(x.conditional_enter_with_counters) > 0 || x.enters_attacking do return false
	if x.enter_transformed || x.face_down_profile != nil || x.enters_modified_if != nil || x.owner_library do return false
	if under, has := x.enters_under.?; has {
		if _, you := under.(types.ControllerRef_You); !you do return false
	}
	#partial switch x.destination {
	case .Hand, .Exile:
	case .Battlefield:
		if may_match_aura(x.target) do return false
	case:
		return false
	}
	if m, multi := a.multi_target.?; multi {
		least, fixed_min := fixed_quantity(m.min)
		most_q, has_max := m.max.?
		if !fixed_min || !has_max do return false
		most, fixed_max := fixed_quantity(most_q)
		if !fixed_max || least < 0 || most < max(least, 1) || most > 10 do return false
		if a.target_selection_mode == .Random do return false // "N cards at random": not yet
	}
	return true
}

// The cards of the controller's graveyard an instruction can choose from as it resolves.
@(private = "file")
graveyard_choices :: proc(s: ^types.GameState, x: types.Effect_ChangeZone, controller: types.PlayerId, source: types.ObjectId) -> [dynamic]types.ObjectId {
	out := make([dynamic]types.ObjectId, context.temp_allocator)
	parts: []types.TargetFilter = {x.target}
	if either, is_or := x.target.(types.TargetFilter_Or); is_or do parts = either.filters[:]
	for id in ids_of(player(s, controller).graveyard) {
		o := object(s, id)
		for p in parts {
			typed, _ := graveyard_filter(p)
			typed.controller = nil // the graveyard is the controller's own (chosen_from_graveyard)
			if object_matches(s, o, typed, controller, source) {
				append(&out, id)
				break
			}
		}
	}
	return out
}

// How many cards the instruction moves: exactly one, or the fixed range of "two cards" / "up to two" (the card data's
// multi_target), no more than there are (CR 609.3: as much as possible).
@(private = "file")
graveyard_choice_count :: proc(n: ^types.ResolvedAbility, eligible: int) -> (least, most: int) {
	least, most = 1, 1
	if m, multi := n.multi_target.?; multi {
		least, _ = fixed_quantity(m.min)
		if q, has := m.max.?; has do most, _ = fixed_quantity(q)
	}
	return min(least, eligible), min(most, eligible)
}

// Whether a "you may" choice from the graveyard can be made: enough cards to choose (CR 608.2d).
graveyard_choice_possible :: proc(g: ^Game, n: ^types.ResolvedAbility, controller: types.PlayerId, source: types.ObjectId) -> bool {
	x, zc := n.effect.(types.Effect_ChangeZone)
	if !zc || !chosen_from_graveyard(x, n.target_choice_timing) do return true
	eligible := len(graveyard_choices(&g.state, x, controller, source))
	least := 1
	if m, multi := n.multi_target.?; multi do least, _ = fixed_quantity(m.min)
	return eligible >= max(least, 1)
}

// Asks the player which cards of their graveyard to move (or picks one at random); false when there's nothing to ask.
start_graveyard_choice :: proc(g: ^Game, x: types.Effect_ChangeZone, n: ^types.ResolvedAbility, controller: types.PlayerId, source: types.ObjectId) -> bool {
	s := &g.state
	eligible := graveyard_choices(s, x, controller, source)
	least, most := graveyard_choice_count(n, len(eligible))
	if most == 0 do return false
	if n.target_selection_mode == .Random {
		// "A creature card at random": one of them, by the game's seeded randomness.
		chosen := eligible[choose_index(g, len(eligible))]
		move_chosen_cards(g, x.destination, controller, x.enter_tapped, false, {chosen})
		return false
	}
	if least == len(eligible) && most == len(eligible) {
		move_chosen_cards(g, x.destination, controller, x.enter_tapped, false, eligible[:]) // no choice left
		return false
	}
	cards := make([dynamic]types.ObjectId)
	append(&cards, ..eligible[:])
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_EffectZoneChoice{player = controller, cards = cards, count = most, min_count = least, up_to = least < most, source_id = source, effect_kind = .ChangeZone, zone = .Graveyard, destination = x.destination, enter_tapped = x.enter_tapped}
	return true
}

// The target an instruction of an ability takes (as effect_target), none for cards chosen from a graveyard or
// permanents chosen as it resolves (resolution_choice.odin): the ability's choice timing tells the two apart.
instruction_target :: proc(e: types.Effect, timing: types.TargetChoiceTiming) -> (types.TargetFilter, bool) {
	if x, zc := e.(types.Effect_ChangeZone); zc && chosen_from_graveyard(x, timing) do return nil, false
	if chosen_as_it_resolves(e, timing) do return nil, false
	return effect_target(e)
}

// "Mill three cards. You may put a land card from among them into your hand", "target player discards two cards. Put
// up to one land card discarded this way onto the battlefield tapped under your control": a card the instruction
// before put into a graveyard, chosen as this one is carried out. The effect can find it there (CR 701.17c, 400.7j).
// After two instructions that both moved cards, "them" would be both sets: not read.
among_moved_supported :: proc(x: types.Effect_ChangeZone, among: types.TargetFilter_TrackedSetFiltered) -> bool {
	if previous_instruction == nil || among.filter == nil do return false
	if instruction_before_previous != nil && moves_counted_cards(instruction_before_previous^) do return false
	cause, has_cause := among.caused_by.?
	#partial switch y in previous_instruction^ {
	case types.Effect_Mill:
		if y.destination != .Graveyard || (has_cause && cause != .Milled) do return false
	case types.Effect_Discard:
		if has_cause && cause != .Discarded do return false
	case:
		return false
	}
	if len(x.conditional_enter_with_counters) > 0 || len(x.enter_with_counters) > 0 || x.enters_attacking || x.face_down_profile != nil || x.enters_modified_if != nil do return false
	if origin, has := x.origin.?; has && origin != .Graveyard do return false
	#partial switch x.destination {
	case .Hand:
	case .Battlefield:
		if may_match_aura(among.filter^) do return false // CR 303.4f: not yet
	case:
		return false
	}
	return among_filter_supported(among.filter^)
}

// "A land card", "a Hero or enchantment card", "a noncreature, nonland card": what kind of card, nothing about zones
// or controllers (the cards are the ones just moved).
among_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch y in f {
	case types.TargetFilter_Typed:
		return y._0.controller == nil && !names_a_zone(f) && typed_supported(y._0)
	case types.TargetFilter_Or:
		for z in y.filters do if !among_filter_supported(z) do return false
		return len(y.filters) > 0
	}
	return false
}

// The cards the instruction before moved, still in the graveyard it put them in, that fit the filter.
among_moved :: proc(g: ^Game, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId) -> [dynamic]types.ObjectId {
	s := &g.state
	out := make([dynamic]types.ObjectId, context.temp_allocator)
	for id in g.resolution.moved {
		o := object(s, id)
		if o != nil && o.zone == .Graveyard && mass_filter_matches(s, o, f, controller, source) do append(&out, id)
	}
	return out
}

// Asks for the card to put into the hand (or onto the battlefield) from among those moved; false when there's
// nothing to ask. "If you don't" after it reads whether one was put (CR 608.2c).
start_among_moved_choice :: proc(g: ^Game, x: types.Effect_ChangeZone, among: types.TargetFilter_TrackedSetFiltered, controller: types.PlayerId, source: types.ObjectId) -> bool {
	s := &g.state
	eligible := among_moved(g, among.filter^, controller, source)
	g.resolution.performed = false
	if len(eligible) == 0 do return false
	least := 0 if x.up_to else 1
	if least == 1 && len(eligible) == 1 {
		move_chosen_cards(g, x.destination, controller, x.enter_tapped, false, eligible[:])
		g.resolution.performed = true
		return false
	}
	cards := make([dynamic]types.ObjectId)
	append(&cards, ..eligible[:])
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_EffectZoneChoice{player = controller, cards = cards, count = 1, min_count = least, up_to = least == 0, source_id = source, effect_kind = .ChangeZone, zone = .Graveyard, destination = x.destination, enter_tapped = x.enter_tapped}
	return true
}

// Whether a filter says which zone its objects are in ("a creature card in your graveyard").
@(private = "file")
names_a_zone :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		for p in x._0.properties {
			#partial switch _ in p {
			case types.FilterProp_InZone, types.FilterProp_InAnyZone:
				return true
			}
		}
	case types.TargetFilter_Or:
		for y in x.filters do if names_a_zone(y) do return true
	case types.TargetFilter_And:
		for y in x.filters do if names_a_zone(y) do return true
	}
	return false
}

bounce_supported :: proc(x: types.Effect_Bounce) -> bool {
	if d, has := x.destination.?; has && d != .Hand do return false
	if is_self(x.target) do return true // "return this to its owner's hand"
	if x.selection == .Targeted do return filter_supported(x.target) && !may_name_player(x.target)
	// "Return a creature you control to its owner's hand": chosen as it resolves (CR 608.2d), from the player's own.
	typed, ok := x.target.(types.TargetFilter_Typed)
	if !ok || !typed_supported(typed._0) do return false
	c, has := typed._0.controller.?
	_, you := c.(types.ControllerRef_You)
	return has && you
}

// Returns true while the player chooses.
do_bounce :: proc(g: ^Game, x: types.Effect_Bounce, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> bool {
	s := &g.state
	if is_self(x.target) {
		// CR 400.7: only while it's the same object, from the battlefield or the graveyard it went to.
		if o := same_source(g, source); o != nil && (o.zone == .Battlefield || o.zone == .Graveyard) do move_object(g, o.id, .Hand)
		return false
	}
	if x.selection == .Targeted {
		if id, ok := target_object(target); ok && object(s, id).zone == .Battlefield do move_object(g, id, .Hand)
		return false
	}
	typed := x.target.(types.TargetFilter_Typed)._0
	eligible: [dynamic]types.ObjectId
	for o in permanents_of(s, controller) do if object_matches(s, o, typed, controller, source) do append(&eligible, o.id)
	if len(eligible) <= 1 {
		for id in eligible do move_object(g, id, .Hand)
		return false
	}
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_EffectZoneChoice{player = controller, cards = eligible, count = 1, min_count = 1, source_id = source, effect_kind = .Bounce, zone = .Battlefield, destination = .Hand}
	return true
}

answer_bounce :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_EffectZoneChoice, chosen: []types.ObjectId) -> bool {
	if !g.resolution.active || len(chosen) != w.count || has_duplicates(chosen) do return false
	for id in chosen do if !slice.contains(w.cards[:], id) do return false
	together := begin_together() // at the same time (CR 603.2c)
	for id in chosen do move_object(g, id, .Hand)
	end_together(together)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// Graveyard cards matching a filter, as targets for the player choosing.
// `source` is left out: a spell cast from a graveyard (flashback) can't target itself (CR 115.5).
graveyard_targets :: proc(s: ^types.GameState, f: types.TypedFilter, chooser: types.PlayerId, source: types.ObjectId, out: ^[dynamic]types.TargetRef) {
	for p in s.players {
		owned_ok := true
		for prop in f.properties do if owned, ok := prop.(types.FilterProp_Owned); ok {
			#partial switch _ in owned.controller {
			case types.ControllerRef_You:
				owned_ok = p.id == chooser
			case types.ControllerRef_Opponent:
				owned_ok = p.id != chooser
			}
		}
		if c, has := f.controller.?; has {
			#partial switch _ in c {
			case types.ControllerRef_You:
				owned_ok = owned_ok && p.id == chooser
			case types.ControllerRef_Opponent:
				owned_ok = owned_ok && p.id != chooser
			}
		}
		if !owned_ok do continue
		for id in ids_of(p.graveyard) {
			if id == source do continue
			o := object(s, id)
			plain := f
			plain.controller = nil // a card's owner was checked above; in a graveyard it has no controller as such
			if object_matches(s, o, plain, chooser, 0) do append(out, types.TargetRef_Object{id})
		}
	}
}

// A card's types outside the battlefield; "permanent card" means any card that isn't an instant or sorcery.
card_matches_type :: proc(o: ^types.GameObject, t: types.TypeFilter) -> bool {
	if _, permanent := t.(types.TypeFilter_Permanent); permanent do return is_permanent_card(o)
	return matches_type(o, t)
}

// "Put a land card from your hand onto the battlefield": a card the player chooses from their own hand as the
// instruction is carried out, not a target (CR 115.10a: only what the text calls "target" is one; CR 608.2d).
hand_choice :: proc(x: types.Effect_ChangeZone) -> (types.TypedFilter, bool) {
	origin, has := x.origin.?
	if !has || origin != .Hand do return {}, false
	t, typed := x.target.(types.TargetFilter_Typed)
	if !typed do return {}, false
	in_hand := false
	for p in t._0.properties {
		#partial switch y in p {
		case types.FilterProp_InZone:
			if y.zone != .Hand do return {}, false
			in_hand = true
		case:
			if !property_supported(p) do return {}, false
		}
	}
	if c, has_c := t._0.controller.?; has_c {
		if _, you := c.(types.ControllerRef_You); !you do return {}, false
	}
	for tf in t._0.type_filters do if !type_filter_supported(tf) do return {}, false
	return t._0, in_hand
}

// Asks the player which card of their hand to move; false when there's none to choose (nothing happens).
start_hand_choice :: proc(g: ^Game, x: types.Effect_ChangeZone, controller: types.PlayerId, source: types.ObjectId) -> bool {
	s := &g.state
	f, _ := hand_choice(x)
	eligible: [dynamic]types.ObjectId
	for id in ids_of(player(s, controller).hand) do if object_matches(s, object(s, id), f, controller, source) do append(&eligible, id)
	if len(eligible) == 0 do return false
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_EffectZoneChoice{player = controller, cards = eligible, count = 1, min_count = 1, source_id = source, effect_kind = .ChangeZone, zone = .Hand, destination = x.destination, enter_tapped = x.enter_tapped, enters_attacking = x.enters_attacking}
	return true
}

// The chosen cards (from the chooser's hand or graveyard) go where the instruction says.
answer_zone_choice :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_EffectZoneChoice, chosen: []types.ObjectId) -> bool {
	if !g.resolution.active || len(chosen) < w.min_count || len(chosen) > w.count || has_duplicates(chosen) do return false
	for id in chosen do if !slice.contains(w.cards[:], id) do return false
	move_chosen_cards(g, w.destination.? or_else .Battlefield, p, w.enter_tapped, w.enters_attacking, chosen)
	g.resolution.performed = len(chosen) > 0 // "if you do / don't" after "you may put a card ..." (CR 608.2c)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// Moves cards a player chose from their own hand or graveyard, at the same time (CR 603.2c); onto the battlefield
// under that player's control (CR 110.2), tapped or attacking as the instruction says.
@(private = "file")
move_chosen_cards :: proc(g: ^Game, to: types.Zone, p: types.PlayerId, enter_tapped: types.EtbTapState, enters_attacking: bool, chosen: []types.ObjectId) {
	together := begin_together()
	for id in chosen {
		move_object(g, id, to)
		if to == .Battlefield {
			o := object(&g.state, id)
			o.controller = p
			if enter_tapped == .Tapped do o.tapped = true
			if enters_attacking do enter_attacking(&g.state, o)
		}
	}
	end_together(together)
}

// Moves the affected object; CR 400.7 makes it a new object in its new zone.
// True while a player chooses what an Aura it returns will enchant (answer_aura_host carries it out then).
do_change_zone :: proc(g: ^Game, x: types.Effect_ChangeZone, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> bool {
	s := &g.state
	// CR 610.3a-b: "exile ... until this leaves the battlefield" with this already gone: nothing moves.
	if exile_until_source_gone(g) do return false
	moving := make([dynamic]types.ObjectId, context.temp_allocator)
	if _, _, linked := linked_exile_target(x.target); linked {
		// "Return the exiled cards": those this object's other ability exiled (CR 607.2a, exile_links.odin).
		append(&moving, ..linked_cards_named(g, x.target, controller, source)[:])
	} else if _, tracked := x.target.(types.TargetFilter_TrackedSet); tracked {
		// CR 400.7j: an effect that moved an object to a public zone can find it there; one now in a hidden zone (or
		// a token that ceased to exist, CR 111.8) can't be found.
		for id in g.resolution.moved {
			o := object(s, id)
			if o == nil || o.zone == .Hand || o.zone == .Library do continue
			if origin, has := x.origin.?; has && o.zone != origin do continue
			append(&moving, id)
		}
	} else {
		moved: ^types.GameObject
		if id, ok := target_object(target); ok do moved = object(s, id)
		else if is_self(x.target) do moved = same_source(g, source)
		if moved == nil do return false
		if origin, has := x.origin.?; has && moved.zone != origin do return false // it left that zone: nothing to move
		if is_self(x.target) && moved.zone == .Stack {
			// "Exile Genesis Ultimatum": the spell stays on the stack until it has resolved, then goes to exile
			// instead of its owner's graveyard (CR 608.2n; spell_leaves_stack).
			if x.destination == .Exile && g.resolution.spell == moved.id do g.spell_exiles_itself = moved.id
			return false
		}
		if _, event := x.target.(types.TargetFilter_TriggeringSource); event {
			// The trigger event's card is found only in a public zone (CR 400.7e), and isn't put where it already is.
			if moved.zone == .Hand || moved.zone == .Library || moved.zone == .Stack || moved.zone == x.destination do return false
		}
		append(&moving, moved.id)
	}
	if x.destination == .Battlefield {
		under: Maybe(types.PlayerId) // the player it enters under: "under your control", else its owner (CR 110.2a)
		if _, has := x.enters_under.?; has do under = controller
		if choose_aura_hosts(g, moving[:], under, source) do return true
	}
	together := begin_together()
	for id in moving do change_zone_of(g, x, object(s, id), controller, source)
	end_together(together)
	clear(&g.resolution.aura_hosts)
	return false
}

// CR 303.4f: an Aura put onto the battlefield other than by resolving as an Aura spell, by an effect that doesn't say
// what it will enchant: the player it enters under chooses, as it enters, an object its enchant ability allows. CR
// 303.4g: with nothing it can enchant, it stays in its zone.
Aura_Host :: struct {
	aura: types.ObjectId,
	host: types.ObjectId, // 0: nothing it can enchant
}

// What an Aura could enchant as it enters under `who` (CR 303.4f): a permanent its enchant ability allows (read as
// that player's Aura), not one with protection from it (CR 702.16c). It isn't targeted (CR 115.10a).
aura_hosts_for :: proc(s: ^types.GameState, aura: ^types.GameObject, who: types.PlayerId) -> [dynamic]types.TargetRef {
	out := make([dynamic]types.TargetRef)
	f, _ := enchant_filter(aura)
	was := aura.controller
	aura.controller = who
	defer aura.controller = was
	for id in ids_of(s.battlefield) {
		h := object(s, id)
		if h.id != aura.id && aura_can_enchant(s, aura, f, h) && !protected_from(h, aura) do append(&out, types.TargetRef_Object{id})
	}
	return out
}

// Before an instruction moves cards onto the battlefield: a host for each Aura among them, asked of the player it
// enters under when there's a choice. True while asking.
@(private = "file")
choose_aura_hosts :: proc(g: ^Game, moving: []types.ObjectId, under: Maybe(types.PlayerId), source: types.ObjectId) -> bool {
	s := &g.state
	r := &g.resolution
	next: for id in moving {
		o := object(s, id)
		if o == nil || !is_aura(o) do continue
		for c in r.aura_hosts do if c.aura == id do continue next
		who := under.? or_else o.owner
		hosts := aura_hosts_for(s, o, who)
		if len(hosts) > 1 {
			s.priority_player = who
			s.waiting_for = types.WaitingFor_ReturnAsAuraTarget{player = who, source_id = source, returned_id = id, legal_targets = hosts}
			return true
		}
		host: types.ObjectId
		if len(hosts) == 1 do host, _ = target_object(hosts[0])
		append(&r.aura_hosts, Aura_Host{aura = id, host = host})
		delete(hosts)
	}
	return false
}

// The player's choice of what the returning Aura enchants; then the instruction is carried out (or asks again, for
// the next Aura).
answer_aura_host :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ReturnAsAuraTarget, choice: Maybe(types.TargetRef)) -> bool {
	// An Aura returning because what it was exiled "until" left (CR 610.3), outside any resolution (exile_links.odin).
	if g.asking_exile_return || !g.resolution.active do return answer_exile_return_host(g, p, w, choice)
	r := &g.resolution
	if !r.active || r.current == nil || p != w.player do return false
	t, chosen := choice.?
	if !chosen || !slice.contains(w.legal_targets[:], t) do return false
	x, moves := r.current.effect.(types.Effect_ChangeZone)
	if !moves do x, moves = linked_exile_return(r.current.effect) // "return the exiled cards"
	if !moves do return false
	host, _ := target_object(t)
	append(&r.aura_hosts, Aura_Host{aura = w.returned_id, host = host})
	g.state.waiting_for = nil
	// The card the instruction moves is the Aura asked about (a single object: its target, "it", "this", the trigger
	// event's card); "those cards" (TrackedSet) are found again from what the instruction before moved.
	if do_change_zone(g, x, r.controller, r.source, types.TargetRef_Object{w.returned_id}) do return true
	if continue_resolution(g) do after_resolution(g)
	return true
}

// Moves one object as the instruction says: to its destination, and onto the battlefield under the control, tapped
// and with the counters it names; an Aura attached as it enters to the host chosen for it (CR 303.4f), or left where
// it is with none (CR 303.4g).
@(private = "file")
change_zone_of :: proc(g: ^Game, x: types.Effect_ChangeZone, moved: ^types.GameObject, controller: types.PlayerId, source: types.ObjectId) {
	s := &g.state
	aura_host: ^types.GameObject
	if x.destination == .Battlefield && is_aura(moved) {
		for c in g.resolution.aura_hosts do if c.aura == moved.id && c.host != 0 do aura_host = object(s, c.host)
		if aura_host == nil do return
	}
	move_object(g, moved.id, x.destination)
	if aura_host != nil && moved.zone == .Battlefield do attach(s, moved, aura_host)
	if x.destination == .Battlefield {
		// CR 110.2a: under the control the instruction states: "under your control" (the card data's enters_under),
		// else its owner's ("return that card to the battlefield under its owner's control").
		if _, has := x.enters_under.?; has do moved.controller = controller
		if x.enter_tapped == .Tapped do moved.tapped = true
		// CR 122.6: it enters with the counters the instruction names, as it enters.
		for c in x.enter_with_counters {
			if moved.zone != .Battlefield do break
			n := quantity_value(s, c._1, controller, source, 0)
			if n > 0 do add_counters(moved, c._0, u32(n))
		}
		if x.enters_attacking && moved.zone == .Battlefield do enter_attacking(s, moved)
	}
}

// Instructions that move cards, which "that card" / "those cards" after them can name (resolution.odin's moved):
// exiling, returning, milling. Tokens just made only within a delayed ability ("sacrifice those tokens at the
// beginning of the next end step"): straight after the instruction that makes them, "those" is a leaves-the-
// battlefield ability's (CR 603.6c) the data has lost.
moves_cards :: proc(e: types.Effect) -> bool {
	#partial switch _ in e {
	case types.Effect_ChangeZone, types.Effect_ChangeZoneAll, types.Effect_ExileTop, types.Effect_Bounce, types.Effect_Mill:
		return true
	case types.Effect_Token, types.Effect_CopyTokenOf:
		return checking_delayed
	}
	return false
}

// Instructions whose moved cards a count can read ("for each creature destroyed this way"): any of the above, and
// destroying, sacrificing, discarding (to a graveyard).
moves_counted_cards :: proc(e: types.Effect) -> bool {
	#partial switch _ in e {
	case types.Effect_Destroy, types.Effect_DestroyAll, types.Effect_Sacrifice, types.Effect_Discard:
		return true
	}
	return moves_cards(e)
}

// Whether a filter can match an Aura: one put onto the battlefield has what it enchants chosen as it enters (CR
// 303.4f), which only do_change_zone does yet; other ways of putting cards onto the battlefield refuse such filters.
// The type filters all apply (a "creature card", a "non-Aura enchantment card"), so one that rules Auras out is
// enough; Auras that are also creatures, lands or artifacts aren't printed.
may_match_aura :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Typed:
		for t in x._0.type_filters {
			#partial switch y in t {
			case types.TypeFilter_Creature, types.TypeFilter_Land, types.TypeFilter_Artifact, types.TypeFilter_Planeswalker, types.TypeFilter_Battle, types.TypeFilter_Instant, types.TypeFilter_Sorcery:
				return false
			case types.TypeFilter_Subtype:
				// An artifact or land subtype ("an Equipment card") is only on an artifact or land (CR 205.3d).
				artifact, land := ARTIFACT_TYPES, LAND_TYPES
				if slice.contains(artifact[:], y._0) || slice.contains(land[:], y._0) do return false
			case types.TypeFilter_Non:
				if sub, is_sub := y._0^.(types.TypeFilter_Subtype); is_sub && sub._0 == "Aura" do return false
				if _, enchantment := y._0^.(types.TypeFilter_Enchantment); enchantment do return false
			}
		}
		return true // enchantment, permanent, card, any: could be an Aura
	case types.TargetFilter_Or:
		for y in x.filters do if may_match_aura(y) do return true
		return false
	}
	return true
}

// "Those cards" after two instructions that both moved cards ("exile target artifact and target creature, then
// return them"): the data's last instruction alone moved only some of them, so this isn't read yet.
@(thread_local)
instruction_before_previous: ^types.Effect

// While a delayed ability's instructions are checked (delayed.odin).
@(thread_local)
checking_delayed: bool
