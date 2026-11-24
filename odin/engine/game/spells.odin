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
card_supported :: proc(face: ^types.CardFace) -> bool {
	for r in face.replacements do if !replacement_supported(r) do return false
	for st in face.static_abilities do if !static_supported(st) && !static_mode_supported(st) && !cost_modifier_supported(st) do return false
	for t in face.triggers do if !trigger_supported(t) do return false
	if !additional_cost_supported(face) || len(face.casting_options) > 0 || !modal_supported(face) do return false
	// A spell needs a mana cost it can pay (CR 118.6, 107.4e-f); lands aren't cast.
	if !is_land_face(face) {
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
	     types.Keyword_Indestructible, types.Keyword_Hexproof, types.Keyword_Shroud:
		return true
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
	if !multi_target_supported(a) || a.distribute != nil || a.repeat_for != nil || a.unless_pay != nil do return false
	if a.else_ability != nil do return false
	if !effect_supported(a.effect^, a.duration) do return false
	if refers_to_parent_target(a.effect^) && !after_target do return false
	if moves_found_cards(a.effect^) && !after_search do return false
	_, targets := effect_target(a.effect^)
	_, searches := a.effect^.(types.Effect_SearchLibrary)
	if a.sub_ability != nil do return ability_supported(a.sub_ability^, after_target || targets, after_search || searches)
	return true
}

effect_supported :: proc(e: types.Effect, duration: Maybe(types.Duration)) -> bool {
	if supported, known := more_effect_supported(e, duration); known do return supported
	#partial switch x in e {
	case types.Effect_DealDamage:
		fixed := quantity_supported(x.amount)
		// To a target, to "you", or to "that creature's controller".
		_, parent_controller := x.target.(types.TargetFilter_ParentTargetController)
		return fixed && x.damage_source == nil && x.excess == nil && (filter_supported(x.target) || is_controller(x.target) || parent_controller)
	case types.Effect_Pump:
		_, pf := x.power.(types.PtValue_Fixed)
		_, tf := x.toughness.(types.PtValue_Fixed)
		d, has := duration.?
		_, eot := d.(types.Duration_UntilEndOfTurn)
		// A pump aimed at "any target" is a misparsed mass pump: a player can't get +N/+N.
		return pf && tf && has && eot && (is_self(x.target) || (filter_supported(x.target) && !may_name_player(x.target)))
	case types.Effect_LoseLife:
		fixed := quantity_supported(x.amount)
		t, has := x.target.?
		_, you := t.(types.TargetFilter_Controller)
		return fixed && (!has || you)
	case types.Effect_Token:
		_, you := x.owner.(types.TargetFilter_Controller)
		for st in x.static_abilities do if !static_supported(st) && !static_mode_supported(st) && !own_grant_supported(st) do return false
		for k in x.keywords do if !keyword_supported(k) do return false
		return quantity_supported(x.count) && pt_supported(x.power) && pt_supported(x.toughness) && you && x.attach_to == nil && predefined_token_supported(x) &&
			!x.enters_attacking && len(x.enter_with_counters) == 0
	case types.Effect_Draw:
		fixed := quantity_supported(x.count)
		_, you := x.target.(types.TargetFilter_Controller)
		return fixed && you
	case types.Effect_GenericEffect:
		return generic_effect_supported(x)
	case types.Effect_SearchLibrary:
		return search_supported(x)
	case types.Effect_Sacrifice:
		return sacrifice_supported(x)
	case types.Effect_Counter:
		return counter_supported(x)
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
		fixed := quantity_supported(x.amount)
		_, you := x.player.(types.TargetFilter_Controller)
		return fixed && (you || x.player == nil)
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
	f := effect_target_filter(e)
	#partial switch _ in f {
	case types.TargetFilter_Any, types.TargetFilter_Player, types.TargetFilter_Opponent, types.TargetFilter_Typed, types.TargetFilter_Or:
		return f, true
	case types.TargetFilter_StackSpell, types.TargetFilter_And:
		return f, is_spell_target(f)
	}
	return nil, false
}

