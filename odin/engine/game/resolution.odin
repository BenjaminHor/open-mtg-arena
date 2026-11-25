// Resolving a spell or ability (CR 608.2): its instructions are carried out in order. Some instructions ask a
// player to choose (scry, surveil); the resolution pauses there and continues once they answer.
package game

import "core:reflect"
import "core:slice"
import rng "../rng"
import types "../types"

Resolution :: struct {
	active:       bool,
	next:         ^types.ResolvedAbility, // the next instruction to carry out
	controller:   types.PlayerId,
	source:       types.ObjectId,
	spell:        types.ObjectId, // an instant or sorcery to put into the graveyard at the end (CR 608.2n), or 0
	stack_id:     types.ObjectId, // an ability's stack object, or 0
	last_targets: [dynamic]types.TargetRef, // the latest targeting instruction's legal targets: "it", "they" next
	all_targets:  [dynamic]types.TargetRef, // every target chosen for it, in order
	asked:        ^types.ResolvedAbility, // a "you may" instruction waiting for its controller's answer
	answer:       Maybe(bool),
	performed:    bool, // whether the latest "you may" instruction was done: "if you do" (CR 608.2c)
	found:        [dynamic]types.ObjectId, // the cards a library search found: "those cards" next
	source_incarnation: Maybe(u64), // the source as the ability was put on the stack: "this" means that object
	source_was:   ^types.GameObject, // that source as it last was, when it has since changed zones (CR 608.2h)
	event:        Trigger_Event, // a triggered ability's event: "that much damage", "that creature"
	scope_node:   ^types.ResolvedAbility, // an instruction carried out for each player in a scope...
	scope:        [dynamic]types.PlayerId, // ...for these players...
	scope_next:   int, // ...of which this is the next
	moved:        [dynamic]types.ObjectId, // what the latest instruction moved between zones: "this way" (CR 608.2c)
	events_mark:  int, // where that instruction's events began (it may have paused for a choice since)
	did_something: bool, // that instruction moved, made or put counters on something: "when you do" after it
	current:      ^types.ResolvedAbility, // the instruction being carried out (the one before, once the next starts)
	top:          ^types.ResolvedAbility, // the first instruction
	unless_node:  ^types.ResolvedAbility, // an "unless [a player] pays" instruction whose payer was asked...
	unless_paid:  bool, // ...and whether they paid
	fizzled:      bool, // every target illegal: it didn't resolve (CR 608.2b)
}

// The spell or ability as it goes on the stack: one node per instruction, each with the targets chosen for it (CR
// 601.2c), the way the Rust engine's state has it. It resolves from this alone, so a saved game's stack resolves
// too. `counts` is how many targets each targeting instruction took (1 each when nil); targets left over (an Aura
// spell's, CR 303.4a) stay on the first node.
resolved_tree :: proc(s: ^types.GameState, a: ^types.AbilityDefinition, targets: []types.TargetRef, counts: []int, controller: types.PlayerId, source: types.ObjectId) -> ^types.ResolvedAbility {
	top, prev: ^types.ResolvedAbility
	next, k := 0, 0
	reflexive := false // past a "when you do": its targets come when it triggers (CR 603.12)
	for x := a; x != nil; x = x.sub_ability {
		if x != a && is_reflexive(x) do reflexive = true
		node := new(types.ResolvedAbility)
		node.source_id = source
		node.controller = controller
		if src := object(s, source); src != nil do node.source_incarnation = src.incarnation
		if x.effect != nil do node.effect = x.effect^
		node.duration = x.duration
		node.condition = x.condition
		node.sub_link = x.sub_link
		node.kind = x.kind
		node.description = x.description
		node.optional = x.optional
		node.multi_target = x.multi_target
		node.player_scope = x.player_scope
		node.unless_pay = x.unless_pay
		node.distribute = x.distribute
		if x.effect != nil && !reflexive {
			if _, targets_one := effect_target(x.effect^); targets_one {
				n := counts[k] if k < len(counts) else 1
				k += 1
				for _ in 0 ..< n do if next < len(targets) {
					append(&node.targets, targets[next])
					next += 1
				}
			}
		}
		if top == nil do top = node
		else do prev.sub_ability = node
		prev = node
	}
	if top == nil {
		top = new(types.ResolvedAbility)
		top.source_id = source
		top.controller = controller
	}
	for ; next < len(targets); next += 1 do append(&top.targets, targets[next])
	for n := top; n != nil; n = n.sub_ability do record_target_incarnations(s, n)
	return top
}

