// Continuous effects and the layer system (CR 611, 613). Each permanent's power, toughness and keywords are worked
// out again from its printed values every time the game looks at them: the static abilities of permanents on the
// battlefield (CR 611.3) and the effects of resolved spells and abilities (CR 611.2) apply in layer order, and
// within a layer in timestamp order (CR 613.7). Nothing is edited in place, so an effect that ends simply stops
// applying.
package game

import "core:reflect"
import "core:slice"
import types "../types"

// ---- What's supported --------------------------------------------------------------------------------------

// "[Permanents of a kind] get +N/+N, have [keyword], are N/N": static abilities that always apply, to this object
// or to permanents of a kind, with fixed numbers.
static_supported :: proc(st: types.StaticDefinition) -> bool {
	if _, continuous := st.mode.(types.StaticMode_Continuous); !continuous do return false
	if st.per_player_condition != nil do return false
	if c, has := st.condition.?; has && !condition_supported(c) do return false
	if st.characteristic_defining {
		// CR 604.3: a characteristic-defining ability sets power/toughness or color on the object itself.
		for m in st.modifications {
			#partial switch _ in m {
			case types.ContinuousModification_SetDynamicPower, types.ContinuousModification_SetDynamicToughness,
			     types.ContinuousModification_SetColor, types.ContinuousModification_SetPower, types.ContinuousModification_SetToughness,
			     types.ContinuousModification_AddAllCreatureTypes: // "is every creature type", in every zone (has_subtype)
			case:
				return false
			}
		}
	}
	if st.affected_zone != nil || st.effect_zone != nil || len(st.active_zones) > 0 do return false
	affected, has := st.affected.?
	if !has && !st.characteristic_defining do return false
	if has && !affected_supported(affected) do return false
	if len(st.modifications) == 0 do return false
	for m in st.modifications do if !modification_supported(m) do return false
	return true
}

// The changes a continuous effect can make here: types and subtypes added (layer 4), keywords added (layer 6),
// power and toughness set or changed (layer 7b, 7c).
modification_supported :: proc(m: types.ContinuousModification) -> bool {
	#partial switch k in m {
	case types.ContinuousModification_AddDynamicPower:
		return quantity_supported(k.value)
	case types.ContinuousModification_AddDynamicToughness:
		return quantity_supported(k.value)
	case types.ContinuousModification_SetDynamicPower:
		return quantity_supported(k.value)
	case types.ContinuousModification_SetDynamicToughness:
		return quantity_supported(k.value)
	case types.ContinuousModification_SetColor:
		return true
	case types.ContinuousModification_RemoveAllSubtypes:
		return k.set == .Creature || k.set == .Land
	case types.ContinuousModification_AddPower, types.ContinuousModification_AddToughness,
	     types.ContinuousModification_SetPower, types.ContinuousModification_SetToughness,
	     types.ContinuousModification_AddType, types.ContinuousModification_AddSubtype:
		return true
	case types.ContinuousModification_AddChosenSubtype:
		return k.kind == .CreatureType
	case types.ContinuousModification_AddAllCreatureTypes:
		return true
	case types.ContinuousModification_GrantAbility:
		// An activated ability (a mana ability included) the permanent then has, its "this" being that permanent.
		if k.definition == nil do return false
		if _, _, mana := tap_mana_ability(k.definition^); mana do return true
		return activated_supported(k.definition^)
	case types.ContinuousModification_GrantTrigger:
		return k.trigger != nil && trigger_supported(k.trigger^)
	case types.ContinuousModification_AddKeyword:
		return keyword_grantable(k.keyword)
	case types.ContinuousModification_AddStaticMode:
		modes := rule_modes(k.mode)
		return modes != {} && modes & PLAYER_MODES == {} && .Flash not_in modes
	}
	return false
}

