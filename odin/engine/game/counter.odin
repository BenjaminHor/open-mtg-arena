// Countering spells and abilities (CR 701.6): "Counter target spell", "counter target creature spell", "counter
// target spell with mana value 4 or greater", "counter target activated or triggered ability", "counter target spell,
// activated ability, or triggered ability". The target is a spell or ability on the stack (not the counterspell
// itself, CR 115.5); countering removes it from the stack (CR 701.6a), a spell into its owner's graveyard (or where a
// "put it ... instead" says), unless it can't be countered (CR 101.2).
package game

import types "../types"

// "Target spell" or "target activated or triggered ability", optionally of a kind: StackSpell, StackAbility, a
// StackSpell and a typed description together, a typed description of a spell ("legendary spell", the card data's
// card on the stack), or either of such.
spell_target_supported :: proc(f: types.TargetFilter, in_either := false) -> bool {
	#partial switch x in f {
	case types.TargetFilter_StackSpell:
		return true
	case types.TargetFilter_StackAbility:
		return stack_ability_filter_supported(x)
	case types.TargetFilter_Typed:
		// "Noncreature spell" beside "activated ability" (Louisoix's Sacrifice): a spell is a card on the stack here,
		// read as one of the choices (legal_targets finds those on the stack).
		return in_either && names_stack(x._0) && spell_description_supported(x._0)
	case types.TargetFilter_And:
		has_stack := false
		for y in x.filters {
			#partial switch z in y {
			case types.TargetFilter_StackSpell:
				has_stack = true
			case types.TargetFilter_Typed:
				if !spell_description_supported(z._0) do return false
			case:
				// "Target spell or ability that targets you" (an ability described by its targets) isn't read yet.
				return false
			}
		}
		return has_stack
	case types.TargetFilter_Or:
		for y in x.filters do if !spell_target_supported(y, in_either = true) do return false
		return len(x.filters) > 0
	}
	return false
}

// "Activated or triggered ability", "triggered ability you control": by its kind and controller (CR 113.3b-c). An
// ability described by its source's kind ("from a creature source") or its keyword ("backup") isn't read yet.
@(private = "file")
stack_ability_filter_supported :: proc(x: types.TargetFilter_StackAbility) -> bool {
	if x.tag != nil do return false
	if c, has := x.controller.?; has {
		#partial switch _ in c {
		case types.ControllerRef_You, types.ControllerRef_Opponent:
		case:
			return false
		}
	}
	return true
}

// Whether a typed description says "on the stack" (the card data's way of writing "spell" beside an ability).
@(private = "file")
names_stack :: proc(f: types.TypedFilter) -> bool {
	for p in f.properties do if z, in_zone := p.(types.FilterProp_InZone); in_zone && z.zone == .Stack do return true
	return false
}

// A description of a spell: its types ("creature spell"), its qualities ("with mana value 4 or greater", "red",
// "colorless", "that targets a permanent you control") and whose it is ("you control"). No types named means any
// spell. "Card" names any spell (CR 111.1, 707.10: a copy of a spell isn't a card, but it's a spell all the same).
@(private = "file")
spell_description_supported :: proc(f: types.TypedFilter) -> bool {
	for t in f.type_filters do if !type_filter_supported(t) do return false
	for p in f.properties {
		if z, in_zone := p.(types.FilterProp_InZone); in_zone && z.zone == .Stack do continue
		if !property_supported(p) do return false
	}
	if c, has := f.controller.?; has {
		#partial switch _ in c {
		case types.ControllerRef_You, types.ControllerRef_Opponent:
		case:
			return false
		}
	}
	return true
}

// What "a spell that targets [it]" can name (spell_targets_one): this object, you, a typed permanent, or either.
spell_targets_filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_SelfRef, types.TargetFilter_Controller:
		return true
	case types.TargetFilter_Typed:
		return typed_supported(x._0)
	case types.TargetFilter_Or:
		for y in x.filters do if !spell_targets_filter_supported(y) do return false
		return len(x.filters) > 0
	}
	return false
}

is_spell_target :: proc(f: types.TargetFilter) -> bool {
	#partial switch _ in f {
	case types.TargetFilter_StackSpell, types.TargetFilter_And, types.TargetFilter_StackAbility:
		return true
	case types.TargetFilter_Or:
		return spell_target_supported(f)
	}
	return false
}

// The spells and abilities on the stack that fit, other than `source` itself (CR 115.5).
spell_targets :: proc(s: ^types.GameState, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId, out: ^[dynamic]types.TargetRef) {
	for i in 0 ..< types.pvec_len(s.stack) {
		e := types.pvec_get(s.stack, i)
		if e.id == source do continue
		if stack_entry_fits(s, e, f, controller, source) do append(out, types.TargetRef_Object{e.id})
	}
}