// Starts resolving: checks targets (CR 608.2b) and carries out the instructions. False while a player chooses.
start_resolution :: proc(g: ^Game, top: ^types.ResolvedAbility, controller: types.PlayerId, source: types.ObjectId, spell: types.ObjectId = 0, stack_id: types.ObjectId = 0, event := Trigger_Event{}, source_was: ^types.GameObject = nil) -> bool {
	s := &g.state
	any_target, any_legal := false, false
	for n := top; n != nil; n = n.sub_ability {
		clear(&n.illegal_target_slots)
		f, targets_one := effect_target(n.effect)
		if !targets_one && refers_to_parent_target(n.effect) do continue // a delayed ability's "it": not a target
		fight, is_fight := n.effect.(types.Effect_Fight)
		for t, i in n.targets {
			any_target = true
			// "Target creature you control fights target creature": the first target is the subject's.
			if is_fight && i == 0 && fight_subject_targeted(fight) do f = fight.subject
			else if is_fight do f = fight.target
			// CR 608.2b: a target that changed zones (a new object, CR 400.7) or no longer fits is illegal.
			if targets_one && same_object_as_chosen(s, n, i) && target_still_legal(s, t, f, controller, source) do any_legal = true
			else do append(&n.illegal_target_slots, i)
		}
	}
	g.resolution = Resolution{active = true, next = top, controller = controller, source = source, spell = spell, stack_id = stack_id, event = event, source_was = source_was}
	g.resolution.source_incarnation = top.source_incarnation
	g.resolution.last_targets = make([dynamic]types.TargetRef)
	g.resolution.all_targets = make([dynamic]types.TargetRef)
	g.resolution.found = make([dynamic]types.ObjectId)
	g.resolution.moved = make([dynamic]types.ObjectId)
	g.resolution.events_mark = -1
	g.resolution.top = top
	for n := top; n != nil; n = n.sub_ability do append(&g.resolution.all_targets, ..n.targets[:])
	// A delayed ability's "it" (CR 603.7c): only while it's the same object it was.
	if refers_to_parent_target(top.effect) {
		for t, i in top.targets do if same_object_as_chosen(s, top, i) do append(&g.resolution.last_targets, t)
	}
	// CR 608.2b: with every target illegal, the spell or ability does nothing.
	if any_target && !any_legal {
		g.resolution.next = nil
		g.resolution.fizzled = true // it doesn't resolve (an Adventure goes to the graveyard, CR 716.3d)
	}
	return continue_resolution(g)
}

// An instruction about its trigger's event ("put a +1/+1 counter on that creature", "it deals 2 damage to that
// player"): what it acts on, or nil when that object has changed zones since (CR 400.7).
event_reference :: proc(s: ^types.GameState, e: types.Effect, event: Trigger_Event) -> (Maybe(types.TargetRef), bool) {
	#partial switch _ in effect_target_filter(e) {
	case types.TargetFilter_TriggeringSource:
		if event.object == 0 do return nil, true
		o := object(s, event.object)
		if o == nil {
			// An ability on the stack ("that spell or ability", ward), while it's still there.
			if _, on_stack := stack_entry_of(s, event.object); on_stack do return types.TargetRef(types.TargetRef_Object{event.object}), true
			return nil, true
		}
		if o.incarnation != event.incarnation do return nil, true
		return types.TargetRef(types.TargetRef_Object{o.id}), true
	case types.TargetFilter_TriggeringSourceController:
		if event.object == 0 do return nil, true
		return types.TargetRef(types.TargetRef_Player{event.object_controller}), true
	case types.TargetFilter_TriggeringPlayer:
		p, has := event.player.?
		if !has do return nil, true
		return types.TargetRef(types.TargetRef_Player{p}), true
	}
	return nil, false
}

