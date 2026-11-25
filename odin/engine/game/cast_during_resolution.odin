// Spells cast while another spell or ability resolves (CR 608.2g): "You may cast a spell with mana value 4 or less
// from your hand without paying its mana cost" (the Expertise cycle, Maelstrom Archangel), and "you may cast target
// instant or sorcery card from your graveyard without paying its mana cost. If that spell would be put into your
// graveyard, exile it instead" (Torrential Gearhulk, Goblin Dark-Dwellers). The player is offered the cards they may
// cast (CR 601.3); casting one follows CR 601.2a-i, no player gets priority after it's cast, and the resolving spell
// or ability then goes on resolving (CR 608.2g).
package game

import "core:slice"
import types "../types"

// The cast offered while a spell or ability resolves.
Free_Cast :: struct {
	active:      bool, // the offer is open: the player picks a card, or none
	player:      types.PlayerId,
	candidates:  [dynamic]types.ObjectId,
	casting:     types.ObjectId, // the card being cast from the offer, until its cast ends (or is reversed)
	exile_rider: bool, // "if that spell would be put into your graveyard, exile it instead"
	source:      types.ObjectId,
}

// ---- What's supported ----------------------------------------------------------------------------------------

// Where the card is cast from: chosen from the hand as the instruction is carried out, or the card the ability
// targeted in a graveyard.
@(private = "file")
Free_Cast_Shape :: enum {
	None,
	From_Hand, // "you may cast a spell [with mana value N or less] from your hand without paying its mana cost"
	Target_In_Graveyard, // "you may cast target instant card from your graveyard without paying its mana cost"
}

@(private = "file")
free_cast_shape :: proc(x: types.Effect_CastFromZone) -> Free_Cast_Shape {
	// Without paying its mana cost, cast now (not a permission lasting a while, nor "play"), with nothing else changed
	// about how it's cast.
	if !x.without_paying_mana_cost || x.mode != .Cast || x.duration != nil || x.cast_transformed do return .None
	if x.alt_ability_cost != nil || x.mana_spend_permission != nil || x.additional_cost != nil || x.cast_cost_modifier != nil do return .None
	if c, has := x.constraint.?; has {
		mv, ok := c.(types.CastPermissionConstraint_ManaValue)
		if !ok || !quantity_supported(mv.value) || quantity_reads_target(mv.value) do return .None
	}
	typed, is_typed := x.target.(types.TargetFilter_Typed)
	if !is_typed do return .None
	if c, has := typed._0.controller.?; has {
		if _, you := c.(types.ControllerRef_You); !you do return .None
	} else {
		return .None // "from a graveyard" (anyone's): not yet
	}
	zone: Maybe(types.Zone)
	for p in typed._0.properties {
		if z, in_zone := p.(types.FilterProp_InZone); in_zone {
			zone = z.zone
			continue
		}
		if cmc, is_cmc := p.(types.FilterProp_Cmc); is_cmc && quantity_reads_target(cmc.value) do return .None
		if !property_supported(p) do return .None
	}
	for t in typed._0.type_filters do if !type_filter_supported(t) do return .None
	z, has_zone := zone.?
	if !has_zone do return .None
	#partial switch d in x.driver {
	case types.CastFromZoneDriver_DuringResolution:
		if z == .Hand do return .From_Hand
	case nil, types.CastFromZoneDriver_LingeringPermission:
		// The card data's default (no driver named): with no duration, "you may cast target card" now.
		if z == .Graveyard do return .Target_In_Graveyard
	}
	return .None
}

cast_from_zone_supported :: proc(x: types.Effect_CastFromZone) -> bool {
	return free_cast_shape(x) != .None
}

// The card targeted in a graveyard is the instruction's target (CR 115.1); one chosen from the hand isn't.
cast_from_zone_target :: proc(x: types.Effect_CastFromZone) -> (types.TargetFilter, bool) {
	if free_cast_shape(x) == .Target_In_Graveyard do return x.target, true
	return nil, false
}

// "If that spell would be put into your graveyard, exile it instead": the card data writes it as the next instruction
// ("exile it"). It's a replacement on the spell (CR 614.1a) applied as the spell would go to the graveyard
// (spell_leaves_stack), so the instruction itself does nothing.
is_cast_rider :: proc(caster: ^types.ResolvedAbility, next: ^types.ResolvedAbility) -> bool {
	if caster == nil || next == nil || caster.sub_ability != next || next.sub_link != .SequentialSibling do return false
	if _, casts := caster.effect.(types.Effect_CastFromZone); !casts do return false
	cz, moves := next.effect.(types.Effect_ChangeZone)
	if !moves || cz.destination != .Exile || cz.origin != nil do return false
	_, parent := cz.target.(types.TargetFilter_ParentTarget)
	return parent
}

// Whether the instruction being carried out is that rider (the one before it a cast from a zone).
current_is_cast_rider :: proc(g: ^Game) -> bool {
	r := &g.resolution
	if !r.active || r.current == nil do return false
	for n := r.top; n != nil; n = n.sub_ability do if n.sub_ability == r.current do return is_cast_rider(n, r.current)
	return false
}

// ---- Carrying it out ---------------------------------------------------------------------------------------

