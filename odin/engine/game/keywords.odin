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

// CR 701.16a: "Investigate" means "Create a Clue token" (CR 111.10f), the token the card data writes out for "create a
// Clue token".
@(private = "file")
clue_token: types.Effect_Token
@(private = "file")
clue_once: sync.Once

investigate_token :: proc() -> types.Effect {
	sync.once_do(&clue_once, proc() {
		clue_token.name = "Clue"
		clue_token.power = types.PtValue_Fixed{0}
		clue_token.toughness = types.PtValue_Fixed{0}
		append(&clue_token.types, "Artifact", "Clue")
		clue_token.count = types.QuantityExpr_Fixed{value = 1}
		clue_token.owner = types.TargetFilter_Controller{}
	})
	return clue_token
}

// CR 702.147a: Decayed, "This creature can't block" (combat.odin's can_block) and "When this creature attacks,
// sacrifice it at end of combat": the triggered ability as the card data writes it out for "when ~ attacks,
// sacrifice it at end of combat" (a delayed trigger, CR 603.7).
@(private = "file")
decayed_sacrifice: types.Effect
@(private = "file")
decayed_sacrifice_ability: types.AbilityDefinition
@(private = "file")
decayed_delayed: types.Effect
@(private = "file")
decayed_ability: types.AbilityDefinition
@(private = "file")
decayed_definition: types.TriggerDefinition
@(private = "file")
decayed_once: sync.Once

@(private = "file")
decayed_trigger :: proc() -> ^types.TriggerDefinition {
	sync.once_do(&decayed_once, proc() {
		decayed_sacrifice = types.Effect_Sacrifice{target = types.TargetFilter_SelfRef{}, count = types.QuantityExpr_Fixed{value = 1}}
		decayed_sacrifice_ability.kind = .Spell
		decayed_sacrifice_ability.effect = &decayed_sacrifice
		decayed_delayed = types.Effect_CreateDelayedTrigger{condition = types.DelayedTriggerCondition_AtNextPhase{phase = .EndCombat}, effect = &decayed_sacrifice_ability}
		decayed_ability.kind = .Spell
		decayed_ability.effect = &decayed_delayed
		decayed_ability.description = "Decayed"
		decayed_definition.mode = types.TriggerMode_Attacks{}
		decayed_definition.valid_card = types.TargetFilter_SelfRef{}
		decayed_definition.execute = &decayed_ability
		decayed_definition.description = "Decayed"
	})
	return &decayed_definition
}

// The decayed trigger of a creature that attacks (CR 702.147a): each instance triggers; the first sacrifice is the
// only one that does anything (the others find a new object, CR 400.7).
decayed_triggers :: proc(g: ^Game, attacker: ^types.GameObject) {
	for k in attacker.keywords do if _, decayed := k.(types.Keyword_Decayed); decayed {
		add_trigger(g, attacker.id, attacker.controller, decayed_trigger())
	}
}