// A keyword an effect can give: one this engine carries out on an object that has it. Riot works through the
// replacement the card's own data spells out (CR 702.136a), which a permanent given riot doesn't get yet.
keyword_grantable :: proc(k: types.Keyword) -> bool {
	if _, riot := k.(types.Keyword_Riot); riot do return false
	return keyword_supported(k)
}

// This object, or permanents of a kind and controller (optionally "other").
affected_supported :: proc(f: types.TargetFilter) -> bool {
	#partial switch x in f {
	case types.TargetFilter_SelfRef:
		return true
	case types.TargetFilter_Typed:
		return typed_supported(x._0)
	}
	return false
}

// ---- Applying (CR 613) --------------------------------------------------------------------------------------

@(private = "file")
Static_Effect :: struct {
	source:    ^types.GameObject,
	static:    ^types.StaticDefinition,
	timestamp: u64,
}

// Works out every permanent's power, toughness and keywords.
apply_continuous_effects :: proc(g: ^Game) {
	s := &g.state
	battlefield := ids_of(s.battlefield)
	// The static abilities in effect, in timestamp order (CR 613.7a: a static ability's effect has its object's).
	statics := make([dynamic]Static_Effect, context.temp_allocator)
	for id in battlefield {
		o := object(s, id)
		if o.static_definitions == nil do continue
		for &st in o.static_definitions^ do if static_supported(st) do append(&statics, Static_Effect{o, &st, o.timestamp})
	}
	slice.sort_by(statics[:], proc(a, b: Static_Effect) -> bool {return a.timestamp < b.timestamp})

	for id in battlefield {
		o := object(s, id)
		power, toughness := o.base_power, o.base_toughness
		// Layer 4 (CR 613.1d): types and subtypes added.
		// Built in scratch memory, and copied for keeps only when an effect changed it (this runs after every action).
		card_types := o.base_card_types
		card_types.core_types = slice.clone_to_dynamic(o.base_card_types.core_types[:], context.temp_allocator)
		card_types.subtypes = slice.clone_to_dynamic(o.base_card_types.subtypes[:], context.temp_allocator)
		types_changed := false
		add_types :: proc(ct: ^types.CardType, mods: []types.ContinuousModification, changed: ^bool, source: ^types.GameObject) {
			for m in mods {
				#partial switch k in m {
				case types.ContinuousModification_AddAllCreatureTypes:
					// "Is every creature type" (CR 205.3m, the list of creature types; the static form of changeling,
					// CR 702.73a).
					for name in CREATURE_TYPES do if !slice.contains(ct.subtypes[:], name) {
						append(&ct.subtypes, name)
						changed^ = true
					}
				case types.ContinuousModification_AddChosenSubtype:
					// "It's the chosen type in addition to its other types" (CR 614.12: chosen as its source entered).
					if name, chosen := chosen_creature_type(source); chosen && k.kind == .CreatureType && !slice.contains(ct.subtypes[:], name) {
						append(&ct.subtypes, name)
					}
				case types.ContinuousModification_AddType:
					if !slice.contains(ct.core_types[:], k.core_type) do append(&ct.core_types, k.core_type)
				case types.ContinuousModification_AddSubtype:
					if !slice.contains(ct.subtypes[:], k.subtype) do append(&ct.subtypes, k.subtype)
				case types.ContinuousModification_RemoveAllSubtypes:
					// CR 205.1b: "becomes a [creature type] creature" replaces its creature types.
					for i := len(ct.subtypes) - 1; i >= 0; i -= 1 do if subtype_in_set(ct.subtypes[i], k.set) {
						ordered_remove(&ct.subtypes, i)
						changed^ = true
					}
				}
			}
		}
		keywords := make([dynamic]types.Keyword, context.temp_allocator)
		append(&keywords, ..o.base_keywords[:])
		// The effects of resolved spells and abilities still applying to this object, in the order they were created.
		temps := make([dynamic][]types.ContinuousModification, context.temp_allocator)
		for t in g.temp_effects do if t.object == o.id && t.incarnation == o.incarnation do append(&temps, t.modifications)
		for e in statics do if affects(s, e.source, e.static, o) do add_types(&card_types, e.static.modifications[:], &types_changed, e.source)
		for mods in temps do add_types(&card_types, mods, &types_changed, nil)
		o.card_types = o.base_card_types
		if types_changed || len(card_types.core_types) != len(o.base_card_types.core_types) || len(card_types.subtypes) != len(o.base_card_types.subtypes) {
			o.card_types.core_types = slice.clone_to_dynamic(card_types.core_types[:])
			o.card_types.subtypes = slice.clone_to_dynamic(card_types.subtypes[:])
		}
		// Layer 6 (CR 613.1f): abilities added.
		for e in statics do if affects(s, e.source, e.static, o) {
			for m in e.static.modifications do if k, ok := m.(types.ContinuousModification_AddKeyword); ok && !has_keyword_in(keywords[:], k.keyword) do append(&keywords, k.keyword)
		}
		for mods in temps do for m in mods do if k, ok := m.(types.ContinuousModification_AddKeyword); ok && !has_keyword_in(keywords[:], k.keyword) do append(&keywords, k.keyword)
		// CR 122.1b, 613.1f: a keyword counter gives its keyword.
		for c in o.counters do if kc, ok := c._0.(types.CounterType_Keyword); ok {
			if k, known := keyword_of_counter(kc._0); known && !has_keyword_in(keywords[:], k) do append(&keywords, k)
		}
		// Layer 5 (CR 613.1e): color.
		colors_set := false
		for e in statics do if affects(s, e.source, e.static, o) {
			for m in e.static.modifications do if k, ok := m.(types.ContinuousModification_SetColor); ok {
				o.color = k.colors
				colors_set = true
			}
		}
		for mods in temps do for m in mods do if k, ok := m.(types.ContinuousModification_SetColor); ok {
			o.color = k.colors
			colors_set = true
		}
		if !colors_set do o.color = o.base_color
		// Layer 6 (CR 613.1f), after layer 5's colour (CR 613.1e): abilities granted ("equipped creature has '{T}: ...'", "creatures you control have 'whenever ...'"): its
		// own, then the granted ones.
		{
			granted := make([dynamic]types.AbilityDefinition, context.temp_allocator)
			granted_triggers := make([dynamic]^types.TriggerDefinition, context.temp_allocator)
			grants :: proc(mods: []types.ContinuousModification, out: ^[dynamic]types.AbilityDefinition, triggers: ^[dynamic]^types.TriggerDefinition) {
				for m in mods {
					#partial switch k in m {
					case types.ContinuousModification_GrantAbility:
						if k.definition != nil do append(out, k.definition^)
					case types.ContinuousModification_GrantTrigger:
						if k.trigger != nil do append(triggers, k.trigger)
					}
				}
			}
			for e in statics do if affects(s, e.source, e.static, o) do grants(e.static.modifications[:], &granted, &granted_triggers)
			for mods in temps do grants(mods, &granted, &granted_triggers)
			set_granted_abilities(o, granted[:], granted_triggers[:])
		}
		// Layer 7a (CR 613.4a): characteristic-defining abilities, then layer 7b (613.4b): set to a value.
		for pass in 0 ..< 2 {
			for e in statics do if e.static.characteristic_defining == (pass == 0) && affects(s, e.source, e.static, o) {
				for m in e.static.modifications {
					#partial switch k in m {
					case types.ContinuousModification_SetPower:
						power = k.value
					case types.ContinuousModification_SetToughness:
						toughness = k.value
					case types.ContinuousModification_SetDynamicPower:
						power = i32(quantity_value(s, k.value, e.source.controller, e.source.id, 0))
					case types.ContinuousModification_SetDynamicToughness:
						toughness = i32(quantity_value(s, k.value, e.source.controller, e.source.id, 0))
					}
				}
			}
		}
		for mods in temps do for m in mods {
			#partial switch k in m {
			case types.ContinuousModification_SetPower:
				power = k.value
			case types.ContinuousModification_SetToughness:
				toughness = k.value
			}
		}
		// Layer 7c (CR 613.4c): modifications, from static abilities, resolved effects and counters.
		dp, dt: i32
		for e in statics do if affects(s, e.source, e.static, o) {
			for m in e.static.modifications {
				#partial switch k in m {
				case types.ContinuousModification_AddPower:
					dp += k.value
				case types.ContinuousModification_AddToughness:
					dt += k.value
				case types.ContinuousModification_AddDynamicPower:
					dp += i32(quantity_value(s, k.value, e.source.controller, e.source.id, 0))
				case types.ContinuousModification_AddDynamicToughness:
					dt += i32(quantity_value(s, k.value, e.source.controller, e.source.id, 0))
				}
			}
		}
		for mods in temps do for m in mods {
			#partial switch k in m {
			case types.ContinuousModification_AddPower:
				dp += k.value
			case types.ContinuousModification_AddToughness:
				dt += k.value
			}
		}
		for p in g.pumps do if p.object == o.id && p.incarnation == o.incarnation {
			dp += p.power
			dt += p.toughness
		}
		for c in o.counters {
			#partial switch _ in c._0 {
			case types.CounterType_Plus1Plus1:
				dp += i32(c._1)
				dt += i32(c._1)
			case types.CounterType_Minus1Minus1:
				dp -= i32(c._1)
				dt -= i32(c._1)
			case types.CounterType_PowerToughness:
				// CR 122.1a, 613.4c: a +X/+Y counter adds X to power and Y to toughness.
				pt := c._0.(types.CounterType_PowerToughness)
				dp += pt.power * i32(c._1)
				dt += pt.toughness * i32(c._1)
			}
		}
		if p, ok := power.?; ok do power = p + dp
		if t, ok := toughness.?; ok do toughness = t + dt
		o.power, o.toughness = power, toughness
		o.keywords = o.base_keywords
		if len(keywords) != len(o.base_keywords) do o.keywords = slice.clone_to_dynamic(keywords[:])
	}
}

