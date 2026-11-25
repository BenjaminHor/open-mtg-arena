// Exile linked to the object that exiled it: "exile target creature until this leaves the battlefield" (CR 610.3)
// and "the exiled card" / "cards exiled with this" (CR 607.2a: Journey to Nowhere, Fiend Hunter, Bag of Holding).
//
// The links live in the game state, the way its data model has them:
//   - `exile_links`: a card in exile and the permanent whose ability exiled it, while both are still those objects.
//     `ExileLinkKind_UntilSourceLeaves` for an "until" exile, `ExileLinkKind_TrackedBySource` for any other exile by
//     one of the permanent's abilities.
//   - `linked_exile_lki`: once that permanent has left the battlefield, its links as they were, by the incarnation
//     that left (`departed`) and the one it became (`successor`). Its leaves-the-battlefield ability, and an ability
//     activated by sacrificing it, still refer to the cards its other ability exiled (CR 607.2a, 603.10a).
// A link never outlives either object (CR 400.7): a card leaving exile loses its links (move_object calls
// unlink_departing), and a permanent leaving the battlefield takes its links into `linked_exile_lki`.
//
// The cards to return once an "until" host has left wait in Game.exile_returns (beside the state, like the other
// pending choices): they normally return at once, so the queue is empty again before anyone could save the game, except
// for an Aura whose owner is choosing what it will enchant (CR 303.4f).
package game

import "core:slice"
import "core:strings"
import types "../types"

// A card to return to the zone it was exiled from, because the object it was exiled "until" has left (CR 610.3).
Exile_Return :: struct {
	card:        types.ObjectId,
	incarnation: u64, // the card as it was in exile: once it has left exile it's a new object (CR 400.7)
	zone:        types.Zone, // where it was exiled from (CR 610.3: "returns the object to its previous zone")
	source:      types.ObjectId, // the object that left
}

// The game whose returns wait for the end of the simultaneous zone changes under way (end_together), if any.
@(thread_local)
exile_returns_waiting: ^Game

// Set while the returns are carried out, so the moves they make don't start another round.
@(thread_local)
returning_exiled: bool

until_host_leaves :: proc(d: Maybe(types.Duration)) -> bool {
	x, has := d.?
	if !has do return false
	_, until := x.(types.Duration_UntilHostLeavesPlay)
	return until
}

// ---- What's supported --------------------------------------------------------------------------------------

// "Exile target nonland permanent an opponent controls until this enchantment leaves the battlefield": a permanent
// exiled by an ability of the permanent that is the "host" (CR 610.3). A spell has no such host: refused.
exile_until_supported :: proc(x: types.Effect_ChangeZone) -> bool {
	if x.destination != .Exile || !host_is_a_permanent() do return false
	if origin, has := x.origin.?; has && origin != .Battlefield do return false
	#partial switch _ in x.target {
	case types.TargetFilter_Typed, types.TargetFilter_Or:
	case:
		return false // "this", "it", "that card", cards in other zones: not read with an "until"
	}
	if _, in_graveyard := graveyard_filter(x.target); in_graveyard do return false
	return change_zone_supported(x) && filter_supported(x.target) && !may_name_player(x.target)
}

// "Exile each nonland permanent with mana value 2 or less until this enchantment leaves the battlefield".
exile_all_until_supported :: proc(x: types.Effect_ChangeZoneAll) -> bool {
	origin := x.origin.? or_else .Battlefield
	return x.destination == .Exile && origin == .Battlefield && host_is_a_permanent() && change_zone_all_supported(x)
}

// The card being checked is a permanent card (not an instant or sorcery), so its abilities' source can leave the
// battlefield. Without a card at hand (an ability checked as it triggers or resolves), the card it's on was checked
// whole before it could be cast or played (card_supported, object_supported).
@(private = "file")
host_is_a_permanent :: proc() -> bool {
	if checking_face == nil do return true
	for t in checking_face.card_type.core_types do if t == .Instant || t == .Sorcery do return false
	return true
}