// Carries out the remaining instructions. False while a player chooses; true once resolved.
continue_resolution :: proc(g: ^Game) -> bool {
	s := &g.state
	r := &g.resolution
	event_amount = r.event.amount // "that much", read by the instructions (quantities.odin)
	event_object_now = r.event.object
	source_was_now = r.source_was
	for r.next != nil {
		// What the instruction just carried out moved, before the next one reads "this way". An instruction skipped
		// for its condition carries nothing out, so "this way" still means the one before it.
		if r.events_mark >= 0 && r.events_mark <= len(g.events) {
			note_moved(g, r.events_mark)
			if r.current != nil do note_amount(g, r.current.effect, r.events_mark)
		}
		r.events_mark = -1
		x := r.next
		r.next = x.sub_ability
		previous := r.current
		r.current = x
		if c, has := x.condition.?; has {
			if _, when_you_do := c.(types.AbilityCondition_WhenYouDo); when_you_do {
				// CR 603.12: "when you do" triggers if the "you may" before it was done; the rest is that ability's.
				// After a "you may", whether it was done; after a mandatory instruction, whether it did anything.
				done := r.performed if previous != nil && previous.optional else r.did_something
				if done do reflexive_trigger(g, x)
				r.next = nil
				continue
			}
		}
		parent_targets := slice.clone(r.last_targets[:], context.temp_allocator) // "it fights ...": the one before's
		affected := make([dynamic]Maybe(types.TargetRef), context.temp_allocator)
		if _, targets_one := effect_target(x.effect); targets_one {
			clear(&r.last_targets)
			for t, i in x.targets do if !slice.contains(x.illegal_target_slots[:], i) {
				append(&r.last_targets, t)
				append(&affected, t)
			}
			if len(affected) == 0 do continue // CR 608.2b: an illegal target is unaffected
		} else if refers_to_parent_target(x.effect) {
			// "Untap target creature. It gains flying": "it" is the previous instruction's target, and an illegal
			// one is unaffected by the rest too (CR 608.2b).
			_, of_controller := effect_target_filter(x.effect).(types.TargetFilter_ParentTargetController)
			for t in r.last_targets {
				if !of_controller {
					append(&affected, t)
					continue
				}
				// "That creature's controller" (its last known controller if it has left, CR 608.2h).
				if id, is_object := target_object(t); is_object {
					o := object(s, id)
					if was := last_known(id); was != nil && o.zone != .Battlefield do o = was
					append(&affected, types.TargetRef(types.TargetRef_Player{o.controller}))
				}
			}
			if len(affected) == 0 do continue
		} else if t, refers := event_reference(s, x.effect, r.event); refers {
			// "That creature", "that player": what the trigger event was about (CR 608.2c), only while it's the
			// same object (CR 400.7).
			t, ok := t.?
			if !ok do continue
			append(&affected, t)
		} else {
			append(&affected, nil)
		}
		if sub := x.sub_ability; sub != nil && is_instead(sub) && condition_holds_now(r, s, sub.condition.?) {
			continue // replaced by the next instruction ("... instead", CR 608.2c); its targets stay for "it"
		}
		resuming_scope := r.scope_node == x // a scoped instruction already under way: its condition was checked
		if c, has := x.condition.?; has && !resuming_scope && !condition_holds_now(r, s, c) {
			// CR 608.2c: the instruction doesn't happen, nor what depends on it; the next independent instruction
			// still does.
			for r.next != nil && r.next.sub_link != .SequentialSibling do r.next = r.next.sub_ability
			continue
		}
		if x.optional {
			// CR 608.2d: "you may": the controller chooses as the instruction is carried out.
			if answer, answered := r.answer.?; answered && r.asked == x {
				r.answer, r.asked = nil, nil
				r.performed = answer
				if !answer {
					// Declined: what continues it is skipped too, up to an independent instruction or an "if you
					// do / don't" that reads the answer.
					for r.next != nil && r.next.sub_link != .SequentialSibling && !reads_outcome(r.next) do r.next = r.next.sub_ability
					continue
				}
			} else if !optional_possible(g, x, r.controller, r.source) {
				// CR 608.2d: an impossible option can't be chosen; it's as if declined ("if you don't").
				r.performed = false
				for r.next != nil && r.next.sub_link != .SequentialSibling && !reads_outcome(r.next) do r.next = r.next.sub_ability
				continue
			} else {
				r.next, r.asked = x, x // carried out once answered
				s.priority_player = r.controller
				s.waiting_for = types.WaitingFor_OptionalEffectChoice{player = r.controller, source_id = r.source, description = x.description}
				return false
			}
		}
		if scope, scoped := x.player_scope.?; scoped {
			// "Each player ...": the instruction for each player in turn, as that player, resuming after a choice.
			if r.scope_node != x {
				r.scope_node = x
				r.scope = scope_players(s, scope, r.controller)
				r.scope_next = 0
				r.events_mark = len(g.events) // for "this way": what it did for every player
			}
			for r.scope_next < len(r.scope) {
				p := r.scope[r.scope_next]
				r.scope_next += 1
				if do_effect(g, x.effect, x.duration, p, r.source, nil) {
					r.next = x // carried on once the player has chosen
					return false
				}
			}
			r.scope_node = nil
			continue
		}
		if fight, is_fight := x.effect.(types.Effect_Fight); is_fight {
			// After its conditions and "you may" like any instruction (CR 608.2c-d).
			r.events_mark = len(g.events)
			do_fight(g, x, fight, parent_targets)
			continue
		}
		if _, has := x.unless_pay.?; has {
			if r.unless_node != x {
				if ask_unless_payment(g, x, affected[0]) do return false // the payer decides
			} else {
				r.unless_node = nil
				if r.unless_paid {
					r.unless_paid = false
					continue // CR 118.12a: paid, so the instruction isn't carried out
				}
			}
		}
		r.events_mark = len(g.events)
		if division, divided := x.distribution.?; divided {
			// CR 601.2d, 608.2b: each legal target gets the share announced for it.
			for d in division do if slice.contains(affected[:], Maybe(types.TargetRef)(d._0)) {
				do_effect(g, with_share(x.effect, int(d._1)), x.duration, r.controller, r.source, d._0)
			}
			continue
		}
		for t in affected do if do_effect(g, x.effect, x.duration, r.controller, r.source, t) do return false // waiting for a choice
	}
	if r.spell != 0 {
		// CR 608.2n; exiled after flashback (CR 702.34a) or an Adventure that resolved (CR 716.3d).
		if r.fizzled || !adventure_resolved(g, object(&g.state, r.spell)) do spell_leaves_stack(g, r.spell)
	}
	if r.stack_id != 0 {
		delete_key(&g.stack_abilities, r.stack_id)
		delete_key(&g.stack_transforms, r.stack_id)
	}
	r^ = {}
	s.last_effect_amount, s.last_effect_excess_amount = nil, nil // "this way" means this resolution's instructions
	event_object_now = 0
	source_was_now = nil
	return true
}

