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
	if len(face.triggers) > 0 || len(face.static_abilities) > 0 || len(face.replacements) > 0 do return false
	if face.additional_cost != nil || face.modal != nil || len(face.casting_options) > 0 do return false
	for a in face.abilities {
		switch a.kind {
		case .Spell:
			if !spell_ability_supported(a) do return false
		case .Activated:
			if _, _, ok := tap_mana_ability(a); !ok do return false
		case .Database, .BeginGame, .Mulligan:
			return false
		}
	}
	for k in face.keywords do if !keyword_supported(k) do return false
	return true
}

keyword_supported :: proc(k: types.Keyword) -> bool {
	#partial switch _ in k {
	case types.Keyword_Flying, types.Keyword_Reach, types.Keyword_Haste, types.Keyword_Vigilance,
	     types.Keyword_Defender, types.Keyword_Trample, types.Keyword_Lifelink, types.Keyword_Deathtouch,
	     types.Keyword_FirstStrike, types.Keyword_DoubleStrike, types.Keyword_Flash, types.Keyword_Menace:
		return true
	}
	return false
}

spell_ability_supported :: proc(a: types.AbilityDefinition) -> bool {
	if a.effect == nil || a.condition != nil || a.optional || a.optional_targeting || a.modal != nil do return false
	if a.multi_target != nil || a.distribute != nil || a.repeat_for != nil || a.unless_pay != nil do return false
	if a.else_ability != nil do return false
	if !effect_supported(a.effect^, a.duration) do return false
	if a.sub_ability != nil do return spell_ability_supported(a.sub_ability^)
	return true
}

effect_supported :: proc(e: types.Effect, duration: Maybe(types.Duration)) -> bool {
	#partial switch x in e {
	case types.Effect_DealDamage:
		_, fixed := fixed_quantity(x.amount)
		return fixed && x.damage_source == nil && x.excess == nil && filter_supported(x.target)
	case types.Effect_Pump:
		_, pf := x.power.(types.PtValue_Fixed)
		_, tf := x.toughness.(types.PtValue_Fixed)
		d, has := duration.?
		_, eot := d.(types.Duration_UntilEndOfTurn)
		return pf && tf && has && eot && filter_supported(x.target)
	case types.Effect_Draw:
		_, fixed := fixed_quantity(x.count)
		_, you := x.target.(types.TargetFilter_Controller)
		return fixed && you
	case types.Effect_GainLife:
		_, fixed := fixed_quantity(x.amount)
		_, you := x.player.(types.TargetFilter_Controller)
		return fixed && you
	case types.Effect_Destroy:
		return !x.cant_regenerate && filter_supported(x.target)
	}
	return false
}

// The target filters this engine can find targets for.
filter_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Any, types.TargetFilter_Player, types.TargetFilter_Opponent:
		return true
	case types.TargetFilter_Typed:
		if len(x._0.properties) > 0 do return false
		if c, has := x._0.controller.?; has {
			#partial switch _ in c {
			case types.ControllerRef_You, types.ControllerRef_Opponent:
			case:
				return false
			}
		}
		for t in x._0.type_filters {
			#partial switch _ in t {
			case types.TypeFilter_Creature, types.TypeFilter_Land, types.TypeFilter_Artifact, types.TypeFilter_Enchantment,
			     types.TypeFilter_Planeswalker, types.TypeFilter_Permanent:
			case:
				return false
			}
		}
		return true
	}
	return false
}

// ---- Targets (CR 115) ----------------------------------------------------------------------------------------

// The target an effect asks for, if it targets.
effect_target :: proc(e: types.Effect) -> (types.TargetFilter, bool) {
	#partial switch x in e {
	case types.Effect_DealDamage:
		return x.target, true
	case types.Effect_Pump:
		return x.target, true
	case types.Effect_Destroy:
		return x.target, true
	}
	return nil, false
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

matches_type :: proc(o: ^types.GameObject, t: types.TypeFilter) -> bool {
	#partial switch _ in t {
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
	case types.TypeFilter_Permanent:
		return true
	}
	return false
}