// "The exiled card", "cards exiled with this", alone or narrowed by card type ("each creature card exiled with this
// land"): the data's ExiledBySource, alone or in an And with one typed filter. The typed part, if any.
linked_exile_target :: proc(f: types.TargetFilter) -> (narrowed: types.TypedFilter, has_type: bool, ok: bool) {
	#partial switch x in f {
	case types.TargetFilter_ExiledBySource:
		return {}, false, true
	case types.TargetFilter_And:
		if len(x.filters) != 2 do return {}, false, false
		linked := false
		for y in x.filters {
			#partial switch z in y {
			case types.TargetFilter_ExiledBySource:
				linked = true
			case types.TargetFilter_Typed:
				narrowed, has_type = z._0, true
			}
		}
		return narrowed, has_type, linked && has_type
	}
	return {}, false, false
}

// "Return the exiled card to the battlefield under its owner's control", "return all cards exiled with this artifact
// to their owner's hand", "put each card exiled with this artifact into its owner's graveyard".
linked_return_supported :: proc(x: types.Effect_ChangeZoneAll) -> bool {
	narrowed, has_type, linked := linked_exile_target(x.target)
	if !linked do return false
	if has_type {
		// Only what kind of card: "each creature card exiled with this". "All other ... cards exiled with this"
		// (Mirror of Life Trapping, Mysterious Limousine) means other than the card just exiled, which the data
		// doesn't say: refused.
		if narrowed.controller != nil || len(narrowed.properties) > 0 || len(narrowed.type_filters) == 0 do return false
		for tf in narrowed.type_filters do if !type_filter_supported(tf) do return false
	}
	if origin, has := x.origin.?; !has || origin != .Exile do return false
	#partial switch x.destination {
	case .Battlefield, .Hand, .Graveyard:
	case:
		return false
	}
	if _, controller := x.actor.(types.LibraryInstructionActor_Controller); x.actor != nil && !controller do return false
	if c, has := x.enters_under.?; has {
		if _, you := c.(types.ControllerRef_You); !you do return false
	}
	if x.enters_attacking || len(x.enter_with_counters) > 0 || x.face_down_profile != nil || x.library_position != nil || x.random_order do return false
	if x.enter_tapped == .Untapped do return false
	if checking_face == nil do return true // as host_is_a_permanent
	if x.destination == .Battlefield && x.enters_under == nil {
		// The data says "under its owner's control" (Journey to Nowhere) and plain "put ... onto the battlefield"
		// (Underworld Sentinel: under the control of the player putting it there, CR 110.2a, as its ruling says) the
		// same way; this engine carries out the first, so only a card whose text says so is read.
		text := checking_face.oracle_text.? or_else ""
		if !strings.contains(text, "owner's control") && !strings.contains(text, "owners' control") do return false
	}
	return exiles_are_linked(checking_face)
}

// CR 607.2a, 607.2b, 607.2q: "the exiled card" means the cards the object's other abilities exiled, whether by an
// instruction, a replacement effect or a cost. This engine links exiles made by an ability's "exile" instruction
// (move_object, link_exiled_card); a card that exiles any other way (a cost, a replacement, the top of a library) would
// leave those cards out, so it's refused.
@(private = "file")
exiles_are_linked :: proc(face: ^types.CardFace) -> bool {
	if c, has := face.additional_cost.?; has {
		switch y in c {
		case types.AdditionalCost_Optional:
			if cost_exiles(y.cost) do return false
		case types.AdditionalCost_Required:
			if cost_exiles(y._0) do return false
		case types.AdditionalCost_Kicker:
			for k in y.costs do if cost_exiles(k) do return false
		case types.AdditionalCost_Choice:
			for k in y._0 do if cost_exiles(k) do return false
		}
	}
	for &a in face.abilities {
		if c, has := a.cost.?; has && cost_exiles(c) do return false
		if !chain_exiles_linked(&a) do return false
	}
	for t in face.triggers do if !chain_exiles_linked(t.execute) do return false
	for r in face.replacements {
		// A replacement that exiles (CR 607.2b) isn't linked here: refused if it exiles at all.
		if r.execute != nil && !chain_exiles_linked(r.execute, linkable = false) do return false
	}
	return true
}