// ---- "This way" amounts (CR 608.2c) -----------------------------------------------------------------------

// Which instructions produce a number a later one reads as "the life lost this way", "that many", "the excess damage
// dealt this way": life lost or gained, damage dealt (and its excess, CR 120.10), cards drawn or discarded.
amount_producer :: proc(e: types.Effect) -> (total: bool, excess: bool) {
	#partial switch _ in e {
	case types.Effect_LoseLife, types.Effect_GainLife, types.Effect_Draw, types.Effect_Discard, types.Effect_DamageAll, types.Effect_DamageEachPlayer:
		return true, false
	case types.Effect_DealDamage:
		return true, true
	}
	return false, false
}

// After an instruction is carried out: the number it produced, from the events it caused since `mark`.
note_amount :: proc(g: ^Game, e: types.Effect, mark: int) {
	total, excess_too := amount_producer(e)
	if !total do return
	n, excess := 0, 0
	for ev in g.events[mark:] {
		#partial switch _ in e {
		case types.Effect_LoseLife:
			if ev.kind == .Life_Lost do n += ev.amount
		case types.Effect_GainLife:
			if ev.kind == .Life_Gained do n += ev.amount
		case types.Effect_Draw:
			if ev.kind == .Card_Drawn do n += 1
		case types.Effect_Discard:
			if ev.kind == .Zone_Change && ev.from == .Hand do n += 1 // CR 701.9a: from a hand
		case:
			if ev.kind == .Damage {
				n += ev.amount
				excess += ev.excess
			}
		}
	}
	g.state.last_effect_amount = i32(n)
	if excess_too do g.state.last_effect_excess_amount = i32(excess)
}

// ---- "Unless a player pays" (CR 118.12a) -----------------------------------------------------------------

