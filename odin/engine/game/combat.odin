// Combat (CR 506-511) and state-based actions (CR 704).
package game

import types "../types"

power_of :: proc(o: ^types.GameObject) -> int {return int(o.power.? or_else 0)}
toughness_of :: proc(o: ^types.GameObject) -> int {return int(o.toughness.? or_else 0)}

// CR 508.1a, 702.3b: an untapped creature its controller has controlled since the turn began (or with haste), and
// without defender.
can_attack :: proc(s: ^types.GameState, o: ^types.GameObject) -> bool {
	if !is_type(o, .Creature) || o.tapped || o.controller != s.active_player do return false
	if has_keyword(o, types.Keyword_Defender) do return false
	return !o.summoning_sick || has_keyword(o, types.Keyword_Haste)
}

// CR 509.1a, 702.9b: an untapped creature can block an attacker; a flying attacker only by flying or reach.
can_block :: proc(blocker, attacker: ^types.GameObject) -> bool {
	if !is_type(blocker, .Creature) || blocker.tapped do return false
	if has_keyword(attacker, types.Keyword_Flying) && !has_keyword(blocker, types.Keyword_Flying) && !has_keyword(blocker, types.Keyword_Reach) do return false
	return true
}

ask_attackers :: proc(g: ^Game) -> bool {
	s := &g.state
	valid: [dynamic]types.ObjectId
	for o in permanents_of(s, s.active_player) do if can_attack(s, o) do append(&valid, o.id)
	if len(valid) == 0 do return false
	targets: [dynamic]types.AttackTarget
	append(&targets, types.AttackTarget_Player{opponent(s, s.active_player)})
	s.waiting_for = types.WaitingFor_DeclareAttackers{player = s.active_player, valid_attacker_ids = valid, valid_attack_targets = targets}
	return true
}

// CR 508.1: the declared creatures attack the defending player and become tapped (CR 508.1f) unless they have
// vigilance (CR 702.20b). Then the active player gets priority (CR 508.2).
declare_attackers :: proc(g: ^Game, attacks: []types.Tuple2(types.ObjectId, types.AttackTarget)) -> bool {
	s := &g.state
	defender := opponent(s, s.active_player)
	seen := make(map[types.ObjectId]bool, context.temp_allocator)
	for a in attacks {
		o := object(s, a._0)
		if o == nil || o.zone != .Battlefield || !can_attack(s, o) || seen[a._0] do return false
		t, to_player := a._1.(types.AttackTarget_Player)
		if !to_player || t._0 != defender do return false
		seen[a._0] = true
	}
	combat := types.CombatState{}
	for a in attacks {
		o := object(s, a._0)
		if !has_keyword(o, types.Keyword_Vigilance) do o.tapped = true
		append(&combat.attackers, types.AttackerInfo{object_id = a._0, defending_player = defender, attack_target = a._1})
		append(&g.events, Event{kind = .Attack, object = a._0, controller = o.controller}) // CR 508.3a
	}
	s.combat = combat
	// CR 508.2: the active player gets priority, attackers or not (508.8 skips the later combat steps).
	give_priority(g, s.active_player)
	return true
}

ask_blockers :: proc(g: ^Game) -> bool {
	s := &g.state
	combat, ok := &s.combat.?
	if !ok || len(combat.attackers) == 0 do return false
	defender := opponent(s, s.active_player)
	valid: [dynamic]types.ObjectId
	targets: map[types.ObjectId][dynamic]types.ObjectId
	for o in permanents_of(s, defender) {
		blockable: [dynamic]types.ObjectId
		for a in combat.attackers do if can_block(o, object(s, a.object_id)) do append(&blockable, a.object_id)
		if len(blockable) > 0 {
			append(&valid, o.id)
			targets[o.id] = blockable
		}
	}
	if len(valid) == 0 do return false
	s.waiting_for = types.WaitingFor_DeclareBlockers{player = defender, valid_blocker_ids = valid, valid_block_targets = targets}
	return true
}