// Whether every exile in the instructions is one an "exile" instruction makes (ChangeZone or ChangeZoneAll to exile),
// which link_exiled_card links; with `linkable` false, whether nothing in them exiles at all.
@(private = "file")
chain_exiles_linked :: proc(a: ^types.AbilityDefinition, linkable := true) -> bool {
	for x := a; x != nil; x = x.sub_ability {
		if x.effect != nil {
			#partial switch e in x.effect^ {
			case types.Effect_ChangeZone:
				if e.destination == .Exile && !linkable do return false
			case types.Effect_ChangeZoneAll:
				if e.destination == .Exile && !linkable do return false
			case types.Effect_Dig:
				if d, has := e.destination.?; has && d == .Exile do return false
				if d, has := e.rest_destination.?; has && d == .Exile do return false
			case types.Effect_ExileTop, types.Effect_ExileFromTopUntil, types.Effect_ExileFaceDownPile, types.Effect_HeistExile,
			     types.Effect_ExileHaunting, types.Effect_ExileTopCardContest, types.Effect_ExileResolvingSpellInsteadOfGraveyard,
			     types.Effect_HideawayConceal, types.Effect_RevealUntil, types.Effect_Discover, types.Effect_Cascade:
				return false
			}
		}
		if x.else_ability != nil && !chain_exiles_linked(x.else_ability, linkable) do return false
	}
	return true
}

@(private = "file")
cost_exiles :: proc(c: types.AbilityCost) -> bool {
	#partial switch x in c {
	case types.AbilityCost_Exile, types.AbilityCost_ExileMaterials, types.AbilityCost_ExileWithAggregate:
		return true
	case types.AbilityCost_Composite:
		for y in x.costs do if cost_exiles(y) do return true
	case types.AbilityCost_OneOf:
		for y in x.costs do if cost_exiles(y) do return true
	}
	return false
}

// ---- Making and ending links -------------------------------------------------------------------------------

// CR 610.3a-b: an "until" exile whose host has already left the battlefield (or left and come back, a new object, CR
// 400.7) since the ability was put on the stack moves nothing.
exile_until_source_gone :: proc(g: ^Game) -> bool {
	r := &g.resolution
	if !r.active || r.current == nil || !until_host_leaves(r.current.duration) do return false
	src := same_source(g, r.source)
	return src == nil || src.zone != .Battlefield
}

// A card just put into exile (move_object): if an ability's "exile" instruction put it there, it's linked to that
// ability's source, while the source is still the permanent whose ability it is (CR 607.2a; an "until" exile, CR
// 610.3). A source that has left in the meantime (Fiend Hunter leaving before its enters ability resolves) has no
// link to make: its leaves-the-battlefield ability has already returned what it could, and the card stays exiled.
// A token exiled ceases to exist (CR 111.8): nothing to link.
link_exiled_card :: proc(g: ^Game, card: ^types.GameObject, from: types.Zone) {
	r := &g.resolution
	if !r.active || r.spell != 0 || r.current == nil || card.is_token do return
	#partial switch e in r.current.effect {
	case types.Effect_ChangeZone:
		if e.destination != .Exile do return
	case types.Effect_ChangeZoneAll:
		if e.destination != .Exile do return
	case:
		return // exiled some other way ("exile it instead", CR 614.6): not by the instruction
	}
	src := same_source(g, r.source)
	if src == nil || src.zone != .Battlefield || src.id == card.id do return
	kind: types.ExileLinkKind = types.ExileLinkKind_TrackedBySource{}
	if until_host_leaves(r.current.duration) do kind = types.ExileLinkKind_UntilSourceLeaves{return_zone = from}
	append(&g.state.exile_links, types.ExileLink{exiled_id = card.id, source_id = src.id, kind = kind})
}

// Before an object changes zones (move_object, as the object it was): a card leaving exile is a new object no link
// names any more (CR 400.7); a permanent leaving the battlefield keeps its links only as last known information
// (`linked_exile_lki`), and each card it exiled "until" it left is to return (CR 610.3).
unlink_departing :: proc(g: ^Game, o: ^types.GameObject, from: types.Zone) {
	s := &g.state
	snapshot: [dynamic]types.LinkedExileSnapshot
	for i := 0; i < len(s.exile_links); {
		l := s.exile_links[i]
		if from == .Exile && l.exiled_id == o.id {
			ordered_remove(&s.exile_links, i)
			continue
		}
		if l.source_id != o.id {
			i += 1
			continue
		}
		if card := object(s, l.exiled_id); card != nil && card.zone == .Exile {
			append(&snapshot, types.LinkedExileSnapshot{exiled_id = card.id, owner = card.owner, mana_value = u32(object_mana_value(card)), incarnation = card.incarnation})
			if until, is_until := l.kind.(types.ExileLinkKind_UntilSourceLeaves); is_until {
				append(&g.exile_returns, Exile_Return{card = card.id, incarnation = card.incarnation, zone = until.return_zone, source = o.id})
			}
		}
		ordered_remove(&s.exile_links, i)
	}
	if len(snapshot) == 0 {
		delete(snapshot)
		return
	}
	entries := s.linked_exile_lki[o.id]
	append(&entries, types.LinkedExileLki{departed = o.incarnation, successor = o.incarnation + 1, snapshot = snapshot})
	s.linked_exile_lki[o.id] = entries
}