// Asks the target spell's controller whether to pay, if they can (a cost that can't be paid isn't, CR 118.3).
// True while they decide.
ask_unless_payment :: proc(g: ^Game, x: ^types.ResolvedAbility, target: Maybe(types.TargetRef)) -> bool {
	s := &g.state
	u := x.unless_pay.?
	payer: types.PlayerId
	id: types.ObjectId
	if _, yours := u.payer.(types.TargetFilter_Controller); yours {
		// "Sacrifice it unless you pay {1}": the ability's controller.
		payer = x.controller
		id = x.source_id
	} else {
		is_object: bool
		id, is_object = target_object(target)
		if !is_object do return false
		entry, on_stack := stack_entry_of(s, id)
		if !on_stack do return false
		payer = entry.controller // the target spell's or ability's controller
	}
	cost := u.cost.(types.AbilityCost_Mana).cost
	if _, payable := plan_payment(s, payer, cost); !payable do return false
	g.resolution.unless_node = x
	g.resolution.next = x // carried on once they've decided
	s.priority_player = payer
	s.waiting_for = types.WaitingFor_UnlessPayment{player = payer, cost = u.cost, pending_effect = x, effect_description = x.description, affected_object = id}
	return true
}

// The payer's answer: pay the cost (CR 118.12a), or not, and the resolution goes on.
answer_unless_payment :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_UnlessPayment, pay: bool) -> bool {
	r := &g.resolution
	if !r.active || p != w.player || r.unless_node == nil do return false
	if pay {
		cost := w.cost.(types.AbilityCost_Mana).cost
		if !pay_mana(g, p, cost) do return false
	}
	r.unless_paid = pay
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// ---- Scry and surveil (CR 701.22, 701.25) --------------------------------------------------------------------

// The top n cards of a library, top first.
top_cards :: proc(p: ^types.Player, n: int) -> [dynamic]types.ObjectId {
	out := make([dynamic]types.ObjectId)
	count := types.pvec_len(p.library)
	for i in 0 ..< min(n, count) do append(&out, types.pvec_get(p.library, count - 1 - i))
	return out
}

// Asks the player; false when there's nothing to look at.
ask_scry :: proc(g: ^Game, p: types.PlayerId, n: int, surveil: bool) -> bool {
	s := &g.state
	cards := top_cards(player(s, p), n)
	if len(cards) == 0 do return false
	s.priority_player = p
	if surveil do s.waiting_for = types.WaitingFor_SurveilChoice{player = p, cards = cards}
	else do s.waiting_for = types.WaitingFor_ScryChoice{player = p, cards = cards}
	return true
}

// CR 701.22a: the cards kept go back on top in the order chosen (first is the top); the others go to the bottom.
// CR 701.25a: surveil puts the others into the graveyard instead.
answer_scry :: proc(g: ^Game, p: types.PlayerId, looked: []types.ObjectId, keep: []types.ObjectId, surveil: bool) -> bool {
	s := &g.state
	if has_duplicates(keep) do return false
	for id in keep {
		found := false
		for l in looked do if l == id do found = true
		if !found do return false
	}
	pl := player(s, p)
	// Take the looked-at cards off the top.
	rest := make([dynamic]types.ObjectId, context.temp_allocator)
	for id in ids_of(pl.library) {
		seen := false
		for l in looked do if l == id do seen = true
		if !seen do append(&rest, id)
	}
	others := make([dynamic]types.ObjectId, context.temp_allocator)
	for id in looked {
		kept := false
		for k in keep do if k == id do kept = true
		if !kept do append(&others, id)
	}
	pl.library = {}
	if !surveil do for id in others do types.pvec_push(&pl.library, id, copy_id) // the bottom is the front
	for id in rest do types.pvec_push(&pl.library, id, copy_id)
	for i := len(keep) - 1; i >= 0; i -= 1 do types.pvec_push(&pl.library, keep[i], copy_id) // first kept ends on top
	if surveil do for id in others {
		// Back in the library list for the zone move to take it from there.
		types.pvec_push(&pl.library, id, copy_id)
		move_object(g, id, .Graveyard)
	}
	s.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// ---- Discard (CR 701.9) -------------------------------------------------------------------------------------

// CR 701.9b: the discarding player chooses which cards, unless the effect says random. A player with no more cards
// than the count discards their hand; nothing to choose.
start_discard :: proc(g: ^Game, p: types.PlayerId, n: int, random: bool, source: types.ObjectId) -> (asked: bool) {
	s := &g.state
	hand := ids_of(player(s, p).hand)
	if n <= 0 || len(hand) == 0 do return false
	if len(hand) <= n {
		for id in hand do discard_card(g, id)
		return false
	}
	if random {
		for _ in 0 ..< n {
			cards := ids_of(player(s, p).hand)
			discard_card(g, cards[choose_index(g, len(cards))])
		}
		return false
	}
	cards: [dynamic]types.ObjectId
	append(&cards, ..hand)
	s.priority_player = p
	s.waiting_for = types.WaitingFor_DiscardChoice{player = p, count = n, cards = cards, source_id = source}
	return true
}

answer_discard :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_DiscardChoice, chosen: []types.ObjectId) -> bool {
	if len(chosen) != w.count || has_duplicates(chosen) do return false
	for id in chosen {
		found := false
		for c in w.cards do if c == id do found = true
		if !found do return false
	}
	for id in chosen do discard_card(g, id)
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

// ---- Look at the top cards and take some ("dig") ------------------------------------------------------------

// "Look at the top N cards of your library. Put K of them [matching] into your hand and the rest on the bottom of
// your library [or into your graveyard]."
start_dig :: proc(g: ^Game, x: types.Effect_Dig, p: types.PlayerId, controller: types.PlayerId, source: types.ObjectId) -> (asked: bool) {
	s := &g.state
	n := quantity_value(s, x.count, controller, source, 0)
	cards := top_cards(player(s, p), n)
	if len(cards) == 0 do return false
	selectable: [dynamic]types.ObjectId
	for id in cards do if dig_matches(s, x.filter, object(s, id), controller, source) do append(&selectable, id)
	keep, _ := x.keep_count.?
	s.priority_player = p
	s.waiting_for = types.WaitingFor_DigChoice {
		player           = p,
		library_owner    = p,
		cards            = cards,
		keep_count       = int(keep),
		up_to            = x.up_to,
		selectable_cards = selectable,
		kept_destination = x.destination,
		rest_destination = x.rest_destination,
		source_id        = source,
	}
	return true
}

dig_matches :: proc(s: ^types.GameState, f: types.TargetFilter, o: ^types.GameObject, controller: types.PlayerId, source: types.ObjectId) -> bool {
	#partial switch x in f {
	case types.TargetFilter_Any:
		return true
	case types.TargetFilter_Typed:
		plain := x._0
		plain.controller = nil
		return object_matches(s, o, plain, controller, source)
	case types.TargetFilter_Or:
		for y in x.filters do if dig_matches(s, y, o, controller, source) do return true
	}
	return false
}

answer_dig :: proc(g: ^Game, p: types.PlayerId, w: types.WaitingFor_DigChoice, kept: []types.ObjectId) -> bool {
	s := &g.state
	if has_duplicates(kept) || len(kept) > w.keep_count do return false
	// "Up to" may take fewer; otherwise as many as there are to take (CR 107.1c doesn't force the impossible).
	if !w.up_to && len(kept) < min(w.keep_count, len(w.selectable_cards)) do return false
	for id in kept {
		found := false
		for c in w.selectable_cards do if c == id do found = true
		if !found do return false
	}
	pl := player(s, p)
	kept_to, _ := w.kept_destination.?
	rest_to := w.rest_destination.? or_else .Library
	for id in kept do move_object(g, id, kept_to)
	rest := make([dynamic]types.ObjectId, context.temp_allocator)
	for id in w.cards {
		taken := false
		for k in kept do if k == id do taken = true
		if !taken do append(&rest, id)
	}
	if rest_to == .Library {
		// The rest go to the bottom (the front of the list), in the order they were.
		others := make([dynamic]types.ObjectId, context.temp_allocator)
		for id in ids_of(pl.library) {
			looked := false
			for r in rest do if r == id do looked = true
			if !looked do append(&others, id)
		}
		pl.library = {}
		for id in rest do types.pvec_push(&pl.library, id, copy_id)
		for id in others do types.pvec_push(&pl.library, id, copy_id)
	} else {
		for id in rest do move_object(g, id, rest_to)
	}
	s.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

choose_index :: proc(g: ^Game, n: int) -> int {
	return rng.choose_index(&g.rng, n)
}

// "If you do" / "if you don't" (CR 608.2c) read the latest "you may" answer; other conditions the game.
@(private = "file")
condition_holds_now :: proc(r: ^Resolution, s: ^types.GameState, c: types.AbilityCondition) -> bool {
	if want, is_outcome := outcome_wanted(c); is_outcome do return r.performed == want
	// Conditions made of others, any of which may read this resolution ("if you do", "this way").
	#partial switch x in c {
	case types.AbilityCondition_And:
		for y in x.conditions do if !condition_holds_now(r, s, y) do return false
		return true
	case types.AbilityCondition_Or:
		for y in x.conditions do if condition_holds_now(r, s, y) do return true
		return false
	case types.AbilityCondition_Not:
		return !condition_holds_now(r, s, x.condition^)
	case types.AbilityCondition_ConditionInstead:
		return condition_holds_now(r, s, x.inner^)
	}
	if x, this_way := c.(types.AbilityCondition_ZoneChangedThisWay); this_way {
		// "If a creature card was exiled this way": what the instruction before moved, as it is now.
		typed := x.filter.(types.TargetFilter_Typed)._0
		for id in r.moved {
			o := object(s, id)
			if o == nil do continue
			if dest, has := x.destination.?; has && o.zone != dest do continue
			if object_matches(s, o, typed, r.controller, r.source) do return true
		}
		return false
	}
	return ability_condition_holds(s, c, r.controller, r.source, r.last_targets[:])
}

// Whether a condition is "if you do" (true) or "if you don't" (false), and whether it's either.
outcome_wanted :: proc(c: types.AbilityCondition) -> (want: bool, is_outcome: bool) {
	#partial switch x in c {
	case types.AbilityCondition_EffectOutcome:
		_, performed := x.signal.(types.EffectOutcomeSignal_OptionalEffectPerformed)
		return true, performed
	case types.AbilityCondition_Not:
		if x.condition == nil do return false, false
		inner, ok := outcome_wanted(x.condition^)
		return !inner, ok
	}
	return false, false
}

