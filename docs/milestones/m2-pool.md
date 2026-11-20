# M2 pool: Magic 2010

The card pool for M2 (D-053) and what each card needs from the engine (M2-02). Written from Scryfall's Oracle data and
then checked card by card against its Oracle text; a card's notes say what's new about it. This map set M2's task order
(`m2-rules-depth.md`, D-055). It's kept by hand: when a task scripts a card and finds it needs something else, fix its
row.

**234 cards**: 229 different nonbasic cards and the five basic lands. None is left out: no card needs multiplayer or
a casual variant (D-051), so every card will be scripted and tested.

## What the cards need

A card can need several systems. Codes in the table at the end: `T` targeting, `C` costs, `FX` effects and keyword
actions, `KW` keywords and attack or block restrictions, `TR` triggers, `R` replacement and prevention, `S` static
abilities and layers, `K` counters, `TK` tokens, `A` Auras, `E` Equipment, `PW` planeswalkers, `SP` special rules.

| System | Task | Cards that need it |
| --- | --- | --- |
| Targeting with restrictions | M2-04 | 34 |
| Costs (X, sacrifice, counters as costs) | M2-04 | 14 |
| Effects and keyword actions (destroy, draw, discard, ...) | M2-05 | 87 |
| Keywords and attack or block restrictions | M2-06 | 45 |
| Triggered abilities | M2-07 | 43 |
| Replacement and prevention, regeneration | M2-08 | 22 |
| Static abilities and layers | M2-09 | 43 |
| Counters | M2-10 | 4 |
| Tokens | M2-11 | 9 |
| Auras | M2-12 | 15 |
| Equipment | M2-12 | 3 |
| Planeswalkers | M2-13 | 5 |
| Special rules (below) | M2-14 | 18 |

## When each card becomes playable

A card is playable after the last task it needs. Each system task scripts the cards that become playable with it, so
the pool grows through the milestone: 38 cards need nothing new, 93 are playable after M2-05, 144 after M2-07, 211
after M2-12, all 234 after M2-14.

