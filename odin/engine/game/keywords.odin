// Keyword abilities the card data lists only by name, carried out as the abilities they stand for.
package game

import "core:sync"
import types "../types"

// CR 702.108a: Prowess, "Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn."
@(private = "file")
prowess_pump: types.Effect
@(private = "file")
prowess_ability: types.AbilityDefinition
@(private = "file")
prowess_definition: types.TriggerDefinition
@(private = "file")
prowess_once: sync.Once

// The ability, set up once (static: nothing allocated, so it outlives any game).
@(private = "file")
prowess_trigger :: proc() -> ^types.TriggerDefinition {
	sync.once_do(&prowess_once, proc() {
		prowess_pump = types.Effect_Pump{power = types.PtValue_Fixed{1}, toughness = types.PtValue_Fixed{1}, target = types.TargetFilter_SelfRef{}}
		prowess_ability.kind = .Spell
		prowess_ability.effect = &prowess_pump
		prowess_ability.duration = types.Duration_UntilEndOfTurn{}
		prowess_ability.description = "Prowess"
		prowess_definition.mode = types.TriggerMode_SpellCast{}
		prowess_definition.execute = &prowess_ability
		prowess_definition.description = "Prowess"
	})
	return &prowess_definition
}

// The prowess triggers of a spell being cast: each instance on each creature its caster controls (CR 702.108b).
prowess_triggers :: proc(g: ^Game, spell: ^types.GameObject, caster: types.PlayerId) {
	if is_type(spell, .Creature) do return
	for o in permanents_of(&g.state, caster) {
		for k in o.keywords do if _, prowess := k.(types.Keyword_Prowess); prowess {
			add_trigger(g, o.id, o.controller, prowess_trigger())
		}
	}
}