// The cards "exiled with" the source (CR 607.2a), for an ability of it as the object `incarnation` names: the source
// still on the battlefield as that object, or the object that left (its last known links, CR 603.10a). Only cards
// still in exile as the objects they were when linked (CR 400.7).
linked_exiled_cards :: proc(g: ^Game, source: types.ObjectId, incarnation: Maybe(u64)) -> [dynamic]types.ObjectId {
	s := &g.state
	out := make([dynamic]types.ObjectId, context.temp_allocator)
	o := object(s, source)
	inc, known := incarnation.?
	if o != nil && o.zone == .Battlefield && (!known || o.incarnation == inc) {
		for l in s.exile_links do if l.source_id == source {
			if card := object(s, l.exiled_id); card != nil && card.zone == .Exile && !card.is_token do append(&out, card.id)
		}
		return out
	}
	if !known do return out
	for entry in s.linked_exile_lki[source] {
		// The ability of the object that left: put on the stack before it left (an ability activated by sacrificing
		// it) or after (its leaves-the-battlefield ability, whose source is then the new object).
		if entry.departed != inc && entry.successor != inc do continue
		for snap in entry.snapshot {
			card := object(s, snap.exiled_id)
			if card != nil && card.zone == .Exile && card.incarnation == snap.incarnation && !card.is_token && !slice.contains(out[:], card.id) do append(&out, card.id)
		}
	}
	return out
}

// The linked cards an instruction names: all of them, or those of a kind ("each creature card exiled with this").
linked_cards_named :: proc(g: ^Game, f: types.TargetFilter, controller: types.PlayerId, source: types.ObjectId) -> [dynamic]types.ObjectId {
	s := &g.state
	out := make([dynamic]types.ObjectId, context.temp_allocator)
	narrowed, has_type, _ := linked_exile_target(f)
	for id in linked_exiled_cards(g, source, g.resolution.source_incarnation) {
		if has_type && !object_matches(s, object(s, id), narrowed, controller, source) do continue
		append(&out, id)
	}
	return out
}

// A "return the exiled cards" instruction, carried out as a ChangeZone of those cards (do_change_zone), which
// chooses what a returning Aura enchants (CR 303.4f).
linked_exile_return :: proc(e: types.Effect) -> (types.Effect_ChangeZone, bool) {
	x, all := e.(types.Effect_ChangeZoneAll)
	if !all do return {}, false
	if _, _, linked := linked_exile_target(x.target); !linked do return {}, false
	return types.Effect_ChangeZone{actor = x.actor, origin = x.origin, destination = x.destination, target = x.target, enters_under = x.enters_under, enter_tapped = x.enter_tapped}, true
}

// ---- Returning (CR 610.3) ------------------------------------------------------------------------------------

// Notes that cards wait to return: at once, or when the simultaneous zone changes under way end (CR 610.3: the return
// is created immediately after the event; 610.3d: returns after simultaneous events are simultaneous). While a spell
// or ability resolves, once the instruction that made the host leave is done (continue_resolution), so that what it
// did "this way" (CR 608.2c) doesn't include the returns; after its last instruction, before the next player
// receives priority (give_priority).
returns_due :: proc(g: ^Game) {
	if len(g.exile_returns) == 0 || g.resolution.active do return
	if moving_together do exile_returns_waiting = g
	else do return_exiled_cards(g)
}

// The returns of the zone changes that just ended together (end_together).
returns_after_together :: proc() {
	g := exile_returns_waiting
	if g == nil do return
	exile_returns_waiting = nil
	if !g.resolution.active do return_exiled_cards(g)
}