| Playable after | Cards | |
| --- | --- | --- |
| M1 (already built) | 38 | Elite Vanguard, Siege Mastodon, Silvercoat Lion, Stormfront Pegasus, Air Elemental, Coral Merfolk, Disorient, Horned Turtle, Snapping Drake, Wind Drake, Zephyr Sprite, Kelinore Bat, Looming Shade, Warpath Ghoul, Zombie Goliath, Canyon Minotaur, Fiery Hellhound, Goblin Piker, Lightning Bolt, Lightning Elemental, Prodigal Pyromancer, Raging Goblin, Shivan Dragon, Centaur Courser, Craw Wurm, Enormous Baloth, Giant Growth, Giant Spider, Llanowar Elves, Might of Oaks, Runeclaw Bear, Ornithopter, Rod of Ruin, Plains, Island, Swamp, Mountain, Forest |
| M2-04 | 5 | Righteousness, Vampire Aristocrat, Fireball, Ignite Disorder, Lava Axe |
| M2-05 | 50 | Angel's Mercy, Blinding Mage, Celestial Purge, Divine Verdict, Excommunicate, Planar Cleansing, Solemn Offering, Tempest of Light, Undead Slayer, Cancel, Divination, Essence Scatter, Fabricate, Flashfreeze, Merfolk Looter, Mind Spring, Negate, Ponder, Tome Scour, Traumatize, Unsummon, Acolyte of Xathrid, Assassinate, Consume Spirit, Deathmark, Diabolic Tutor, Disentomb, Doom Blade, Duress, Haunting Echoes, Mind Rot, Mind Shatter, Royal Assassin, Sign in Blood, Tendrils of Corruption, Burning Inquiry, Earthquake, Goblin Artillery, Pyroclasm, Seismic Strike, Shatter, Yawning Fissure, Birds of Paradise, Bountiful Harvest, Elvish Piper, Naturalize, Nature's Spiral, Rampant Growth, Windstorm, Terramorphic Expanse |
| M2-06 | 21 | Griffin Sentinel, Palace Guard, Razorfoot Griffin, Serra Angel, Wall of Faith, Alluring Siren, Phantom Warrior, Bog Wraith, Child of Night, Dread Warlock, Berserkers of Blood Ridge, Jackal Familiar, Panic Attack, Viashino Spearhunter, Wall of Fire, Deadly Recluse, Emerald Oryx, Kalonian Behemoth, Mist Leopard, Prized Unicorn, Stampeding Rhino |
| M2-07 | 30 | Lightwielder Paladin, Mesa Enchantress, Soul Warden, Illusionary Servant, Sage Owl, Gravedigger, Howling Banshee, Hypnotic Specter, Megrim, Sanguine Bond, Underworld Dreams, Xathrid Demon, Ball Lightning, Bogardan Hellkite, Capricious Efreet, Dragon Whelp, Inferno Elemental, Manabarbs, Sparkmage Apprentice, Acidic Slime, Borderland Ranger, Bramble Creeper, Elvish Visionary, Lurking Predators, Angel's Feather, Demon's Horn, Dragon's Claw, Howling Mine, Kraken's Eye, Wurm's Tooth |
| M2-08 | 19 | Baneslayer Angel, Guardian Seraph, Harm's Way, Safe Passage, White Knight, Polymorph, Black Knight, Drudge Skeletons, Wall of Bone, Cudgel Troll, Fog, Great Sable Stag, Regenerate, Darksteel Colossus, Dragonskull Summit, Drowned Catacomb, Glacial Fortress, Rootbound Crag, Sunpetal Grove |
| M2-09 | 24 | Glorious Charge, Honor of the Pure, Rhox Pikemaster, Silence, Veteran Armorsmith, Veteran Swordsmith, Jump, Levitation, Merfolk Sovereign, Serpent of the Endless Sea, Nightmare, Relentless Rats, Rise from the Grave, Act of Treason, Burst of Speed, Goblin Chieftain, Kindled Fury, Stone Giant, Trumpet Blast, Awakener Druid, Elvish Archdruid, Overrun, Coat of Arms, Spellbook |
| M2-10 | 2 | Mold Adder, Protean Hydra |
| M2-11 | 6 | Captain of the Watch, Cemetery Reaper, Siege-Gang Commander, Ant Queen, Howl of the Night Pack, Gargoyle Castle |
| M2-12 | 16 | Armored Ascension, Holy Strength, Indestructibility, Lifelink, Open the Vaults, Pacifism, Ice Cage, Mind Control, Soul Bleed, Unholy Strength, Weakness, Firebreathing, Oakenform, Gorgon Flail, Magebane Armor, Whispersilk Cloak |
| M2-13 | 5 | Ajani Goldmane, Jace Beleren, Liliana Vess, Chandra Nalaar, Garruk Wildspeaker |
| M2-14 | 18 | Clone, Convincing Mirage, Djinn of Wishes, Hive Mind, Sleep, Sphinx Ambassador, Telepathy, Time Warp, Twincast, Wall of Frost, Vampire Nocturnus, Magma Phoenix, Warp World, Entangling Vines, Master of the Wild Hunt, Mirror of Fate, Pithing Needle, Platinum Angel |

## Special rules (M2-14)

Rules only one or two cards need, each built with its card:

- **Copies (CR 707):** Clone (a permanent, "as it enters", CR 614.12), Twincast and Hive Mind (copies of spells, CR
  707.10).
- **Extra turns (CR 500.7):** Time Warp.
- **Hidden information made public:** Telepathy (hands revealed), Vampire Nocturnus (top card of the library
  revealed), Djinn of Wishes (reveal and play without paying the mana cost). These need per-player knowledge
  (future-rules.md, "Hidden information").
- **Choosing a name or a type as it enters (CR 614.12):** Pithing Needle, Convincing Mirage; Sphinx Ambassador names a
  card on resolution.