@(private = "file")
reads_outcome :: proc(n: ^types.ResolvedAbility) -> bool {
	c, has := n.condition.?
	if !has do return false
	_, is_outcome := outcome_wanted(c)
	return is_outcome
}

// The controller's answer to a "you may" instruction during resolution.
answer_optional :: proc(g: ^Game, p: types.PlayerId, accept: bool) -> bool {
	r := &g.resolution
	if !r.active || r.asked == nil || p != r.controller do return false
	r.answer = accept
	g.state.waiting_for = nil
	if continue_resolution(g) do after_resolution(g)
	return true
}

is_instead :: proc(n: ^types.ResolvedAbility) -> bool {
	c, has := n.condition.?
	if !has do return false
	#partial switch _ in c {
	case types.AbilityCondition_AdditionalCostPaidInstead, types.AbilityCondition_ConditionInstead:
		return true
	}
	return false
}

// "This permanent" in an ability: its source, only while it's still the object it was when the ability went on the
// stack (CR 400.7: a permanent that changed zones is a new object, even if it came back).
same_source :: proc(g: ^Game, source: types.ObjectId) -> ^types.GameObject {
	o := object(&g.state, source)
	if o == nil do return nil
	if inc, has := g.resolution.source_incarnation.?; g.resolution.active && has && o.incarnation != inc do return nil
	return o
}

