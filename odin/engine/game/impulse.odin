// Impulse draw: "Exile the top two cards of your library. Until the end of your next turn, you may play those
// cards." The cards are exiled (CR 406), and a permission to play them from exile is kept on each card in the state
// (its casting_permissions), ending with its stated duration or when the card leaves exile (CR 400.7).
package game

import types "../types"

exile_top_supported :: proc(x: types.Effect_ExileTop) -> bool {
	if x.face_down || !is_controller(x.player) || !quantity_supported(x.count) do return false
	if _, controller := x.actor.(types.LibraryInstructionActor_Controller); x.actor != nil && !controller do return false
	_, top := x.position.(types.LibraryPosition_Top)
	return top
}

do_exile_top :: proc(g: ^Game, x: types.Effect_ExileTop, controller: types.PlayerId, source: types.ObjectId, target: Maybe(types.TargetRef)) {
	s := &g.state
	n := amount(g, x.count, controller, source, target)
	pl := player(s, controller)
	together := begin_together()
	for _ in 0 ..< n {
		count := types.pvec_len(pl.library)
		if count == 0 do break
		move_object(g, types.pvec_get(pl.library, count - 1), .Exile)
	}
	end_together(together)
}

// "You may play those cards this turn / until the end of your next turn / for as long as they remain exiled."
grant_permission_supported :: proc(x: types.Effect_GrantCastingPermission) -> bool {
	if x.grantee != .AbilityController do return false
	if _, tracked := x.target.(types.TargetFilter_TrackedSet); !tracked do return false
	p, ok := x.permission.(types.CastingPermission_PlayFromExile)
	if !ok || p.frequency != .Unlimited || p.single_use || p.without_paying_mana_cost || p.card_filter != nil do return false
	if p.mana_spend_permission != nil || p.cast_cost_modifier != nil || p.alt_ability_cost != nil || p.land_enter_tapped != .Unspecified do return false
	#partial switch d in p.duration {
	case types.Duration_UntilEndOfTurn, types.Duration_Permanent:
		return true
	case types.Duration_UntilEndOfNextTurnOf:
		_, you := d.player.(types.PlayerScope_Controller)
		return you
	}
	return false
}

// The permission for the cards the instruction before exiled ("those cards").
do_grant_permission :: proc(g: ^Game, x: types.Effect_GrantCastingPermission, controller: types.PlayerId, source: types.ObjectId) {
	s := &g.state
	p := x.permission.(types.CastingPermission_PlayFromExile)
	p.granted_to = controller
	p.source_id = source
	last := max(int)
	#partial switch _ in p.duration {
	case types.Duration_UntilEndOfTurn:
		last = int(s.turn_number)
	case types.Duration_UntilEndOfNextTurnOf:
		// The controller's next turn: the one after this, or after the opponent's (two players, no extra turns).
		last = int(s.turn_number) + (2 if s.active_player == controller else 1)
	}
	for id in g.resolution.moved {
		o := object(s, id)
		if o == nil || o.zone != .Exile do continue
		append(&o.casting_permissions, types.CastingPermission(p))
		append(&g.permission_ends, Permission_End{object = o.id, incarnation = o.incarnation, last_turn = last})
	}
}

// Whether the player may play (or cast) this card from exile now, by a permission.
exile_permission :: proc(o: ^types.GameObject, p: types.PlayerId) -> (mode: types.CardPlayMode, ok: bool) {
	if o.zone != .Exile do return
	for c in o.casting_permissions do if x, play := c.(types.CastingPermission_PlayFromExile); play && x.granted_to == p do return x.mode, true
	return
}

// CR 514.2: permissions lasting until the end of this turn end in the cleanup step.
end_permissions :: proc(g: ^Game) {
	s := &g.state
	kept := make([dynamic]Permission_End)
	for e in g.permission_ends {
		o := object(s, e.object)
		if o == nil || o.incarnation != e.incarnation || o.zone != .Exile do continue
		if e.last_turn <= int(s.turn_number) {
			clear(&o.casting_permissions)
			continue
		}
		append(&kept, e)
	}
	g.permission_ends = kept
}

Permission_End :: struct {
	object:      types.ObjectId,
	incarnation: u64,
	last_turn:   int,
}
