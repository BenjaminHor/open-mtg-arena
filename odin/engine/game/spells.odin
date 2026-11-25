// Casting spells (CR 601), targets (CR 115), the stack and resolving (CR 405, 608), and the effects spells have.
// Only what's implemented is allowed: a card with an ability this engine can't carry out isn't castable
// (card_supported), so nothing is ever half done.
package game

import "core:fmt"
import "core:reflect"
import "core:slice"
import "core:strings"
import types "../types"

has_keyword :: proc(o: ^types.GameObject, $T: typeid) -> bool {
	for k in o.keywords do if _, ok := k.(T); ok do return true
	return false
}

// ---- What's supported --------------------------------------------------------------------------------------

// Whether this engine can carry out every part of a card: its spell or permanent, its mana abilities and its
// keywords. Triggered, static and replacement abilities, and activated abilities other than mana abilities, come
// later.
// Cards whose card data says something other than the card (found in rules reviews): refused until the data is
// fixed, rather than played wrong.
MISPARSED_CARDS :: [?]string{
	"Phelia, Exuberant Shepherd", // its +1/+1 counter sits outside the delayed ability and without its condition
	"Shallow Grave", // "the top creature card of your graveyard" is read as a target
	"Vizier of Deferment", // "if it attacked or blocked this turn" is dropped
	// Fifth rules review (2026-11-25): parts of the Oracle text the data dropped or changed.
	"Guardian Naga", // "during your turn" on its prevention
	"Captivating Crossroads", // "during your first three turns ... if you were the starting player"
	"Buzzing Whack-a-Doodle", // the opponent's secret choice; all three abilities unconditional
	"Riptide Replicator", // the token "of the chosen color and type", and the creature-type choice
	"Volrath's Laboratory", // the same
	"Sarpadian Empires, Vol. VII", // the token of the chosen type
	"Pompous Gadabout", // "creatures that don't have a name" read as any creature
	"Nick Fury, Spymaster", // "gains indestructible until end of turn"
	"Quicksilver Servitor", // "from among cards put into your hand this turn"
	"Dawn-Blessed Pennant", // reads a chosen card type; the card chooses a creature type
	"Gilraen, Dúnedain Protector", // the delayed return's origin (battlefield) contradicts the exiled card
}

misparsed :: proc(name: string) -> bool {
	for n in MISPARSED_CARDS do if n == name do return true
	return false
}

// `back_face`: a transforming card's back face, which isn't cast and has no mana cost of its own (CR 712.6d).
card_supported :: proc(face: ^types.CardFace, back_face := false) -> bool {
	if misparsed(face.name) do return false
	{
		// CR 107.3m: "enters with X counters" uses the spell's X.
		x_defined = has_x(face.mana_cost)
		defer x_defined = false
		for r in face.replacements do if !replacement_supported(r) do return false
		// "Prevent ... dealt by enchanted creature": an Aura's or Equipment's own host only.
		for r in face.replacements do if static_prevention_supported(r) && prevention_reads_attachment(r) {
			if !slice.contains(face.card_type.subtypes[:], "Aura") && !slice.contains(face.card_type.subtypes[:], "Equipment") do return false
		}
	}
	for st in face.static_abilities do if !static_supported(st) && !static_mode_supported(st) && !cost_modifier_supported(st) do return false
	for t in face.triggers do if !trigger_supported(t) do return false
	if !additional_cost_supported(face) || len(face.casting_options) > 0 || !modal_supported(face) do return false
	// Not yet: "cast only during ..." (CR 601.3), strive (an ability word, CR 207.2c), cleave (CR 702.148), a
	// Case's "to solve" (CR 720.3a).
	if len(face.casting_restrictions) > 0 || face.strive_cost != nil || face.cleave_variant != nil || face.solve_condition != nil do return false
	// A spell needs a mana cost it can pay (CR 118.6, 107.4e-f); lands aren't cast.
	if !is_land_face(face) && !back_face {
		c, is_cost := face.mana_cost.(types.ManaCost_Cost)
		if !is_cost do return false
		for shard in c.shards do if _, _, ok := shard_payers(shard); !ok do return false
	}
	spells := 0
	for a in face.abilities {
		switch a.kind {
		case .Spell:
			if face.modal != nil do continue // the modes, checked by modal_supported
			// One spell ability is what casting carries out (spell_ability); a second paragraph isn't yet.
			spells += 1
			if spells > 1 do return false
			x_defined = has_x(face.mana_cost)
			ok := spell_ability_supported(a)
			x_defined = false
			if !ok do return false
		case .Activated:
			if _, _, ok := tap_mana_ability(a); !ok && !activated_supported(a) do return false
		case .Database, .BeginGame, .Mulligan:
			return false
		}
	}
	for k in face.keywords do if !keyword_supported(k) do return false
	return true
}

keyword_supported :: proc(k: types.Keyword) -> bool {
	#partial switch k in k {
	case types.Keyword_Flying, types.Keyword_Reach, types.Keyword_Haste, types.Keyword_Vigilance,
	     types.Keyword_Defender, types.Keyword_Trample, types.Keyword_Lifelink, types.Keyword_Deathtouch,
	     types.Keyword_FirstStrike, types.Keyword_DoubleStrike, types.Keyword_Flash, types.Keyword_Menace,
	     types.Keyword_Indestructible, types.Keyword_Hexproof, types.Keyword_Shroud, types.Keyword_Prowess,
	     types.Keyword_Convoke, // CR 702.51a: paying with creatures (mana.odin)
	     types.Keyword_Changeling, types.Keyword_Devoid, types.Keyword_Toxic, // CR 702.73a, 702.114a, 702.164c
	     types.Keyword_Decayed: // CR 702.147a (keywords.odin)
		return true
	case types.Keyword_Crew:
		return k.once_per_turn == nil // CR 702.122 (crew.odin)
	case types.Keyword_Ward:
		return ward_supported(k) // ward.odin
	case types.Keyword_Affinity:
		return typed_supported(k._0) // CR 702.41a (cost_modifiers.odin)
	case types.Keyword_Protection:
		return protection_supported(k) // protection.odin
	case types.Keyword_Enchant:
		// CR 702.5a: an Aura enchants a permanent of a kind (enchanting players isn't modelled yet).
		t, typed := k._0.(types.TargetFilter_Typed)
		return typed && typed_supported(t._0)
	case types.Keyword_Equip:
		_, ok := k._0.(types.ManaCost_Cost)
		return ok
	case types.Keyword_Flashback:
		_, mana := k._0.(types.FlashbackCost_Mana)
		return mana // the cast from the graveyard and the exile are flashback.odin's
	case types.Keyword_Kicker:
		return true // carried out through the card's additional cost (kicker_cost), which card_supported checks
	case types.Keyword_Typecycling:
		// CR 702.29e: "[type]cycling [cost]": the card data spells it out as an activated ability from the hand that
		// searches for a card of that type, checked like any other.
		return true
	case types.Keyword_Cycling:
		// CR 702.29a: the card data spells it out as an activated ability from the hand ("[cost], Discard this
		// card: Draw a card"), checked like any other.
		_, mana := k._0.(types.CyclingCost_Mana)
		return mana
	}
	return false
}

spell_ability_supported :: proc(a: types.AbilityDefinition) -> bool {
	return ability_supported(a)
}

// An ability this engine can carry out: each effect in its chain supported, with no conditions or choices beyond
// targets and (for triggered abilities, CR 603.5) whether to do it at all.
// `after_target`: an earlier instruction of the same ability chose a target, which "it" or "that creature" can
// refer to.
ability_supported :: proc(a: types.AbilityDefinition, after_target := false, after_search := false) -> bool {
	if a.effect == nil || a.optional_targeting || a.modal != nil do return false
	if c, has := a.condition.?; has && !ability_condition_supported(c) do return false
	// "Each player draws", "an opponent draws", "for each creature chosen": scopes and groups not carried out yet.
	// (Declaring a group is harmless while nothing reads it; reading one isn't supported.)
	if a.reads_chosen_group != nil || a.starting_with != nil do return false
	if scope, has := a.player_scope.?; has && !player_scope_ok(scope, a) do return false
	if a.target_chooser != nil || a.optional_player != nil || a.optional_for != nil do return false
	if !multi_target_supported(a) || !distribute_supported(a) || a.repeat_for != nil || !unless_pay_supported(a) do return false
	if a.else_ability != nil do return false
	if !effect_supported(a.effect^, a.duration) do return false
	if refers_to_parent_target(a.effect^) && !after_target do return false
	if d, delayed := a.effect^.(types.Effect_CreateDelayedTrigger); delayed && !delayed_trigger_supported(d, after_target) do return false
	if moves_found_cards(a.effect^) && !after_search do return false
	_, targets := effect_target(a.effect^)
	_, searches := a.effect^.(types.Effect_SearchLibrary)
	if a.sub_ability != nil && is_reflexive(a.sub_ability) {
		// CR 603.12: "You may X. When you do, Y": Y is a triggered ability of its own, with its own targets. Read
		// after a "you may" only, and as the last part of the ability (what follows it belongs to it).
		// After a mandatory instruction, "you do" means it did something (moved, made or marked something).
		if !a.optional {
			#partial switch _ in a.effect^ {
			case types.Effect_ChangeZone, types.Effect_Sacrifice, types.Effect_Token, types.Effect_PutCounter, types.Effect_Mill, types.Effect_Discard, types.Effect_Destroy:
			case:
				return false
			}
		}
		for y := a.sub_ability.sub_ability; y != nil; y = y.sub_ability do if y.sub_link == .SequentialSibling do return false
		reflex := a.sub_ability^
		reflex.condition = nil
		return ability_supported(reflex)
	}
	if a.sub_ability != nil do return ability_supported(a.sub_ability^, after_target || targets, after_search || searches)
	return true
}

// "When you do, ...": a reflexive triggered ability (CR 603.12), created as the ability resolves.
is_reflexive :: proc(a: ^types.AbilityDefinition) -> bool {
	c, has := a.condition.?
	if !has do return false
	_, when_you_do := c.(types.AbilityCondition_WhenYouDo)
	return when_you_do
}