// Offers the cast: the cards that fit and could be cast now for free. True when the player is asked.
do_cast_from_zone :: proc(g: ^Game, x: types.Effect_CastFromZone, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> bool {
	s := &g.state
	shape := free_cast_shape(x)
	candidates := make([dynamic]types.ObjectId)
	typed := x.target.(types.TargetFilter_Typed)._0
	fits :: proc(g: ^Game, x: types.Effect_CastFromZone, typed: types.TypedFilter, o: ^types.GameObject, controller: types.PlayerId, source: types.ObjectId) -> bool {
		s := &g.state
		plain := typed
		plain.controller = nil // "from your hand": the player's own cards
		if !object_matches(s, o, plain, controller, source) do return false
		// "With mana value less than or equal to that damage" (CR 202.3).
		if c, has := x.constraint.?; has {
			mv := c.(types.CastPermissionConstraint_ManaValue)
			if !compare(object_mana_value(o), mv.comparator, amount(g, mv.value, controller, source, nil)) do return false
		}
		return free_castable(g, controller, o)
	}
	switch shape {
	case .From_Hand:
		for id in ids_of(player(s, controller).hand) do if o := object(s, id); fits(g, x, typed, o, controller, source) do append(&candidates, id)
	case .Target_In_Graveyard:
		if id, ok := target_object(target); ok {
			o := object(s, id)
			if o != nil && o.zone == .Graveyard && o.owner == controller && fits(g, x, typed, o, controller, source) do append(&candidates, id)
		}
	case .None:
	}
	if len(candidates) == 0 {
		g.resolution.performed = false // nothing could be cast: "if you don't" (CR 608.2c)
		return false
	}
	exile_rider := false
	if r := &g.resolution; r.active && r.current != nil do exile_rider = is_cast_rider(r.current, r.current.sub_ability)
	g.free_cast = Free_Cast{active = true, player = controller, candidates = candidates, exile_rider = exile_rider, source = source}
	zones := make([dynamic]types.Zone)
	append(&zones, types.Zone.Hand if shape == .From_Hand else types.Zone.Graveyard)
	offer := types.CastOfferKind_FreeCastWindow {
		candidates = slice.clone_to_dynamic(candidates[:]),
		remaining_casts = 1,
		face_policy = {filter = x.target, source_id = source, controller = controller, constraint = x.constraint, play_mode = .Cast},
		zones = zones,
		member_pool = slice.clone_to_dynamic(candidates[:]),
	}
	if exile_rider do offer.graveyard_replacement = types.SpellStackToGraveyardReplacement_Exile{}
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_CastOffer{player = controller, kind = offer}
	return true
}

// Whether the player could cast the card now without paying its mana cost, by the resolving effect's permission
// (CR 608.2g): wherever it is, whatever the timing, with its targets and other costs.
free_castable :: proc(g: ^Game, p: types.PlayerId, o: ^types.GameObject) -> bool {
	if is_type(o, .Land) do return false // a land is played, not cast (CR 305.9)
	saved := casting_alternative
	defer casting_alternative = saved
	casting_alternative = {spell = o.id, free = true}
	saved_x := o.cost_x_paid
	defer o.cost_x_paid = saved_x
	if has_x(o.mana_cost) do o.cost_x_paid = 0 // CR 107.3b
	return castable(&g.state, p, o, g.card_db)
}

// The player's answer: a card to cast, or none.
answer_free_cast :: proc(g: ^Game, p: types.PlayerId, selection: Maybe(types.ObjectId)) -> bool {
	f := &g.free_cast
	if !f.active || p != f.player do return false
	id, chosen := selection.?
	if !chosen {
		g.free_cast = {}
		g.resolution.performed = false
		g.state.waiting_for = nil
		if continue_resolution(g) do after_resolution(g)
		return true
	}
	if !slice.contains(f.candidates[:], id) do return false
	f.active = false
	f.casting = id
	g.state.waiting_for = nil
	if !cast_spell(g, p, id, nil, adventure_decided = true, face_decided = true, free = true) {
		// No longer castable: the offer stands.
		f.active = true
		f.casting = 0
		g.state.waiting_for = types.WaitingFor_CastOffer{player = p, kind = free_cast_offer(g)}
		return false
	}
	g.resolution.performed = true
	return true
}

@(private = "file")
free_cast_offer :: proc(g: ^Game) -> types.CastOfferKind_FreeCastWindow {
	return types.CastOfferKind_FreeCastWindow{candidates = slice.clone_to_dynamic(g.free_cast.candidates[:]), remaining_casts = 1, member_pool = slice.clone_to_dynamic(g.free_cast.candidates[:])}
}

// CR 608.2g: once the spell cast during the resolution is cast (or its cast reversed, CR 734), no player gets
// priority: the resolution goes on. True when it took over from giving priority.
resume_after_free_cast :: proc(g: ^Game) -> bool {
	f := &g.free_cast
	if f.casting == 0 do return false
	o := object(&g.state, f.casting)
	if o != nil && o.zone == .Stack {
		if f.exile_rider do g.exiled_from_stack[o.id] = o.incarnation
		g.cast_by_effect[o.id] = o.incarnation // not by flashback, though from a graveyard (CR 702.34a)
	} else {
		g.resolution.performed = false // the cast was reversed: as if declined
	}
	g.free_cast = {}
	if continue_resolution(g) do after_resolution(g)
	return true
}

// "If that spell would be put into your graveyard, exile it instead" (the rider of a cast from a graveyard).
exiled_instead_of_graveyard_after_cast :: proc(g: ^Game, o: ^types.GameObject) -> bool {
	inc, marked := g.exiled_from_stack[o.id]
	return marked && inc == o.incarnation
}

// The AI's pick: the spell with the greatest mana value it could cast.
ai_free_cast :: proc(g: ^Game, w: types.CastOfferKind_FreeCastWindow) -> Maybe(types.ObjectId) {
	best: Maybe(types.ObjectId)
	best_mv := -1
	for id in w.candidates {
		o := object(&g.state, id)
		if o == nil do continue
		if mv := object_mana_value(o); mv > best_mv {
			best, best_mv = id, mv
		}
	}
	return best
}