@(private = "file")
has_keyword_in :: proc(list: []types.Keyword, k: types.Keyword) -> bool {
	for x in list do if reflect.union_variant_typeid(x) == reflect.union_variant_typeid(k) do return true
	return false
}

// Whether a static ability of `source` applies to `o`.
@(private = "file")
affects :: proc(s: ^types.GameState, source: ^types.GameObject, st: ^types.StaticDefinition, o: ^types.GameObject) -> bool {
	if !condition_holds(s, source, st.condition) do return false
	affected, has := st.affected.?
	if !has && st.characteristic_defining do return o.id == source.id // a CDA defines its own object
	#partial switch x in affected {
	case types.TargetFilter_SelfRef:
		return o.id == source.id
	case types.TargetFilter_Typed:
		return object_matches(s, o, x._0, source.controller, source.id)
	}
	return false
}

// ---- Effects from resolved spells and abilities (CR 611.2) --------------------------------------------------

// "Target creature gets +1/+0 and gains first strike until end of turn": a continuous effect a resolved spell or
// ability created, on one object (as it was then, CR 611.2c), until the cleanup step (CR 514.2).
Temp_Effect :: struct {
	object:        types.ObjectId,
	incarnation:   u64,
	modifications: []types.ContinuousModification,
	permanent:     bool, // lasts for the game (CR 611.2a) rather than until end of turn
	modes:         bit_set[Rule_Mode], // a rule it states for the object: "can't block this turn" (CR 611.2)
	// A rule for every permanent of a kind ("creatures can't block this turn"): object is 0 and this is the
	// description, read when the rule is checked (CR 611.2c), from the point of view of `controller` and `source`.
	filter:        Maybe(types.TypedFilter),
	controller:    types.PlayerId,
	source:        types.ObjectId,
}