effect_supported :: proc(e: types.Effect, duration: Maybe(types.Duration)) -> bool {
	if supported, known := more_effect_supported(e, duration); known do return supported
	#partial switch x in e {
	case types.Effect_DealDamage:
		fixed := quantity_supported(x.amount)
		// To a target, to "you", or to "that creature's controller". "Target creature you control deals damage
		// equal to its power to target creature" (bite): the source is the first target, chosen by a TargetOnly.
		_, parent_controller := x.target.(types.TargetFilter_ParentTargetController)
		if src, has := x.damage_source.?; has {
			if src != .Target || !is_power_of_target(x.amount) do return false
			fixed = true
		}
		return fixed && x.excess == nil && (filter_supported(x.target) || is_controller(x.target) || parent_controller)
	case types.Effect_TargetOnly:
		// "Choose target creature": a target for the instructions after it, doing nothing itself.
		return filter_supported(x.target) && !may_name_player(x.target)
	case types.Effect_Fight:
		// CR 701.14a: "Target creature you control fights target creature you don't control", "this creature fights",
		// "it fights" (the target of the instruction before, which ability_supported requires). A subject named by
		// what it's attached to ("enchanted creature fights") isn't read yet.
		_, parent := x.subject.(types.TargetFilter_ParentTarget)
		subject_ok := is_self(x.subject) || parent || (fight_subject_targeted(x) && filter_supported(x.subject) && !may_name_player(x.subject) && !names_attachment(x.subject))
		return subject_ok && filter_supported(x.target) && !may_name_player(x.target)
	case types.Effect_Pump:
		pf, tf := pump_value_supported(x.power), pump_value_supported(x.toughness)
		d, has := duration.?
		_, eot := d.(types.Duration_UntilEndOfTurn)
		// A pump aimed at "any target" is a misparsed mass pump: a player can't get +N/+N.
		return pf && tf && has && eot && (is_self(x.target) || (filter_supported(x.target) && !may_name_player(x.target)))
	case types.Effect_LoseLife:
		// "You lose N life", "target player / target opponent loses N life", "defending player loses N life",
		// "its controller loses N life".
		if !quantity_supported(x.amount) do return false
		t, has := x.target.?
		if !has do return true
		#partial switch y in t {
		case types.TargetFilter_Controller, types.TargetFilter_Player, types.TargetFilter_Opponent,
		     types.TargetFilter_DefendingPlayer, types.TargetFilter_ParentTargetController:
			return true
		case types.TargetFilter_TriggeringPlayer, types.TargetFilter_TriggeringSourceController:
			return filter_supported(t) // "that player": the trigger event's (resolution.odin)
		case types.TargetFilter_Typed:
			_, is_player := player_typed(y._0)
			return is_player
		}
		return false
	case types.Effect_Token:
		_, you := x.owner.(types.TargetFilter_Controller)
		_, parent_controller := x.owner.(types.TargetFilter_ParentTargetController)
		you = you || parent_controller // "its controller creates ...": the earlier target's controller
		if x.enters_attacking {
			// CR 508.4: attacking the defending player (planeswalker and battle choices aren't offered yet).
			#partial switch _ in x.attack_destination {
			case types.TokenAttackDestination_ControllerChooses, types.TokenAttackDestination_Player:
			case:
				return false
			}
		}
		for st in x.static_abilities do if !static_supported(st) && !static_mode_supported(st) && !own_grant_supported(st) do return false
		for k in x.keywords do if !keyword_supported(k) do return false
		return quantity_supported(x.count) && pt_supported(x.power) && pt_supported(x.toughness) && you && x.attach_to == nil && predefined_token_supported(x) &&
			len(x.enter_with_counters) == 0
	case types.Effect_Draw:
		// "Draw N cards", "target player / target opponent draws N cards", "its controller draws a card", "that
		// player draws".
		return quantity_supported(x.count) && life_or_draw_player_supported(x.target)
	case types.Effect_GenericEffect:
		return generic_effect_supported(x, duration)
	case types.Effect_SearchLibrary:
		return search_supported(x)
	case types.Effect_Sacrifice:
		return sacrifice_supported(x)
	case types.Effect_CreateDelayedTrigger:
		return delayed_trigger_supported(x, true) // and with what came before it: ability_supported
	case types.Effect_PreventDamage:
		return prevention_supported(x)
	case types.Effect_PayCost:
		return pay_cost_supported(x)
	case types.Effect_ExileTop:
		return exile_top_supported(x)
	case types.Effect_GrantCastingPermission:
		return grant_permission_supported(x)
	case types.Effect_AddTargetReplacement:
		return exile_instead_supported(x)
	case types.Effect_GainControl:
		// "Gain control of target creature until end of turn" (Act of Treason), or for good.
		ok_duration := true
		if d, has := duration.?; has {
			_, eot := d.(types.Duration_UntilEndOfTurn)
			ok_duration = eot
		}
		return ok_duration && filter_supported(x.target) && !may_name_player(x.target)
	case types.Effect_CopyTokenOf:
		// "Create a token that's a copy of target creature you control" / "of this creature" (CR 707.2).
		_, you := x.owner.(types.TargetFilter_Controller)
		_, fixed := fixed_quantity(x.count)
		plain := !x.enters_attacking && len(x.extra_keywords) == 0 && len(x.additional_modifications) == 0 && x.source_filter == nil
		return you && fixed && plain && (is_self(x.target) || (filter_supported(x.target) && !may_name_player(x.target)))
	case types.Effect_Counter:
		return counter_supported(x)
	case types.Effect_Investigate:
		return true // a Clue token (CR 701.16a)
	case types.Effect_Proliferate:
		return true // CR 701.34a (proliferate.odin)
	case types.Effect_Mana:
		return resolving_mana_supported(x)
	case types.Effect_Amass:
		return amass_supported(x) // amass.odin
	case types.Effect_Transform:
		return transform_supported(x) // transform.odin
	case types.Effect_Shuffle:
		return is_controller(x.target)
	case types.Effect_Attach:
		return attach_effect_supported(x)
	case types.Effect_Discard:
		// "You discard N" or "target player discards N", chosen by the discarder or at random.
		return quantity_supported(x.count) && x.unless_filter == nil && x.filter == nil && (is_controller(x.target) || is_player_filter(x.target))
	case types.Effect_Dig:
		keep, has_keep := x.keep_count.?
		dest, has_dest := x.destination.?
		rest, has_rest := x.rest_destination.?
		return is_controller(x.player) && quantity_supported(x.count) && has_keep && keep >= 1 && x.keep_count_expr == nil &&
			has_dest && (dest == .Hand || dest == .Graveyard) && has_rest && (rest == .Library || rest == .Graveyard) &&
			x.rest_remainder == .Route && x.rest_split_top_count == nil && x.source == .Library && !x.enter_tapped && !x.enters_attacking &&
			(is_any(x.filter) || mass_filter_supported(x.filter) || spell_filter_supported(x.filter))
	case types.Effect_Scry:
		_, fixed := fixed_quantity(x.count)
		return fixed && (x.target == nil || is_controller(x.target))
	case types.Effect_Surveil:
		_, fixed := fixed_quantity(x.count)
		return fixed && (x.target == nil || is_controller(x.target))
	case types.Effect_ChangeZone:
		return change_zone_supported(x)
	case types.Effect_Bounce:
		return bounce_supported(x)
	case types.Effect_GainLife:
		// "You gain N life", "target player gains N life", "its controller gains N life", "that player gains".
		return quantity_supported(x.amount) && (x.player == nil || life_or_draw_player_supported(x.player))
	case types.Effect_Destroy:
		return !x.cant_regenerate && filter_supported(x.target) && !may_name_player(x.target)
	}
	return false
}

// The target filters this engine can find targets for.
filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Any, types.TargetFilter_Player, types.TargetFilter_Opponent:
		return true
	case types.TargetFilter_ParentTarget:
		return true // only after an instruction that chose a target (ability_supported)
	case types.TargetFilter_TriggeringSource:
		return event_object_defined // "that creature": in a trigger whose event names one (resolution.odin)
	case types.TargetFilter_TriggeringPlayer:
		return event_player_defined
	case types.TargetFilter_TriggeringSourceController:
		return event_object_defined
	case types.TargetFilter_Typed:
		if _, is_player := player_typed(x._0); is_player do return true
		return typed_supported(x._0)
	case types.TargetFilter_Or:
		// "Target creature or planeswalker an opponent controls", "target opponent or planeswalker".
		for y in x.filters {
			#partial switch _ in y {
			case types.TargetFilter_Typed, types.TargetFilter_Player, types.TargetFilter_Opponent, types.TargetFilter_Any:
				if !filter_supported(y) do return false
			case:
				return false
			}
		}
		return len(x.filters) > 0
	}
	return false
}

// A typed filter naming no types or properties, only a controller: a player ("target opponent").
player_typed :: proc(f: types.TypedFilter) -> (types.ControllerRef, bool) {
	c, has := f.controller.?
	if !has || len(f.type_filters) > 0 || len(f.properties) > 0 do return nil, false
	#partial switch _ in c {
	case types.ControllerRef_You, types.ControllerRef_Opponent:
		return c, true
	}
	return nil, false
}

// ---- Targets (CR 115) ----------------------------------------------------------------------------------------

// The target an effect asks for, if it targets (CR 115.1: the word "target"; here, a filter naming what can be
// chosen rather than "this" or "you").
effect_target :: proc(e: types.Effect) -> (types.TargetFilter, bool) {
	if moves_found_cards(e) do return nil, false // "those cards" a search found
	if x, zc := e.(types.Effect_ChangeZone); zc {
		if _, from_hand := hand_choice(x); from_hand do return nil, false // chosen as it resolves, not targeted
	}
	f := effect_target_filter(e)
	#partial switch _ in f {
	case types.TargetFilter_Any, types.TargetFilter_Player, types.TargetFilter_Opponent, types.TargetFilter_Typed, types.TargetFilter_Or:
		return f, true
	case types.TargetFilter_StackSpell, types.TargetFilter_And:
		return f, is_spell_target(f)
	}
	return nil, false
}

// A fight's subject chosen as a target ("target creature you control fights ..."), not "this creature" or "it".
fight_subject_targeted :: proc(f: types.Effect_Fight) -> bool {
	_, typed := f.subject.(types.TargetFilter_Typed)
	return typed
}

// A filter naming a permanent by what's attached to it ("enchanted creature", "equipped creature").
names_attachment :: proc(f: types.TargetFilter) -> bool {
	typed, ok := f.(types.TargetFilter_Typed)
	if !ok do return false
	for p in typed._0.properties {
		#partial switch _ in p {
		case types.FilterProp_EnchantedBy, types.FilterProp_EquippedBy, types.FilterProp_AttachedTo:
			return true
		}
	}
	return false
}

// Whether an instruction acts on "it" or "that creature": the target an earlier instruction chose (CR 608.2c).
refers_to_parent_target :: proc(e: types.Effect) -> bool {
	if f, is_fight := e.(types.Effect_Fight); is_fight {
		if _, parent := f.subject.(types.TargetFilter_ParentTarget); parent do return true
	}
	#partial switch _ in effect_target_filter(e) {
	case types.TargetFilter_ParentTarget, types.TargetFilter_ParentTargetController:
		return true
	}
	if tok, is_token := e.(types.Effect_Token); is_token {
		_, parent_controller := tok.owner.(types.TargetFilter_ParentTargetController)
		return parent_controller
	}
	if atr, is_replacement := e.(types.Effect_AddTargetReplacement); is_replacement {
		// "If that creature would die this turn": the earlier instruction's target.
		_, any := atr.target.(types.TargetFilter_Any)
		return any
	}
	if prev, is_prevention := e.(types.Effect_PreventDamage); is_prevention {
		// "Prevent all damage that would be dealt to it this turn."
		_, parent := prev.target.(types.TargetFilter_ParentTarget)
		return parent
	}
	if sac, is_sacrifice := e.(types.Effect_Sacrifice); is_sacrifice {
		// "Sacrifice it" (not a targeted instruction: its other forms name a kind of permanent to choose).
		_, parent := sac.target.(types.TargetFilter_ParentTarget)
		return parent
	}
	if x, generic := e.(types.Effect_GenericEffect); generic && x.target == nil {
		for st in x.static_abilities {
			aff, _ := st.affected.?
			if _, parent := aff.(types.TargetFilter_ParentTarget); parent do return true
		}
	}
	return false
}