// Whether an instruction acts on "it" or "that creature": the target an earlier instruction chose (CR 608.2c).
refers_to_parent_target :: proc(e: types.Effect) -> bool {
	#partial switch _ in effect_target_filter(e) {
	case types.TargetFilter_ParentTarget, types.TargetFilter_ParentTargetController:
		return true
	}
	if x, generic := e.(types.Effect_GenericEffect); generic && x.target == nil {
		for st in x.static_abilities {
			aff, _ := st.affected.?
			if _, parent := aff.(types.TargetFilter_ParentTarget); parent do return true
		}
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
				if targetable_by(o, controller) do append(&out, types.TargetRef_Object{id})
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
	// From the hand, a commander from the command zone (CR 903.8), or a card with flashback from the graveyard
	// (CR 702.34a).
	if o.owner != p || !(o.zone == .Hand || (o.zone == .Command && o.is_commander) || flashback_castable(o, p)) do return false
	if !object_supported(o, card_db) || !can_cast_now(s, p, o) do return false
	if is_modal(o) {
		if !modes_castable(s, p, o) do return false
	} else if !slots_fillable(s, spell_slot_list(o)[:], p, o.id) do return false
	if !additional_cost_payable(s, p, o) do return false
	_, payable := plan_payment(s, p, spell_cost(s, o, p))
	return payable
}

