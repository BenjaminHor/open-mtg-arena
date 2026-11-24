// Casting spells (CR 601), targets (CR 115), the stack and resolving (CR 405, 608), and the effects spells have.
// Only what's implemented is allowed: a card with an ability this engine can't carry out isn't castable
// (card_supported), so nothing is ever half done.
package game

import "core:fmt"
import "core:reflect"
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
card_supported :: proc(face: ^types.CardFace) -> bool {
	for r in face.replacements do if !replacement_supported(r) do return false
	for st in face.static_abilities do if !static_supported(st) && !static_mode_supported(st) do return false
	for t in face.triggers do if !trigger_supported(t) do return false
	if face.additional_cost != nil || face.modal != nil || len(face.casting_options) > 0 do return false
	// A spell needs a mana cost it can pay (CR 118.6, 107.4e-f); lands aren't cast.
	if !is_land_face(face) {
		c, is_cost := face.mana_cost.(types.ManaCost_Cost)
		if !is_cost do return false
		for shard in c.shards do if _, _, ok := shard_payers(shard); !ok do return false
	}
	for a in face.abilities {
		switch a.kind {
		case .Spell:
			if !spell_ability_supported(a) do return false
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
	     types.Keyword_Indestructible, types.Keyword_Hexproof, types.Keyword_Shroud:
		return true
	case types.Keyword_Enchant:
		// CR 702.5a: an Aura enchants a permanent of a kind (enchanting players isn't modelled yet).
		t, typed := k._0.(types.TargetFilter_Typed)
		return typed && typed_supported(t._0)
	case types.Keyword_Equip:
		_, ok := k._0.(types.ManaCost_Cost)
		return ok
	}
	return false
}

spell_ability_supported :: proc(a: types.AbilityDefinition) -> bool {
	return !a.optional && ability_supported(a)
}

// An ability this engine can carry out: each effect in its chain supported, with no conditions or choices beyond
// targets and (for triggered abilities, CR 603.5) whether to do it at all.
ability_supported :: proc(a: types.AbilityDefinition) -> bool {
	if a.effect == nil || a.condition != nil || a.optional_targeting || a.modal != nil do return false
	// "Each player draws", "an opponent draws", "for each creature chosen": scopes and groups not carried out yet.
	// (Declaring a group is harmless while nothing reads it; reading one isn't supported.)
	if a.player_scope != nil || a.reads_chosen_group != nil || a.starting_with != nil do return false
	if a.target_chooser != nil || a.optional_player != nil || a.optional_for != nil do return false
	if a.multi_target != nil || a.distribute != nil || a.repeat_for != nil || a.unless_pay != nil do return false
	if a.else_ability != nil do return false
	if !effect_supported(a.effect^, a.duration) do return false
	if a.sub_ability != nil do return a.sub_ability.optional == a.optional && ability_supported(a.sub_ability^)
	return true
}

effect_supported :: proc(e: types.Effect, duration: Maybe(types.Duration)) -> bool {
	if supported, known := more_effect_supported(e, duration); known do return supported
	#partial switch x in e {
	case types.Effect_DealDamage:
		fixed := quantity_supported(x.amount)
		return fixed && x.damage_source == nil && x.excess == nil && filter_supported(x.target)
	case types.Effect_Pump:
		_, pf := x.power.(types.PtValue_Fixed)
		_, tf := x.toughness.(types.PtValue_Fixed)
		d, has := duration.?
		_, eot := d.(types.Duration_UntilEndOfTurn)
		// A pump aimed at "any target" is a misparsed mass pump: a player can't get +N/+N.
		return pf && tf && has && eot && (is_self(x.target) || (filter_supported(x.target) && !is_any(x.target)))
	case types.Effect_LoseLife:
		fixed := quantity_supported(x.amount)
		t, has := x.target.?
		_, you := t.(types.TargetFilter_Controller)
		return fixed && (!has || you)
	case types.Effect_Token:
		fixed := quantity_supported(x.count)
		_, pf := x.power.(types.PtValue_Fixed)
		_, tf := x.toughness.(types.PtValue_Fixed)
		_, you := x.owner.(types.TargetFilter_Controller)
		return fixed && pf && tf && you && x.attach_to == nil && !x.enters_attacking && len(x.static_abilities) == 0 && len(x.enter_with_counters) == 0
	case types.Effect_Draw:
		fixed := quantity_supported(x.count)
		_, you := x.target.(types.TargetFilter_Controller)
		return fixed && you
	case types.Effect_GenericEffect:
		return generic_effect_supported(x)
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
		fixed := quantity_supported(x.amount)
		_, you := x.player.(types.TargetFilter_Controller)
		return fixed && (you || x.player == nil)
	case types.Effect_Destroy:
		return !x.cant_regenerate && filter_supported(x.target) && !is_any(x.target)
	}
	return false
}