// The player who draws or gains life: you, a target player (or opponent), the controller of the earlier target, or
// the trigger event's player.
life_or_draw_player_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch y in f {
	case types.TargetFilter_Controller, types.TargetFilter_Player, types.TargetFilter_Opponent, types.TargetFilter_ParentTargetController:
		return true
	case types.TargetFilter_TriggeringPlayer, types.TargetFilter_TriggeringSourceController:
		return filter_supported(f)
	case types.TargetFilter_Typed:
		_, is_player := player_typed(y._0)
		return is_player
	}
	return false
}

// The object or player an effect names, whether chosen as a target or not ("you", "this", "it").
effect_target_filter :: proc(e: types.Effect) -> types.TargetFilter {
	f: types.TargetFilter
	#partial switch x in e {
	case types.Effect_DealDamage:
		f = x.target
	case types.Effect_Pump:
		f = x.target
	case types.Effect_CopyTokenOf:
		f = x.target
	case types.Effect_GainControl:
		f = x.target
	case types.Effect_Draw:
		f = x.target
	case types.Effect_GainLife:
		f = x.player
	case types.Effect_TargetOnly:
		f = x.target
	case types.Effect_Fight:
		f = x.target
	case types.Effect_LoseLife:
		f = x.target.? or_else nil
	case types.Effect_Destroy:
		f = x.target
	case types.Effect_GenericEffect:
		f = x.target.? or_else nil
	case types.Effect_ChangeZone:
		f = x.target
	case types.Effect_Bounce:
		if x.selection == .Targeted do f = x.target // a chosen one isn't targeted
	case types.Effect_Attach:
		if _, chosen := x.selection.(types.AttachSelection_AtResolution); !chosen do f = x.target // chosen as it resolves: not targeted
	case types.Effect_PutCounter:
		f = x.target
	case types.Effect_SetTapState:
		f = x.target
	case types.Effect_Mill:
		f = x.target
	case types.Effect_Discard:
		f = x.target
	case types.Effect_Counter:
		f = x.target
	}
	return f
}

is_controller :: proc(f: types.TargetFilter) -> bool {
	_, ok := f.(types.TargetFilter_Controller)
	return ok
}

is_any :: proc(f: types.TargetFilter) -> bool {
	_, ok := f.(types.TargetFilter_Any)
	return ok
}

is_self :: proc(f: types.TargetFilter) -> bool {
	_, ok := f.(types.TargetFilter_SelfRef)
	return ok
}

// The targets of a spell: an Aura spell's single target from its enchant ability (CR 303.4a), or its
// instructions' slots.
spell_slot_list :: proc(o: ^types.GameObject, modes: []int = nil) -> [dynamic]Target_Slot {
	if is_modal(o) {
		// CR 700.2c: only the chosen modes' targets.
		out := make([dynamic]Target_Slot, context.temp_allocator)
		abilities := mode_abilities(o)
		groups := 0
		for i in modes {
			mode_slots := slot_list(abilities[i])
			last := -1
			for slot in mode_slots {
				append(&out, Target_Slot{filter = slot.filter, optional = slot.optional, group = slot.group + groups})
				last = slot.group
			}
			groups += last + 1
		}
		return out
	}
	if is_aura(o) {
		out := make([dynamic]Target_Slot, context.temp_allocator)
		f, _ := enchant_filter(o)
		append(&out, Target_Slot{filter = f})
		return out
	}
	return slot_list(spell_ability(o))
}

spell_target_slots :: proc(o: ^types.GameObject) -> [dynamic]types.TargetFilter {
	out := make([dynamic]types.TargetFilter, context.temp_allocator)
	for slot in spell_slot_list(o) do append(&out, slot.filter)
	return out
}

// The targets of a spell, one per targeting effect in its chain, in order.
target_slots :: proc(a: ^types.AbilityDefinition) -> [dynamic]types.TargetFilter {
	out := make([dynamic]types.TargetFilter, context.temp_allocator)
	for x := a; x != nil; x = x.sub_ability {
		if x.effect == nil do continue
		if f, ok := effect_target(x.effect^); ok do append(&out, f)
	}
	return out
}

matches_type :: proc(o: ^types.GameObject, t: types.TypeFilter) -> bool {return type_matches(o, t)}

// CR 115.4: "any target" is a creature, player, planeswalker or battle. A typed filter is a permanent of each listed
// type (and controller), on the battlefield.
legal_targets :: proc(s: ^types.GameState, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId = 0) -> [dynamic]types.TargetRef {
	out := make([dynamic]types.TargetRef)
	#partial switch x in f {
	case types.TargetFilter_Any:
		for id in ids_of(s.battlefield) {
			o := object(s, id)
			if is_type(o, .Creature) || is_type(o, .Planeswalker) || is_type(o, .Battle) {
				if targetable_by(o, controller, object(s, source)) do append(&out, types.TargetRef_Object{id})
			}
		}
		for p in s.players do append(&out, types.TargetRef_Player{p.id})
	case types.TargetFilter_Player:
		for p in s.players do append(&out, types.TargetRef_Player{p.id})
	case types.TargetFilter_Opponent:
		for p in s.players do if p.id != controller do append(&out, types.TargetRef_Player{p.id})
	case types.TargetFilter_StackSpell, types.TargetFilter_And:
		spell_targets(s, f, controller, source, &out)
	case types.TargetFilter_Or:
		if is_spell_target(f) {
			spell_targets(s, f, controller, source, &out)
			return out
		}
		for y in x.filters do for t in legal_targets(s, y, controller, source) {
			if !slice.contains(out[:], t) do append(&out, t)
		}
	case types.TargetFilter_Typed:
		if c, is_player := player_typed(x._0); is_player {
			_, you := c.(types.ControllerRef_You)
			for p in s.players do if (p.id == controller) == you do append(&out, types.TargetRef_Player{p.id})
			return out
		}
		if gf, in_graveyard := graveyard_filter(f); in_graveyard {
			graveyard_targets(s, gf, controller, source, &out)
			return out
		}
		for id in ids_of(s.battlefield) {
			o := object(s, id)
			if !object_matches(s, o, x._0, controller, source) do continue
			if targetable_by(o, controller, object(s, source)) do append(&out, types.TargetRef_Object{id})
		}
	}
	return out
}

// CR 702.18 (shroud) and 702.11 (hexproof): objects that can't be the target of spells, or of an opponent's.
targetable_by :: proc(o: ^types.GameObject, controller: types.PlayerId, source: ^types.GameObject = nil) -> bool {
	if has_keyword(o, types.Keyword_Shroud) do return false
	if o.controller != controller && has_keyword(o, types.Keyword_Hexproof) do return false
	if protected_from(o, source) do return false // CR 702.16b
	return true
}

target_still_legal :: proc(s: ^types.GameState, t: types.TargetRef, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId = 0) -> bool {
	for l in legal_targets(s, f, controller, source) do if l == t do return true
	return false
}

// ---- Casting (CR 601) ---------------------------------------------------------------------------------------

spell_ability :: proc(o: ^types.GameObject) -> ^types.AbilityDefinition {
	if o.abilities == nil do return nil
	for &a in o.abilities^ do if a.kind == .Spell do return &a
	return nil
}

// CR 117.1a, 307.1: a player may cast an instant (or a spell with flash, CR 702.8) whenever they have priority, and
// any other spell only in their main phase, on their own turn, with the stack empty.
can_cast_now :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) -> bool {
	if is_type(o, .Land) do return false
	if is_type(o, .Instant) || has_keyword(o, types.Keyword_Flash) || has_own_flash_rule(o) do return true
	return sorcery_timing(s, p)
}

sorcery_timing :: proc(s: ^types.GameState, p: types.PlayerId) -> bool {
	return s.active_player == p && (s.phase == .PreCombatMain || s.phase == .PostCombatMain) && types.pvec_len(s.stack) == 0
}

// Whether the player can cast this card from their hand now: supported, timely, with legal targets and payable.
castable :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, card_db: Card_Lookup) -> bool {
	// From the hand, a commander from the command zone (CR 903.8), or a card with flashback from the graveyard
	// (CR 702.34a).
	_, from_exile := exile_permission(o, p)
	if adventure_permission(o, p) do from_exile = true // CR 716.3d: the creature, after its Adventure
	if is_type(o, .Land) do from_exile = false // a land is played, not cast
	if o.owner != p || !(o.zone == .Hand || (o.zone == .Command && o.is_commander) || flashback_castable(o, p) || from_exile) do return refuse("not castable from its zone")
	if !object_supported(o, card_db) do return refuse_unsupported(o)
	if !can_cast_now(s, p, o) do return refuse("not now (timing or priority)")
	if is_modal(o) {
		if !modes_castable(s, p, o) do return refuse("no castable modes")
	} else if !slots_fillable(s, spell_slot_list(o)[:], p, o.id) do return refuse("no legal targets")
	if !additional_cost_payable(s, p, o) do return refuse("additional cost unpayable")
	_, payable := plan_payment(s, p, spell_cost(s, o, p), 0, nil, Payment{o, true})
	return payable || refuse("mana cost unpayable")
}

// Why the last action was refused, for the client's rejection message and the fixture replayer's report (no rules
// effect).
@(thread_local)
rejection: string

// The object whose support the last refusal was about, for the reply to list what's missing (object_gaps).
@(thread_local)
rejection_object: types.ObjectId

refuse :: proc(why: string) -> bool {
	rejection = why
	rejection_object = 0
	return false
}

refuse_unsupported :: proc(o: ^types.GameObject) -> bool {
	rejection = "card not supported"
	rejection_object = o.id
	return false
}

// What the engine is missing to carry out this object (as card_gaps, from the object's own abilities).
object_gaps :: proc(o: ^types.GameObject) -> [dynamic]string {
	f := object_face(o)
	if o.trigger_definitions != nil {
		f.triggers = make([dynamic]types.TriggerDefinition, context.temp_allocator)
		for e in o.trigger_definitions^ do append(&f.triggers, e.definition)
	}
	return card_gaps(&f)
}

// The total cost to cast it: its mana cost, plus {2} for each earlier cast of a commander from the command zone
// (CR 903.8, the commander tax).
// CR 601.2f: the total cost: the mana cost, plus the commander tax (CR 903.8), plus increases, minus reductions,
// never below {0}. Reductions here are of generic mana only.
spell_cost :: proc(s: ^types.GameState, o: ^types.GameObject, p: types.PlayerId) -> types.ManaCost {
	if cost_targets.spell != o.id {
		// Not told its targets: the best case (Cost_Targets).
		saved := cost_targets
		cost_targets = {spell = o.id, caster = p, best_case = true}
		defer cost_targets = saved
		return spell_cost(s, o, p)
	}
	base := o.mana_cost
	if o.zone == .Graveyard {
		if f, has := flashback_cost(o); has do base = f // CR 702.34a: instead of its mana cost
	}
	c, is_cost := base.(types.ManaCost_Cost)
	if !is_cost do return base
	add_kicker_cost(o, &c) // CR 702.33a: an additional cost
	generic := int(c.generic) + cost_change(s, p, o)
	if has_x(o.mana_cost) {
		// CR 107.3a: each {X} is the announced value (0 before it's announced).
		x := int(o.cost_x_paid.? or_else 0)
		shards := make([dynamic]types.ManaCostShard, context.temp_allocator)
		for shard in c.shards {
			if shard == .X do generic += x
			else do append(&shards, shard)
		}
		c.shards = shards
	}
	if o.zone == .Command do generic += 2 * int(s.commander_cast_count[o.id])
	c.generic = u32(max(generic, 0))
	return c
}