// CR 509.1: each blocker blocks one attacker it can block; an attacker with menace needs two or more (702.111b).
declare_blockers :: proc(g: ^Game, assignments: []types.Tuple2(types.ObjectId, types.ObjectId)) -> bool {
	s := &g.state
	combat, ok := &s.combat.?
	if !ok do return false
	defender := opponent(s, s.active_player)
	used := make(map[types.ObjectId]bool, context.temp_allocator)
	count := make(map[types.ObjectId]int, context.temp_allocator)
	for a in assignments {
		blocker, attacker := object(s, a._0), object(s, a._1)
		if blocker == nil || attacker == nil || blocker.zone != .Battlefield || blocker.controller != defender || used[a._0] do return false
		if !is_attacking(combat, a._1) || !can_block(blocker, attacker) do return false
		used[a._0] = true
		count[a._1] += 1
	}
	for attacker, n in count do if n == 1 && has_keyword(object(s, attacker), types.Keyword_Menace) do return false
	for a in assignments {
		list := combat.blocker_assignments[a._1]
		append(&list, a._0)
		combat.blocker_assignments[a._1] = list
		back := combat.blocker_to_attacker[a._0]
		append(&back, a._1)
		combat.blocker_to_attacker[a._0] = back
	}
	for &info in combat.attackers do if count[info.object_id] > 0 do info.blocked = true
	append(&combat.blockers_declared_by, defender)
	give_priority(g, s.active_player)
	return true
}

is_attacking :: proc(c: ^types.CombatState, id: types.ObjectId) -> bool {
	for a in c.attackers do if a.object_id == id do return true
	return false
}

// CR 510: combat damage. With first or double strike in the fight, those creatures deal damage first (CR 702.7b)
// and state-based actions are checked before the others deal theirs. When an attacker's controller divides its
// damage (CR 510.1c: two or more blockers; 702.19b: trample), they're asked first; returns false while waiting.
combat_damage :: proc(g: ^Game) -> bool {
	s := &g.state
	progress := &g.damage_progress
	combat, ok := &s.combat.?
	if !ok do return true
	if !progress.started {
		apply_continuous_effects(g)
		progress.started = true
		for a in combat.attackers {
			if strikes_first(object(s, a.object_id)) do progress.any_first = true
			for b in combat.blocker_assignments[a.object_id] do if strikes_first(object(s, b)) do progress.any_first = true
		}
	}
	pass: Damage_Pass = .Only
	if progress.any_first do pass = .Regular if progress.first_done else .First
	for a in combat.attackers {
		if _, chosen := progress.choices[a.object_id]; chosen || !needs_damage_choice(s, combat, a, pass) do continue
		ask_damage_assignment(g, combat, a)
		return false
	}
	damage_pass(g, combat, pass)
	clear(&progress.choices)
	if pass == .First {
		progress.first_done = true
		check_state_based_actions(g)
		if game_over(s) {
			progress^ = {}
			return true
		}
		return combat_damage(g)
	}
	progress^ = {}
	return true
}

// How an attacker's controller divided its damage: to each blocker, and (trample) to the player.
Damage_Choice :: struct {
	to_blockers: [dynamic]types.Tuple2(types.ObjectId, u32),
	to_player:   u32,
}

Combat_Damage_Progress :: struct {
	started, any_first, first_done: bool,
	choices:                        map[types.ObjectId]Damage_Choice,
}

alive_blockers :: proc(s: ^types.GameState, combat: ^types.CombatState, attacker: types.ObjectId) -> [dynamic]^types.GameObject {
	out := make([dynamic]^types.GameObject, context.temp_allocator)
	for b in combat.blocker_assignments[attacker] do if o := object(s, b); o.zone == .Battlefield do append(&out, o)
	return out
}

@(private = "file")
needs_damage_choice :: proc(s: ^types.GameState, combat: ^types.CombatState, a: types.AttackerInfo, pass: Damage_Pass) -> bool {
	attacker := object(s, a.object_id)
	if !a.blocked || !deals_damage_in(attacker, pass) || power_of(attacker) <= 0 do return false
	n := len(alive_blockers(s, combat, a.object_id))
	return n >= 2 || (n == 1 && has_keyword(attacker, types.Keyword_Trample))
}