// The target filters this engine can find targets for.
filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Any, types.TargetFilter_Player, types.TargetFilter_Opponent:
		return true
	case types.TargetFilter_Typed:
		return typed_supported(x._0)
	}
	return false
}

// ---- Targets (CR 115) ----------------------------------------------------------------------------------------

// The target an effect asks for, if it targets (CR 115.1: the word "target"; here, a filter naming what can be
// chosen rather than "this" or "you").
effect_target :: proc(e: types.Effect) -> (types.TargetFilter, bool) {
	f: types.TargetFilter
	#partial switch x in e {
	case types.Effect_DealDamage:
		f = x.target
	case types.Effect_Pump:
		f = x.target
	case types.Effect_Destroy:
		f = x.target
	case types.Effect_GenericEffect:
		f = x.target.? or_else nil
	case types.Effect_ChangeZone:
		f = x.target
	case types.Effect_Bounce:
		f = x.target
	case types.Effect_Attach:
		f = x.target
	case types.Effect_PutCounter:
		f = x.target
	case types.Effect_SetTapState:
		f = x.target
	case types.Effect_Mill:
		f = x.target
	case types.Effect_Discard:
		f = x.target
	case:
		return nil, false
	}
	#partial switch _ in f {
	case types.TargetFilter_Any, types.TargetFilter_Player, types.TargetFilter_Opponent, types.TargetFilter_Typed:
		return f, true
	}
	return nil, false
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

// The targets of a spell: an Aura spell's single target from its enchant ability (CR 303.4a), or one per
// targeting instruction.
spell_target_slots :: proc(o: ^types.GameObject) -> [dynamic]types.TargetFilter {
	if is_aura(o) {
		out := make([dynamic]types.TargetFilter, context.temp_allocator)
		f, _ := enchant_filter(o)
		append(&out, f)
		return out
	}
	return target_slots(spell_ability(o))
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
				if targetable_by(o, controller) do append(&out, types.TargetRef_Object{id})
			}
		}
		for p in s.players do append(&out, types.TargetRef_Player{p.id})
	case types.TargetFilter_Player:
		for p in s.players do append(&out, types.TargetRef_Player{p.id})
	case types.TargetFilter_Opponent:
		for p in s.players do if p.id != controller do append(&out, types.TargetRef_Player{p.id})
	case types.TargetFilter_Typed:
		if gf, in_graveyard := graveyard_filter(f); in_graveyard {
			graveyard_targets(s, gf, controller, &out)
			return out
		}
		for id in ids_of(s.battlefield) {
			o := object(s, id)
			if !object_matches(s, o, x._0, controller, source) do continue
			if targetable_by(o, controller) do append(&out, types.TargetRef_Object{id})
		}
	}
	return out
}

// CR 702.18 (shroud) and 702.11 (hexproof): objects that can't be the target of spells, or of an opponent's.
targetable_by :: proc(o: ^types.GameObject, controller: types.PlayerId) -> bool {
	if has_keyword(o, types.Keyword_Shroud) do return false
	if o.controller != controller && has_keyword(o, types.Keyword_Hexproof) do return false
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
	// From the hand, or a commander from the command zone (CR 903.8).
	if o.owner != p || !(o.zone == .Hand || (o.zone == .Command && o.is_commander)) do return false
	if !object_supported(o, card_db) || !can_cast_now(s, p, o) do return false
	for f in spell_target_slots(o) do if len(legal_targets(s, f, p, o.id)) == 0 do return false
	_, payable := plan_payment(s, p, spell_cost(s, o))
	return payable
}