// Looks up the card an object was made from, to check what this engine supports of it.
Card_Lookup :: proc(name: string) -> ^types.CardExportEntry

// The card database lookup of the game in play, for code that holds only an object.
current_card_db: Card_Lookup

card_entry_of :: proc(o: ^types.GameObject) -> (^types.CardExportEntry, bool) {
	if current_card_db == nil || o.is_token do return nil, false
	e := current_card_db(o.base_name)
	return e, e != nil
}

// A card with more than one half (CR 709 split, 712 double-faced, 715 adventurer, 702.xxx prepare and the like): fully
// supported only once the way its other half is used is, and that half is supported too. None is yet: the gap names
// the layout. `name` is the card's name as the pool spells it ("Fire // Ice").
layout_gap :: proc(e: ^types.CardExportEntry, name: string) -> (gap: string, has_gap: bool) {
	layout, has_layout := e.layout.?
	if !has_layout && !strings.contains(name, "//") do return "", false
	if has_layout && layout == "transform" {
		// A transforming card (transform.odin): supported when its back face is.
		back := transform_back_face(e)
		if back == nil do return "layout:transform (no back face)", true
		if !card_supported(&back.face, back_face = true) do return "back face", true
		return "", false
	}
	if has_layout && layout == "modal_dfc" {
		// A modal double-faced card (mdfc.odin): supported when its back face is.
		back := modal_back_face(e)
		if back == nil do return "layout:modal_dfc (no back face)", true
		if !card_supported(&back.face) do return "back face", true
		return "", false
	}
	if has_layout && layout == "adventure" {
		// An adventurer card (adventure.odin): supported when its Adventure is.
		adventure := adventure_face(e)
		if adventure == nil do return "layout:adventure (no Adventure)", true
		if !card_supported(&adventure.face) do return "adventure", true
		return "", false
	}
	if !has_layout || layout == "" do layout = "multi-face"
	return strings.concatenate({"layout:", layout}, context.temp_allocator), true
}

// Whether this engine can carry out everything the object has (CR 109.3: its characteristics are its own, whatever
// card it came from).
object_supported :: proc(o: ^types.GameObject, card_db: Card_Lookup) -> bool {
	// A token is what a supported effect made: its abilities are ones the engine carries out (CR 111.10 included).
	// A copy of a card (printed_ref set) has that card's abilities, checked like the card's.
	if o.is_token && o.printed_ref == nil do return true
	// Its triggers are checked where they are (object_face leaves them out, to allocate nothing: this runs for
	// every card on every legal-action query).
	if o.trigger_definitions != nil do for e in o.trigger_definitions^ do if !trigger_supported(e.definition) do return false
	f := object_face(o)
	return card_supported(&f, back_face = o.transformed) // a transformed permanent's back face has no mana cost
}

// The object's own abilities, costs and keywords as a card face, for the checks shared with whole cards (its
// triggers aside: object_supported checks those). Casting options (alternative costs) aren't kept on an object,
// so they come from its card.
object_face :: proc(o: ^types.GameObject) -> types.CardFace {
	f := types.CardFace {
		name                 = o.name,
		mana_cost            = o.mana_cost,
		card_type            = o.card_types,
		keywords             = o.keywords,
		modal                = o.modal,
		additional_cost      = o.additional_cost,
		casting_restrictions = o.casting_restrictions,
		strive_cost          = o.strive_cost,
		cleave_variant       = o.cleave_variant,
	}
	if o.abilities != nil do f.abilities = o.abilities^
	if o.static_definitions != nil do f.static_abilities = (^[dynamic]types.StaticDefinition)(o.static_definitions)^
	if o.replacement_definitions != nil do f.replacements = (^[dynamic]types.ReplacementDefinition)(o.replacement_definitions)^
	if e, ok := card_entry_of(o); ok {
		f.casting_options = e.face.casting_options
		f.solve_condition = e.face.solve_condition // a Case's "to solve" (CR 720.3a), not kept on objects either
	}
	return f
}

// CR 601.2: casting. The card moves to the stack (601.2a), its targets are chosen (601.2c; when the action didn't
// name them, the player is asked, one target at a time), the cost is paid (601.2g-h) and the spell becomes cast.
cast_spell :: proc(g: ^Game, p: types.PlayerId, id: types.ObjectId, targets: []types.TargetRef, adventure_decided := false, face_decided := false) -> bool {
	s := &g.state
	o := object(s, id)
	if o == nil do return false
	if !face_decided && len(targets) == 0 {
		// CR 712.8b, 712.9: a modal double-faced card's face (mdfc.odin).
		if handled, ok := offer_modal_face(g, p, o); handled do return ok
	}
	if !adventure_decided && len(targets) == 0 {
		// CR 716.3: the creature or its Adventure (adventure.odin).
		if handled, ok := offer_adventure(g, p, o); handled do return ok
	}
	if !castable(s, p, o, g.card_db) do return false
	slots := spell_slot_list(o)
	g.pending = Pending_Cast{object = id, ability_index = -1}
	announce_spell(s, p, o)
	// Targets named with the action fill the slots in order.
	for t in targets {
		settle_choice(s, slots[:], &g.pending.choice, p, id)
		if !slice.contains(slot_legal(s, slots[:], &g.pending.choice, p, id)[:], t) {
			withdraw_spell(s, id)
			g.pending = {}
			return false
		}
		take_target(slots[:], &g.pending.choice, t)
	}
	if is_modal(o) {
		// CR 601.2b, 700.2a: the modes are chosen first.
		if len(targets) > 0 {
			withdraw_spell(s, id)
			g.pending = {}
			return false
		}
		ask_modes(g, p, o)
		return true
	}
	continue_casting(g, p)
	return true
}

// CR 601.2a: casting starts by putting the spell on the stack, where it is while its modes, X, costs and targets are
// chosen (601.2b-h). Its entry is on the stack from now on; the card keeps its place in its zone until it becomes
// cast (601.2i), so a cast that's reversed (CR 734) has nothing to move back.
announce_spell :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) {
	types.pvec_push(&s.stack, types.StackEntry{id = o.id, source_id = o.id, controller = p, kind = types.StackEntryKind_Spell{card_id = o.card_id}}, copy_entry)
}

// The spell's entry while it's being cast, taken off the stack: the cast was reversed (CR 734), or it's done and its
// full entry takes the place.
withdraw_spell :: proc(s: ^types.GameState, id: types.ObjectId, reversed := true) {
	n := types.pvec_len(s.stack)
	if n == 0 do return
	top := types.pvec_get(s.stack, n - 1)
	// CR 601.2a: it's the topmost object while it's cast; nothing can be put above it before it's cast.
	if _, spell := top.kind.(types.StackEntryKind_Spell); !spell || top.id != id do return
	o := object(s, id)
	if o == nil || o.zone == .Stack do return // already cast: not an announcement
	types.pvec_pop(&s.stack, copy_entry)
	if reversed && showing_adventure(o) do show_creature(current_card_db, o) // a reversed Adventure: the creature (CR 716.4)
	if reversed && o.modal_back_face do mdfc_front_up(current_card_db, o) // the front face in the hand (CR 712.6a)
}

// CR 601.2b: the announcements in order: kicker, then X; then targets (601.2c) and paying (601.2h).
continue_casting :: proc(g: ^Game, p: types.PlayerId) {
	s := &g.state
	o := object(s, g.pending.object)
	if ask_kicker(g, p, o) do return
	if has_x(o.mana_cost) && o.cost_x_paid == nil {
		// CR 107.3a: the value of X is announced.
		pending := new(types.PendingCast)
		pending.object_id = o.id
		pending.card_id = o.card_id
		pending.cost = o.mana_cost
		s.waiting_for = types.WaitingFor_ChooseXValue{player = p, min = 0, max = max_x(s, p, o), pending_cast = pending}
		return
	}
	next_target_or_finish(g, p)
}

// CR 601.2c: asks for the next target, or (all chosen) goes on to pay: the spell is cast, or the ability's costs
// are paid.
next_target_or_finish :: proc(g: ^Game, p: types.PlayerId) {
	s := &g.state
	slots := pending_slot_list(g)
	settle_choice(s, slots[:], &g.pending.choice, p, g.pending.object)
	if g.pending.slot < len(slots) {
		ask_target(g, p)
		return
	}
	if ask_division(g, p) do return // CR 601.2d: announced after the targets
	if g.pending.ability_index >= 0 {
		pay_activation(g, p)
		return
	}
	o := object(s, g.pending.object)
	if !spell_payable_with_targets(g, p, o) {
		// CR 601.2h, 734.1: the targets chosen leave a cost it can't pay ("costs {3} less if it targets a tapped
		// creature", with an untapped one chosen): the cast is reversed.
		withdraw_spell(s, o.id)
		o.cost_x_paid = nil
		o.additional_cost_payment_count = 0
		g.pending = {}
		rejection = "the cost with those targets can't be paid"
		give_priority(g, p)
		return
	}
	// CR 601.2h: an additional cost that has the player choose (what to sacrifice or discard).
	if cost, has := spell_additional_cost(o); has && !g.pending.cost_chosen {
		if c, chooses := object_cost_of(s, p, o, cost); chooses {
			others := make([dynamic]types.ObjectId, context.temp_allocator)
			for id in c.choices do if id != o.id do append(&others, id)
			c.choices = others
			ask_cost_objects(g, p, c)
			return
		}
	}
	finish_cast(g, p, g.pending.object, g.pending.targets[:])
	g.pending = {}
}

// Whether the spell being cast can pay its cost with the targets chosen for it (CR 601.2f, 601.2h).
spell_payable_with_targets :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject, targets: []types.TargetRef = nil) -> bool {
	saved := cost_targets
	defer cost_targets = saved
	cost_targets = {spell = o.id, caster = p, targets = targets if targets != nil else g.pending.targets[:]}
	_, payable := plan_payment(&g.state, p, spell_cost(&g.state, o, p), 0, nil, Payment{o, true})
	return payable
}

has_x :: proc(cost: types.ManaCost) -> bool {
	c, ok := cost.(types.ManaCost_Cost)
	if !ok do return false
	for shard in c.shards do if shard == .X do return true
	return false
}

// The largest X the player can pay for, with the mana they have.
max_x :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) -> u32 {
	saved := o.cost_x_paid
	defer o.cost_x_paid = saved
	x: u32 = 0
	for x < 40 {
		o.cost_x_paid = x + 1
		if _, payable := plan_payment(s, p, spell_cost(s, o, p), 0, nil, Payment{o, true}); !payable do break
		x += 1
	}
	return x
}

// CR 107.3a: the player announces X, then chooses the targets and pays.
choose_x :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ChooseXValue, value: u32) -> bool {
	if g.pending.object == 0 || value < w.min || value > w.max do return false
	object(&g.state, g.pending.object).cost_x_paid = value
	next_target_or_finish(g, p)
	return true
}