// The effect's duration: its own, else the instruction's, else none stated: it lasts indefinitely (CR 611.2a).
effect_duration :: proc(e: types.Effect_GenericEffect, instruction: Maybe(types.Duration)) -> types.Duration {
	if d, has := e.duration.?; has do return d
	if d, has := instruction.?; has do return d
	return types.Duration_Permanent{}
}

generic_effect_supported :: proc(e: types.Effect_GenericEffect, instruction: Maybe(types.Duration) = nil) -> bool {
	d := effect_duration(e, instruction)
	if e.end_cost != nil do return false
	#partial switch _ in d {
	case types.Duration_UntilEndOfTurn, types.Duration_Permanent:
	case:
		return false
	}
	if t, targets := e.target.?; targets && !(is_self(t) || (filter_supported(t) && !may_name_player(t))) do return false
	if len(e.static_abilities) == 0 do return false
	for st in e.static_abilities {
		if st.condition != nil do return false
		if _, continuous := st.mode.(types.StaticMode_Continuous); !continuous {
			// "Target creature can't block this turn": a rule for one object (CR 611.2), not for players.
			modes := rule_modes(st.mode)
			if modes == {} || modes & (PLAYER_MODES | {.Flash, .Cant_Be_Countered}) != {} do return false
		}
		affected, ok := st.affected.?
		if !ok do return false
		#partial switch _ in affected {
		case types.TargetFilter_ParentTarget, types.TargetFilter_SelfRef:
		case types.TargetFilter_Typed:
			if !mass_filter_supported(affected) do return false
		case:
			return false
		}
		for m in st.modifications do if !modification_supported(m) do return false
	}
	return true
}