- **"Doesn't untap during the untap step":** Sleep, Wall of Frost, Entangling Vines.
- **Losing and winning:** Platinum Angel (can't lose, opponents can't win; CR 104.3).
- **Abilities that work from other zones:** Magma Phoenix (returns from the graveyard, CR 113.6).
- **Big one-offs:** Warp World, Mirror of Fate (face-up exiled cards), Master of the Wild Hunt (damage dealt each way
  and divided by the other player).

## Prebuilt decks

Decks for the fuzzer and the golden games grow with the pool. A first M10 deck pair once M2-05 is done (93 playable
cards), replacing the M1 decks as the fuzzer's main decks: done (D-069), `red-green-beats` and `blue-black-control`
in `packages/cards/src/decks/`, first versions of two of the three below from scripted cards only; the fuzzer plays
them two games in three, and M1's pair stays for the benchmark. Three final decks in M2-14, chosen so that between them
every mechanic appears:

- **White Soldiers:** Elite Vanguard, Captain of the Watch, Veteran Armorsmith and Swordsmith, Honor of the Pure,
  Pacifism (anthems, tokens, Auras, first strike).
- **Red-Green Beats:** Lightning Bolt, Fireball, Prodigal Pyromancer, Overrun, Giant Growth, tramplers and tokens.
- **Blue-Black Control:** Cancel, Doom Blade, Mind Rot, Sign in Blood, fliers, regenerating walls, a planeswalker.

The exact lists are written when they're built (D-053's pool rule: only scripted cards go in a deck).

## Every card

