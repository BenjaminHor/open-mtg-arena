// Flashback (CR 702.34a): "You may cast this card from your graveyard if the resulting spell is an instant or
// sorcery spell by paying [cost] rather than paying its mana cost" and "If the flashback cost was paid, exile this
// card instead of putting it anywhere else any time it would leave the stack."
package game

import types "../types"

flashback_cost :: proc(o: ^types.GameObject) -> (types.ManaCost, bool) {
	for k in o.keywords do if f, ok := k.(types.Keyword_Flashback); ok {
		if m, mana := f._0.(types.FlashbackCost_Mana); mana && !has_x(m._0) do return m._0, true
	}
	return nil, false
}

// Castable from the graveyard by flashback: an instant or sorcery card its owner has there.
flashback_castable :: proc(o: ^types.GameObject, p: types.PlayerId) -> bool {
	if o.zone != .Graveyard || o.owner != p do return false
	if !is_type(o, .Instant) && !is_type(o, .Sorcery) do return false
	_, has := flashback_cost(o)
	return has
}

// Cast from the graveyard by its flashback ability: not by another effect's permission (cast_during_resolution.odin),
// for which no flashback cost was paid (CR 702.34a).
cast_by_flashback :: proc(g: ^Game, o: ^types.GameObject) -> bool {
	z, has := o.cast_from_zone.?
	if !has || z != .Graveyard || o.zone != .Stack do return false
	if inc, by_effect := g.cast_by_effect[o.id]; by_effect && inc == o.incarnation do return false
	_, flashback := flashback_cost(o)
	return flashback
}

// Where a spell goes as it leaves the stack (CR 608.2n, 701.6a): its owner's graveyard, or exile after flashback.
spell_leaves_stack :: proc(g: ^Game, id: types.ObjectId) {
	o := object(&g.state, id)
	exiles_itself := g.spell_exiles_itself == id // "Exile [this spell]" (zone_effects.odin)
	g.spell_exiles_itself = 0
	// CR 702.34a; or "if that spell would be put into your graveyard, exile it instead" (cast_during_resolution.odin).
	if o != nil && (cast_by_flashback(g, o) || exiles_itself || exiled_instead_of_graveyard_after_cast(g, o)) {
		move_object(g, id, .Exile)
		return
	}
	move_object(g, id, .Graveyard)
}