// CR 610.3, 610.3c-d: each card returns to the zone it was exiled from, onto the battlefield under its owner's
// control, all at the same time. One that is no longer the card it was in exile (it left exile, a new object, CR
// 400.7) or a token (CR 111.8) doesn't. An Aura returning has what it will enchant chosen by its owner as it enters
// (CR 303.4f); with nothing it could enchant, it stays in exile (CR 303.4g). An Aura with a choice to make is asked
// about before the next player receives priority (ask_exile_return_host), not here, partway through whatever made its
// host leave.
return_exiled_cards :: proc(g: ^Game) {
	if returning_exiled || len(g.exile_returns) == 0 do return
	returning_exiled = true
	defer returning_exiled = false
	s := &g.state
	together := begin_together()
	for i := 0; i < len(g.exile_returns); {
		ret := g.exile_returns[i]
		card := still_to_return(s, ret)
		if card == nil {
			ordered_remove(&g.exile_returns, i)
			continue
		}
		host: ^types.GameObject
		if ret.zone == .Battlefield && is_aura(card) {
			hosts := aura_hosts_for(s, card, card.owner)
			n := len(hosts)
			if n == 1 {
				id, _ := target_object(hosts[0])
				host = object(s, id)
			}
			delete(hosts)
			if n > 1 {
				i += 1 // its owner chooses (ask_exile_return_host)
				continue
			}
			if n == 0 {
				ordered_remove(&g.exile_returns, i) // CR 303.4g: it stays in exile
				continue
			}
		}
		ordered_remove(&g.exile_returns, i)
		return_card(g, card, ret.zone, host)
	}
	end_together(together)
}

// The card a return names, if it's still that card in exile.
@(private = "file")
still_to_return :: proc(s: ^types.GameState, ret: Exile_Return) -> ^types.GameObject {
	card := object(s, ret.card)
	if card == nil || card.zone != .Exile || card.incarnation != ret.incarnation || card.is_token do return nil
	if !slice.contains(ids_of(s.exile), card.id) do return nil
	return card
}

// Puts the card back, under its owner's control (move_object: CR 610.3c, 110.2), an Aura attached to its host.
@(private = "file")
return_card :: proc(g: ^Game, card: ^types.GameObject, zone: types.Zone, host: ^types.GameObject) {
	move_object(g, card.id, zone)
	if host != nil && card.zone == .Battlefield do attach(&g.state, card, host)
}

// Before a player receives priority: the cards still to return, and the owner of a returning Aura asked what it will
// enchant (CR 303.4f). True while asking.
ask_exile_return_host :: proc(g: ^Game, after: types.PlayerId) -> bool {
	return_exiled_cards(g)
	s := &g.state
	for len(g.exile_returns) > 0 {
		ret := g.exile_returns[0]
		card := still_to_return(s, ret)
		if card == nil {
			ordered_remove(&g.exile_returns, 0)
			continue
		}
		hosts := aura_hosts_for(s, card, card.owner)
		if len(hosts) <= 1 {
			// The board changed since: no choice left to make.
			delete(hosts)
			return_exiled_cards(g)
			continue
		}
		g.asking_exile_return = true
		g.exile_return_after = after
		s.priority_player = card.owner
		s.waiting_for = types.WaitingFor_ReturnAsAuraTarget{player = card.owner, source_id = ret.source, returned_id = card.id, legal_targets = hosts}
		return true
	}
	return false
}

// The owner's choice of what the returning Aura enchants; then the next player receives priority (or the next Aura's
// owner is asked).
answer_exile_return_host :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_ReturnAsAuraTarget, choice: Maybe(types.TargetRef)) -> bool {
	s := &g.state
	if p != w.player do return false
	t, chosen := choice.?
	if !chosen || !slice.contains(w.legal_targets[:], t) do return false
	ret: Exile_Return
	after := g.exile_return_after
	if len(g.exile_returns) > 0 && g.exile_returns[0].card == w.returned_id {
		ret = g.exile_returns[0]
		ordered_remove(&g.exile_returns, 0)
	} else {
		// A restored game has the prompt alone (the queue lives beside the state): the Aura in exile returns to the
		// battlefield, and the active player receives priority (CR 117.3b).
		card := object(s, w.returned_id)
		if g.asking_exile_return || card == nil || card.zone != .Exile do return false
		ret = Exile_Return{card = card.id, incarnation = card.incarnation, zone = .Battlefield, source = w.source_id}
		after = s.active_player
	}
	g.asking_exile_return = false
	s.waiting_for = nil
	if card := still_to_return(s, ret); card != nil {
		id, _ := target_object(t)
		returning_exiled = true // this one alone: the others still waiting are asked about next
		together := begin_together()
		return_card(g, card, ret.zone, object(s, id))
		end_together(together)
		returning_exiled = false
	}
	give_priority(g, after)
	return true
}