@(private = "file")
stack_entry_fits :: proc(s: ^types.GameState, e: types.StackEntry, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_StackAbility:
		// CR 113.3b-c: an activated or triggered ability on the stack (mana abilities never are, CR 605.3a). Crew and
		// the like are activated abilities (CR 702.122a).
		kind: types.StackAbilityKind
		#partial switch _ in e.kind {
		case types.StackEntryKind_ActivatedAbility, types.StackEntryKind_KeywordAction:
			kind = .Activated
		case types.StackEntryKind_TriggeredAbility:
			kind = .Triggered
		case:
			return false
		}
		if k, has := x.kind.?; has && k != kind do return false
		if c, has := x.controller.?; has {
			_, you := c.(types.ControllerRef_You)
			if (e.controller == controller) != you do return false
		}
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if stack_entry_fits(s, e, y, controller, source) do return true
		return false
	}
	// The rest describe spells.
	if _, is_spell := e.kind.(types.StackEntryKind_Spell); !is_spell do return false
	o := object(s, e.id)
	return o != nil && spell_fits(s, o, f, controller, source)
}

@(private = "file")
spell_fits :: proc(s: ^types.GameState, o: ^types.GameObject, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_StackSpell:
		return true
	case types.TargetFilter_Typed:
		// "Card" names any spell here, a copy too (spell_description_supported).
		t := x._0
		types_kept := make([dynamic]types.TypeFilter, context.temp_allocator)
		for tf in t.type_filters do if _, card := tf.(types.TypeFilter_Card); !card do append(&types_kept, tf)
		t.type_filters = types_kept
		return object_matches(s, o, t, controller, source)
	case types.TargetFilter_And:
		for y in x.filters do if !spell_fits(s, o, y, controller, source) do return false
		return true
	case types.TargetFilter_Or:
		for y in x.filters do if spell_fits(s, o, y, controller, source) do return true
	}
	return false
}

counter_supported :: proc(x: types.Effect_Counter) -> bool {
	if x.source_rider != nil do return false
	if zone, has := x.countered_spell_zone.?; has {
		// "If that spell is countered this way, put it on top of / on the bottom of its owner's library / into its
		// owner's hand / exile it instead of putting it into its owner's graveyard."
		if lib, to_library := zone.(types.SpellStackToGraveyardReplacement_Library); to_library {
			#partial switch _ in lib.position {
			case types.LibraryPosition_Top, types.LibraryPosition_Bottom:
			case:
				return false
			}
		}
	}
	// "Counter that spell [instead]": the spell the instruction before targeted (ability_supported checks there is one).
	if _, parent := x.target.(types.TargetFilter_ParentTarget); parent do return true
	return spell_target_supported(x.target)
}

// CR 701.6a: the spell leaves the stack for its owner's graveyard (or `zone`, where the counterspell puts it instead)
// and doesn't resolve.
counter_spell :: proc(g: ^Game, id: types.ObjectId, zone: Maybe(types.SpellStackToGraveyardReplacement) = nil) {
	s := &g.state
	o := object(s, id)
	if o == nil {
		// CR 701.6a: a countered ability is removed from the stack (ward counters abilities too).
		if _, on_stack := stack_entry_of(s, id); !on_stack do return
		kept: types.PVec(types.StackEntry)
		for i in 0 ..< types.pvec_len(s.stack) {
			e := types.pvec_get(s.stack, i)
			if e.id != id do types.pvec_push(&kept, e, copy_entry)
		}
		s.stack = kept
		delete_key(&g.stack_abilities, id)
		delete_key(&g.stack_events, id)
		delete_key(&g.stack_conditions, id)
		delete_key(&g.stack_transforms, id)
		return
	}
	if o.zone != .Stack || has_rule(g, o, .Cant_Be_Countered) do return
	kept: types.PVec(types.StackEntry)
	for i in 0 ..< types.pvec_len(s.stack) {
		e := types.pvec_get(s.stack, i)
		if e.id != id do types.pvec_push(&kept, e, copy_entry)
	}
	s.stack = kept
	// A flashback spell is exiled whichever replacement applies first (CR 702.34a "anywhere else", 616.1f: after "put
	// it into its owner's hand instead", it still leaves the stack; after exiling it, it no longer goes to a graveyard).
	if z, has := zone.?; has && !cast_by_flashback(g, o) {
		switch y in z {
		case types.SpellStackToGraveyardReplacement_Hand:
			move_object(g, id, .Hand)
		case types.SpellStackToGraveyardReplacement_Exile:
			move_object(g, id, .Exile)
		case types.SpellStackToGraveyardReplacement_Library:
			_, bottom := y.position.(types.LibraryPosition_Bottom)
			put_in_library(g, id, top = !bottom)
		}
		return
	}
	spell_leaves_stack(g, id) // its owner's graveyard, or exile after flashback (CR 702.34a)
}

// "If that spell is countered this way, exile it instead of putting it into its owner's graveyard" (Force of
// Negation): the card data writes it as the next instruction, "exile it from the graveyard if it went there". It's a
// replacement (CR 614.1a, 701.6a): the countered card goes straight to exile, never to the graveyard (where an
// ability could see it arrive). That next instruction then finds nothing in the graveyard to move.
exiled_instead_of_graveyard :: proc(next: ^types.ResolvedAbility) -> bool {
	if next == nil do return false
	cz, is_move := next.effect.(types.Effect_ChangeZone)
	if !is_move || cz.destination != .Exile do return false
	origin, has_origin := cz.origin.?
	if !has_origin || origin != .Graveyard do return false
	if _, parent := cz.target.(types.TargetFilter_ParentTarget); !parent do return false
	c, has := next.condition.?
	if !has do return false
	_, this_way := c.(types.AbilityCondition_ZoneChangedThisWay)
	return this_way
}