// Starts the effect on its objects: the target or the source for "it"/"this", or every permanent of a kind, fixed
// as it begins (CR 611.2c).
add_temp_effect :: proc(g: ^Game, e: types.Effect_GenericEffect, controller: types.PlayerId, source: types.ObjectId, target: ^types.GameObject, instruction: Maybe(types.Duration) = nil) {
	s := &g.state
	d := effect_duration(e, instruction)
	_, permanent := d.(types.Duration_Permanent)
	for st in e.static_abilities {
		mods := make([dynamic]types.ContinuousModification)
		append(&mods, ..st.modifications[:])
		affected, _ := st.affected.?
		objects := make([dynamic]^types.GameObject, context.temp_allocator)
		#partial switch x in affected {
		case types.TargetFilter_ParentTarget:
			if target != nil do append(&objects, target)
		case types.TargetFilter_SelfRef:
			if o := object(s, source); o != nil && o.zone == .Battlefield do append(&objects, o)
		case types.TargetFilter_Typed:
			if rules_only(st) {
				// CR 611.2c: changing only the rules, it applies to whatever fits, including later arrivals.
				append(&g.temp_effects, Temp_Effect{modifications = mods[:], permanent = permanent, modes = rule_modes(st.mode), filter = x._0, controller = controller, source = source})
				continue
			}
			append(&objects, ..affected_permanents(s, affected, controller, source)[:])
		}
		for o in objects do if o.zone == .Battlefield {
			append(&g.temp_effects, Temp_Effect{object = o.id, incarnation = o.incarnation, modifications = mods[:], permanent = permanent, modes = rule_modes(st.mode)})
		}
	}
	apply_continuous_effects(g)
}

// ---- Conditions ("as long as ...", CR 611.3a: applied at each moment to what it says) ---------------------

condition_supported :: proc(c: types.StaticCondition) -> bool {
	#partial switch x in c {
	case types.StaticCondition_DuringYourTurn, types.StaticCondition_ChosenLabelIs:
		return true
	case types.StaticCondition_IsPresent:
		f, has := x.filter.?
		return has && mass_filter_supported(f)
	case types.StaticCondition_QuantityComparison:
		return quantity_supported(x.lhs) && quantity_supported(x.rhs)
	case types.StaticCondition_HasCounters:
		#partial switch m in x.counters {
		case types.CounterMatch_Any:
			return true
		case types.CounterMatch_OfType:
			return counter_kind_supported(m._0)
		}
	}
	return false
}