// The damage that counts as lethal to a blocker (CR 702.19b: damage already marked counts; 702.2c: any damage from
// a deathtouch source).
lethal_damage :: proc(attacker, blocker: ^types.GameObject) -> u32 {
	lethal := max(toughness_of(blocker) - int(blocker.damage_marked), 0)
	if has_keyword(attacker, types.Keyword_Deathtouch) do lethal = min(lethal, 1)
	return u32(lethal)
}

@(private = "file")
ask_damage_assignment :: proc(g: ^Game, combat: ^types.CombatState, a: types.AttackerInfo) {
	s := &g.state
	attacker := object(s, a.object_id)
	slots: [dynamic]types.DamageSlot
	for b in alive_blockers(s, combat, a.object_id) do append(&slots, types.DamageSlot{blocker_id = b.id, lethal_minimum = lethal_damage(attacker, b)})
	modes: [dynamic]types.CombatDamageAssignmentMode
	append(&modes, types.CombatDamageAssignmentMode.Normal)
	trample: Maybe(types.TrampleKind)
	if has_keyword(attacker, types.Keyword_Trample) do trample = .Standard
	s.priority_player = attacker.controller
	s.waiting_for = types.WaitingFor_AssignCombatDamage {
		player           = attacker.controller,
		attacker_id      = a.object_id,
		total_damage     = u32(power_of(attacker)),
		blockers         = slots,
		assignment_modes = modes,
		trample          = trample,
		defending_player = a.defending_player,
		attack_target    = a.attack_target,
	}
}

// The attacker's controller's division (CR 510.1c): all of its damage, among its blockers; with trample, to the
// player only once every blocker has lethal damage (CR 702.19b).
assign_combat_damage :: proc(g: ^Game, p: types.PlayerId, a: types.GameAction_AssignCombatDamage) -> bool {
	s := &g.state
	w := s.waiting_for.(types.WaitingFor_AssignCombatDamage)
	if a.mode != .Normal || a.controller_damage != 0 do return false
	total := a.trample_damage
	given := make(map[types.ObjectId]u32, context.temp_allocator)
	for x in a.assignments {
		found := false
		for slot in w.blockers do if slot.blocker_id == x._0 do found = true
		if !found || x._0 in given do return false
		given[x._0] = x._1
		total += x._1
	}
	if total != w.total_damage do return false
	if a.trample_damage > 0 {
		if w.trample == nil do return false
		for slot in w.blockers do if given[slot.blocker_id] < slot.lethal_minimum do return false
	}
	choice := Damage_Choice{to_player = a.trample_damage}
	for x in a.assignments do append(&choice.to_blockers, x)
	g.damage_progress.choices[w.attacker_id] = choice
	s.waiting_for = nil
	if combat_damage(g) {
		append(&g.events, Event{kind = .Step_Begin, step = .CombatDamage})
		give_priority(g, s.active_player)
	}
	return true
}

Damage_Pass :: enum {
	Only, // no first strike: everyone deals damage once
	First, // CR 702.7b: creatures with first or double strike
	Regular, // after a first-strike pass: creatures without first strike, and double strikers again (CR 702.4b)
}

strikes_first :: proc(o: ^types.GameObject) -> bool {
	return o != nil && (has_keyword(o, types.Keyword_FirstStrike) || has_keyword(o, types.Keyword_DoubleStrike))
}

deals_damage_in :: proc(o: ^types.GameObject, pass: Damage_Pass) -> bool {
	if o == nil || o.zone != .Battlefield do return false
	switch pass {
	case .Only:
		return true
	case .First:
		return strikes_first(o)
	case .Regular:
		return !strikes_first(o) || has_keyword(o, types.Keyword_DoubleStrike)
	}
	return false
}