// CR 115.4: "any target" is a creature, player, planeswalker or battle. A typed filter is a permanent of each listed
// type (and controller), on the battlefield.
legal_targets :: proc(s: ^types.GameState, f: types.TargetFilter, controller: types.PlayerId) -> [dynamic]types.TargetRef {
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
		outer: for id in ids_of(s.battlefield) {
			o := object(s, id)
			for t in x._0.type_filters do if !matches_type(o, t) do continue outer
			if c, has := x._0.controller.?; has {
				#partial switch _ in c {
				case types.ControllerRef_You:
					if o.controller != controller do continue
				case types.ControllerRef_Opponent:
					if o.controller == controller do continue
				}
			}
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

target_still_legal :: proc(s: ^types.GameState, t: types.TargetRef, f: types.TargetFilter, controller: types.PlayerId) -> bool {
	for l in legal_targets(s, f, controller) do if l == t do return true
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
	if is_type(o, .Instant) || has_keyword(o, types.Keyword_Flash) do return true
	return sorcery_timing(s, p)
}

sorcery_timing :: proc(s: ^types.GameState, p: types.PlayerId) -> bool {
	return s.active_player == p && (s.phase == .PreCombatMain || s.phase == .PostCombatMain) && types.pvec_len(s.stack) == 0
}

// Whether the player can cast this card from their hand now: supported, timely, with legal targets and payable.
castable :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject, card_db: Card_Lookup) -> bool {
	if o.zone != .Hand || o.owner != p do return false
	if !object_supported(o, card_db) || !can_cast_now(s, p, o) do return false
	if a := spell_ability(o); a != nil {
		for f in target_slots(a) do if len(legal_targets(s, f, p)) == 0 do return false
	}
	_, payable := plan_payment(s, p, o.mana_cost)
	return payable
}

// Looks up the card an object was made from, to check what this engine supports of it.
Card_Lookup :: proc(name: string) -> ^types.CardExportEntry

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
	a := spell_ability(o)
	slots := target_slots(a) if a != nil else nil
	chosen: [dynamic]types.TargetRef
	for t, i in targets {
		if i >= len(slots) || !target_still_legal(s, t, slots[i], p) do return false
		append(&chosen, t)
	}
	if len(chosen) < len(slots) {
		// CR 601.2c: ask for the next target.
		g.pending = Pending_Cast{object = id, targets = chosen}
		ask_target(g, p)
		return true
	}
	finish_cast(g, p, id, chosen[:])
	return true
}

Pending_Cast :: struct {
	object:  types.ObjectId,
	targets: [dynamic]types.TargetRef,
}

ask_target :: proc(g: ^Game, p: types.PlayerId) {
	s := &g.state
	o := object(s, g.pending.object)
	slots := target_slots(spell_ability(o))
	slot := len(g.pending.targets)
	legal := legal_targets(s, slots[slot], p)
	pending := new(types.PendingCast)
	pending.object_id = o.id
	pending.card_id = o.card_id
	pending.cost = o.mana_cost
	pending.origin_zone = .Hand
	target_slot_list: [dynamic]types.TargetSelectionSlot
	for f in slots do append(&target_slot_list, types.TargetSelectionSlot{legal_targets = legal_targets(s, f, p)})
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
	o := object(s, g.pending.object)
	slots := target_slots(spell_ability(o))
	slot := len(g.pending.targets)
	if !target_still_legal(s, t, slots[slot], p) do return false
	append(&g.pending.targets, t)
	if len(g.pending.targets) < len(slots) {
		ask_target(g, p)
		return true
	}
	finish_cast(g, p, g.pending.object, g.pending.targets[:])
	g.pending = {}
	return true
}

// CR 601.2g-i: pay the cost, and the spell is cast: it sits on the stack and its controller gets priority again
// (CR 117.3c).
finish_cast :: proc(g: ^Game, p: types.PlayerId, id: types.ObjectId, targets: []types.TargetRef) {
	s := &g.state
	o := object(s, id)
	taps, _ := plan_payment(s, p, o.mana_cost)
	for t in taps do t.tapped = true // CR 605.3: the mana abilities are activated while paying
	move_object(s, id, .Stack)
	o.controller = p
	resolved := new(types.ResolvedAbility)
	resolved.source_id = id
	resolved.controller = p
	if a := spell_ability(o); a != nil && a.effect != nil do resolved.effect = a.effect^
	for t in targets do append(&resolved.targets, t)
	types.pvec_push(&s.stack, types.StackEntry{id = id, source_id = id, controller = p, kind = types.StackEntryKind_Spell{card_id = o.card_id, ability = resolved}}, copy_entry)
	s.priority_passes = nil
	give_priority(g, p)
}

copy_entry :: proc(x: types.StackEntry) -> types.StackEntry {return x}

// ---- Resolving (CR 608) -------------------------------------------------------------------------------------