// Whether the condition of a static ability of `source` holds now.
condition_holds :: proc(s: ^types.GameState, source: ^types.GameObject, c: Maybe(types.StaticCondition)) -> bool {
	cond, has := c.?
	if !has do return true
	#partial switch x in cond {
	case types.StaticCondition_DuringYourTurn:
		return s.active_player == source.controller
	case types.StaticCondition_ChosenLabelIs:
		// "As long as Khans was chosen" (the Sieges: a choice between words, linked to the ability that reads it, CR 607.2f).
		label, chosen := chosen_label(source)
		return chosen && label == x.label
	case types.StaticCondition_IsPresent:
		f, _ := x.filter.?
		return len(affected_permanents(s, f, source.controller, source.id)) > 0
	case types.StaticCondition_QuantityComparison:
		l := quantity_value(s, x.lhs, source.controller, source.id, 0)
		r := quantity_value(s, x.rhs, source.controller, source.id, 0)
		return compare(l, x.comparator, r)
	case types.StaticCondition_HasCounters:
		n: u32
		for c in source.counters {
			#partial switch m in x.counters {
			case types.CounterMatch_Any:
				n += c._1
			case types.CounterMatch_OfType:
				if same_counter(c._0, m._0) do n += c._1
			}
		}
		if max_n, has_max := x.maximum.?; has_max && n > max_n do return false
		return n >= x.minimum
	}
	return false
}

// A granted ability that only states a rule ("can't block"), changing no characteristics (CR 611.2c).
rules_only :: proc(st: types.StaticDefinition) -> bool {
	if _, continuous := st.mode.(types.StaticMode_Continuous); continuous && len(st.modifications) == 0 do return false
	for m in st.modifications do if _, mode := m.(types.ContinuousModification_AddStaticMode); !mode do return false
	return true
}