Pending_Cast :: struct {
	object:        types.ObjectId,
	using choice:  Target_Choice, // the targets chosen so far
	modes:         [dynamic]int, // a modal spell's chosen modes, in printed order (CR 700.2d)
	modes_chosen:  bool,
	kicker_decided: bool,
	ability_index: int, // an activated ability being activated, or -1 for a spell being cast
	cost_objects:  [dynamic]types.ObjectId, // the permanents to sacrifice or cards to discard for the cost, once chosen
	cost_chosen:   bool,
	division:      [dynamic]u32, // CR 601.2d: each target's share of what's divided, in target order
	division_decided: bool,
}

// The ability whose targets are being chosen: the spell's, or the activated ability's.
pending_ability :: proc(g: ^Game) -> ^types.AbilityDefinition {
	o := object(&g.state, g.pending.object)
	if g.pending.ability_index >= 0 do return activated_ability(o, g.pending.ability_index)
	if is_modal(o) && len(g.pending.modes) > 0 do return mode_abilities(o)[g.pending.modes[0]]
	return spell_ability(o)
}

// The target slots of what's being cast or activated.
pending_slot_list :: proc(g: ^Game) -> [dynamic]Target_Slot {
	o := object(&g.state, g.pending.object)
	if g.pending.ability_index >= 0 do return slot_list(activated_ability(o, g.pending.ability_index))
	return spell_slot_list(o, g.pending.modes[:])
}

ask_target :: proc(g: ^Game, p: types.PlayerId) {
	s := &g.state
	o := object(s, g.pending.object)
	slots := pending_slot_list(g)
	slot := g.pending.slot
	legal := slot_legal(s, slots[:], &g.pending.choice, p, o.id)
	pending := new(types.PendingCast)
	pending.object_id = o.id
	pending.card_id = o.card_id
	pending.cost = o.mana_cost
	pending.origin_zone = .Hand if g.pending.ability_index < 0 else .Battlefield
	if g.pending.ability_index >= 0 do pending.activation_ability_index = g.pending.ability_index
	target_slot_list := selection_slots(s, slots[:], p, o.id)
	selected: [dynamic]Maybe(types.TargetRef)
	for t in g.pending.targets do append(&selected, t)
	s.waiting_for = types.WaitingFor_TargetSelection {
		player = p,
		pending_cast = pending,
		target_slots = target_slot_list,
		selection = {current_slot = slot, selected_slots = selected, current_legal_targets = legal},
	}
}

choose_target :: proc(g: ^Game, p: types.PlayerId, t: types.TargetRef) -> bool {
	s := &g.state
	slots := pending_slot_list(g)
	if g.pending.slot >= len(slots) || !slice.contains(slot_legal(s, slots[:], &g.pending.choice, p, g.pending.object)[:], t) do return false
	take_target(slots[:], &g.pending.choice, t)
	next_target_or_finish(g, p)
	return true
}

// CR 115.6: declining an optional target ("up to two"): that instruction takes no more.
decline_target :: proc(g: ^Game, p: types.PlayerId) -> bool {
	slots := pending_slot_list(g)
	if g.pending.slot >= len(slots) || !slots[g.pending.slot].optional do return false
	skip_group(slots[:], &g.pending.choice)
	next_target_or_finish(g, p)
	return true
}

// CR 601.2g-i: pay the cost, and the spell is cast: it sits on the stack and its controller gets priority again
// (CR 117.3c).
finish_cast :: proc(g: ^Game, p: types.PlayerId, id: types.ObjectId, targets: []types.TargetRef) {
	s := &g.state
	o := object(s, id)
	cost_targets = {spell = id, caster = p, targets = targets} // CR 601.2f: the total cost reads the targets
	pay_mana(g, p, spell_cost(s, o, p), 0, g.pending.cost_objects[:], Payment{o, true}) // CR 605.3, 601.2h
	cost_targets = {}
	pay_additional_cost(g, p, o)
	from := o.zone // where it was cast from: flashback's exile reads it (CR 702.34a)
	if o.zone == .Command {
		s.commander_cast_count[o.id] += 1
		o.commander_tax = 2 * s.commander_cast_count[o.id]
	}
	withdraw_spell(s, id, reversed = false) // its full entry replaces the one it had while being cast (CR 601.2a)
	move_object(g, id, .Stack)
	o.cast_from_zone = from
	o.controller = p
	chain := chosen_mode_chain(o, g.pending.modes[:]) if is_modal(o) else spell_ability(o)
	resolved := resolved_tree(s, chain, targets, g.pending.counts[:], p, id)
	record_division(resolved, g.pending.division[:])
	variant: types.CastingVariant = types.CastingVariant_Normal{}
	if showing_adventure(o) do variant = types.CastingVariant_Adventure{} // CR 716.3b
	types.pvec_push(&s.stack, types.StackEntry{id = id, source_id = id, controller = p, kind = types.StackEntryKind_Spell{card_id = o.card_id, ability = resolved, casting_variant = variant}}, copy_entry)
	record_spell_cast(s, p, o, from)
	note_targeted(g, id, p, targets) // CR 601.2c
	append(&g.events, Event{kind = .Spell_Cast, object = id, controller = p}) // CR 601.2i
	s.priority_passes = nil
	give_priority(g, p)
}

copy_entry :: proc(x: types.StackEntry) -> types.StackEntry {return x}

// ---- Resolving (CR 608) -------------------------------------------------------------------------------------

resolve_top_of_stack :: proc(g: ^Game) {
	s := &g.state
	entry := types.pvec_pop(&s.stack, copy_entry)
	#partial switch k in entry.kind {
	case types.StackEntryKind_TriggeredAbility:
		resolve_ability(g, entry, k.ability)
		return
	case types.StackEntryKind_ActivatedAbility:
		resolve_ability(g, entry, k.ability)
		return
	case types.StackEntryKind_KeywordAction:
		if crew, is_crew := k.action.(types.KeywordAction_Crew); is_crew do resolve_crew(g, crew, entry.id)
		return
	}
	spell, is_spell := entry.kind.(types.StackEntryKind_Spell)
	if !is_spell do return
	o := object(s, entry.source_id)
	if is_permanent_card(o) {
		host: ^types.GameObject
		if is_aura(o) {
			// CR 608.3b-c: an Aura spell whose target is illegal doesn't resolve; otherwise it enters attached to it.
			f, _ := enchant_filter(o)
			if len(spell.ability.targets) == 0 || !same_object_as_chosen(s, spell.ability, 0) || !target_still_legal(s, spell.ability.targets[0], f, entry.controller, o.id) {
				move_object(g, o.id, .Graveyard)
				return
			}
			id, _ := target_object(spell.ability.targets[0])
			host = object(s, id)
		}
		// CR 608.3: a permanent spell resolving becomes a permanent on the battlefield under its controller.
		move_object(g, o.id, .Battlefield)
		o.controller = entry.controller
		if host != nil do attach(s, o, host)
		return
	}
	// CR 608.2n: an instant or sorcery spell goes to its owner's graveyard as the final step of resolving.
	start_resolution(g, spell.ability, entry.controller, o.id, spell = o.id)
}

is_permanent_card :: proc(o: ^types.GameObject) -> bool {
	return !is_type(o, .Instant) && !is_type(o, .Sorcery)
}

// One effect of a resolving spell.
// One instruction of a resolving spell or ability. True when it asked a player to choose (resolution pauses).
do_effect :: proc(g: ^Game, effect: types.Effect, duration: Maybe(types.Duration), controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> (asked: bool) {
	s := &g.state
	if _, known := more_effect_supported(effect, duration); known {
		do_more_effect(g, effect, controller, source, target)
		return
	}
	#partial switch x in effect {
	case types.Effect_Attach:
		return do_attach(g, x, controller, source, target)
	case types.Effect_Discard:
		who := controller
		if pid, ok := target_player(target); ok do who = pid
		n := amount(g, x.count, controller, source, target)
		return start_discard(g, who, n, x.selection == .Random, source)
	case types.Effect_Dig:
		return start_dig(g, x, controller, controller, source)
	case types.Effect_Scry:
		n, _ := fixed_quantity(x.count)
		return ask_scry(g, controller, n, false)
	case types.Effect_Surveil:
		n, _ := fixed_quantity(x.count)
		return ask_scry(g, controller, n, true)
	case types.Effect_DealDamage:
		if src, has := x.damage_source.?; has && src == .Target {
			// The first target deals it, its power as the amount (CR 608.2h): nothing if it's no longer legal.
			dealer := first_target_object(g)
			if dealer == nil do return
			if t, ok := target.?; ok do deal_damage(g, dealer.id, t, power_of(dealer))
			return
		}
		n := amount(g, x.amount, controller, source, target)
		if is_controller(x.target) do deal_damage(g, source, types.TargetRef_Player{controller}, n) // "to you"
		else if t, has := target.?; has do deal_damage(g, source, t, n)
	case types.Effect_Pump:
		pumped: ^types.GameObject
		if id, ok := target_object(target); ok do pumped = object(s, id)
		else if is_self(x.target) do pumped = same_source(g, source)
		// "This creature gets +N/+N": only while it's still the same object on the battlefield (CR 400.7).
		if pumped != nil && pumped.zone == .Battlefield do pump(g, pumped, pump_value(g, x.power, controller, source, target), pump_value(g, x.toughness, controller, source, target))
	case types.Effect_LoseLife:
		n := amount(g, x.amount, controller, source, target)
		who := controller
		if pid, ok := target_player(target); ok do who = pid
		else if t, has := x.target.?; has {
			// CR 506.2: in a two-player game, the defending player is the attacking player's opponent.
			if _, defending := t.(types.TargetFilter_DefendingPlayer); defending do who = opponent(s, controller)
		}
		lose_life(s, who, n) // CR 119.3
	case types.Effect_ChangeZone:
		if moves_found_cards(effect) do move_found_cards(g, x, controller)
		else if _, from_hand := hand_choice(x); from_hand {
			if start_hand_choice(g, x, controller, source) do return true
		} else do do_change_zone(g, x, controller, source, target)
	case types.Effect_SearchLibrary:
		start_search(g, x, controller, source)
		return true
	case types.Effect_Sacrifice:
		return do_sacrifice(g, x, controller, source, target)
	case types.Effect_CreateDelayedTrigger:
		create_delayed_trigger(g, x, controller, source)
	case types.Effect_PreventDamage:
		add_prevention(g, x, controller, source, target)
	case types.Effect_PayCost:
		if cost_payable_now(g, x, controller, source) do do_pay_cost(g, x, controller, source)
	case types.Effect_ExileTop:
		do_exile_top(g, x, controller, source, target)
	case types.Effect_GrantCastingPermission:
		do_grant_permission(g, x, controller, source)
	case types.Effect_AddTargetReplacement:
		add_exile_instead(g, target)
	case types.Effect_GainControl:
		if id, ok := target_object(target); ok {
			_, eot := duration.?
			if o := object(s, id); o != nil do gain_control(g, o, controller, eot)
		}
	case types.Effect_CopyTokenOf:
		original: ^types.GameObject
		if id, ok := target_object(target); ok do original = object(s, id)
		else if is_self(x.target) do original = same_source(g, source)
		// CR 608.2h: an object that left the battlefield is copied as it last existed there.
		if original != nil && original.zone != .Battlefield do if was := last_known(original.id); was != nil do original = was
		n, _ := fixed_quantity(x.count)
		if original != nil do for _ in 0 ..< n do create_copy_token(g, original, controller, x.tapped)
	case types.Effect_Counter:
		if id, ok := target_object(target); ok do counter_spell(g, id)
	case types.Effect_Shuffle:
		shuffle_library(g, controller)
	case types.Effect_Bounce:
		return do_bounce(g, x, controller, source, target)
	case types.Effect_Proliferate:
		return start_proliferate(g, controller)
	case types.Effect_Mana:
		add_resolving_mana(g, x, controller, source)
	case types.Effect_GenericEffect:
		targeted: ^types.GameObject
		if id, ok := target_object(target); ok do targeted = object(s, id)
		add_temp_effect(g, x, controller, source, targeted, duration)
	case types.Effect_Investigate:
		return do_effect(g, investigate_token(), duration, controller, source, target) // CR 701.16a
	case types.Effect_Amass:
		return do_amass(g, x, controller, source)
	case types.Effect_Transform:
		// CR 701.27g: an ability of the permanent transforms it only if it hasn't transformed since the ability was
		// put on the stack.
		o := same_source(g, source)
		if o == nil do break
		if count, known := g.stack_transforms[g.resolution.stack_id]; known && count != o.transformation_count do break
		transform_permanent(g, o)
	case types.Effect_Token:
		n := amount(g, x.count, controller, source, target)
		maker := controller
		if _, parent := x.owner.(types.TargetFilter_ParentTargetController); parent {
			// "Its controller creates ...": the controller of the earlier target (CR 608.2c, 608.2h).
			id, is_object := target_object(target)
			if !is_object do return
			maker = object(s, id).controller
		}
		for _ in 0 ..< n do create_token(g, x, maker, source)
	case types.Effect_Draw:
		n := amount(g, x.count, controller, source, target)
		who := controller
		if pid, ok := target_player(target); ok do who = pid // a target player, or "its controller" (CR 608.2c)
		for _ in 0 ..< n do draw_card(s, player(s, who))
	case types.Effect_GainLife:
		n := amount(g, x.amount, controller, source, target)
		who := controller
		if pid, ok := target_player(target); ok do who = pid // a target player, "its controller", "that player"
		gain_life(s, who, n)
	case types.Effect_Destroy:
		if id, ok := target_object(target); ok do destroy(g, object(s, id))
	}
	return false
}

