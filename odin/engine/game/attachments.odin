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

// "Attach this Equipment to target creature you control" (equip, CR 702.6a; a triggered ability), "attach it to that
// creature" (the trigger event's), "attach it to the token" (the one just made), "attach target Equipment you control
// to this creature", "you may attach an Equipment you control to it / to the token" (chosen as it resolves, CR
// 608.2d). The card data's `selection` says how the ATTACHMENT is picked (a target, or described and chosen as it
// resolves); a host the data names by a filter is a target, announced with the ability (CR 115.1, 601.2c, 602.2b,
// 603.3d). Two targets in one instruction ("attach target Equipment to target creature") aren't read yet.
attach_effect_supported :: proc(x: types.Effect_Attach) -> bool {
	// "Return this card to the battlefield attached to [a creature]": the card enters attached (CR 303.4f, 301.5e),
	// which isn't done yet; attaching it once it has entered isn't the same (it would enter unattached first).
	if previous_instruction != nil {
		if _, moved := previous_instruction^.(types.Effect_ChangeZone); moved do return false
	}
	host_ok := filter_targets_objects(x.target) || attach_context_host(x.target)
	switch a in x.selection {
	case types.AttachSelection_Targeted:
		if x.attachment == nil || is_self(x.attachment) do return host_ok
		// "Attach target Equipment you control to this creature": the attachment is the target, the host this.
		return is_self(x.target) && filter_targets_objects(x.attachment)
	case types.AttachSelection_AtResolution:
		if _, one := a.count.(types.AttachCardinality_One); !one && a.count != nil do return false
		if x.attachment == nil || is_self(x.attachment) do return host_ok
		#partial switch y in x.attachment {
		case types.TargetFilter_ParentTarget:
			// "When this Equipment enters, attach it to target creature you control": "it" is the permanent that
			// entered, the source itself (CR 603.2, 608.2c); only as that ability's first instruction.
			return attaching_self_entering && previous_instruction == nil && host_ok
		case types.TargetFilter_Typed:
			// "You may attach an Equipment you control to it / to the token": one chosen as it resolves (CR 608.2d),
			// attached to the host an earlier instruction named.
			c, has := y._0.controller.?
			_, you := c.(types.ControllerRef_You)
			_, parent := x.target.(types.TargetFilter_ParentTarget)
			_, last := x.target.(types.TargetFilter_LastCreated)
			return has && you && typed_supported(y._0) && only_equipment(y._0) && (parent || last)
		}
	}
	return false
}

// "Attach this Aura to a creature you control" (Breath of Fury): a host described by a filter but chosen as the
// ability resolves (CR 608.2d), which attach_effect_supported would read as a target; not read yet.
attach_host_timing_supported :: proc(a: types.AbilityDefinition) -> bool {
	if a.effect == nil || a.target_choice_timing == .Stack do return true
	x, attaches := a.effect^.(types.Effect_Attach)
	return !attaches || !filter_targets_objects(x.target)
}

// A filter naming objects to target ("target creature you control"), not a player.
@(private = "file")
filter_targets_objects :: proc(f: types.TargetFilter) -> bool {
	#partial switch _ in f {
	case types.TargetFilter_Typed, types.TargetFilter_Or:
		return filter_supported(f) && !may_name_player(f)
	}
	return false
}

// A host an earlier instruction or the trigger event names: "the token" just made, "it" (the target before), "that
// creature" (the trigger event's object).
@(private = "file")
attach_context_host :: proc(f: types.TargetFilter) -> bool {
	#partial switch _ in f {
	case types.TargetFilter_LastCreated, types.TargetFilter_ParentTarget:
		return true
	case types.TargetFilter_TriggeringSource:
		return event_object_defined
	}
	return false
}

// "An Equipment you control": a filter only Equipment can match, so what's chosen can equip (CR 301.5).
@(private = "file")
only_equipment :: proc(f: types.TypedFilter) -> bool {
	for t in f.type_filters do if sub, ok := t.(types.TypeFilter_Subtype); ok && sub._0 == "Equipment" do return true
	return false
}

// While the instructions of a permanent's own "when this enters" ability are checked (triggers.odin): there "attach
// it" names that permanent.
@(thread_local)
attaching_self_entering: bool

// The target of an attach instruction (CR 115.1): the attachment when the data makes it the target ("attach target
// Equipment you control to this creature"), else the host ("to target creature you control"). A host named by an
// earlier instruction or the trigger event ("it", "that creature", "the token") is no target (effect_target).
attach_target_filter :: proc(x: types.Effect_Attach) -> types.TargetFilter {
	if _, targeted := x.selection.(types.AttachSelection_Targeted); targeted && x.attachment != nil && !is_self(x.attachment) do return x.attachment
	return x.target
}