// Whether a "you may" instruction could be carried out (CR 608.2d): something to discard, something to sacrifice.
optional_possible :: proc(g: ^Game, x: ^types.ResolvedAbility, controller: types.PlayerId, source: types.ObjectId) -> bool {
	s := &g.state
	#partial switch e in x.effect {
	case types.Effect_Discard:
		return types.pvec_len(player(s, controller).hand) > 0
	case types.Effect_Sacrifice:
		if is_self(e.target) {
			o := same_source(g, source)
			return o != nil && o.zone == .Battlefield && o.controller == controller
		}
		typed, ok := e.target.(types.TargetFilter_Typed)
		if !ok do return false
		for o in permanents_of(s, controller) do if object_matches(s, o, typed._0, controller, source) do return true
		return false
	case types.Effect_PayCost:
		return cost_payable_now(g, e, controller, source)
	}
	return true
}

// "You may pay {2}", "you may pay 3 life" (CR 118.3: a cost can be paid only if the player can pay all of it;
// CR 119.4: life only up to their total). Mana from the player's mana sources, chosen as automatic payment does.
pay_cost_supported :: proc(x: types.Effect_PayCost) -> bool {
	if x.scale != nil || !is_controller(x.payer) do return false
	#partial switch c in x.cost {
	case types.AbilityCost_Mana:
		_, plain := c.cost.(types.ManaCost_Cost)
		return plain && !has_x(c.cost)
	case types.AbilityCost_PayLife:
		_, fixed := fixed_quantity(c.amount)
		return fixed
	}
	return false
}