// CR 120.3: damage to a player makes them lose that much life; to a creature, it's marked on it; to a planeswalker,
// it removes loyalty counters. CR 702.15b: a source with lifelink makes its controller gain that much life.
// CR 702.2b: deathtouch damage marks the creature for destruction.
deal_damage :: proc(g: ^Game, source: types.ObjectId, target: types.TargetRef, n: int, combat := false) {
	if n <= 0 do return
	s := &g.state
	src := object(s, source)
	if damage_prevented(g, target, combat) do return // CR 615.6
	if statically_prevented(g, source, target, combat) do return // CR 615.1a, 615.6
	if t, is_object := target.(types.TargetRef_Object); is_object && protected_from(object(s, t._0), src) do return // CR 702.16e
	if t, is_object := target.(types.TargetRef_Object); is_object {
		// CR 122.1c: "If damage would be dealt to this permanent, prevent that damage and remove a shield counter
		// from it." Prevented damage isn't dealt: no event, no lifelink.
		if o := object(s, t._0); o != nil && o.zone == .Battlefield {
			// Combat damage is dealt at once (CR 510.2): one shield counter prevents all of it to this permanent.
			if g.dealing_combat && slice.contains(g.shielded[:], o.id) do return
			if counter_count(o, types.CounterType_Shield{}) > 0 {
				remove_counters(o, types.CounterType_Shield{}, 1)
				if g.dealing_combat do append(&g.shielded, o.id)
				return
			}
		}
	}
	// CR 603.2: damage dealt is an event abilities can trigger on.
	append(&g.events, Event{kind = .Damage, object = source, target = target, amount = n, combat = combat})
	switch t in target {
	case types.TargetRef_Player:
		lose_life(s, t._0, n)
		if combat && src != nil {
			// CR 702.164c: combat damage to a player from a creature with toxic also gives poison counters equal to
			// its total toxic value (702.164b).
			toxic: u32 = 0
			for k in src.keywords do if x, is_toxic := k.(types.Keyword_Toxic); is_toxic do toxic += x._0
			if toxic > 0 do player(s, t._0).poison_counters += toxic
		}
	case types.TargetRef_Object:
		o := object(s, t._0)
		if is_type(o, .Creature) {
			o.damage_marked += u32(n)
			if src != nil && has_keyword(src, types.Keyword_Deathtouch) do o.dealt_deathtouch_damage = true
		}
		if is_type(o, .Planeswalker) {
			l := o.loyalty.? or_else 0
			o.loyalty = l - min(l, u32(n))
		}
	}
	if src != nil && has_keyword(src, types.Keyword_Lifelink) do gain_life(s, src.controller, n)
}

gain_life :: proc(s: ^types.GameState, p: types.PlayerId, n: int) {
	pl := player(s, p)
	pl.life += i32(n)
	pl.life_gained_this_turn += u32(n)
	// CR 119.9: a gain of 0 life isn't an event abilities trigger on.
	if n > 0 && action_events != nil do append(action_events, Event{kind = .Life_Gained, controller = p, amount = n})
}

lose_life :: proc(s: ^types.GameState, p: types.PlayerId, n: int) {
	pl := player(s, p)
	pl.life -= i32(n)
	pl.life_lost_this_turn += u32(n)
}

// CR 701.8: destroying a permanent moves it to its owner's graveyard (CR 702.12b: unless it's indestructible).
destroy :: proc(g: ^Game, o: ^types.GameObject) {
	if o.zone != .Battlefield || has_keyword(o, types.Keyword_Indestructible) do return
	// CR 122.1c: "If this permanent would be destroyed as the result of an effect, instead remove a shield counter."
	if counter_count(o, types.CounterType_Shield{}) > 0 {
		remove_counters(o, types.CounterType_Shield{}, 1)
		return
	}
	move_object(g, o.id, .Graveyard)
}

// CR 611.2: "+N/+N until end of turn" changes the creature's power and toughness until the cleanup step
// (CR 514.2), applied in layer 7c (CR 613.4c).
Pump :: struct {
	object:      types.ObjectId,
	incarnation: u64,
	power:       i32,
	toughness:   i32,
}

pump :: proc(g: ^Game, o: ^types.GameObject, power, toughness: i32) {
	append(&g.pumps, Pump{object = o.id, incarnation = o.incarnation, power = power, toughness = toughness})
	apply_continuous_effects(g)
}

end_until_end_of_turn_effects :: proc(g: ^Game) {
	clear(&g.pumps)
	clear(&g.preventions) // CR 514.2: "this turn" prevention ends
	end_permissions(g)
	clear(&g.exile_instead)
	// CR 514.2: "until end of turn" control ends; the permanent goes back to who controlled it before, if it's still
	// the same object.
	kept := make([dynamic]Control_Change)
	for c in g.control_changes {
		if !c.until_eot {
			append(&kept, c)
			continue
		}
		if o := object(&g.state, c.object); o != nil && o.zone == .Battlefield && o.incarnation == c.incarnation do o.controller = c.previous
	}
	g.control_changes = kept
	lasting := make([dynamic]Temp_Effect)
	for e in g.temp_effects do if e.permanent do append(&lasting, e)
	g.temp_effects = lasting
	apply_continuous_effects(g)
}

// Why this engine can't fully support a card yet: one entry per missing piece ("trigger:ChangesZone",
// "effect:Token", "keyword:Ward", ...), for the coverage report to rank what to build next. Empty when supported.
card_gaps :: proc(face: ^types.CardFace, back_face := false) -> [dynamic]string {
	out := make([dynamic]string, context.temp_allocator)
	if misparsed(face.name) do append(&out, "card data: misparsed")
	if !is_land_face(face) && !back_face {
		// As card_supported: a spell needs a mana cost it can pay (CR 118.6, 107.4e-f).
		c, is_cost := face.mana_cost.(types.ManaCost_Cost)
		if !is_cost do append(&out, "mana cost: none")
		else do for shard in c.shards do if _, _, ok := shard_payers(shard); !ok {
			append(&out, "mana cost: symbol")
			break
		}
	}
	name :: proc(prefix: string, v: any) -> string {
		full := fmt.tprintf("%v", reflect.union_variant_typeid(v))
		if i := strings.last_index_byte(full, '_'); i >= 0 do full = full[i + 1:]
		return strings.concatenate({prefix, full}, context.temp_allocator)
	}
	for t in face.triggers do if !trigger_supported(t) {
		// For a kind of trigger the engine handles, what's missing is its effect or a condition on it.
		#partial switch _ in t.mode {
		case types.TriggerMode_ChangesZone, types.TriggerMode_Phase, types.TriggerMode_Attacks, types.TriggerMode_YouAttack,
		     types.TriggerMode_SpellCast, types.TriggerMode_DamageDone, types.TriggerMode_DamageDoneOnceByController,
		     types.TriggerMode_EntersOrAttacks, types.TriggerMode_LeavesBattlefield, types.TriggerMode_Taps,
		     types.TriggerMode_LifeGained, types.TriggerMode_Drawn, types.TriggerMode_DamageReceived,
		     types.TriggerMode_Sacrificed, types.TriggerMode_CounterAdded:
			event_amount_defined = trigger_has_amount(t)
			event_object_defined, event_player_defined = trigger_has_object(t), trigger_has_player(t)
			if t.execute != nil && !ability_supported(t.execute^) do ability_gaps(&out, t.execute^, "trigger")
			else do append(&out, name("trigger condition:", t.mode))
			event_amount_defined, event_object_defined, event_player_defined = false, false, false
		case:
			append(&out, name("trigger:", t.mode))
		}
	}
	for st in face.static_abilities do if !static_supported(st) && !static_mode_supported(st) && !cost_modifier_supported(st) do append(&out, static_gap(st))
	x_defined = has_x(face.mana_cost) // CR 107.3m, as card_supported checks it
	for r in face.replacements do if !replacement_supported(r) do append(&out, name("replacement:", r.event))
	for r in face.replacements do if static_prevention_supported(r) && prevention_reads_attachment(r) {
		if !slice.contains(face.card_type.subtypes[:], "Aura") && !slice.contains(face.card_type.subtypes[:], "Equipment") do append(&out, "replacement:DamageDone (enchanted creatures)")
	}
	x_defined = false
	if !additional_cost_supported(face) do append(&out, "additional cost")
	if !modal_supported(face) do append(&out, "modal")
	if len(face.casting_options) > 0 do append(&out, "casting option")
	if len(face.casting_restrictions) > 0 do append(&out, "casting restriction")
	if face.strive_cost != nil do append(&out, "keyword:Strive")
	if face.cleave_variant != nil do append(&out, "keyword:Cleave")
	if face.solve_condition != nil do append(&out, "solve condition")
	for a in face.abilities {
		switch a.kind {
		case .Spell:
			x_defined = has_x(face.mana_cost)
			if !spell_ability_supported(a) do ability_gaps(&out, a, "spell")
			x_defined = false
		case .Activated:
			if _, _, ok := tap_mana_ability(a); !ok && !activated_supported(a) {
				if a.effect != nil && !ability_supported(a) do ability_gaps(&out, a, "activated")
				else if cost, has := a.cost.?; has && !cost_supported(cost) do append(&out, name("cost:", cost))
				else do append(&out, activated_gap(a))
			}
		case .Database, .BeginGame, .Mulligan:
			append(&out, fmt.tprintf("ability:%v", a.kind))
		}
	}
	for k in face.keywords do if !keyword_supported(k) do append(&out, name("keyword:", k))
	return out
}