// CR 510.1, 510.2: all combat damage of a pass is dealt at once, so it's worked out first and then dealt.
damage_pass :: proc(g: ^Game, combat: ^types.CombatState, pass: Damage_Pass) {
	s := &g.state
	Hit :: struct {
		source: types.ObjectId,
		target: types.TargetRef,
		n:      int,
	}
	hits := make([dynamic]Hit, context.temp_allocator)
	for a in combat.attackers {
		attacker := object(s, a.object_id)
		if !deals_damage_in(attacker, pass) do continue
		n := power_of(attacker)
		if n <= 0 do continue
		if !a.blocked {
			hits_target, _ := a.attack_target.(types.AttackTarget_Player)
			append(&hits, Hit{a.object_id, types.TargetRef_Player{hits_target._0}, n})
			continue
		}
		// CR 510.1c: the division its controller chose, when there was one to make.
		if choice, chosen := g.damage_progress.choices[a.object_id]; chosen {
			for x in choice.to_blockers do if x._1 > 0 do append(&hits, Hit{a.object_id, types.TargetRef_Object{x._0}, int(x._1)})
			if choice.to_player > 0 do append(&hits, Hit{a.object_id, types.TargetRef_Player{a.defending_player}, int(choice.to_player)})
			continue
		}
		alive := alive_blockers(s, combat, a.object_id)
		if len(alive) == 0 {
			if has_keyword(attacker, types.Keyword_Trample) {
				append(&hits, Hit{a.object_id, types.TargetRef_Player{a.defending_player}, n})
			}
			continue // CR 510.1c: a blocked creature with no blockers left deals no damage
		}
		// CR 510.1c: exactly one blocker takes it all (no choice to make).
		append(&hits, Hit{a.object_id, types.TargetRef_Object{alive[0].id}, n})
	}
	// CR 510.1d: each blocker deals its damage to the attacker it blocks.
	for blocker_id, attackers in combat.blocker_to_attacker {
		blocker := object(s, blocker_id)
		if !deals_damage_in(blocker, pass) || len(attackers) == 0 || object(s, attackers[0]).zone != .Battlefield do continue
		if n := power_of(blocker); n > 0 do append(&hits, Hit{blocker_id, types.TargetRef_Object{attackers[0]}, n})
	}
	for h in hits do deal_damage(g, h.source, h.target, h.n)
}

// CR 704.3: state-based actions are performed all at once, and repeated until none apply.
check_state_based_actions :: proc(g: ^Game) {
	s := &g.state
	apply_continuous_effects(g)
	for {
		changed := false
		for id in ids_of(s.battlefield) {
			o := object(s, id)
			if !is_type(o, .Creature) do continue
			t := toughness_of(o)
			if t <= 0 {
				move_object(g, id, .Graveyard) // CR 704.5f
				changed = true
			} else if int(o.damage_marked) >= t || o.dealt_deathtouch_damage {
				// CR 704.5g, 704.5h: lethal damage, or any damage from a source with deathtouch.
				if has_keyword(o, types.Keyword_Indestructible) {
					o.dealt_deathtouch_damage = false
				} else {
					move_object(g, id, .Graveyard)
					changed = true
				}
			}
		}
		for id in ids_of(s.battlefield) {
			// CR 704.5i: a planeswalker with no loyalty goes to its owner's graveyard.
			o := object(s, id)
			if is_type(o, .Planeswalker) && (o.loyalty.? or_else 0) == 0 {
				move_object(g, id, .Graveyard)
				changed = true
			}
		}
		if remove_departed_tokens(g) do changed = true
		if !changed do break
		apply_continuous_effects(g) // a permanent that left takes its effects with it
	}
	// CR 704.5a-c: a player with no life, who drew from an empty library, or with ten poison counters loses.
	losers := make([dynamic]types.PlayerId, context.temp_allocator)
	for &p in s.players {
		if p.is_eliminated do continue
		if p.life <= 0 || p.drew_from_empty_library || p.poison_counters >= 10 {
			p.is_eliminated = true
			append(&losers, p.id)
		}
	}
	if len(losers) > 0 {
		remaining := make([dynamic]types.PlayerId, context.temp_allocator)
		for p in s.players do if !p.is_eliminated do append(&remaining, p.id)
		// CR 104.2a: the last player in the game wins; if everyone lost at once, it's a draw (CR 104.4a).
		winner: Maybe(types.PlayerId)
		if len(remaining) == 1 do winner = remaining[0]
		s.waiting_for = types.WaitingFor_GameOver{winner = winner}
	}
}