| # | Card | Type | Needs | Notes |
| --- | --- | --- | --- | --- |
| 1 | Ajani Goldmane | Legendary Planeswalker — Ajani | PW K TK S | planeswalker; +1/+1 counters; a token whose P/T is defined by an ability |
| 2 | Angel's Mercy | Instant | FX | life gain |
| 3 | Armored Ascension | Enchantment — Aura | A S | P/T from a count of Plains; grants flying |
| 4 | Baneslayer Angel | Creature — Angel | KW R | first strike, lifelink; protection from Demons and Dragons; protection prevents damage (CR 702.16e) |
| 5 | Blinding Mage | Creature — Human Wizard | T FX | activated ability that taps a target |
| 6 | Captain of the Watch | Creature — Human Soldier | KW S TR TK | vigilance; anthem for Soldiers; enters trigger; tokens |
| 7 | Celestial Purge | Instant | T FX | target by color; exile |
| 8 | Divine Verdict | Instant | T FX | target attacking or blocking creature; destroy |
| 9 | Elite Vanguard | Creature — Human Soldier | — |  |
| 10 | Excommunicate | Sorcery | FX | put a permanent on top of its owner's library |
| 11 | Glorious Charge | Instant | S | "creatures you control get +1/+1 until end of turn" (affected set locked, CR 611.2c) |
| 12 | Griffin Sentinel | Creature — Griffin | KW | vigilance |
| 13 | Guardian Seraph | Creature — Angel | R | damage prevention |
| 14 | Harm's Way | Instant | R T | damage redirection; choose a source |
| 15 | Holy Strength | Enchantment — Aura | A S |  |
| 16 | Honor of the Pure | Enchantment | S | anthem for white creatures |
| 17 | Indestructibility | Enchantment — Aura | A KW | indestructible |
| 18 | Lifelink | Enchantment — Aura | A KW S | grants lifelink |
| 19 | Lightwielder Paladin | Creature — Human Knight | KW TR T FX | first strike; combat damage to a player trigger; exile |
| 20 | Mesa Enchantress | Creature — Human Druid | TR FX | "whenever you cast" trigger; may draw |
| 21 | Open the Vaults | Sorcery | FX A | return from graveyards to the battlefield; Auras with nothing to enchant stay (CR 303.4) |
| 22 | Pacifism | Enchantment — Aura | A KW | can't attack or block |
| 23 | Palace Guard | Creature — Human Soldier | KW | can block any number of creatures |
| 24 | Planar Cleansing | Sorcery | FX | destroy all nonland permanents |
| 25 | Razorfoot Griffin | Creature — Griffin | KW | first strike |
| 26 | Rhox Pikemaster | Creature — Rhino Soldier | KW S | first strike; grants first strike to Soldiers |
| 27 | Righteousness | Instant | T | target blocking creature |
| 28 | Safe Passage | Instant | R | prevent all damage this turn |
| 29 | Serra Angel | Creature — Angel | KW | vigilance |
| 30 | Siege Mastodon | Creature — Elephant | — |  |
| 31 | Silence | Instant | S | opponents can't cast spells ("can't" effects, CR 101.2) |
| 32 | Silvercoat Lion | Creature — Cat | — |  |
| 33 | Solemn Offering | Sorcery | T FX | target artifact or enchantment; destroy; life gain |
| 34 | Soul Warden | Creature — Human Cleric | TR FX | another creature enters; life gain |
| 35 | Stormfront Pegasus | Creature — Pegasus | — |  |
| 36 | Tempest of Light | Instant | FX | destroy all enchantments |
| 37 | Undead Slayer | Creature — Human Cleric | T FX | target by subtype; exile |
| 38 | Veteran Armorsmith | Creature — Human Soldier | S | anthem for Soldiers |
| 39 | Veteran Swordsmith | Creature — Human Soldier | S | anthem for Soldiers |
| 40 | Wall of Faith | Creature — Wall | KW | defender |
| 41 | White Knight | Creature — Human Knight | KW R | first strike; protection from black; protection prevents damage (CR 702.16e) |
| 42 | Air Elemental | Creature — Elemental | — |  |
| 43 | Alluring Siren | Creature — Siren | KW T | "attacks if able" requirement on a target (CR 508.1d) |
| 44 | Cancel | Instant | FX | counter target spell |
| 45 | Clone | Creature — Shapeshifter | SP R | copy effect (CR 707), "as it enters" choice (CR 614.12) |
| 46 | Convincing Mirage | Enchantment — Aura | A S SP | enchant land; land type change (layer 4); "as it enters" choice |
| 47 | Coral Merfolk | Creature — Merfolk | — |  |
| 48 | Disorient | Instant | — |  |
| 49 | Divination | Sorcery | FX | draw |
| 50 | Djinn of Wishes | Creature — Djinn | K C FX SP | wish counters; remove a counter as a cost; reveal and play without paying the mana cost |
| 51 | Essence Scatter | Instant | T FX | counter target creature spell |
| 52 | Fabricate | Sorcery | FX | search library, reveal, shuffle |
| 53 | Flashfreeze | Instant | T FX | counter target spell by color |
| 54 | Hive Mind | Enchantment | TR SP | copy spells for each other player (CR 707.10) |
| 55 | Horned Turtle | Creature — Turtle | — |  |
| 56 | Ice Cage | Enchantment — Aura | A KW S TR | can't attack or block; can't activate abilities; "becomes the target" trigger |
| 57 | Illusionary Servant | Creature — Illusion | TR FX | "becomes the target" trigger; sacrifice |
| 58 | Jace Beleren | Legendary Planeswalker — Jace | PW FX | planeswalker; draw; mill |
| 59 | Jump | Instant | S | grants flying until end of turn |
| 60 | Levitation | Enchantment | S | grants flying to creatures you control |
| 61 | Merfolk Looter | Creature — Merfolk Rogue | FX | draw, then discard |
| 62 | Merfolk Sovereign | Creature — Merfolk Noble | S T KW | anthem for Merfolk; target by subtype; can't be blocked |
| 63 | Mind Control | Enchantment — Aura | A S | control change (layer 2) |
| 64 | Mind Spring | Sorcery | C FX | X cost; draw |
| 65 | Negate | Instant | T FX | counter target noncreature spell |
| 66 | Phantom Warrior | Creature — Illusion Warrior | KW | can't be blocked |
| 67 | Polymorph | Sorcery | FX R | destroy, can't be regenerated; reveal until a creature; put onto the battlefield; shuffle |
| 68 | Ponder | Sorcery | FX | look at the top cards, reorder, may shuffle; draw |
| 69 | Sage Owl | Creature — Bird | TR FX | enters trigger; look at the top cards and reorder |
| 70 | Serpent of the Endless Sea | Creature — Serpent | S KW | P/T from a count of Islands; attack restriction |
| 71 | Sleep | Sorcery | FX SP | tap all; "doesn't untap during the next untap step" |
| 72 | Snapping Drake | Creature — Drake | — |  |
| 73 | Sphinx Ambassador | Creature — Sphinx | TR SP FX | combat damage trigger; search another player's library; name a card |
| 74 | Telepathy | Enchantment | SP | hands revealed (hidden information made public) |
| 75 | Time Warp | Sorcery | SP | extra turn (CR 500.7) |
| 76 | Tome Scour | Sorcery | FX | mill |
| 77 | Traumatize | Sorcery | FX | mill half a library |
| 78 | Twincast | Instant | SP | copy a spell (CR 707.10) |
| 79 | Unsummon | Instant | FX | return to owner's hand |
| 80 | Wall of Frost | Creature — Wall | KW TR SP | defender; "whenever it blocks" trigger; doesn't untap |
| 81 | Wind Drake | Creature — Drake | — |  |
| 82 | Zephyr Sprite | Creature — Faerie | — |  |
| 83 | Acolyte of Xathrid | Creature — Human Cleric | FX | life loss as an effect |
| 84 | Assassinate | Sorcery | T FX | target tapped creature; destroy |
| 85 | Black Knight | Creature — Human Knight | KW R | first strike; protection from white; protection prevents damage (CR 702.16e) |
| 86 | Bog Wraith | Creature — Wraith | KW | swampwalk |
| 87 | Cemetery Reaper | Creature — Zombie | S T FX TK | anthem for Zombies; target card in a graveyard; exile; token |
| 88 | Child of Night | Creature — Vampire | KW | lifelink |
| 89 | Consume Spirit | Sorcery | C FX | X cost, spend only black mana on X; life gain |
| 90 | Deathmark | Sorcery | T FX | target by color; destroy |
| 91 | Diabolic Tutor | Sorcery | FX | search library, shuffle |
| 92 | Disentomb | Sorcery | T FX | target card in your graveyard; return to hand |
| 93 | Doom Blade | Instant | T FX | target nonblack creature; destroy |
| 94 | Dread Warlock | Creature — Human Wizard Warlock | KW | can't be blocked except by black creatures |
| 95 | Drudge Skeletons | Creature — Skeleton | R | regenerate |
| 96 | Duress | Sorcery | FX | reveal hand, choose a card, discard |
| 97 | Gravedigger | Creature — Zombie | TR T FX | enters trigger; target card in graveyard; return to hand |
| 98 | Haunting Echoes | Sorcery | FX | exile a graveyard; search for cards by name; shuffle |
| 99 | Howling Banshee | Creature — Spirit | TR FX | enters trigger; life loss |
| 100 | Hypnotic Specter | Creature — Specter | TR FX | damage-to-opponent trigger; discard at random |
| 101 | Kelinore Bat | Creature — Bat | — |  |
| 102 | Liliana Vess | Legendary Planeswalker — Liliana | PW FX S | planeswalker; discard; search and put on top; reanimate all under your control |
| 103 | Looming Shade | Creature — Shade | — |  |
| 104 | Megrim | Enchantment | TR | "whenever an opponent discards" trigger |
| 105 | Mind Rot | Sorcery | FX | discard |
| 106 | Mind Shatter | Sorcery | C FX | X cost; discard at random |
| 107 | Nightmare | Creature — Nightmare Horse | S | P/T from a count of Swamps (characteristic-defining, CR 604.3) |
| 108 | Relentless Rats | Creature — Rat | S | P/T from other cards named Relentless Rats; its deck rule is deckbuilding's, not the engine's |
| 109 | Rise from the Grave | Sorcery | T FX S | target card in a graveyard; put onto the battlefield; adds a type and color |
| 110 | Royal Assassin | Creature — Human Assassin | T FX | target tapped creature; destroy |
| 111 | Sanguine Bond | Enchantment | TR T | "whenever you gain life" trigger |
| 112 | Sign in Blood | Sorcery | FX | draw; life loss |
| 113 | Soul Bleed | Enchantment — Aura | A TR | trigger at the upkeep of the enchanted creature's controller |
| 114 | Tendrils of Corruption | Instant | FX | damage and life gain equal to a count |
| 115 | Underworld Dreams | Enchantment | TR | "whenever an opponent draws" trigger |
| 116 | Unholy Strength | Enchantment — Aura | A S |  |
| 117 | Vampire Aristocrat | Creature — Vampire Rogue Noble | C | sacrifice a creature as a cost |
| 118 | Vampire Nocturnus | Creature — Vampire | SP S | top card of the library revealed; conditional anthem and flying |
| 119 | Wall of Bone | Creature — Skeleton Wall | KW R | defender; regenerate |
| 120 | Warpath Ghoul | Creature — Zombie | — |  |
| 121 | Weakness | Enchantment — Aura | A S | -2/-1 |
| 122 | Xathrid Demon | Creature — Demon | KW TR FX | trample; upkeep trigger; sacrifice; life loss equal to the sacrificed creature's power (last known information) |
| 123 | Zombie Goliath | Creature — Zombie Giant | — |  |
| 124 | Act of Treason | Sorcery | S FX | control change until end of turn (layer 2); untap; grants haste |
| 125 | Ball Lightning | Creature — Elemental | KW TR FX | trample; end step trigger; sacrifice |
| 126 | Berserkers of Blood Ridge | Creature — Human Berserker | KW | "attacks each combat if able" (CR 508.1d) |
| 127 | Bogardan Hellkite | Creature — Dragon | KW TR T | flash; enters trigger; damage divided among any number of targets |
| 128 | Burning Inquiry | Sorcery | FX | draw; discard at random |
| 129 | Burst of Speed | Sorcery | S | grants haste until end of turn |
| 130 | Canyon Minotaur | Creature — Minotaur Warrior | — |  |
| 131 | Capricious Efreet | Creature — Efreet | TR T FX | upkeep trigger; targets with different restrictions; destroy one at random |
| 132 | Chandra Nalaar | Legendary Planeswalker — Chandra | PW C FX | planeswalker; −X loyalty cost |
| 133 | Dragon Whelp | Creature — Dragon | TR FX | delayed trigger after four activations; sacrifice |
| 134 | Earthquake | Sorcery | C FX | X cost; damage to each creature without flying and each player |
| 135 | Fiery Hellhound | Creature — Elemental Dog | — |  |
| 136 | Fireball | Sorcery | C T | X cost; cost increase per extra target; damage divided evenly among any number of targets |
| 137 | Firebreathing | Enchantment — Aura | A S | grants an activated ability (layer 6) |
| 138 | Goblin Artillery | Creature — Goblin Warrior | FX | damage to "you" (an effect subject for the controller) |
| 139 | Goblin Chieftain | Creature — Goblin | S | anthem for Goblins; grants haste |
| 140 | Goblin Piker | Creature — Goblin Warrior | — |  |
| 141 | Ignite Disorder | Instant | T | one to three targets by color; damage divided as you choose (CR 601.2d) |
| 142 | Inferno Elemental | Creature — Elemental | TR | blocks or becomes blocked trigger |
| 143 | Jackal Familiar | Creature — Jackal | KW | can't attack or block alone |
| 144 | Kindled Fury | Instant | KW S | grants first strike until end of turn |
| 145 | Lava Axe | Sorcery | T | target player or planeswalker |
| 146 | Lightning Bolt | Instant | — |  |
| 147 | Lightning Elemental | Creature — Elemental | — |  |
| 148 | Magma Phoenix | Creature — Phoenix | TR FX SP | dies trigger; damage to each creature and player; ability that works from the graveyard |
| 149 | Manabarbs | Enchantment | TR | "whenever a player taps a land for mana" trigger (CR 605.4) |
| 150 | Panic Attack | Sorcery | T KW | up to three targets; can't block |
| 151 | Prodigal Pyromancer | Creature — Human Wizard | — |  |
| 152 | Pyroclasm | Sorcery | FX | damage to each creature |
| 153 | Raging Goblin | Creature — Goblin Berserker | — |  |
| 154 | Seismic Strike | Instant | FX | damage equal to a count |
| 155 | Shatter | Instant | T FX | target artifact; destroy |
| 156 | Shivan Dragon | Creature — Dragon | — |  |
| 157 | Siege-Gang Commander | Creature — Goblin | TR TK C | enters trigger; tokens; sacrifice a Goblin as a cost |
| 158 | Sparkmage Apprentice | Creature — Human Wizard | TR | enters trigger with a target |
| 159 | Stone Giant | Creature — Giant | T S TR | target with a P/T condition; grants flying; delayed destroy trigger |
| 160 | Trumpet Blast | Instant | S | group pump for attacking creatures until end of turn |
| 161 | Viashino Spearhunter | Creature — Lizard Warrior | KW | first strike |
| 162 | Wall of Fire | Creature — Wall | KW | defender |
| 163 | Warp World | Sorcery | SP | shuffle all permanents into libraries, reveal and put onto the battlefield |
| 164 | Yawning Fissure | Sorcery | FX | sacrifice of the player's choice |
| 165 | Acidic Slime | Creature — Ooze | KW TR T FX | deathtouch; enters trigger; destroy |
| 166 | Ant Queen | Creature — Insect | TK | token from an activated ability |
| 167 | Awakener Druid | Creature — Human Druid | TR S | enters trigger; a land becomes a creature for as long as (layer 4, duration) |
| 168 | Birds of Paradise | Creature — Bird | FX | mana of any color (a choice) |
| 169 | Borderland Ranger | Creature — Human Scout Ranger | TR FX | enters trigger; may search, reveal, shuffle |
| 170 | Bountiful Harvest | Sorcery | FX | life gain equal to a count |
| 171 | Bramble Creeper | Creature — Elemental | TR | attacks trigger |
| 172 | Centaur Courser | Creature — Centaur Warrior | — |  |
| 173 | Craw Wurm | Creature — Wurm | — |  |
| 174 | Cudgel Troll | Creature — Troll | R | regenerate |
| 175 | Deadly Recluse | Creature — Spider | KW | deathtouch |
| 176 | Elvish Archdruid | Creature — Elf Druid | S FX | anthem for Elves; mana equal to a count |
| 177 | Elvish Piper | Creature — Elf Shaman | FX | put a creature card from hand onto the battlefield |
| 178 | Elvish Visionary | Creature — Elf Shaman | TR FX | enters trigger; draw |
| 179 | Emerald Oryx | Creature — Antelope | KW | forestwalk |
| 180 | Enormous Baloth | Creature — Beast | — |  |
| 181 | Entangling Vines | Enchantment — Aura | A SP | enchant tapped creature; doesn't untap |
| 182 | Fog | Instant | R | prevent all combat damage |
| 183 | Garruk Wildspeaker | Legendary Planeswalker — Garruk | PW TK S FX | planeswalker; token; group pump and trample; untap |
| 184 | Giant Growth | Instant | — |  |
| 185 | Giant Spider | Creature — Spider | — |  |
| 186 | Great Sable Stag | Creature — Elk | KW R | can't be countered; protection from blue and from black; protection prevents damage (CR 702.16e) |
| 187 | Howl of the Night Pack | Sorcery | TK FX | tokens equal to a count |
| 188 | Kalonian Behemoth | Creature — Beast | KW | shroud |
| 189 | Llanowar Elves | Creature — Elf Druid | — |  |
| 190 | Lurking Predators | Enchantment | TR FX | "whenever an opponent casts" trigger; reveal; put onto the battlefield or the bottom |
| 191 | Master of the Wild Hunt | Creature — Human Shaman | TR TK SP | upkeep trigger; tokens; tap all Wolves, damage dealt each way and divided by the opponent |
| 192 | Might of Oaks | Instant | — |  |
| 193 | Mist Leopard | Creature — Cat | KW | shroud |
| 194 | Mold Adder | Creature — Fungus Snake | TR K | cast trigger; +1/+1 counter |
| 195 | Naturalize | Instant | T FX | target artifact or enchantment; destroy |
| 196 | Nature's Spiral | Sorcery | T FX | target permanent card in your graveyard; return to hand |
| 197 | Oakenform | Enchantment — Aura | A S |  |
| 198 | Overrun | Sorcery | S KW | group pump and trample until end of turn |
| 199 | Prized Unicorn | Creature — Unicorn | KW | "all creatures able to block it do so" (CR 509.1c) |
| 200 | Protean Hydra | Creature — Hydra | C K R TR | X cost; enters with counters; prevention that removes counters; counter-removed trigger, delayed |
| 201 | Rampant Growth | Sorcery | FX | search library, put onto the battlefield tapped, shuffle |
| 202 | Regenerate | Instant | R T | regenerate target creature |
| 203 | Runeclaw Bear | Creature — Bear | — |  |
| 204 | Stampeding Rhino | Creature — Rhino | KW | trample |
| 205 | Windstorm | Instant | C FX | X cost; damage to each creature with flying |
| 206 | Angel's Feather | Artifact | TR | cast trigger; may gain life |
| 207 | Coat of Arms | Artifact | S | P/T from creatures sharing a type (layer 7c, a count) |
| 208 | Darksteel Colossus | Artifact Creature — Golem | KW R | trample; indestructible; "would be put into a graveyard" replacement, shuffle into library |
| 209 | Demon's Horn | Artifact | TR | cast trigger; may gain life |
| 210 | Dragon's Claw | Artifact | TR | cast trigger; may gain life |
| 211 | Gorgon Flail | Artifact — Equipment | E S KW | equipment; +1/+1 and deathtouch |
| 212 | Howling Mine | Artifact | TR FX | draw step trigger with an "intervening if" (CR 603.4); draw |
| 213 | Kraken's Eye | Artifact | TR | cast trigger; may gain life |
| 214 | Magebane Armor | Artifact — Equipment | E S R | equipment; loses flying; prevent noncombat damage |
| 215 | Mirror of Fate | Artifact | C SP | sacrifice as a cost; face-up exiled cards; exile a library |
| 216 | Ornithopter | Artifact Creature — Thopter | — |  |
| 217 | Pithing Needle | Artifact | SP S | "as it enters" name a card (CR 614.12); can't activate abilities |
| 218 | Platinum Angel | Artifact Creature — Angel | SP | can't lose and opponents can't win (CR 104.3) |
| 219 | Rod of Ruin | Artifact | — |  |
| 220 | Spellbook | Artifact — Book | S | no maximum hand size (CR 402.2) |
| 221 | Whispersilk Cloak | Artifact — Equipment | E KW | equipment; can't be blocked; shroud |
| 222 | Wurm's Tooth | Artifact | TR | cast trigger; may gain life |
| 223 | Dragonskull Summit | Land | R FX | enters tapped unless (a replacement, CR 614.1d); mana of one of two colors |
| 224 | Drowned Catacomb | Land | R FX | enters tapped unless; mana of one of two colors |
| 225 | Gargoyle Castle | Land | C TK | sacrifice as a cost; artifact creature token |
| 226 | Glacial Fortress | Land | R FX | enters tapped unless; mana of one of two colors |
| 227 | Rootbound Crag | Land | R FX | enters tapped unless; mana of one of two colors |
| 228 | Sunpetal Grove | Land | R FX | enters tapped unless; mana of one of two colors |
| 229 | Terramorphic Expanse | Land | C FX | sacrifice as a cost; search, put onto the battlefield tapped, shuffle |
| 230 | Plains | Basic Land — Plains | — |  |
| 237 | Island | Basic Land — Island | — |  |
| 239 | Swamp | Basic Land — Swamp | — |  |
| 242 | Mountain | Basic Land — Mountain | — |  |
| 247 | Forest | Basic Land — Forest | — |  |