// The specific part of a static ability that isn't supported, for the coverage report.
static_gap :: proc(st: types.StaticDefinition) -> string {
	variant :: proc(v: any) -> string {
		full := fmt.tprintf("%v", reflect.union_variant_typeid(v))
		if i := strings.last_index_byte(full, '_'); i >= 0 do full = full[i + 1:]
		return full
	}
	if _, continuous := st.mode.(types.StaticMode_Continuous); !continuous do return strings.concatenate({"static:", variant(st.mode)}, context.temp_allocator)
	if c, has := st.condition.?; has && !condition_supported(c) do return strings.concatenate({"static condition:", variant(c)}, context.temp_allocator)
	for m in st.modifications do if !modification_supported(m) do return strings.concatenate({"static change:", variant(m)}, context.temp_allocator)
	if a, has := st.affected.?; has && !affected_supported(a) do return strings.concatenate({"static affects:", variant(a)}, context.temp_allocator)
	return "static:Continuous (other)"
}

@(private = "file")
ability_gaps :: proc(out: ^[dynamic]string, a: types.AbilityDefinition, prefix: string) {
	if c, has := a.condition.?; has && !ability_condition_supported(c) {
		// Named by its kind ("spell:condition:IsYourTurn"); one made of others by the first part not supported.
		inner := unsupported_condition_part(c)
		full := fmt.tprintf("%v", reflect.union_variant_typeid(inner))
		if i := strings.last_index_byte(full, '_'); i >= 0 do full = full[i + 1:]
		append(out, strings.concatenate({"spell:condition:", full}, context.temp_allocator))
	}
	if a.optional_targeting do append(out, "spell:optional")
	if a.modal != nil do append(out, "spell:modal")
	if !multi_target_supported(a) do append(out, "spell:multiple targets")
	if !distribute_supported(a) do append(out, "spell:divided")
	if a.repeat_for != nil do append(out, "spell:repeat")
	if !unless_pay_supported(a) do append(out, "spell:unless pay")
	if a.else_ability != nil do append(out, "spell:otherwise")
	if a.effect != nil && !effect_supported(a.effect^, a.duration) {
		full := fmt.tprintf("%v", reflect.union_variant_typeid(a.effect^))
		if i := strings.last_index_byte(full, '_'); i >= 0 do full = full[i + 1:]
		detail := ""
		#partial switch e in a.effect^ {
		case types.Effect_GenericEffect:
			if t, has := e.target.?; has && !(is_self(t) || filter_supported(t)) do detail = fmt.tprintf(" (target %v)", reflect.union_variant_typeid(t))
			for st in e.static_abilities {
				if detail != "" do break
				if st.condition != nil {
					detail = " (condition)"
					break
				}
				if _, c := st.mode.(types.StaticMode_Continuous); !c && rule_modes(st.mode) == {} {
					detail = fmt.tprintf(" (mode %v)", reflect.union_variant_typeid(st.mode))
					break
				}
				for m in st.modifications do if !modification_supported(m) {
					detail = fmt.tprintf(" (%v)", reflect.union_variant_typeid(m))
					break
				}
				if aff, has := st.affected.?; detail == "" && has {
					#partial switch _ in aff {
					case types.TargetFilter_ParentTarget, types.TargetFilter_SelfRef:
					case:
						if !mass_filter_supported(aff) do detail = fmt.tprintf(" (affects %v)", reflect.union_variant_typeid(aff))
					}
				}
			}
			if d, has := e.duration.?; detail == "" do detail = fmt.tprintf(" (duration %v)", reflect.union_variant_typeid(d) if has else nil)
		case types.Effect_Mana:
			detail = fmt.tprintf(" (%v)", reflect.union_variant_typeid(e.produced))
		}
		append(out, strings.concatenate({"effect:", full, detail}, context.temp_allocator))
	}
	if a.sub_ability != nil do ability_gaps(out, a.sub_ability^, prefix)
}

is_land_face :: proc(face: ^types.CardFace) -> bool {
	for t in face.card_type.core_types do if t == .Land do return true
	return false
}

// CR 400.7: an object that changes zones is a new object. Each object target is remembered with the incarnation it
// had when chosen, so a card that left and came back isn't the same target (CR 608.2b).
record_target_incarnations :: proc(s: ^types.GameState, resolved: ^types.ResolvedAbility) {
	clear(&resolved.target_incarnations)
	for t in resolved.targets {
		ref: types.ObjectIncarnationRef
		if o, is_object := t.(types.TargetRef_Object); is_object {
			ref = types.ObjectIncarnationRef{object_id = o._0, incarnation = object(s, o._0).incarnation}
		}
		append(&resolved.target_incarnations, ref)
	}
}

same_object_as_chosen :: proc(s: ^types.GameState, resolved: ^types.ResolvedAbility, i: int) -> bool {
	o, is_object := resolved.targets[i].(types.TargetRef_Object)
	if !is_object || i >= len(resolved.target_incarnations) do return true
	return object(s, o._0).incarnation == resolved.target_incarnations[i].incarnation
}

// The object or player an effect's target is, if it has one (and is that kind).
target_object :: proc(target: Maybe(types.TargetRef)) -> (types.ObjectId, bool) {
	t, has := target.?
	if !has do return 0, false
	o, is_object := t.(types.TargetRef_Object)
	return o._0, is_object
}

target_player :: proc(target: Maybe(types.TargetRef)) -> (types.PlayerId, bool) {
	t, has := target.?
	if !has do return 0, false
	p, is_player := t.(types.TargetRef_Player)
	return p._0, is_player
}

// An instruction's amount, worked out now (CR 608.2h: the values are determined as it's carried out). "Its"
// refers to the ability's first object target.
amount :: proc(g: ^Game, q: types.QuantityExpr, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> int {
	first: types.ObjectId
	if id, ok := target_object(target); ok do first = id
	else do for t in g.resolution.all_targets do if o, is_object := t.(types.TargetRef_Object); is_object {
		first = o._0
		break
	}
	return quantity_value(&g.state, q, controller, source, first)
}

// "You may cast this spell as though it had flash" printed on the card itself (CR 702.8, 601.3b).
has_own_flash_rule :: proc(o: ^types.GameObject) -> bool {
	if o.static_definitions == nil do return false
	for &st in o.static_definitions^ do if .Flash in rule_modes(st.mode) && static_mode_supported(st) do return true
	return false
}

// A token's power or toughness: a number, or an amount worked out as it's created ("an X/X token").
pt_supported :: proc(v: types.PtValue) -> bool {
	#partial switch x in v {
	case types.PtValue_Fixed:
		return true
	case types.PtValue_Quantity:
		return quantity_supported(x._0)
	}
	return false
}

// "+N/+N", "+X/+X where X is ...", "-X/-X" (the spell's X): the amounts of a pump.
pump_value_supported :: proc(v: types.PtValue) -> bool {
	#partial switch x in v {
	case types.PtValue_Variable:
		return (x._0 == "X" || x._0 == "-X") && x_defined
	}
	return pt_supported(v)
}

// CR 608.2h: an amount in an instruction is worked out once, as it resolves; the pump doesn't change after.
pump_value :: proc(g: ^Game, v: types.PtValue, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> i32 {
	#partial switch x in v {
	case types.PtValue_Fixed:
		return x._0
	case types.PtValue_Quantity:
		return i32(amount(g, x._0, controller, source, target))
	case types.PtValue_Variable:
		xq := types.QuantityExpr(types.QuantityExpr_Ref{qty = types.QuantityRef_Variable{name = "X"}})
		n := i32(amount(g, xq, controller, source, target))
		return -n if x._0 == "-X" else n
	}
	return 0
}

// CR 613.1b: a control-changing effect (layer 2). The permanent leaves combat (CR 506.4) and, as its new
// controller hasn't controlled it continuously since their turn began, can't attack or {T} unless it has haste
// (CR 302.6).
gain_control :: proc(g: ^Game, o: ^types.GameObject, controller: types.PlayerId, until_eot: bool) {
	if o.zone != .Battlefield || o.controller == controller do return
	append(&g.control_changes, Control_Change{object = o.id, incarnation = o.incarnation, previous = o.controller, until_eot = until_eot})
	o.controller = controller
	o.summoning_sick = true
	remove_from_combat(&g.state, o.id)
	apply_continuous_effects(g)
}

is_power_of_target :: proc(q: types.QuantityExpr) -> bool {
	r, is_ref := q.(types.QuantityExpr_Ref)
	if !is_ref do return false
	p, is_power := r.qty.(types.QuantityRef_Power)
	if !is_power do return false
	_, of_target := p.scope.(types.ObjectScope_Target)
	return of_target
}

// The resolving spell's or ability's first target, while it's still a legal one on the battlefield (CR 608.2b).
first_target_object :: proc(g: ^Game) -> ^types.GameObject {
	s := &g.state
	top := g.resolution.top
	if top == nil || len(top.targets) == 0 || slice.contains(top.illegal_target_slots[:], 0) do return nil
	id, ok := target_object(top.targets[0])
	if !ok do return nil
	o := object(s, id)
	if o == nil || o.zone != .Battlefield do return nil
	return o
}

// ---- Conditions on instructions ("if ...", CR 608.2c) ---------------------------------------------------------

ability_condition_supported :: proc(c: types.AbilityCondition) -> bool {
	if _, is_outcome := outcome_wanted(c); is_outcome do return true // "if you do" / "if you don't"
	#partial switch x in c {
	case types.AbilityCondition_AdditionalCostPaid:
		_, of_source := x.subject.(types.ObjectScope_Source)
		return of_source && x.source != .NonKicker && x.origin == nil && x.variant == nil
	case types.AbilityCondition_AdditionalCostPaidInstead:
		return true
	case types.AbilityCondition_ConditionInstead:
		// "If [condition], [this] instead": replaces the instruction before it when the condition holds.
		return x.inner != nil && ability_condition_supported(x.inner^)
	case types.AbilityCondition_QuantityCheck:
		return quantity_supported(x.lhs) && quantity_supported(x.rhs)
	case types.AbilityCondition_TargetMatchesFilter:
		// "If that creature is attacking": the target chosen for an earlier slot, as it is now. Unset, the subject is
		// the target (the card data leaves the default out).
		typed, ok := x.filter.(types.TargetFilter_Typed)
		_, of_target := x.subject.(types.ObjectScope_Target)
		of_target = of_target || x.subject == nil
		slot, has_slot := x.subject_slot.?
		return ok && of_target && object_condition_filter_supported(typed._0) && (!has_slot || slot == 0)
	case types.AbilityCondition_SourceMatchesFilter:
		typed, ok := x.filter.(types.TargetFilter_Typed)
		return ok && object_condition_filter_supported(typed._0)
	case types.AbilityCondition_ZoneChangedThisWay:
		// "If a card was exiled this way" (resolution.odin reads what the instruction before moved).
		typed, ok := x.filter.(types.TargetFilter_Typed)
		return ok && object_condition_filter_supported(typed._0)
	case types.AbilityCondition_And:
		for y in x.conditions do if !ability_condition_supported(y) do return false
		return len(x.conditions) > 0
	case types.AbilityCondition_Or:
		for y in x.conditions do if !ability_condition_supported(y) do return false
		return len(x.conditions) > 0
	case types.AbilityCondition_Not:
		return x.condition != nil && ability_condition_supported(x.condition^)
	case types.AbilityCondition_IsYourTurn, types.AbilityCondition_CastDuringPhase:
		return true
	}
	return false
}