resolve_top_of_stack :: proc(g: ^Game) {
	s := &g.state
	entry := types.pvec_pop(&s.stack, copy_entry)
	spell, is_spell := entry.kind.(types.StackEntryKind_Spell)
	if !is_spell do return
	o := object(s, entry.source_id)
	if is_permanent_card(o) {
		// CR 608.3: a permanent spell resolving becomes a permanent on the battlefield under its controller.
		move_object(s, o.id, .Battlefield)
		o.controller = entry.controller
		return
	}
	a := spell_ability(o)
	slots := target_slots(a)
	targets := spell.ability.targets[:]
	// CR 608.2b: a spell whose targets are all illegal now doesn't resolve; it's removed from the stack.
	any_legal := len(slots) == 0
	legal := make([]bool, len(targets), context.temp_allocator)
	for t, i in targets do if i < len(slots) && target_still_legal(s, t, slots[i], entry.controller) {
		legal[i] = true
		any_legal = true
	}
	if any_legal {
		slot := 0
		for x := a; x != nil; x = x.sub_ability {
			if x.effect == nil do continue
			target: Maybe(types.TargetRef)
			if _, targets_one := effect_target(x.effect^); targets_one {
				if slot < len(targets) && legal[slot] do target = targets[slot]
				slot += 1
				if target == nil do continue // CR 608.2b: an illegal target is unaffected
			}
			do_effect(g, x, entry.controller, o.id, target)
		}
	}
	// CR 608.2n: an instant or sorcery spell goes to its owner's graveyard as the final step of resolving.
	move_object(s, o.id, .Graveyard)
}

is_permanent_card :: proc(o: ^types.GameObject) -> bool {
	return !is_type(o, .Instant) && !is_type(o, .Sorcery)
}

// One effect of a resolving spell.
do_effect :: proc(g: ^Game, a: ^types.AbilityDefinition, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) {
	s := &g.state
	#partial switch x in a.effect^ {
	case types.Effect_DealDamage:
		n, _ := fixed_quantity(x.amount)
		deal_damage(g, source, target.?, n)
	case types.Effect_Pump:
		if t, ok := target.?.(types.TargetRef_Object); ok {
			pump(g, object(s, t._0), x.power.(types.PtValue_Fixed)._0, x.toughness.(types.PtValue_Fixed)._0)
		}
	case types.Effect_Draw:
		n, _ := fixed_quantity(x.count)
		for _ in 0 ..< n do draw_card(s, player(s, controller))
	case types.Effect_GainLife:
		n, _ := fixed_quantity(x.amount)
		gain_life(s, controller, n)
	case types.Effect_Destroy:
		if t, ok := target.?.(types.TargetRef_Object); ok do destroy(s, object(s, t._0))
	}
}

// CR 120.3: damage to a player makes them lose that much life; to a creature, it's marked on it; to a planeswalker,
// it removes loyalty counters. CR 702.15b: a source with lifelink makes its controller gain that much life.
// CR 702.2b: deathtouch damage marks the creature for destruction.
deal_damage :: proc(g: ^Game, source: types.ObjectId, target: types.TargetRef, n: int) {
	if n <= 0 do return
	s := &g.state
	src := object(s, source)
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
destroy :: proc(s: ^types.GameState, o: ^types.GameObject) {
	if o.zone != .Battlefield || has_keyword(o, types.Keyword_Indestructible) do return
	move_object(s, o.id, .Graveyard)
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
	if p, ok := o.power.?; ok do o.power = p + power
	if t, ok := o.toughness.?; ok do o.toughness = t + toughness
}

end_until_end_of_turn_effects :: proc(g: ^Game) {
	s := &g.state
	for p in g.pumps {
		o := object(s, p.object)
		if o == nil || o.incarnation != p.incarnation do continue
		if v, ok := o.power.?; ok do o.power = v - p.power
		if v, ok := o.toughness.?; ok do o.toughness = v - p.toughness
	}
	clear(&g.pumps)
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
	for t in face.triggers do append(&out, name("trigger:", t.mode))
	for st in face.static_abilities do append(&out, name("static:", st.mode))
	for r in face.replacements do append(&out, name("replacement:", r.event))
	if face.additional_cost != nil do append(&out, "additional cost")
	if face.modal != nil do append(&out, "modal")
	if len(face.casting_options) > 0 do append(&out, "casting option")
	for a in face.abilities {
		switch a.kind {
		case .Spell:
			if !spell_ability_supported(a) do ability_gaps(&out, a, "spell")
		case .Activated:
			if _, _, ok := tap_mana_ability(a); !ok {
				if a.effect != nil do append(&out, name("activated:", a.effect^))
				else do append(&out, "activated")
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