// The subtypes of each card type (CR 205.3g-i); a subtype that's none of the others' is a creature type (205.3m).
ARTIFACT_TYPES :: [?]string{"Attraction", "Blood", "Bobblehead", "Book", "Clue", "Communicator", "Contraption", "Equipment", "Food", "Fortification", "Gold", "Heartwood", "Incubator", "Infinity", "Junk", "Lander", "Map", "Mutagen", "Powerstone", "Spacecraft", "Stone", "Treasure", "Vehicle", "Vibranium"}
ENCHANTMENT_TYPES :: [?]string{"Aura", "Background", "Cartouche", "Case", "Class", "Curse", "Plan", "Role", "Room", "Rune", "Saga", "Shard", "Shrine"}
LAND_TYPES :: [?]string{"Cave", "Desert", "Forest", "Gate", "Island", "Lair", "Locus", "Mine", "Mountain", "Plains", "Planet", "Power-Plant", "Sphere", "Swamp", "Tower", "Town", "Urza's", "Urza’s"}
SPELL_TYPES :: [?]string{"Adventure", "Arcane", "Chorus", "Lesson", "Omen", "Trap"}
// CR 205.3m: the creature types (creatures and kindreds share them).
CREATURE_TYPES :: [?]string{"Time Lord", "Advisor", "Aenar", "Aetherborn", "Alien", "Ally", "Andorian", "Android", "Angel", "Antelope", "Ape", "Archer", "Archon", "Armadillo", "Army", "Artificer", "Assassin", "Assembly-Worker", "Astartes", "Atog", "Aurochs", "Avatar", "Azra", "Badger", "Bajoran", "Balloon", "Barbarian", "Bard", "Basilisk", "Bat", "Bear", "Beast", "Beaver", "Beeble", "Beholder", "Berserker", "Betazoid", "Bird", "Bison", "Blinkmoth", "Boar", "Bolian", "Borg", "Brikar", "Bringer", "Brushwagg", "Caitian", "Camarid", "Camel", "Capybara", "Cardassian", "Caribou", "Carrier", "Cat", "Centaur", "Child", "Chimera", "Citizen", "Cleric", "Clown", "Cockatrice", "Construct", "Coward", "Coyote", "Crab", "Crocodile", "C’tan", "Custodes", "Cyberman", "Cyclops", "Dalek", "Dauthi", "Demigod", "Demon", "Denobulan", "Deserter", "Detective", "Devil", "Dinosaur", "Djinn", "Doctor", "Dog", "Dragon", "Drake", "Dreadnought", "Drix", "Drone", "Druid", "Dryad", "Dwarf", "Echidna", "Edosian", "Efreet", "Egg", "El-Aurian", "Elder", "Eldrazi", "Elemental", "Elephant", "Elf", "Elk", "Employee", "Eternal", "Excalbian", "Eye", "Faerie", "Ferengi", "Ferret", "Fish", "Flagbearer", "Fox", "Fractal", "Frog", "Fungus", "Gamer", "Gamma", "Gargoyle", "Germ", "Giant", "Giraffe", "Gith", "Glimmer", "Gnoll", "Gnome", "Goat", "Goblin", "God", "Golem", "Gorgon", "Gorn", "Graveborn", "Gremlin", "Griffin", "Guest", "Hag", "Halfling", "Hamster", "Harpy", "Hedgehog", "Hellion", "Hero", "Hippo", "Hippogriff", "Hirogen", "Homarid", "Homunculus", "Horror", "Horse", "Human", "Hydra", "Hyena", "Illusion", "Illyrian", "Imp", "Incarnation", "Inhuman", "Inkling", "Inquisitor", "Insect", "Jackal", "Jellyfish", "Jem’Hadar", "Juggernaut", "Kangaroo", "Kavu", "Kelpien", "Kirin", "Kithkin", "Klingon", "Knight", "Kobold", "Kor", "Kraken", "Kree", "Kwejian", "Llama", "Lamia", "Lammasu", "Lanthanite", "Leech", "Lemur", "Leviathan", "Lhurgoyf", "Licid", "Lizard", "Lobster", "Manticore", "Masticore", "Medusan", "Melkotian", "Mercenary", "Merfolk", "Metathran", "Minion", "Minotaur", "Mite", "Mole", "Monger", "Mongoose", "Monk", "Monkey", "Moogle", "Moonfolk", "Mount", "Mouse", "Mutant", "Myr", "Mystic", "Na’kuhl", "Nautilus", "Necron", "Nephilim", "Nightmare", "Nightstalker", "Ninja", "Noble", "Noggle", "Nomad", "Nymph", "Ocampa", "Octopus", "Officer", "Ogre", "Ooze", "Orb", "Orc", "Orgg", "Orion", "Otter", "Ouphe", "Ox", "Oyster", "Pangolin", "Peasant", "Pegasus", "Pentavite", "Performer", "Pest", "Phelddagrif", "Phoenix", "Phyrexian", "Pilot", "Pincher", "Pirate", "Plant", "Platypus", "Porcupine", "Possum", "Praetor", "Primarch", "Prism", "Processor", "Q", "Qu", "Rabbit", "Raccoon", "Ranger", "Rat", "Rebel", "Reflection", "Rhino", "Rigger", "Robot", "Rogue", "Romulan", "Sable", "Salamander", "Samurai", "Sand", "Saproling", "Satyr", "Scarecrow", "Scientist", "Scion", "Scorpion", "Scout", "Sculpture", "Seal", "Serf", "Serpent", "Servo", "Shade", "Shaman", "Shapeshifter", "Shark", "Sheep", "Shi’ar", "Siren", "Skeleton", "Skrull", "Skunk", "Slith", "Sliver", "Sloth", "Slug", "Snail", "Snake", "Soldier", "Soltari", "Sorcerer", "Spawn", "Specter", "Spellshaper", "Sphinx", "Spider", "Spike", "Spirit", "Splinter", "Sponge", "Spy", "Squid", "Squirrel", "Starfish", "Surrakar", "Survivor", "Symbiote", "Synth", "Talaxian", "Talosian", "Tamarian", "Tellarite", "Tentacle", "Tetravite", "Thalakos", "Tholian", "Thopter", "Thrull", "Tiefling", "Tosk", "Toy", "Treefolk", "Tribble", "Trill", "Trilobite", "Triskelavite", "Troll", "Turtle", "Tyranid", "Unicorn", "Utrom", "Vampire", "Varmint", "Vau-N’Akat", "Vedalken", "Villain", "Volver", "Vorta", "Vulcan", "Wall", "Walrus", "Warlock", "Warrior", "Weasel", "Weird", "Werewolf", "Whale", "Wizard", "Wolf", "Wolverine", "Wombat", "Worm", "Wraith", "Wurm", "Xindi", "Yeti", "Zombie", "Zubera"}

