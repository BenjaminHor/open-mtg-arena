// Prevention effects (CR 615): "Prevent all combat damage that would be dealt this turn", "prevent all damage that
// would be dealt to target creature this turn". A shield lasting the turn; damage it prevents isn't dealt (CR
// 615.6: no event, no lifelink).
package game

import types "../types"

Prevention :: struct {
	filter:      types.TargetFilter, // which recipients: any, players, a kind of creature; nil when `object` is set
	object:      types.ObjectId, // one object ("target creature", "this creature"), as it was
	incarnation: u64,
	combat_only: bool,
	controller:  types.PlayerId,
	source:      types.ObjectId,
}

prevention_supported :: proc(x: types.Effect_PreventDamage) -> bool {
	if _, all := x.amount.(types.PreventionAmount_All); !all do return false
	if x.amount_dynamic != nil || x.damage_source_filter != nil do return false
	if d, has := x.prevention_duration.?; has {
		if _, eot := d.(types.Duration_UntilEndOfTurn); !eot do return false
	}
	#partial switch f in x.target {
	case types.TargetFilter_Any, types.TargetFilter_Player, types.TargetFilter_ParentTarget, types.TargetFilter_SelfRef:
		return true
	case types.TargetFilter_Typed:
		return x.recipient_scope == .All && mass_filter_supported(x.target)
	}
	return false
}

// CR 615.1a: the shield is set up as the spell or ability resolves; it lasts this turn.
add_prevention :: proc(g: ^Game, x: types.Effect_PreventDamage, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) {
	p := Prevention{combat_only = x.scope == .CombatDamage, controller = controller, source = source}
	#partial switch _ in x.target {
	case types.TargetFilter_ParentTarget:
		id, ok := target_object(target)
		if !ok do return
		o := object(&g.state, id)
		if o == nil do return
		p.object, p.incarnation = id, o.incarnation
	case types.TargetFilter_SelfRef:
		o := same_source(g, source)
		if o == nil do return
		p.object, p.incarnation = o.id, o.incarnation
	case:
		p.filter = x.target
	}
	append(&g.preventions, p)
}

// Whether a prevention shield stops this damage.
damage_prevented :: proc(g: ^Game, target: types.TargetRef, combat: bool) -> bool {
	s := &g.state
	for p in g.preventions {
		if p.combat_only && !combat do continue
		switch t in target {
		case types.TargetRef_Player:
			if p.object != 0 do continue
			#partial switch _ in p.filter {
			case types.TargetFilter_Any, types.TargetFilter_Player:
				return true
			}
		case types.TargetRef_Object:
			o := object(s, t._0)
			if o == nil do continue
			if p.object != 0 {
				if p.object == o.id && p.incarnation == o.incarnation do return true
				continue
			}
			#partial switch _ in p.filter {
			case types.TargetFilter_Any:
				return true
			case types.TargetFilter_Typed, types.TargetFilter_Or:
				if mass_filter_matches(s, o, p.filter, p.controller, p.source) do return true
			}
		}
	}
	return false
}

// "If that creature would die this turn, exile it instead" (CR 614.6): a replacement effect on one permanent,
// lasting the turn, applying once.
exile_instead_supported :: proc(x: types.Effect_AddTargetReplacement) -> bool {
	r := x.replacement
	if r == nil || r.execute == nil || r.execute.effect == nil || r.execute.sub_ability != nil || r.condition != nil do return false
	if _, any := x.target.(types.TargetFilter_Any); !any do return false // "that creature": the earlier target
	if _, moved := r.event.(types.ReplacementEvent_Moved); !moved do return false
	if _, mandatory := r.mode.(types.ReplacementMode_Mandatory); !mandatory do return false
	if dest, has := r.destination_zone.?; !has || dest != .Graveyard do return false
	cz, is_cz := r.execute.effect^.(types.Effect_ChangeZone)
	if !is_cz || cz.destination != .Exile || !is_self(cz.target) do return false
	if e, has := r.expiry.?; has {
		if _, eot := e.(types.RestrictionExpiry_EndOfTurn); !eot do return false
	}
	return true
}

add_exile_instead :: proc(g: ^Game, target: Maybe(types.TargetRef)) {
	id, ok := target_object(target)
	if !ok do return
	o := object(&g.state, id)
	if o == nil || o.zone != .Battlefield do return
	append(&g.exile_instead, Control_Change{object = id, incarnation = o.incarnation})
}

// Whether a permanent going from the battlefield to a graveyard goes to exile instead (and the effect is used up).
exiled_instead :: proc(g: ^Game, o: ^types.GameObject) -> bool {
	for c, i in g.exile_instead do if c.object == o.id && c.incarnation == o.incarnation {
		ordered_remove(&g.exile_instead, i)
		return true
	}
	return false
}