cost_payable_now :: proc(g: ^Game, x: types.Effect_PayCost, controller: types.PlayerId, source: types.ObjectId) -> bool {
	s := &g.state
	#partial switch c in x.cost {
	case types.AbilityCost_Mana:
		_, ok := plan_payment(s, controller, c.cost, 0, nil, Payment{object(s, source), false})
		return ok
	case types.AbilityCost_PayLife:
		n, _ := fixed_quantity(c.amount)
		return int(player(s, controller).life) >= n
	}
	return false
}

do_pay_cost :: proc(g: ^Game, x: types.Effect_PayCost, controller: types.PlayerId, source: types.ObjectId) {
	s := &g.state
	#partial switch c in x.cost {
	case types.AbilityCost_Mana:
		pay_mana(g, controller, c.cost, 0, nil, Payment{object(s, source), false})
	case types.AbilityCost_PayLife:
		n, _ := fixed_quantity(c.amount)
		lose_life(s, controller, n) // CR 119.4
	}
}

// Creates the reflexive triggered ability "when you do, ..." (CR 603.12) from the source's own definition of it: it
// waits with the other triggered abilities and goes on the stack, its targets chosen then, the next time a player
// would receive priority (CR 603.3).
@(private = "file")
reflexive_trigger :: proc(g: ^Game, x: ^types.ResolvedAbility) {
	r := &g.resolution
	o := object(&g.state, r.source)
	if o == nil do return
	found: ^types.AbilityDefinition
	look :: proc(a: ^types.AbilityDefinition, x: ^types.ResolvedAbility, found: ^^types.AbilityDefinition) {
		for y := a; y != nil && found^ == nil; y = y.sub_ability {
			if y.effect != nil && is_reflexive(y) && reflect.union_variant_typeid(y.effect^) == reflect.union_variant_typeid(x.effect) do found^ = y
		}
	}
	if o.abilities != nil do for &a in o.abilities^ do look(&a, x, &found)
	for &entry in trigger_definitions(o) do if entry.definition.execute != nil do look(entry.definition.execute, x, &found)
	if found == nil do return
	execute := new(types.AbilityDefinition)
	execute^ = found^
	execute.condition = nil
	t := new(types.TriggerDefinition)
	t.execute = execute
	add_trigger(g, r.source, r.controller, t)
}

// The objects the instruction just carried out moved from one zone to another (its zone-change events).
note_moved :: proc(g: ^Game, events_before: int) {
	r := &g.resolution
	clear(&r.moved)
	r.did_something = false
	for e in g.events[events_before:] {
		if e.kind == .Zone_Change && e.from != e.to do append(&r.moved, e.object)
		if e.kind == .Zone_Change || e.kind == .Counter_Added || e.kind == .Sacrificed do r.did_something = true
	}
}

// CR 701.14a-b: each creature deals damage equal to its power to the other, at once and not as combat damage
// (701.14d); with either gone, no longer a creature, or an illegal target, neither does.
do_fight :: proc(g: ^Game, x: ^types.ResolvedAbility, fight: types.Effect_Fight, parent_targets: []types.TargetRef) {
	s := &g.state
	r := &g.resolution
	a, b: ^types.GameObject
	legal :: proc(s: ^types.GameState, x: ^types.ResolvedAbility, i: int) -> ^types.GameObject {
		if i >= len(x.targets) || slice.contains(x.illegal_target_slots[:], i) do return nil
		id, ok := target_object(x.targets[i])
		if !ok do return nil
		return object(s, id)
	}
	if is_self(fight.subject) {
		a = same_source(g, r.source)
		b = legal(s, x, 0)
	} else if !fight_subject_targeted(fight) {
		// "It fights target creature": the earlier instruction's target (CR 608.2c).
		for t in parent_targets do if id, ok := target_object(t); ok {
			a = object(s, id)
			break
		}
		b = legal(s, x, 0)
	} else {
		a = legal(s, x, 0)
		b = legal(s, x, 1)
	}
	if a == nil || b == nil do return
	if a.zone != .Battlefield || b.zone != .Battlefield || !is_type(a, .Creature) || !is_type(b, .Creature) do return
	pa, pb := power_of(a), power_of(b)
	deal_damage(g, a.id, types.TargetRef_Object{b.id}, pa)
	deal_damage(g, b.id, types.TargetRef_Object{a.id}, pb)
}