subtype_in_set :: proc(name: string, set: types.SubtypeSet) -> bool {
	in_list :: proc(name: string, list: []string) -> bool {
		for n in list do if n == name do return true
		return false
	}
	land := LAND_TYPES
	#partial switch set {
	case .Land:
		return in_list(name, land[:])
	case .Creature:
		// The creature types of CR 205.3m only: not artifact, land or other types, nor planeswalker types (205.3j) or
		// Siege (205.3q), which "becomes a creature" leaves alone (CR 205.1b).
		creature := CREATURE_TYPES
		return in_list(name, creature[:])
	}
	return false
}

// Layer 6 (CR 613.1f): the object's abilities are its own and then those granted to it. Its own activated abilities
// keep their positions (an activation names an ability by its index); granted triggers are marked as granted, and
// replaced on every pass.
set_granted_abilities :: proc(o: ^types.GameObject, granted: []types.AbilityDefinition, granted_triggers: []^types.TriggerDefinition) {
	base := o.base_abilities
	if base != nil {
		if len(granted) == 0 {
			o.abilities = base
		} else {
			// The same grants as before: keep the list (abilities on the stack and activation records point into
			// it); any change: a new list.
			same := o.abilities != base && o.abilities != nil && len(o.abilities^) == len(base^) + len(granted)
			if same do for a, i in granted do if o.abilities^[len(base^) + i].effect != a.effect || o.abilities^[len(base^) + i].sub_ability != a.sub_ability {
				same = false
				break
			}
			if !same {
				all := new([dynamic]types.AbilityDefinition)
				append(all, ..base[:])
				append(all, ..granted)
				o.abilities = all
			}
		}
	}
	if o.trigger_definitions == nil {
		if len(granted_triggers) == 0 do return
		o.trigger_definitions = types.Definitions_TriggerEntry(new([dynamic]types.TriggerEntry))
	}
	list := (^[dynamic]types.TriggerEntry)(o.trigger_definitions)
	own := 0
	for e in list^ do if _, is_granted := e.occurrence.(types.TriggerDefinitionOccurrenceRef_Granted); !is_granted do own += 1
	if len(list^) == own + len(granted_triggers) {
		same := true
		for t, i in granted_triggers do if list^[own + i].definition.execute != t.execute {
			same = false
			break
		}
		if same do return
	}
	// A new list: triggers waiting to go on the stack point into the old one, which stays as it was.
	fresh := new([dynamic]types.TriggerEntry)
	for e in list^ do if _, is_granted := e.occurrence.(types.TriggerDefinitionOccurrenceRef_Granted); !is_granted do append(fresh, e)
	for t, i in granted_triggers {
		append(fresh, types.TriggerEntry{occurrence = types.TriggerDefinitionOccurrenceRef_Granted{grant_instance = types.TriggerGrantInstanceRef(i + 1)}, definition = t^})
	}
	o.trigger_definitions = types.Definitions_TriggerEntry(fresh)
}
