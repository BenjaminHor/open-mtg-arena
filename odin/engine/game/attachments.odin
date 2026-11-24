// Auras and Equipment (CR 301.5, 303.4, 702.5, 702.6): an Aura spell targets what its enchant ability allows and
// enters the battlefield attached to it (CR 303.4a, 608.3c); equip attaches an Equipment to a creature its
// controller controls (CR 702.6a). "Enchanted creature" and "equipped creature" mean the permanent it's attached
// to. State-based actions put an Aura that's attached to nothing legal into the graveyard (CR 704.5m) and unattach
// such Equipment (CR 704.5n).
package game

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
	return filter_supported(x.target) && !may_name_player(x.target)
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
			if host == nil || host.zone != .Battlefield || !aura_can_enchant(s, o, f, host) {
				move_object(g, id, .Graveyard)
				changed = true
			}
		} else if has_subtype(o, "Equipment") {
			if host := host_of(s, o); host != nil && (host.zone != .Battlefield || !is_type(host, .Creature) || host.id == o.id) {
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
