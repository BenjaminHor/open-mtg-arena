// Auras and Equipment (CR 301.5, 303.4, 702.5, 702.6): an Aura spell targets what its enchant ability allows and
// enters the battlefield attached to it (CR 303.4a, 608.3c); equip attaches an Equipment to a creature its
// controller controls (CR 702.6a). "Enchanted creature" and "equipped creature" mean the permanent it's attached
// to. State-based actions put an Aura that's attached to nothing legal into the graveyard (CR 704.5m) and unattach
// such Equipment (CR 704.5n).
package game

import "core:slice"
import types "../types"

// The enchant ability's filter: what an Aura can enchant (CR 702.5a).
enchant_filter :: proc(o: ^types.GameObject) -> (types.TargetFilter, bool) {
	for k in o.keywords do if e, ok := k.(types.Keyword_Enchant); ok do return e._0, true
	for k in o.base_keywords do if e, ok := k.(types.Keyword_Enchant); ok do return e._0, true
	return nil, false
}

is_aura :: proc(o: ^types.GameObject) -> bool {
	_, ok := enchant_filter(o)
	return ok && has_subtype(o, "Aura")
}

attach_effect_supported :: proc(x: types.Effect_Attach) -> bool {
	if x.attachment != nil && !is_self(x.attachment) do return false
	at, chosen := x.selection.(types.AttachSelection_AtResolution)
	if !chosen do return filter_supported(x.target) && !may_name_player(x.target)
	if _, one := at.count.(types.AttachCardinality_One); !one && at.count != nil do return false
	// "Attach it to the token" (the one just created) or "attach it to a creature you control", chosen as it
	// resolves (CR 608.2d), not targeted.
	if _, last := x.target.(types.TargetFilter_LastCreated); last do return true
	typed, ok := x.target.(types.TargetFilter_Typed)
	if !ok || !typed_supported(typed._0) do return false
	c, has := typed._0.controller.?
	_, you := c.(types.ControllerRef_You)
	return has && you
}

// Returns true while the player chooses what to attach it to.
do_attach :: proc(g: ^Game, x: types.Effect_Attach, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> bool {
	s := &g.state
	// CR 702.6a, 701.3: the source (an Equipment) becomes attached to it; only while it's the same object there.
	equipment := same_source(g, source)
	if equipment == nil || equipment.zone != .Battlefield do return false
	if _, chosen := x.selection.(types.AttachSelection_AtResolution); !chosen {
		if id, ok := target_object(target); ok do attach(s, equipment, object(s, id))
		return false
	}
	if _, last := x.target.(types.TargetFilter_LastCreated); last {
		// The token the instruction before made.
		#reverse for id in g.resolution.moved do if o := object(s, id); o != nil && o.zone == .Battlefield && is_type(o, .Creature) {
			attach(s, equipment, o)
			break
		}
		return false
	}
	typed := x.target.(types.TargetFilter_Typed)._0
	eligible: [dynamic]types.ObjectId
	for o in permanents_of(s, controller) do if o.id != equipment.id && object_matches(s, o, typed, controller, source) do append(&eligible, o.id)
	if len(eligible) == 0 do return false
	if len(eligible) == 1 {
		attach(s, equipment, object(s, eligible[0]))
		return false
	}
	s.priority_player = controller
	s.waiting_for = types.WaitingFor_EffectZoneChoice{player = controller, cards = eligible, count = 1, min_count = 1, source_id = source, effect_kind = .Attach, zone = .Battlefield}
	return true
}

answer_attach :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_EffectZoneChoice, chosen: []types.ObjectId) -> bool {
	if !g.resolution.active || len(chosen) != 1 || !slice.contains(w.cards[:], chosen[0]) do return false
	s := &g.state
	if equipment := same_source(g, w.source_id); equipment != nil && equipment.zone == .Battlefield do attach(s, equipment, object(s, chosen[0]))
	s.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// The object something is attached to, if it's attached to a permanent.
host_of :: proc(s: ^types.GameState, o: ^types.GameObject) -> ^types.GameObject {
	at, attached := o.attached_to.?
	if !attached do return nil
	h, is_object := at.(types.AttachTarget_Object)
	if !is_object do return nil
	return object(s, h._0)
}

attach :: proc(s: ^types.GameState, attachment, host: ^types.GameObject) {
	unattach(s, attachment)
	attachment.attached_to = types.AttachTarget_Object{host.id}
	append(&host.attachments, attachment.id)
}

unattach :: proc(s: ^types.GameState, attachment: ^types.GameObject) {
	if host := host_of(s, attachment); host != nil {
		for id, i in host.attachments do if id == attachment.id {
			ordered_remove(&host.attachments, i)
			break
		}
	}
	attachment.attached_to = nil
}

// When a permanent leaves the battlefield, whatever was attached to it is attached to nothing (it goes on to the
// state-based actions).
detach_all_from :: proc(s: ^types.GameState, host: ^types.GameObject) {
	for id in ids_of(s.battlefield) {
		o := object(s, id)
		if h := host_of(s, o); h != nil && h.id == host.id do o.attached_to = nil
	}
	clear(&host.attachments)
}

// CR 704.5m, 704.5n. True when something changed.
attachment_state_actions :: proc(g: ^Game) -> bool {
	s := &g.state
	changed := false
	for id in ids_of(s.battlefield) {
		o := object(s, id)
		if is_aura(o) {
			host := host_of(s, o)
			f, _ := enchant_filter(o)
			// CR 702.16c: a host with protection from the Aura can't be enchanted by it.
			if host == nil || host.zone != .Battlefield || !aura_can_enchant(s, o, f, host) || protected_from(host, o) {
				move_object(g, id, .Graveyard)
				changed = true
			}
		} else if has_subtype(o, "Equipment") {
			// CR 702.16d: nor equipped by Equipment it has protection from.
			if host := host_of(s, o); host != nil && (host.zone != .Battlefield || !is_type(host, .Creature) || host.id == o.id || protected_from(host, o)) {
				unattach(s, o)
				changed = true
			}
		}
	}
	return changed
}

// Whether the Aura's enchant ability allows the host (CR 303.4d: an illegal host makes it go to the graveyard).
aura_can_enchant :: proc(s: ^types.GameState, aura: ^types.GameObject, f: types.TargetFilter, host: ^types.GameObject) -> bool {
	t, typed := f.(types.TargetFilter_Typed)
	if !typed do return false
	return object_matches(s, host, t._0, aura.controller, aura.id)
}