// CR 118.12a: "[do something] unless [a player pays a cost]": supported for "counter target spell unless its
// controller pays {N}", a mana cost the spell's controller chooses whether to pay as the counterspell resolves.
unless_pay_supported :: proc(a: types.AbilityDefinition) -> bool {
	u, has := a.unless_pay.?
	if !has do return true
	if a.effect == nil do return false
	if _, counter := a.effect^.(types.Effect_Counter); !counter do return false
	if _, of_controller := u.payer.(types.TargetFilter_ParentTargetController); !of_controller do return false
	m, is_mana := u.cost.(types.AbilityCost_Mana)
	if !is_mana do return false
	c, is_cost := m.cost.(types.ManaCost_Cost)
	if !is_cost do return false
	for shard in c.shards do if _, _, ok := shard_payers(shard); !ok || shard == .X do return false
	return true
}

// The innermost part of a condition that isn't supported, for the coverage report.
unsupported_condition_part :: proc(c: types.AbilityCondition) -> types.AbilityCondition {
	#partial switch x in c {
	case types.AbilityCondition_ConditionInstead:
		if x.inner != nil do return unsupported_condition_part(x.inner^)
	case types.AbilityCondition_Not:
		if x.condition != nil do return unsupported_condition_part(x.condition^)
	case types.AbilityCondition_And:
		for y in x.conditions do if !ability_condition_supported(y) do return unsupported_condition_part(y)
	case types.AbilityCondition_Or:
		for y in x.conditions do if !ability_condition_supported(y) do return unsupported_condition_part(y)
	}
	return c
}

// A filter read of one object already named ("if it had mana value 3 or less"): no types listed means any object.
@(private = "file")
object_condition_filter_supported :: proc(f: types.TypedFilter) -> bool {
	if len(f.type_filters) > 0 do return typed_supported(f)
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

// Checked as the instruction is carried out.
ability_condition_holds :: proc(s: ^types.GameState, c: types.AbilityCondition, controller: types.PlayerId, source: types.ObjectId, subjects: []types.TargetRef) -> bool {
	#partial switch x in c {
	case types.AbilityCondition_QuantityCheck:
		return compare(quantity_value(s, x.lhs, controller, source, 0), x.comparator, quantity_value(s, x.rhs, controller, source, 0))
	case types.AbilityCondition_TargetMatchesFilter:
		// The (legal) target the instruction acts on; CR 608.2b: nothing is learned from an illegal one.
		if len(subjects) == 0 do return false
		id, is_object := target_object(subjects[0])
		if !is_object do return false
		o := object(s, id)
		// "If it had mana value 3 or less": once it has left the battlefield, as it last existed there (CR 608.2h).
		if x.use_lki do if was := last_known(id); was != nil do o = was
		return o != nil && object_matches(s, o, x.filter.(types.TargetFilter_Typed)._0, controller, source)
	case types.AbilityCondition_SourceMatchesFilter:
		o := object(s, source)
		return o != nil && object_matches(s, o, x.filter.(types.TargetFilter_Typed)._0, controller, source)
	case types.AbilityCondition_AdditionalCostPaid, types.AbilityCondition_AdditionalCostPaidInstead:
		return kicked(object(s, source)) // CR 702.33d
	case types.AbilityCondition_ConditionInstead:
		return ability_condition_holds(s, x.inner^, controller, source, subjects)
	case types.AbilityCondition_IsYourTurn:
		return s.active_player == controller
	case types.AbilityCondition_CastDuringPhase:
		// Addendum, "if you cast this spell during your main phase": a spell resolves in the turn and phase it was
		// cast in, since a phase ends only once the stack is empty (CR 500.2), so it's whether it's that now.
		return s.active_player == controller && slice.contains(x.phases[:], s.phase)
	case types.AbilityCondition_And:
		for y in x.conditions do if !ability_condition_holds(s, y, controller, source, subjects) do return false
		return true
	case types.AbilityCondition_Or:
		for y in x.conditions do if ability_condition_holds(s, y, controller, source, subjects) do return true
		return false
	case types.AbilityCondition_Not:
		return !ability_condition_holds(s, x.condition^, controller, source, subjects)
	}
	return false
}

// The spells each player has cast this turn ("your second spell each turn"), kept in the state.
record_spell_cast :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, from: types.Zone) {
	s.spells_cast_this_turn += 1
	if s.spells_cast_this_turn_by_player == nil do s.spells_cast_this_turn_by_player = make(map[types.PlayerId]types.PVec(types.SpellCastRecord))
	list := s.spells_cast_this_turn_by_player[p]
	rec := types.SpellCastRecord{name = o.name, mana_value = u32(object_mana_value(o)), spell_object_id = o.id, from_zone = from}
	types.pvec_push(&list, rec, proc(x: types.SpellCastRecord) -> types.SpellCastRecord {return x})
	s.spells_cast_this_turn_by_player[p] = list
}

spells_cast_this_turn_by :: proc(s: ^types.GameState, p: types.PlayerId) -> int {
	if list, ok := s.spells_cast_this_turn_by_player[p]; ok do return types.pvec_len(list)
	return 0
}

// "Each player draws a card", "each opponent loses 1 life": an instruction for each player in the scope, as that
// player. Supported for instructions about the player themself with fixed amounts (a "you" inside an amount would
// be ambiguous).
player_scope_ok :: proc(scope: types.PlayerFilter, a: types.AbilityDefinition) -> bool {
	#partial switch _ in scope {
	case types.PlayerFilter_All, types.PlayerFilter_Opponent:
	case:
		return false
	}
	if a.optional || a.effect == nil do return false
	#partial switch x in a.effect^ {
	case types.Effect_LoseLife:
		_, fixed := fixed_quantity(x.amount)
		t, has := x.target.?
		return fixed && (!has || is_controller(t))
	case types.Effect_GainLife:
		_, fixed := fixed_quantity(x.amount)
		return fixed && is_controller(x.player)
	case types.Effect_Draw:
		_, fixed := fixed_quantity(x.count)
		return fixed && is_controller(x.target)
	case types.Effect_Discard:
		_, fixed := fixed_quantity(x.count)
		return fixed && is_controller(x.target)
	case types.Effect_Mill:
		_, fixed := fixed_quantity(x.count)
		return fixed && is_controller(x.target)
	case types.Effect_Sacrifice:
		return !is_self(x.target)
	}
	return false
}

// The players an instruction is carried out for: each player starting with the active player, or each opponent
// (CR 101.4: in turn order, starting with the active player).
scope_players :: proc(s: ^types.GameState, scope: types.PlayerFilter, controller: types.PlayerId) -> [dynamic]types.PlayerId {
	out: [dynamic]types.PlayerId
	n := len(s.players)
	for i in 0 ..< n {
		p := types.PlayerId((int(s.active_player) + i) % n)
		if _, opponents := scope.(types.PlayerFilter_Opponent); opponents && p == controller do continue
		if player(s, p).is_eliminated do continue
		append(&out, p)
	}
	return out
}

// ---- Additional costs (CR 601.2b, 601.2h) ----------------------------------------------------------------------

// "As an additional cost to cast this spell, sacrifice a creature / discard a card / pay 3 life".
additional_cost :: proc(face: ^types.CardFace) -> (types.AbilityCost, bool) {
	a, has := face.additional_cost.?
	if !has do return nil, false
	req, required := a.(types.AdditionalCost_Required)
	if !required do return nil, false
	return req._0, true
}

additional_cost_supported :: proc(face: ^types.CardFace) -> bool {
	if face.additional_cost == nil do return true
	if _, kicker := kicker_cost(face); kicker do return true
	cost, ok := additional_cost(face)
	if !ok || !cost_supported(cost) do return false
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts_of(cost, &parts)
	for part in parts {
		#partial switch x in part {
		case types.AbilityCost_Sacrifice:
			if is_self(x._0.target) do return false
		case types.AbilityCost_Discard:
			if x.self_scope == .SourceCard do return false
		case types.AbilityCost_PayLife:
		case:
			return false // mana, tapping: not as a spell's additional cost here
		}
	}
	return true
}

spell_additional_cost :: proc(o: ^types.GameObject) -> (types.AbilityCost, bool) {
	f := object_face(o)
	return additional_cost(&f)
}

// Whether the additional cost can be paid: enough to sacrifice or discard (not counting the spell itself), and the
// life (CR 119.4).
additional_cost_payable :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) -> bool {
	cost, has := spell_additional_cost(o)
	if !has do return true
	if c, chooses := object_cost_of(s, p, o, cost); chooses {
		others := make([dynamic]types.ObjectId, context.temp_allocator)
		for id in c.choices do if id != o.id do append(&others, id)
		if !cost_objects_leave_mana(s, p, others[:], c.count, spell_cost(s, o, p), 0, Payment{o, true}) do return false
	}
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts_of(cost, &parts)
	for part in parts do if life, ok := part.(types.AbilityCost_PayLife); ok {
		n, _ := fixed_quantity(life.amount)
		if int(player(s, p).life) < n do return false
	}
	return true
}

// Pays the additional cost as the spell is cast (CR 601.2h): the chosen permanents sacrificed or cards discarded,
// life paid.
pay_additional_cost :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) {
	cost, has := spell_additional_cost(o)
	if !has do return
	together := begin_together() // paid at once ("sacrifice two creatures")
	for id in g.pending.cost_objects do pay_with_object(g, id)
	end_together(together)
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts_of(cost, &parts)
	for part in parts do if life, ok := part.(types.AbilityCost_PayLife); ok {
		n, _ := fixed_quantity(life.amount)
		lose_life(&g.state, p, n) // CR 119.4
	}
}

// Why an activated ability whose effect and cost are supported still isn't: for the gap report.
@(private = "file")
activated_gap :: proc(a: types.AbilityDefinition) -> string {
	if a.activator_filter != nil do return "activated: another player activates"
	if a.activation_mana_payment_restriction != nil do return "activated: mana payment restriction"
	if a.cost_reduction != nil do return "activated: cost reduction"
	if zone, has := a.activation_zone.?; has do return fmt.tprintf("activated: from %v", zone)
	for r in a.activation_restrictions do if !restriction_supported(r) {
		if c, ok := r.(types.ActivationRestriction_RequiresCondition); ok {
			if cond, has := c.condition.?; has do return fmt.tprintf("activated: only if %v", reflect.union_variant_typeid(cond))
		}
		return fmt.tprintf("activated: restriction %v", reflect.union_variant_typeid(r))
	}
	return "activated: other"
}
