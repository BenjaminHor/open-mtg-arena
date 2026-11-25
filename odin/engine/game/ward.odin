// Ward, CR 702.21a: "Whenever this permanent becomes the target of a spell or ability an opponent controls, counter
// that spell or ability unless that player pays [cost]." The card data lists only the keyword; this is the
// triggered ability it stands for, carried out as "counter it unless its controller pays" (CR 118.12a).
package game

import types "../types"

// The ward costs carried out: mana without X (X ward costs, CR 702.21b, and other costs aren't yet).
ward_supported :: proc(k: types.Keyword_Ward) -> bool {
	m, is_mana := k._0.(types.WardCost_Mana)
	if !is_mana do return false
	c, is_cost := m._0.(types.ManaCost_Cost)
	if !is_cost do return false
	for shard in c.shards do if _, _, ok := shard_payers(shard); !ok || shard == .X do return false
	return true
}

// A spell or ability on the stack targets these: each permanent it targets "becomes the target" (CR 702.21a,
// 115.1). `entry` is its stack object.
note_targeted :: proc(g: ^Game, entry: types.ObjectId, controller: types.PlayerId, targets: []types.TargetRef) {
	for t in targets {
		id, is_object := target_object(t)
		if !is_object do continue
		if o := object(&g.state, id); o != nil && o.zone == .Battlefield {
			append(&g.events, Event{kind = .Became_Target, object = id, controller = controller, stack_entry = entry})
		}
	}
}

// The ward triggers of a permanent that became a target of an opponent's spell or ability: one per instance.
ward_triggers :: proc(g: ^Game, e: Event) {
	o := object(&g.state, e.object)
	if o == nil || o.zone != .Battlefield || o.controller == e.controller do return
	for k in o.keywords {
		w, is_ward := k.(types.Keyword_Ward)
		if !is_ward || !ward_supported(w) do continue
		counter := new(types.Effect)
		counter^ = types.Effect_Counter{target = types.TargetFilter_TriggeringSource{}}
		a := new(types.AbilityDefinition)
		a.kind = .Spell
		a.effect = counter
		a.description = "Ward"
		a.unless_pay = types.UnlessPayModifier{cost = types.AbilityCost_Mana{cost = w._0.(types.WardCost_Mana)._0}, payer = types.TargetFilter_TriggeringPlayer{}}
		t := new(types.TriggerDefinition)
		t.execute = a
		t.description = "Ward"
		add_trigger(g, o.id, o.controller, t)
	}
}

// The stack object with that id: a spell, or an ability (which isn't an object).
stack_entry_of :: proc(s: ^types.GameState, id: types.ObjectId) -> (types.StackEntry, bool) {
	for i in 0 ..< types.pvec_len(s.stack) {
		e := types.pvec_get(s.stack, i)
		if e.id == id do return e, true
	}
	return {}, false
}