// The total cost to cast it: its mana cost, plus {2} for each earlier cast of a commander from the command zone
// (CR 903.8, the commander tax).
spell_cost :: proc(s: ^types.GameState, o: ^types.GameObject) -> types.ManaCost {
	if o.zone != .Command do return o.mana_cost
	c, is_cost := o.mana_cost.(types.ManaCost_Cost)
	if !is_cost do return o.mana_cost
	c.generic += 2 * s.commander_cast_count[o.id]
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

object_supported :: proc(o: ^types.GameObject, card_db: Card_Lookup) -> bool {
	if card_db == nil do return false
	entry := card_db(o.base_name)
	return entry != nil && card_supported(&entry.face)
}

// CR 601.2: casting. The card moves to the stack (601.2a), its targets are chosen (601.2c; when the action didn't
// name them, the player is asked, one target at a time), the cost is paid (601.2g-h) and the spell becomes cast.
cast_spell :: proc(g: ^Game, p: types.PlayerId, id: types.ObjectId, targets: []types.TargetRef) -> bool {
	s := &g.state
	o := object(s, id)
	if !castable(s, p, o, g.card_db) do return false
	slots := spell_target_slots(o)
	chosen: [dynamic]types.TargetRef
	for t, i in targets {
		if i >= len(slots) || !target_still_legal(s, t, slots[i], p, id) do return false
		append(&chosen, t)
	}
	if len(chosen) < len(slots) {
		// CR 601.2c: ask for the next target.
		g.pending = Pending_Cast{object = id, targets = chosen, ability_index = -1}
		ask_target(g, p)
		return true
	}
	finish_cast(g, p, id, chosen[:])
	return true
}

Pending_Cast :: struct {
	object:        types.ObjectId,
	targets:       [dynamic]types.TargetRef,
	ability_index: int, // an activated ability being activated, or -1 for a spell being cast
}

// The ability whose targets are being chosen: the spell's, or the activated ability's.
pending_ability :: proc(g: ^Game) -> ^types.AbilityDefinition {
	o := object(&g.state, g.pending.object)
	if g.pending.ability_index >= 0 do return activated_ability(o, g.pending.ability_index)
	return spell_ability(o)
}

// The target slots of what's being cast or activated.
pending_slots :: proc(g: ^Game) -> [dynamic]types.TargetFilter {
	o := object(&g.state, g.pending.object)
	if g.pending.ability_index >= 0 do return target_slots(activated_ability(o, g.pending.ability_index))
	return spell_target_slots(o)
}

ask_target :: proc(g: ^Game, p: types.PlayerId) {
	s := &g.state
	o := object(s, g.pending.object)
	slots := pending_slots(g)
	slot := len(g.pending.targets)
	legal := legal_targets(s, slots[slot], p, o.id)
	pending := new(types.PendingCast)
	pending.object_id = o.id
	pending.card_id = o.card_id
	pending.cost = o.mana_cost
	pending.origin_zone = .Hand if g.pending.ability_index < 0 else .Battlefield
	if g.pending.ability_index >= 0 do pending.activation_ability_index = g.pending.ability_index
	target_slot_list: [dynamic]types.TargetSelectionSlot
	for f in slots do append(&target_slot_list, types.TargetSelectionSlot{legal_targets = legal_targets(s, f, p, o.id)})
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
	slots := pending_slots(g)
	slot := len(g.pending.targets)
	if !target_still_legal(s, t, slots[slot], p, g.pending.object) do return false
	append(&g.pending.targets, t)
	if len(g.pending.targets) < len(slots) {
		ask_target(g, p)
		return true
	}
	if g.pending.ability_index >= 0 do finish_activation(g, p, g.pending.object, g.pending.ability_index, g.pending.targets[:])
	else do finish_cast(g, p, g.pending.object, g.pending.targets[:])
	g.pending = {}
	return true
}

// CR 601.2g-i: pay the cost, and the spell is cast: it sits on the stack and its controller gets priority again
// (CR 117.3c).
finish_cast :: proc(g: ^Game, p: types.PlayerId, id: types.ObjectId, targets: []types.TargetRef) {
	s := &g.state
	o := object(s, id)
	taps, _ := plan_payment(s, p, spell_cost(s, o))
	for t in taps do t.tapped = true // CR 605.3: the mana abilities are activated while paying
	if o.zone == .Command {
		s.commander_cast_count[o.id] += 1
		o.commander_tax = 2 * s.commander_cast_count[o.id]
	}
	move_object(g, id, .Stack)
	o.controller = p
	resolved := new(types.ResolvedAbility)
	resolved.source_id = id
	resolved.controller = p
	if a := spell_ability(o); a != nil && a.effect != nil do resolved.effect = a.effect^
	for t in targets do append(&resolved.targets, t)
	record_target_incarnations(s, resolved)
	types.pvec_push(&s.stack, types.StackEntry{id = id, source_id = id, controller = p, kind = types.StackEntryKind_Spell{card_id = o.card_id, ability = resolved}}, copy_entry)
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
	if a := spell_ability(o); a != nil do start_resolution(g, a, entry.controller, o.id, spell.ability, spell = o.id)
	else do move_object(g, o.id, .Graveyard)
}

is_permanent_card :: proc(o: ^types.GameObject) -> bool {
	return !is_type(o, .Instant) && !is_type(o, .Sorcery)
}

// One effect of a resolving spell.
// One instruction of a resolving spell or ability. True when it asked a player to choose (resolution pauses).
do_effect :: proc(g: ^Game, a: ^types.AbilityDefinition, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> (asked: bool) {
	s := &g.state
	if _, known := more_effect_supported(a.effect^, a.duration); known {
		do_more_effect(g, a.effect^, controller, source, target)
		return
	}
	#partial switch x in a.effect^ {
	case types.Effect_Attach:
		// CR 702.6a, 701.3: the source (an Equipment) becomes attached to the target.
		equipment := object(s, source)
		if id, ok := target_object(target); ok && equipment != nil && equipment.zone == .Battlefield do attach(s, equipment, object(s, id))
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
		n := amount(g, x.amount, controller, source, target)
		deal_damage(g, source, target.?, n)
	case types.Effect_Pump:
		pumped: ^types.GameObject
		if id, ok := target_object(target); ok do pumped = object(s, id)
		else if is_self(x.target) do pumped = object(s, source)
		// "This creature gets +N/+N": only while it's still the same object on the battlefield (CR 400.7).
		if pumped != nil && pumped.zone == .Battlefield do pump(g, pumped, x.power.(types.PtValue_Fixed)._0, x.toughness.(types.PtValue_Fixed)._0)
	case types.Effect_LoseLife:
		n := amount(g, x.amount, controller, source, target)
		lose_life(s, controller, n)
	case types.Effect_ChangeZone:
		do_change_zone(g, x, controller, source, target)
	case types.Effect_Bounce:
		if id, ok := target_object(target); ok && object(s, id).zone == .Battlefield do move_object(g, id, .Hand)
	case types.Effect_GenericEffect:
		targeted: ^types.GameObject
		if id, ok := target_object(target); ok do targeted = object(s, id)
		add_temp_effect(g, x, controller, source, targeted)
	case types.Effect_Token:
		n := amount(g, x.count, controller, source, target)
		for _ in 0 ..< n do create_token(g, x, controller)
	case types.Effect_Draw:
		n := amount(g, x.count, controller, source, target)
		for _ in 0 ..< n do draw_card(s, player(s, controller))
	case types.Effect_GainLife:
		n := amount(g, x.amount, controller, source, target)
		gain_life(s, controller, n)
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
	// CR 603.2: damage dealt is an event abilities can trigger on.
	append(&g.events, Event{kind = .Damage, object = source, target = target, amount = n, combat = combat})
	switch t in target {
	case types.TargetRef_Player:
		lose_life(s, t._0, n)
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
}

lose_life :: proc(s: ^types.GameState, p: types.PlayerId, n: int) {
	pl := player(s, p)
	pl.life -= i32(n)
	pl.life_lost_this_turn += u32(n)
}

// CR 701.8: destroying a permanent moves it to its owner's graveyard (CR 702.12b: unless it's indestructible).
destroy :: proc(g: ^Game, o: ^types.GameObject) {
	if o.zone != .Battlefield || has_keyword(o, types.Keyword_Indestructible) do return
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
	lasting := make([dynamic]Temp_Effect)
	for e in g.temp_effects do if e.permanent do append(&lasting, e)
	g.temp_effects = lasting
	apply_continuous_effects(g)
}

// Why this engine can't fully support a card yet: one entry per missing piece ("trigger:ChangesZone",
// "effect:Token", "keyword:Ward", ...), for the coverage report to rank what to build next. Empty when supported.
card_gaps :: proc(face: ^types.CardFace) -> [dynamic]string {
	out := make([dynamic]string, context.temp_allocator)
	name :: proc(prefix: string, v: any) -> string {
		full := fmt.tprintf("%v", reflect.union_variant_typeid(v))
		if i := strings.last_index_byte(full, '_'); i >= 0 do full = full[i + 1:]
		return strings.concatenate({prefix, full}, context.temp_allocator)
	}
	for t in face.triggers do if !trigger_supported(t) {
		// For a kind of trigger the engine handles, what's missing is its effect or a condition on it.
		#partial switch _ in t.mode {
		case types.TriggerMode_ChangesZone, types.TriggerMode_Phase, types.TriggerMode_Attacks:
			if t.execute != nil && !ability_supported(t.execute^) do ability_gaps(&out, t.execute^, "trigger")
			else do append(&out, name("trigger condition:", t.mode))
		case:
			append(&out, name("trigger:", t.mode))
		}
	}
	for st in face.static_abilities do if !static_supported(st) && !static_mode_supported(st) do append(&out, name("static:", st.mode))
	for r in face.replacements do if !replacement_supported(r) do append(&out, name("replacement:", r.event))
	if face.additional_cost != nil do append(&out, "additional cost")
	if face.modal != nil do append(&out, "modal")
	if len(face.casting_options) > 0 do append(&out, "casting option")
	for a in face.abilities {
		switch a.kind {
		case .Spell:
			if !spell_ability_supported(a) do ability_gaps(&out, a, "spell")
		case .Activated:
			if _, _, ok := tap_mana_ability(a); !ok && !activated_supported(a) {
				if a.effect != nil && !ability_supported(a) do ability_gaps(&out, a, "activated")
				else if cost, has := a.cost.?; has && !cost_supported(cost) do append(&out, name("cost:", cost))
				else do append(&out, "activated: restriction")
			}
		case .Database, .BeginGame, .Mulligan:
			append(&out, fmt.tprintf("ability:%v", a.kind))
		}
	}
	for k in face.keywords do if !keyword_supported(k) do append(&out, name("keyword:", k))
	return out
}

@(private = "file")
ability_gaps :: proc(out: ^[dynamic]string, a: types.AbilityDefinition, prefix: string) {
	if a.condition != nil do append(out, "spell:condition")
	if a.optional || a.optional_targeting do append(out, "spell:optional")
	if a.modal != nil do append(out, "spell:modal")
	if a.multi_target != nil || a.distribute != nil do append(out, "spell:multiple targets")
	if a.repeat_for != nil || a.unless_pay != nil || a.else_ability != nil do append(out, "spell:other")
	if a.effect != nil && !effect_supported(a.effect^, a.duration) {
		full := fmt.tprintf("%v", reflect.union_variant_typeid(a.effect^))
		if i := strings.last_index_byte(full, '_'); i >= 0 do full = full[i + 1:]
		append(out, strings.concatenate({"effect:", full}, context.temp_allocator))
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
	else do for t in g.resolution.targets do if o, is_object := t.(types.TargetRef_Object); is_object {
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