// The total cost to cast it: its mana cost, plus {2} for each earlier cast of a commander from the command zone
// (CR 903.8, the commander tax).
// CR 601.2f: the total cost: the mana cost, plus the commander tax (CR 903.8), plus increases, minus reductions,
// never below {0}. Reductions here are of generic mana only.
spell_cost :: proc(s: ^types.GameState, o: ^types.GameObject, p: types.PlayerId) -> types.ManaCost {
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

object_supported :: proc(o: ^types.GameObject, card_db: Card_Lookup) -> bool {
	// A token is what a supported effect made: its abilities are ones the engine carries out (CR 111.10 included).
	if o.is_token do return true
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
	slots := spell_slot_list(o)
	g.pending = Pending_Cast{object = id, ability_index = -1}
	// Targets named with the action fill the slots in order.
	for t in targets {
		settle_choice(s, slots[:], &g.pending.choice, p, id)
		if !slice.contains(slot_legal(s, slots[:], &g.pending.choice, p, id)[:], t) {
			g.pending = {}
			return false
		}
		take_target(slots[:], &g.pending.choice, t)
	}
	if is_modal(o) {
		// CR 601.2b, 700.2a: the modes are chosen first.
		if len(targets) > 0 {
			g.pending = {}
			return false
		}
		ask_modes(g, p, o)
		return true
	}
	continue_casting(g, p)
	return true
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
	if g.pending.ability_index >= 0 {
		pay_activation(g, p)
		return
	}
	// CR 601.2h: an additional cost that has the player choose (what to sacrifice or discard).
	o := object(s, g.pending.object)
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
		if _, payable := plan_payment(s, p, spell_cost(s, o, p)); !payable do break
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
	pay_mana(g, p, spell_cost(s, o, p), 0, g.pending.cost_objects[:]) // CR 605.3, 601.2h
	pay_additional_cost(g, p, o)
	from := o.zone // where it was cast from: flashback's exile reads it (CR 702.34a)
	if o.zone == .Command {
		s.commander_cast_count[o.id] += 1
		o.commander_tax = 2 * s.commander_cast_count[o.id]
	}
	move_object(g, id, .Stack)
	o.cast_from_zone = from
	o.controller = p
	chain := chosen_mode_chain(o, g.pending.modes[:]) if is_modal(o) else spell_ability(o)
	resolved := resolved_tree(s, chain, targets, g.pending.counts[:], p, id)
	types.pvec_push(&s.stack, types.StackEntry{id = id, source_id = id, controller = p, kind = types.StackEntryKind_Spell{card_id = o.card_id, ability = resolved}}, copy_entry)
	record_spell_cast(s, p, o, from)
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
		if is_controller(x.target) do deal_damage(g, source, types.TargetRef_Player{controller}, n) // "to you"
		else if t, has := target.?; has do deal_damage(g, source, t, n)
	case types.Effect_Pump:
		pumped: ^types.GameObject
		if id, ok := target_object(target); ok do pumped = object(s, id)
		else if is_self(x.target) do pumped = same_source(g, source)
		// "This creature gets +N/+N": only while it's still the same object on the battlefield (CR 400.7).
		if pumped != nil && pumped.zone == .Battlefield do pump(g, pumped, x.power.(types.PtValue_Fixed)._0, x.toughness.(types.PtValue_Fixed)._0)
	case types.Effect_LoseLife:
		n := amount(g, x.amount, controller, source, target)
		lose_life(s, controller, n)
	case types.Effect_ChangeZone:
		if moves_found_cards(effect) do move_found_cards(g, x, controller)
		else do do_change_zone(g, x, controller, source, target)
	case types.Effect_SearchLibrary:
		start_search(g, x, controller, source)
		return true
	case types.Effect_Sacrifice:
		return do_sacrifice(g, x, controller, source)
	case types.Effect_Counter:
		if id, ok := target_object(target); ok do counter_spell(g, id)
	case types.Effect_Shuffle:
		shuffle_library(g, controller)
	case types.Effect_Bounce:
		if id, ok := target_object(target); ok && object(s, id).zone == .Battlefield do move_object(g, id, .Hand)
	case types.Effect_GenericEffect:
		targeted: ^types.GameObject
		if id, ok := target_object(target); ok do targeted = object(s, id)
		add_temp_effect(g, x, controller, source, targeted)
	case types.Effect_Token:
		n := amount(g, x.count, controller, source, target)
		for _ in 0 ..< n do create_token(g, x, controller, source)
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
		case types.TriggerMode_ChangesZone, types.TriggerMode_Phase, types.TriggerMode_Attacks, types.TriggerMode_YouAttack:
			if t.execute != nil && !ability_supported(t.execute^) do ability_gaps(&out, t.execute^, "trigger")
			else do append(&out, name("trigger condition:", t.mode))
		case:
			append(&out, name("trigger:", t.mode))
		}
	}
	for st in face.static_abilities do if !static_supported(st) && !static_mode_supported(st) && !cost_modifier_supported(st) do append(&out, static_gap(st))
	for r in face.replacements do if !replacement_supported(r) do append(&out, name("replacement:", r.event))
	if !additional_cost_supported(face) do append(&out, "additional cost")
	if !modal_supported(face) do append(&out, "modal")
	if len(face.casting_options) > 0 do append(&out, "casting option")
	for a in face.abilities {
		switch a.kind {
		case .Spell:
			x_defined = has_x(face.mana_cost)
			supported := spell_ability_supported(a)
			x_defined = false
			if !supported do ability_gaps(&out, a, "spell")
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
	if c, has := a.condition.?; has && !ability_condition_supported(c) do append(out, "spell:condition")
	if a.optional_targeting do append(out, "spell:optional")
	if a.modal != nil do append(out, "spell:modal")
	if !multi_target_supported(a) || a.distribute != nil do append(out, "spell:multiple targets")
	if a.repeat_for != nil || a.unless_pay != nil || a.else_ability != nil do append(out, "spell:other")
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
		// "If that creature is attacking": the target chosen for an earlier slot, as it is now.
		typed, ok := x.filter.(types.TargetFilter_Typed)
		_, of_target := x.subject.(types.ObjectScope_Target)
		slot, has_slot := x.subject_slot.?
		return ok && of_target && !x.use_lki && typed_supported(typed._0) && (!has_slot || slot == 0)
	case types.AbilityCondition_SourceMatchesFilter:
		typed, ok := x.filter.(types.TargetFilter_Typed)
		return ok && typed_supported(typed._0)
	}
	return false
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
		return o != nil && object_matches(s, o, x.filter.(types.TargetFilter_Typed)._0, controller, source)
	case types.AbilityCondition_SourceMatchesFilter:
		o := object(s, source)
		return o != nil && object_matches(s, o, x.filter.(types.TargetFilter_Typed)._0, controller, source)
	case types.AbilityCondition_AdditionalCostPaid, types.AbilityCondition_AdditionalCostPaidInstead:
		return kicked(object(s, source)) // CR 702.33d
	case types.AbilityCondition_ConditionInstead:
		return ability_condition_holds(s, x.inner^, controller, source, subjects)
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
	e, ok := card_entry_of(o)
	if !ok do return nil, false
	return additional_cost(&e.face)
}

// Whether the additional cost can be paid: enough to sacrifice or discard (not counting the spell itself), and the
// life (CR 119.4).
additional_cost_payable :: proc(s: ^types.GameState, p: types.PlayerId, o: ^types.GameObject) -> bool {
	cost, has := spell_additional_cost(o)
	if !has do return true
	if c, chooses := object_cost_of(s, p, o, cost); chooses {
		others := make([dynamic]types.ObjectId, context.temp_allocator)
		for id in c.choices do if id != o.id do append(&others, id)
		if !cost_objects_leave_mana(s, p, others[:], c.count, spell_cost(s, o, p), 0) do return false
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
	for id in g.pending.cost_objects do move_object(g, id, .Graveyard)
	parts := make([dynamic]types.AbilityCost, context.temp_allocator)
	cost_parts_of(cost, &parts)
	for part in parts do if life, ok := part.(types.AbilityCost_PayLife); ok {
		n, _ := fixed_quantity(life.amount)
		lose_life(&g.state, p, n) // CR 119.4
	}
}