// Returns true while the player chooses which Equipment to attach.
do_attach :: proc(g: ^Game, x: types.Effect_Attach, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) -> bool {
	s := &g.state
	if _, targeted := x.selection.(types.AttachSelection_Targeted); targeted && x.attachment != nil && !is_self(x.attachment) {
		// "Attach target Equipment you control to this creature": the target goes onto the source, while the source
		// is the same permanent (CR 400.7).
		host := same_source(g, source)
		id, ok := target_object(target)
		if ok && host != nil && host.zone == .Battlefield do attach_if_legal(s, object(s, id), host)
		return false
	}
	host := attach_host(g, x, target)
	if host == nil do return false
	if typed, chosen := x.attachment.(types.TargetFilter_Typed); chosen {
		// "You may attach an Equipment you control to it": its controller chooses one as it resolves (CR 608.2d).
		eligible: [dynamic]types.ObjectId
		for o in permanents_of(s, controller) do if object_matches(s, o, typed._0, controller, source) && can_attach(s, o, host) do append(&eligible, o.id)
		if len(eligible) == 0 do return false
		if len(eligible) == 1 {
			attach(s, object(s, eligible[0]), host)
			return false
		}
		s.priority_player = controller
		s.waiting_for = types.WaitingFor_EffectZoneChoice{player = controller, cards = eligible, count = 1, min_count = 1, source_id = source, effect_kind = .Attach, zone = .Battlefield}
		return true
	}
	// CR 702.6a, 701.3a: the source (this Equipment, "it") becomes attached to the host, only while it's the same
	// object on the battlefield.
	attachment := same_source(g, source)
	if attachment != nil && attachment.zone == .Battlefield do attach_if_legal(s, attachment, host)
	return false
}

// The permanent an attach instruction attaches to: its target, "it" (the earlier target) or "that creature" (the
// trigger event's object while it's the same object), which resolution.odin passes as the instruction's target; or
// the token the instruction before made.
@(private = "file")
attach_host :: proc(g: ^Game, x: types.Effect_Attach, target: Maybe(types.TargetRef)) -> ^types.GameObject {
	s := &g.state
	host: ^types.GameObject
	if id, ok := target_object(target); ok {
		host = object(s, id)
	} else if _, last := x.target.(types.TargetFilter_LastCreated); last {
		#reverse for id in g.resolution.moved do if o := object(s, id); o != nil && o.zone == .Battlefield && is_type(o, .Creature) {
			host = o
			break
		}
	}
	if host == nil || host.zone != .Battlefield do return nil
	return host
}

answer_attach :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_EffectZoneChoice, chosen: []types.ObjectId) -> bool {
	r := &g.resolution
	if !r.active || r.current == nil || len(chosen) != 1 || !slice.contains(w.cards[:], chosen[0]) do return false
	x, is_attach := r.current.effect.(types.Effect_Attach)
	if !is_attach do return false
	// The host, found again as do_attach found it: "it" is the earlier instruction's target.
	target: Maybe(types.TargetRef)
	if _, parent := x.target.(types.TargetFilter_ParentTarget); parent && len(r.last_targets) > 0 do target = r.last_targets[0]
	s := &g.state
	if host := attach_host(g, x, target); host != nil do attach_if_legal(s, object(s, chosen[0]), host)
	s.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// Whether an Aura or Equipment on the battlefield can become attached to a permanent (CR 701.3a): an Equipment only to
// a creature other than itself, and not while it's a creature itself (CR 301.5, 301.5c; reconfigure isn't read
// yet); an Aura only to what its enchant ability allows, not itself (CR 303.4d); neither to a permanent with
// protection from it (CR 702.16c-d).
can_attach :: proc(s: ^types.GameState, attachment, host: ^types.GameObject) -> bool {
	if attachment == nil || host == nil || attachment.id == host.id || host.zone != .Battlefield || attachment.zone != .Battlefield do return false
	if protected_from(host, attachment) do return false
	if is_aura(attachment) {
		f, _ := enchant_filter(attachment)
		return aura_can_enchant(s, attachment, f, host)
	}
	if has_subtype(attachment, "Equipment") do return is_type(host, .Creature) && !is_type(attachment, .Creature)
	return false
}

// CR 701.3b, 301.5b: an attachment that can't be attached to the host doesn't move.
attach_if_legal :: proc(s: ^types.GameState, attachment, host: ^types.GameObject) {
	if can_attach(s, attachment, host) do attach(s, attachment, host)
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
