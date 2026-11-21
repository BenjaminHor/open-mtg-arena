# Status

Living document. Update it at the end of every task: what changed, what's next, and anything the
next session needs to know. Keep it short. Move finished detail into commit messages.

**Current milestone:** M2 — Rules depth (`milestones/m2-rules-depth.md`)
**Rules version:** see `rules/VERSION.json`

## In progress
- M2 Rules depth (`docs/milestones/m2-rules-depth.md`), started 2026-11-19. M1 is closed: the owner skipped the CLI
  spot checks and asked to start M2; tagging `m1` on `main` is left to the owner.
- M2-01 Hidden information fix: done, merged (PR #21, D-054).
- M2-02 The Magic 2010 pool and its mechanics: done and accepted (the owner read it: "Looks good so far",
  2026-11-20). `docs/milestones/m2-pool.md` maps all 234 cards (none left out) to the systems they need and the task
  after which each is playable; the M2 tasks are reordered by it (D-055). The table is kept by hand from now on: when a
  task scripts a card, check its row.
- M2-03 The event pipeline: done, merged (PR #23, D-056). Every game event goes through `happen`; replacement
  effects (M2-08) and triggers (M2-07) plug in there. Reworked once after the rules-judge and code-reviewer reviews.
- M2-04 Targeting and costs: done (both halves merged), split in two (restrictions taken from the Oracle text of all
  47 pool cards marked T or C).
  - M2-04a Targeting: done, merged (PR #24, D-057). Righteousness, Ignite Disorder, Lava Axe, Elite Vanguard, Coral
    Merfolk, Plains, Island; interim decks white-red and blue-green.
  - M2-04b Costs: done, merged (PR #25, D-058). Fireball, Vampire Aristocrat, Swamp; interim deck black-red.
  - Dropped from M2-04: paying mana outside casting. No Magic 2010 card pays mana while a spell resolves (checked).
  - Future impact: Aura targets (M2-12) use `permanent` targets with the same filters; triggered abilities (M2-07)
    choose targets with the same decisions as they're put on the stack (CR 603.3d); protection and shroud (M2-06)
    and hexproof plug into `legalTargets` as one more check; planeswalkers extend `anyTarget` and
    `playerOrPlaneswalker`.
- M2-05 Effects and keyword actions: split in three by the 50 cards' Oracle text (the spec lists the cards).
  - M2-05a Removal, counters and {T} abilities: done, merged (PR #26, D-059). The 19 cards plus Ornithopter and Rod of
    Ruin scripted; 31 scenarios in `test/scenarios/cards/m2-05a/`; unit tests in `test/effects/removal.test.ts`; the
    interim decks carry the new cards, with five new golden games. Code-reviewed and rules-reviewed; fixes in. The plan
    as built:
    - New effect ops, each skipping an object no longer where the effect expects it (CR 101.3, 400.7), never
      throwing: `destroy` (CR 701.8a), `destroyAll` (every permanent fitting an `ObjectFilter`, decided once as the
      effect applies, one simultaneous event, CR 608.2f, 608.2h; graveyard order later: CR 404.3), `exile`
      (CR 701.13a, 406.2), `returnToHand` and `putOnTopOfLibrary` (the owner's zone, CR 400.3, 404.1), `tap`
      (CR 701.26a: a tapped one does nothing), `counter` (CR 701.6a; its pipeline event is `counterObject`, which won't
      collide with CR 122 counters), `gainLife` (CR 119.3).
    - Subjects: `"you"` joins `"self"` and targets for player effects, the spell's or ability's controller
      (CR 109.5, 115.10b); "you gain 4 life" is `gainLife` to `"you"`.
    - Pipeline events: `counterObject` (any stack object: a spell goes to its owner's graveyard as part of the event,
      an ability ceases to exist; emits a countered event, not SPELL_DID_NOT_RESOLVE; no refund, CR 701.6b) and
      `gainLife` (player, amount; 0 is dropped before replacement, CR 119.9; lifelink is a result of damage, not a
      gainLife proposal, CR 120.3f). Exile, hand and library moves are `moveCard`. future-rules: the M2-08 "zone change
      this event makes" helper must list `counterObject`.
    - {T} in the cost of an ability that uses the stack (Royal Assassin, Blinding Mage, Undead Slayer, Rod of Ruin):
      untapped (CR 107.5); controlled since the turn began only for creatures (CR 602.5a; Rod of Ruin can activate at
      once); tapped at the final payment (CR 601.2h, after targets, so Royal Assassin can't target itself: its ruling),
      before any sacrifice (for "{T}, Sacrifice this" later), rechecked. If the source was tapped for mana meanwhile,
      the cost can't be paid (CR 107.5, 601.2h) and only cancel remains: `autoPay` and the `payMana` legal actions must
      leave out the activating source's own mana ability, or the fuzzer's "every listed action is accepted" breaks.
    - Citations: exile CR 701.13a; "target spell" can't be an ability CR 113.9, 112.1; Undead Slayer's target is a
      permanent (CR 109.2), subtypes only; "can't be countered" later (CR 101.2).
    - Cards: the 19 in the spec, plus Ornithopter and Rod of Ruin (artifacts to target). Enchantments weren't in the pool
      until M2-07b, which adds scenarios for the enchantment half of Naturalize, Solemn Offering and Tempest of Light.
    - Tests (from the rulings): Royal Assassin can't target itself, its ability resolving without its source (and Rod
      of Ruin's after Shatter); Solemn Offering whose target is gone gains no life; Ornithopter as an artifact creature
      spell for Essence Scatter but not Negate or Flashfreeze; a countered creature spell to the graveyard, no refund;
      Cancel can't target an ability or itself, and a Cancel whose target was countered first doesn't resolve; Divine
      Verdict in the end of combat step, not in main 2; Celestial Purge not on a land; Undead Slayer exiling a Vampire,
      not a Bear, not a card in a graveyard; Blinding Mage tapping a would-be blocker, a declared blocker staying in
      combat (CR 506.4b), itself, sick; Assassinate untapped refused; Planar Cleansing both sides, lands stay; Tempest
      of Light with nothing; Excommunicate to the owner's library; a counter war; Doom Blade on a colorless creature.
      (Excommunicate is a sorcery, so it can't meet an attacker; Divine Verdict on a blocker is left to M2-06's combat
      keywords.)
      Unit tests: controller isn't owner (CR 400.3), Royal Assassin's target untapped first, the {T} source tapped for
      mana, gainLife 0, destroy and tap on an object gone mid-resolution.
  - M2-05b Cards moving, split in two by the advisor's review (2026-11-20):
    - M2-05b1, no choices at resolution: done, merged (PR #27, D-060). Divination, Mind Spring, Sign in Blood, Mind
      Shatter, Burning Inquiry, Tome Scour, Traumatize, Disentomb, Nature's Spiral. A `player` target kind, an
      `"eachPlayer"` subject, a `loseLife` pipeline event (CR 119.3); ops draw N (N single draws, CR 121.2, each
      player's in APNAP order, CR 121.2c; `apnapOrder` in `game/turn-order.ts`), lose life, discard at random (seeded
      picks, then one simultaneous discard, Burning Inquiry's ruling; a smaller hand whole, CR 609.3), mill (CR 701.17a,
      as many as possible, 701.17b; half rounded down, CR 107.1a; graveyard order later: CR 404.3). 17 scenarios in
      `test/scenarios/cards/m2-05b/`, unit tests in `test/effects/player-effects.test.ts`; the interim decks carry the
      nine cards, five new golden games. Code-reviewed and rules-reviewed, fixes in. The 0-life drop was removed (Open
      questions). A 300-game fuzz found a false alarm in the leak check (a card drawn and discarded in one action
      looked hidden from its own drawer); the check now counts it as seen, with a test. The draw-several container
      (CR 121.2a) moves to M2-08.
    - M2-05b2, choices at resolution (now), split in two. Plan (2026-11-20), rules-reviewed and revised (D-062):
      - Shared (built in b2a): an effect that needs choices stops with a `chooseCards` decision that keeps the effect
        to resume; after the last answer it's queued once, with the cards chosen, in front of the rest of the
        resolution; nothing happens until every answer is in (CR 608.2d), and answers emit no events.
        One option per answer, plus `finishChoosing` once the minimum is reached; reaching the maximum finishes. The
        chooser isn't always the controller (Mind Rot: the target player, CR 701.9b). Only its own answers are legal:
        no mana abilities, no spells (CR 608.2g; Merfolk Looter's ruling). Counts are clamped (CR 609.3).
      - Hidden information (D-062): options are stored in a fixed order (oracle id, then internal id) and answered by
        position. `playerView` shows the decision's player each option's object id only if they can see that card
        anyway (their own hand); any other option shows only what the card is. Other players see only that a choice
        is being made. A choice over a hidden zone is always asked when the zone isn't empty, with min 0 where the CR
        allows finding nothing (CR 701.23b; Elvish Piper's ruling): skipping it would tell the opponent the zone has
        no such card. A `CARDS_REVEALED` event carries identities only, in the same order. `scrambleHidden` permutes
        hidden ids instead of shifting them, and keeps the identity of cards a viewer is entitled to see; two-worlds
        unit tests come first (Fabricate with and without an artifact, Piper declining against no creature, Tutor
        finding A against B, Echoes leaving copies against none, Duress on a hand built in two orders).
      - M2-05b2a, choices from a hand: done, merged (PR #29). 17 scenarios in `test/scenarios/cards/m2-05b2/`;
        two-worlds, ordering and answer tests in `test/effects/choose-cards.test.ts` (checked to fail when the view
        shows ids, the choice is skipped, or a whole hand is discarded in hand order); `scrambleHidden` permutes hidden
        ids; the interim decks carry the four cards, four new golden games. The reviews found a leak this task brought
        in (a whole-hand discard in hand order), fixed. M2-05b2b is next; first settle and review two design points:
        a search shows the searcher the whole zone, privately, by identity (CR 701.23a), which also keeps Duress's
        revealed hand in the view mid-choice; and where "found" / "exiled this way" live between effects (D-063 is one
        condition on it). Two-worlds tests first (Fabricate with and without an artifact, Tutor finding A or B, Echoes
        leaving copies or none, from the target's view).
        Mind Rot (`discard`: the player discards N of their choice, CR 701.9a-b; a
        smaller hand whole, CR 609.3), Merfolk Looter (draw, then discard, nothing between: CR 608.2g and its ruling;
        CR 704.5b with an empty library), Duress (`target opponent`: a player target with an opponent restriction,
        relative to the controller, checked on choosing and resolving, CR 115.1a, 115.2, 102.2, later: CR 102.3;
        `revealHand` as its own effect, CR 701.20a-b; then `discard` chosen by "you" from the cards fitting
        "noncreature, nonland", mandatory if any fits, nothing if none, CR 608.2d, 609.3), Elvish Piper
        (`putOntoBattlefield` from hand, min 0; under the activator's control, CR 110.2a, 109.5; not cast; summoning
        sick, CR 302.6; resolves with its source gone, CR 113.7a).
      - M2-05b2b, libraries: done, merged (PR #30, D-064); M2-05b is done. 22 scenarios (39 in
        `test/scenarios/cards/m2-05b2/`), unit tests in `test/effects/library-effects.test.ts`; reviewed by the
        rules-judge and code-reviewer, fixes in (a concession mid-search left the "this way" record behind; names read
        through `characteristics()`; an invariant on what a decision shows). M2-05c is next. The two-worlds tests came
        first (each checked to fail when a search skips a library with no match or an "any number" search ends at its
        maximum); the interim decks carry
        the six cards, five new golden games; the fuzzer reaches searches and Ponder's look. Design (settled
        2026-11-20 with the advisor; the rules-judge reviewed the cards): an
        `ObjectFilter` supertype (basic, CR 205.4a, read through `supertypesOf`) and a negated filter, since "other
        than basic land cards" means not (basic and land) (Haunting Echoes still exiles Terramorphic Expanse). A
        `GameState.resolution` record `{ object, found, exiled }` for "this way" (CR 608.2c), set as an object starts
        to resolve and cleared on every exit (`finishResolving`, its early return, `doesNotResolve`), with an
        invariant the fuzzer checks; effects name the found cards with a `"found"` subject. Ops: `search` (only
        chooses, into `found`; look at the whole zone, CR 701.23a; a stated quality may find none, CR 701.23b; "a
        card" must be found if there's one, CR 701.23d), `reveal` of a subject (CR 701.23e), `put` into hand or onto
        the battlefield (tapped: part of the move, CR 110.5b, 603.2e; not a land play, CR 305.4), `shuffle`,
        `mayShuffle` (a `chooseYesNo` decision: yes queues the shuffle, no queues nothing), `lookAtTop` and put back
        in any order (Ponder: a `chooseCards` of the top cards, top first, asked even for one card, CR 701.20e,
        401.4, later: CR 701.20d; reordering is a pipeline event), `exileGraveyard` (records `exiled`). A
        `chooseCards` decision gains `seen`, the whole zone by identity, shown only to the chooser (a searched
        library; Duress's revealed hand, kept in view mid-choice). An "any number" choice (Haunting Echoes) ends only
        on `finishChoosing`, never at its hidden maximum, or the number of answers would tell how many copies are
        left. Haunting Echoes with nothing exiled doesn't search (D-063; the graveyard is public, so skipping tells
        nothing); otherwise it asks even when no copy is left. "Sacrifice this land" is a `sacrificeSelf` cost part,
        after {T} (CR 602.2, D-059); not a mana ability (CR 605.1a). Two-worlds tests first: Fabricate with and
        without an artifact; Tutor finding A or B; Echoes leaving copies or none, from the target's view.
      - Future impact: "whenever a player discards / searches / shuffles" (M2-07) read these events; a replacement on
        a discard or move (M2-08) sees one event per instruction, the choices made; Telepathy and multiplayer reveals
        need revealed cards in the view, not only an event (CR 701.20a); several searchers at once (CR 701.23i), "may
        search" (CR 701.23g) and searching another player's library (Sphinx Ambassador) fit the same steps.

  - M2-05c Life, damage to many, mana: done.
    Plan (2026-11-20), rules-reviewed and revised; split in two:
    - M2-05c1, no new decisions: done, merged (PR #31, D-067). 21 scenarios in `test/scenarios/cards/m2-05c/`, unit tests
      in `test/effects/damage-to-many.test.ts`; the interim decks carry the ten cards, five new golden games. Angel's
      Mercy, Bountiful Harvest, Acolyte of Xathrid, Seismic Strike, Tendrils of
      Corruption, Consume Spirit, Pyroclasm, Windstorm, Earthquake, Goblin Artillery.
      - An `Amount` counted from the battlefield, `{ count: ObjectFilter }`, worked out as the effect applies
        (CR 608.2h); "Mountains" and "Swamps" are land types read through characteristics (CR 205.3i). Tendrils' "where
        X is the number of Swamps you control" is that count, with no X announced (CR 107.3c); it's counted once per
        effect, which can only differ once replacements move things mid-resolution (later: CR 107.3i, 608.2h, M2-08).
      - A subject `{ each: ObjectFilter }`: every permanent fitting it as the effect applies (Earthquake's ruling,
        CR 608.2h). Filters gain `keywords` / `notKeywords`, read through `keywordsOf` (CR 702.9a).
      - `dealDamage` gains `and: [{ to, amount }]`: one source, different damage to different recipients, as one damage
        event (CR 608.2f, 120.4), backed by a unit test that both of Goblin Artillery's damages come before either life
        loss. 0 damage isn't dealt
        (CR 120.8); gaining 0 life isn't an event (CR 119.9).
      - Consume Spirit's "Spend only black mana on X": X stays generic in the printed cost (CR 107.4b; color and mana
        value unchanged, CR 202.2, 202.3e); only the cost to pay (`totalCost`) makes each X a {B}, a payment
        restriction (CR 601.2h). Equivalent today; reductions (CR 118.7a) and other restrictions (Soul Burn) need
        restricted mana later (future-rules).
    - M2-05c2, choices: done, merged (PR #32, D-068). 12 scenarios (`yawning-fissure*`, `birds-of-paradise*` in
      `test/scenarios/cards/m2-05c/`), unit tests in `test/mana/any-color.test.ts`; the interim decks carry both, two
      golden games. With it, M2-05 is done: 71 of the 234 Magic 2010 cards (the pool's 79 include 8 M1-only cards: Shock, Volcanic
      Hammer, Grizzly Bears, Gray Ogre, Hill Giant, Fire Elemental, Spined Wurm, Furnace Whelp). Yawning Fissure (`sacrifice` op, each opponent choosing a land they control, filter relative to
      the chooser; CR 701.21a, 608.2d; with two players one chooser, so APNAP choosing then one simultaneous
      sacrifice stays `later: CR 101.4, 608.2e`; a forced choice isn't asked, the battlefield being public). Birds of
      Paradise: the color travels on the `ACTIVATE_ABILITY` action (a design choice: the CR has it chosen as the
      ability resolves, CR 608.2d, which for a mana ability is right after activation, CR 605.3b), checked as it
      resolves, W/U/B/R/G only (CR 106.1a), in both paths (priority and while paying), refused when missing or sent to a
      fixed-color ability; `legalActions` lists one activation per color; `autoPay` sees it and tries any-color sources
      last.
    - Tests from the review: counts on resolution (Seismic Strike, Tendrils after a fetched land), zero counts and X=0,
      flying checked on resolution, Windstorm sparing reach and players, both players dying (a draw), Pyroclasm on
      damaged creatures, Artillery with its target gone, source gone, on its controller, summoning sick, Acolyte,
      Consume Spirit's black-only X and target gone, Fissure's choices, Birds' colors.
- Next, before M2-06 (plan from the advisor, 2026-11-20):
  1. Done, merged (PR #33): the 22 Magic 2010 cards the pool table marks playable since M1 but that were never scripted (Siege
     Mastodon, Silvercoat Lion, Stormfront Pegasus, Air Elemental, Disorient, Horned Turtle, Snapping Drake, Wind
     Drake, Zephyr Sprite, Kelinore Bat, Looming Shade, Warpath Ghoul, Zombie Goliath, Canyon Minotaur, Fiery
     Hellhound, Goblin Piker, Lightning Elemental, Prodigal Pyromancer, Shivan Dragon, Enormous Baloth, Might of Oaks,
     Runeclaw Bear), its own `add-cards` PR, so 93 are playable as the spec says. 9 scenarios in
     `test/scenarios/cards/m10-core/`, seven golden games from two throwaway deck lists (replaced by the fresh golden set
     in step 2). The pool's comment header, scrambled by sorting the file in earlier tasks, is restored.
  2. Done, merged (PR #34): the golden set rebuilt and Magic 2010's first deck pair (D-069). A `by-kind` agent (the fuzzer's
     picker); `pnpm golden:cover` (`packages/cli/src/golden-cover.ts`) plays the fuzzer's decks for seeds 1 to 800 and
     adds, greedily, the games using the most unused cards per action, each cut off at the turn its last new card is
     used; a card counts as used when played as a land or a spell or ability of it resolves, and three choices the
     export tests read are covered too. The interim decks and their 36 golden games are gone; M1's four (the bench)
     stay; 20 new games, the folder 3.2 MB (was 15 MB; budget 4 MB). `red-green-beats` and `blue-black-control`, first
     versions of two of m2-pool.md's decks, are the fuzzer's main pair (two prebuilt games in three). The fuzzer's 40-seed
     measure lost no decision kind or event type (Ignite Disorder is in red-green-beats for `divide`). Export tests
     repointed to `blue-black-control-vs-red-green-beats-644`, `pool-463`, `pool-707`.
  3. M2-06, keywords and attack or block restrictions (m2-rules-depth.md): done; four keywords come with their first
     cards (D-074); 21 cards; 114 of the 234 Magic 2010 cards now (the pool's 122 include 8 M1-only cards). Next: M2-07 triggered abilities,
     (the golden budget is 8 MB, D-073). Plan (2026-11-20), in
     four PRs, each with its cards, scenarios and interaction matrix rows:
     - M2-06a combat damage, done, merged (PR #35, D-070): first and double strike with a second combat damage step,
       trample (lethal damage first; forced answers filled in, not asked), deathtouch (CR 704.5h record), lifelink (a
       result of the damage event), vigilance. Viashino Spearhunter, Razorfoot Griffin, Stampeding Rhino, Deadly
       Recluse, Child of Night, Serra Angel, Griffin Sentinel. Scenarios in `test/scenarios/cards/m2-06a/` and
       `test/scenarios/interactions/`, unit tests on test creatures in `test/combat/strikes-and-trample.test.ts`
       (double strike has no Magic 2010 card), six new matrix rows; five of the cards in the M10 pair.
       For 06b: trample's lethal damage must count damage other attackers assign to a blocker that blocks several
       (Palace Guard; future-rules, "More combat").
     - M2-06b, done, merged (PR #36, D-071): defender, swampwalk and forestwalk, "can't be blocked (except by ...)", "can block
       any number" (Palace Guard dividing its damage, trample's lethal counting other attackers' damage), "can't block
       this turn". Wall of Faith, Wall of Fire, Bog Wraith, Emerald Oryx, Phantom Warrior, Dread Warlock, Palace Guard,
       Panic Attack. Scenarios in `test/scenarios/cards/m2-06b/` and `interactions/block-any-number/`, five new matrix
       rows; three of the cards in the M10 pair.
     - M2-06c, done, merged (PR #37, D-072): "can't attack or block alone", "attacks each combat if able", "attacks you this
       turn if able", "all creatures able to block it do so"; `finishDeclaring` only when the declaration is legal, and a
       `takeBack` answer. Jackal Familiar, Berserkers of Blood Ridge, Prized Unicorn, Alluring Siren. Scenarios in
       `test/scenarios/cards/m2-06c/` and `interactions/requirements/`, a unit test for take-back
       (`test/combat/declarations.test.ts`), two new matrix rows; three of the cards in the M10 pair. Declarations list
       finishing first (no first-legal loop); the bench baseline reset.
     - M2-06d, done, merged (PR #38): shroud (CR 702.18), one check in `legalTargets` for permanents only (CR 113.6: a spell
       or a graveyard card with shroud can be targeted), which resolution re-checks (CR 608.2b).
       Mist Leopard, Kalonian Behemoth. Scenarios in `test/scenarios/cards/m2-06d/` and `interactions/shroud/`, a unit
       test for a target gaining shroud before resolution, a Shroud matrix row; Mist Leopard in the M10 pair.
       Protection's targeting and blocking, flash, indestructible and "can't be countered" waited for the owner's answer,
       settled by D-074: flash came in M2-07, indestructible in M2-08a, the rest come in M2-08e and M2-12.

  4. Done: M2-07 triggered abilities (CR 603; m2-rules-depth.md), merged in PRs #39, #40, #41 and #44 (D-076–D-079,
     D-084). The plan as it was made (2026-11-20), in three PRs:
     - Shared: `CardDef.triggers` (kept out of `abilities`, like `statics`, D-071), each a condition as data, targets,
       effects, "you may" and an "intervening if" (CR 603.4). Triggers are detected per batch in `checkTriggers` (see
       Settled), matched against result events; matches wait in `GameState.pendingTriggers`. `givePriority`, after state-based actions, puts
       them on the stack (CR 117.5, 603.3): active player's first in APNAP order (CR 603.3b), a player with several
       ordering theirs (a decision), each choosing its targets as it goes on (CR 603.3d; none legal: removed), with no
       cost and no cancel (future-rules: an origin kind in `casting-steps.ts`). An ability on the stack refers to its
       trigger (`AbilityRef` gains `triggered`) and carries what triggered it ("that player", "that much": the
       triggering event's player, object and amount). "You may" asks as it resolves (`chooseYesNo`).
     - M2-07a: the machinery, entering and beginning-of-step triggers: Elvish Visionary, Howling Banshee, Sparkmage
       Apprentice, Gravedigger, Borderland Ranger, Sage Owl, Acidic Slime, Soul Warden, Ball Lightning, Howling Mine
       (intervening if), Bramble Creeper (attacks). Done, merged (PR #39, D-076): the triggers README
       (`engine/src/triggers/README.md`) explains the path; 35 scenarios in `test/scenarios/cards/m2-07a/` and
       `interactions/triggers/`, unit tests in `test/triggers/triggers.test.ts`, a Triggers matrix column; nine of the
       cards in the M10 pair (Soul Warden and Acidic Slime only in pool decks); 9 golden games added (4.4 MB). The
       fuzzer's 40-seed measure doesn't reach `orderTriggers` (two triggers at once for one player); scenarios cover it.
       133 cards in the pool; 125 of the 234 Magic 2010 cards.
     - M2-07b: triggers on casting, drawing, discarding, damage, life gain and tapping for mana: Wurm's Tooth, Dragon's
       Claw, Kraken's Eye, Angel's Feather, Demon's Horn, Mesa Enchantress, Lurking Predators, Underworld Dreams,
       Megrim, Manabarbs, Hypnotic Specter, Sanguine Bond, Lightwielder Paladin.
       Done, merged (PR #40, D-077): 44 scenarios in `test/scenarios/cards/m2-07b/` (with real enchantments for Naturalize,
       Solemn Offering and Tempest of Light), three new Triggers matrix cells; six of the cards in the M10 pair; 12
       golden games added (5.1 MB; every golden log also gained a "taps ... for mana" line per land tapped). 146 cards
       in the pool; 138 of the 234 Magic 2010 cards. Plan (2026-11-20), one PR in three slices, each with its cards and scenarios:
       - Slice 1, casting: `spellCast` with a filter on the spell as cast (colors, types; `controller` is the caster,
         relative to the trigger's controller), matched where `SPELL_CAST` is emitted (CR 601.2i), so the triggers go
         on the stack before the caster gets priority. The five artifacts ("you may gain 1 life"), Mesa Enchantress,
         Lurking Predators (a `revealTop` op whose card is `found`; `put` with an `onlyIf` filter; "you may put it on
         the bottom", a yes or no).
       - Slice 2, drawing, discarding, mana: `playerDraws` and `playerDiscards` (`CARD_DRAWN`, `CARD_DISCARDED`, through
         the pipeline), `landTappedForMana` (CR 106.12: a new `MANA_ABILITY_RESOLVED` event from `resolveManaAbility`,
         land source, {T} in the cost, mana produced, CR 106.12a). Underworld Dreams, Megrim, Manabarbs. The cleanup
         step gives priority when triggers wait (CR 514.3a: a discard to hand size triggers Megrim). Manabarbs triggered
         while paying a cancelled cast is dropped (CR 734.1, built in 07a).
       - Slice 3, damage and life: `selfDealsDamage` (to an opponent, or combat damage to a player), `playerGainsLife`
         with "that much" (`TriggerEvent.amount`, an `Amount` "triggerAmount"). Target filters can name "that player"
         (`controller: "triggeringPlayer"`, read from the ability's `trigger`, CR 603.3d, Lightwielder Paladin).
         Hypnotic Specter, Sanguine Bond (one trigger per life-gain event: each lifelink source, CR 603.2c),
         Lightwielder Paladin.
       - Future impact: "whenever a player casts" also matches copies later (no: copies aren't cast, CR 707.10); the
         filter reads the spell's characteristics through `characteristics()` so layer effects apply; replacement
         effects (M2-08) change draw and life gain events before detection; a 0-life gain has no event (CR 119.10).
     - Golden games rework (owner, D-082), done, merged (PR #42): 25 games, 1.5 MB (was 66, 5.4 MB).
       - `cli/src/action-lines.ts`: `actionLines(actions)` writes one readable line per action (`pass p1 p2`, `p1 land o85`,
         `p2 cast o12`, `p1 activate o5 printed 0 for G`, `p2 chooseTarget p1`, `p2 declareBlocker o7 o5`; D-083);
         `actionsFromLines(setup, lines, cards)` replays the game to fill in each decision id, and counts lines left after the
         game ended. `setup-names.ts`: card names in setups. Game files with `"encoding": "lines"`; `readGameFile`
         reads either encoding.
       - `cli/src/mechanics.ts`: the cover's units: combat keywords and statics as creatures attack or block, flash and
         shroud as a permanent enters, each field of a resolving spell, activated or triggered ability, every decision
         kind answered (a cancel or take-back doesn't count), every event type agents can reach.
       - A test that every pool card is in a scenario, by whole name.
     - Golden action lines name the acting player (owner, D-083), done, merged (PR #43).
     - M2-07c2 (D-084): done, merged (PR #44). With it, M2-07 is done. Engine, Dragon Whelp and Illusionary Servant, 20 scenarios in
       `test/scenarios/cards/m2-07c2/`, unit tests (`test/game/activation-count.test.ts`: a removed activation still
       counts, the count starts again each turn; `test/triggers/delayed.test.ts`: a spell's delayed trigger, CR 603.7d,
       with the test-only instant Late Gift), definition checks, two matrix cells (Firebreathing × Triggers, Burn ×
       Triggers), golden logs with `targeted:` lines (additions only), pool-579 and pool-111 covering `trigger delayed`
       and `selfBecomesTarget`, docs. 152 cards; 144 of the 234 Magic 2010 cards. Not put in the M10 pair: each of its
       slots carries a rule the pool needs. Fuzz (300 games), mutation pass (10 caught), bench, rules-judge and code-reviewer all done, fixes in.
       Design (2026-11-20, with the advisor's review):
       - `GameState.delayedTriggers`: each `{ source, sourceOracleId, controller, ability }`, the ability a
         `TriggeredAbilityDef` (its `when` limited to the next "beginning of step" for now). Created by an effect
         `createDelayedTrigger`; source and controller those of the ability that made it (CR 603.7e). Matched in
         `detectTriggers` apart from the battlefield's (no early exit, no source lookup), and removed as it triggers
         (CR 603.7b). A pending trigger refers to its ability by `{ kind: "triggered", index }` or
         `{ kind: "delayed", ability }`; one lookup resolves both, and identical delayed triggers stay unasked (D-077).
       - Dragon Whelp: `GameState.turnHistory.activations` counts each object's printed ability as it becomes activated
         (where `ABILITY_ACTIVATED` is emitted: a cancel never counts, a countered activation does, D-078), reset as a
         turn begins; the effect `ifActivatedThisTurn { atLeast, effects }` reads its own ability's count through the
         resolving stack object.
       - Illusionary Servant: a `BECAME_TARGET` event as each object target is chosen, for spells, activations and
         triggers, matched where it's emitted; `selfBecomesTarget`. A cancelled cast drops its pending triggers, all of
         which it caused (a cast starts only with none waiting). No pool card targets one object twice in one spell, so
         one trigger per target chosen is enough for now (future-rules).
       - Golden credit: the delayed ability's units when it resolves, not when it's created.
     - M2-07c plan (2026-11-20), two PRs:
       - M2-07c1, done, merged (PR #41, D-079): 27 scenarios in `test/scenarios/cards/m2-07c/`, a unit test for the random
         destroy over seeds, an Inferno Elemental matrix cell, an invariant that a pending decision always has a legal
         action; three of the cards in the M10 pair; 3 golden games (5.4 MB). 150 cards in the pool; 142 of the 234
         Magic 2010 cards. Plan: Xathrid Demon ("your upkeep": `beginningOfStep` gains `whose`; "sacrifice a creature other than this",
         then a loss equal to the sacrificed creature's power, read from its last known characteristics, CR 608.2h:
         kept with it in the resolution's "this way" record as it's sacrificed, D-079; "if you can't" taps
         it and loses 7), Capricious Efreet (targets on both sides, "up to two"; destroy one of the still-legal targets
         at random with the seeded RNG), Inferno Elemental (blocks or becomes blocked: one trigger per blocker/attacker
         pair, matched where `BLOCKERS_DECLARED` is emitted; "that creature" is the trigger's object), Bogardan Hellkite
         (flash, CR 702.8a: cast any time an instant could be; its entering trigger divides 5 damage among zero to five
         targets (CR 107.1c), the division chosen as the trigger goes on the stack, CR 603.3d, 601.2d).
       - M2-07c2: delayed triggers (CR 603.7): created by a resolving effect, kept in `GameState.delayedTriggers` with
         their own `AbilityRef`, removed once triggered ("the next end step"); Dragon Whelp's per-object, per-turn
         activation count (D-078); "becomes the target" (CR 601.2c, 603.2) for spells, activations and triggers, as
         targets are chosen, dropped on cancel (only what the cancelled cast caused): Illusionary Servant.
     - M2-07c: Xathrid Demon, Capricious Efreet, Dragon Whelp (a delayed trigger, CR 603.7), Inferno Elemental,
       Illusionary Servant ("becomes the target", CR 601.2c), Bogardan Hellkite (flash comes with it, D-074).
     - Settled before code (advisor, 2026-11-20):
       - Detection stays `checkTriggers` in `happen` (D-056: it has the state before each batch), plus the four places
         that emit events outside the pipeline: `STEP_BEGAN` (steps.ts), `SPELL_CAST` / `ABILITY_ACTIVATED`
         (casting-steps.ts), `ATTACKERS_DECLARED`, `BLOCKERS_DECLARED`. One `detectTriggers(before, after, events)`.
         Early exit when no permanent has triggers.
       - Only permanents' triggers fire (CR 113.6): not a card in a graveyard, not a spell on the stack.
       - A cancelled cast drops the triggers its mana abilities caused (CR 734.1): all waiting ones, as a cast starts
         only at priority with none waiting (code review: no count needed).
       - Pending triggers make cleanup give priority, like a state-based action did (CR 514.3a); `playersLose` clears
         them; an invariant: nothing pending while a player has priority.
       - Trigger target decisions offer no cancel; ordering is asked only of a player with two or more, the last
         forced; the stack ability stores only what its effects read from the triggering event (no hidden ids).
       - Slices of 07a: machinery and untargeted entering triggers; then targets and "may"; then step and attack
         triggers. A mutation pass before review; trigger cards into the M10 pair and the 40-seed measure.
     - Rules review of the plan (2026-11-20), to build in:
       - Last known information is needed now (CR 608.2h, 603.4): Howling Mine Shattered in response still makes the
         player draw (ruling); Xathrid Demon reads the sacrificed creature's power. A store of objects' last known
         information as they leave, read by the intervening-if re-check and "self" when gone. "Dies" triggers (Magma
         Phoenix, M2-14) will use the same store.
       - CR 603.3b / 117.5 repeat: after a batch is on the stack, `givePriority` runs again (state-based actions, then
         triggers that came up meanwhile, a fresh batch). The `givePriority` work keeps the player who'd get priority;
         putting triggers never gives it to the trigger's controller (CR 603.3b).
       - "Becomes the target" (CR 601.2c, not 603.2): an event as targets are chosen, for spells, activations and
         triggers, dropped on cancel. (07c, Illusionary Servant.)
       - Each emission point matches only its own event: `payCost`, the draw step and declaring attackers already
         passed their other events through `happen`.
       - A pending trigger stores its source id, oracle id, trigger index and controller as it triggered (CR 603.3a):
         the source may be gone before it goes on the stack.
       - The triggering event's data goes on the ability before targets ("target ... that player controls", Lightwielder
         Paladin) and is read again on resolution (CR 608.2b).
       - Triggers go on the stack through the target steps but not `payCost`: no `ABILITY_ACTIVATED`, no priority to
         the trigger's controller, no cancel.
       - Match result events: one `LIFE_GAINED` per lifelink source (Sanguine Bond), `ZONE_CHANGED` for a played land,
         "taps a land for mana" per activation of a land's {T} mana ability (CR 106.12; not Terramorphic Expanse).
       - Intervening if re-checked in `resolveTopOfStack`, beside CR 608.2b: false removes it (CR 608.2a).
       - Delayed triggers (07c) live in state, not on a permanent; their own `AbilityRef`; Dragon Whelp needs a
         per-object, per-turn activation count (not resolutions; cancel doesn't count; CR 400.7 resets; D-078).
       - CR 514.3a (cleanup with triggers) has no 07a card: built with Megrim (07b).
       - Read a permanent's triggers through one function (layer 6 later, CR 603.6b), like `keywordsOf`.
       - Test list: ETB in APNAP order, ordering one's own, Soul Warden negatives, source gone before and after going on
         the stack, illegal target, shroud, Acidic Slime forced onto its controller's land, Gravedigger with no target
         and "may" both ways, Banshee draw, Visionary on an empty library, Howling Mine (its own, the opponent's,
         tapped, first turn, Shattered in response), Ball Lightning (sacrificed, Unsummoned, put in by Elvish Piper in
         the end step), Bramble Creeper; unit tests for creatures entering together, the repeat, cancel dropping
         triggers, a Mine tapped before resolution, the no-pending-while-priority invariant.
     - Future impact: replacement effects (M2-08) sit before detection, so a replaced event triggers as replaced;
       delayed triggers and "until" durations share the turn's step hooks; tokens (M2-11) entering trigger the same
       way; copies of abilities and "trigger an additional time" fit the pending list.
  5. Now: M2-08 replacement and prevention effects (CR 614–616; m2-rules-depth.md). 19 cards. Plan (2026-11-20, with
     the advisor's review), in five PRs. Three later cards shape the data now: Clone (M2-14, a copy as it enters,
     CR 616.1c), Protean Hydra (M2-10, a prevention that removes counters), Magebane Armor (M2-12, a granted
     noncombat-damage prevention).
     - M2-08a: done, merged (PR #45, D-085). 18 scenarios in `test/scenarios/cards/m2-08a/`, a unit test for lands entering together
       (`test/pipeline/replacements.test.ts`), an Indestructible matrix row, three golden games; the Magic 2010 decks
       run checklands. 158 cards; 150 of the 234 Magic 2010 cards. As built, unlike the plan below: one replacement per
       event, refusing two (CR 614.5 and 616.1f come with M2-08c's choice), and `autoPay` stays greedy (lands first,
       then fewest choices; no search). Owner (2026-11-20): carry on with M2-08b once this PR merges. Plan as made:
     - M2-08a, the framework, no player choice: replacement effects as data, applied in `pipeline/happen.ts`'s
       `replace` to each event against the state before its batch, each at most once per event
       (CR 614.5), the result replaced again (CR 616.1f). Until M2-08c, `replace` throws if two different effects
       apply to one event; it never picks. Where they come from: a permanent's static replacement on the battlefield,
       and the moving object's own (CR 113.6: Colossus from hand, library or stack; a land "as it enters", CR 113.6h,
       614.12, read as it would exist on the battlefield). A "the zone change this event makes" helper that changes
       the destination, not the action: a sacrificed, discarded or countered Colossus was still sacrificed, discarded
       or countered (check the CR and rulings; Xathrid Demon, Vampire Aristocrat's cost, `ifNothingSacrificed` and
       Megrim depend on it). Cards: Darksteel Colossus (indestructible, CR 702.12: `destroy` does nothing, and lethal
       damage and deathtouch, CR 704.5g–h, aren't listed, D-039; "if it would be put into a graveyard from anywhere,
       reveal it and shuffle it into its owner's library instead"); the five checklands ("enters tapped unless you
       control a [type] or a [type]", land types read through `characteristics()`, Convincing Mirage later), with
       "{T}: Add {G} or {W}": the color carried on the action as for any color (D-068) but limited to two, and
       `autoPay` searching sources once one offers a restricted choice (D-068 said it would need to).
     - M2-08b: done, merged (PR #46, D-086). Built: 23 scenarios in `test/scenarios/cards/m2-08b/`, unit tests
       (`test/permanents/regeneration.test.ts`, with CR 614.17c on a test-only indestructible wall;
       `test/effects/reveal-until.test.ts`), a Regeneration matrix row, two golden games. 163 cards; 155 of the 234
       Magic 2010 cards. Next: M2-08c, the CR 616.1 choice (plan below).
       Design (as planned; CR 614.17c is the unit test above, not a Colossus scenario):
       - `GameState.replacements` (the list architecture.md plans): replacement effects made by resolving spells and
         abilities, here `{ kind: "regenerationShield", object }`, all "this turn": emptied in cleanup with the
         continuous effects (CR 514.2). Made by the op `regenerate` (of: a subject), outside the pipeline like
         continuous effects; making one isn't regenerating (CR 701.19c).
       - `replace` gathers a destroy's candidates from the event, not only the moving card's own text: the object's
         shields, unless the destroy says it can't be regenerated (`destroy` op and event `noRegeneration`, CR
         701.19c). Several shields of one object are interchangeable: one is used, unasked (like D-077). A shield and a
         different replacement on one destroy still refuse until M2-08c.
       - The destroy becomes a `regenerate` event, performed whole (CR 701.19a): the shield used up, all damage removed,
         tapped by its controller, removed from combat (`Combat.removed`, CR 506.4; `rules/combat.ts` reads it). Events:
         `PERMANENT_REGENERATED`, then `DAMAGE_REMOVED` and `PERMANENT_TAPPED` as they happen. Lethal damage and
         deathtouch destroy, so they're regenerated (CR 704.5g–h); sacrifice and toughness 0 aren't destruction.
       - Polymorph: `destroy` with `noRegeneration`, then `revealUntil` (who: the target's controller, a new subject
         `{ controllerOf: { target: 0 } }`, read from last known information if it's gone, CR 608.2h; filter: a
         creature card) making the card `found`, `put` it onto the battlefield under that player, then that player
         shuffles; revealed cards never leave the library. The reveal happens even if the creature isn't destroyed
         (its ruling); an illegal target means nothing happens (CR 608.2b).
       - Tests: each card's basic use; regenerating in combat (a blocker regenerated: the attacker stays blocked, no
         trample, deals no damage to the player; an attacker regenerated after first-strike damage deals no regular
         damage); a shield unused ends in cleanup; two shields, one used; sacrifice not replaced; deathtouch;
         Polymorph on a shielded creature, on Darksteel Colossus (not destroyed, still reveals), with no creature card
         left; CR 614.17c: Regenerate on Darksteel Colossus, then Doom Blade: the shield is still there.
       - Future impact: M2-08c's choice between a shield and a "would die" replacement; static regeneration
         (CR 701.19b) and "can't be regenerated" as a continuous effect later; `Combat.removed` serves "remove from
         combat" effects and control changes later.
     - M2-08b, regeneration (CR 701.19, 614.8), with a scenario for CR 614.17c (an indestructible creature's
       destroy never uses up its shield; `happen.ts` cites it as later until then): a shield in state bound to one object, used once, the next time it would
       be destroyed this turn (destroy, lethal damage, deathtouch; not sacrifice): instead tap it, remove its damage,
       remove it from combat (a recorded removed-from-combat set, CR 506.4, which future-rules asks for). Identical
       shields are used unasked (like D-077). "Can't be regenerated": the shield isn't applied (CR 701.19c). Cards:
       Drudge Skeletons, Wall of Bone, Cudgel Troll, Regenerate, Polymorph (its reveal happens even if the creature
       isn't destroyed: its ruling).
     - M2-08c: done, merged (PR #47, D-087). Built: `happenOrAsk`, the `chooseReplacement` decision and its plumbing (legal
       actions, view, CLI action lines and describe, scenario `choose:` "regeneration" or a card's name, export), unit
       tests in `test/pipeline/replacement-choice.test.ts`, an import guard. Next: M2-08d.
       Design, with the advisor's review:
       - `happenOrAsk`: like `happen`, but when the affected player (or the affected object's controller, CR 616.1)
         must choose between two different replacement candidates, it performs nothing, sets a `chooseReplacement`
         decision, and queues a `resumeEvent` work item holding the proposed event and the choices so far. On the answer,
         `replace` runs again from the top with the choices in order; nothing was performed, so the state is as it
         was, and the others are checked again after each (CR 616.1f; CR 614.5 later). Several players choose in APNAP order (CR 616.1).
         Candidates are named by stable references (`{ kind: "ownText", object, index }`, `{ kind:
         "regenerationShield", object }`). Identical candidates aren't asked about (D-086).
       - Only callers that do nothing after the event may pause: a resolving effect's damage and destroy
         (`run-effect.ts`, one work item per effect) and combat damage, which queues its priority before the event. A
         test checks no other file imports `happenOrAsk`; plain `happen` still refuses a choice (unreachable with the
         pool: only damage, from these two places, can meet two effects; Homing Bear's tests use a destroy spell).
       - Applying candidates in order rebuilds the event: a replacement that swaps the core event for another
         (regeneration) drops what earlier ones added around it (CR 614.6: a replaced event never happens). Homing
         Bear (test-only: "would be put into a graveyard ... library instead") with a regeneration shield on one
         destroy: shield first, it regenerates; library first, it's still a destroy, so the shield then applies
         (CR 616.1f) and it regenerates, with no reveal or shuffle.
       - Plumbing: the decision kind in `legalActions`, the view, the scenario syntax, the CLI's action lines, the
         fuzz picker, and `DECISION_KINDS` with a reason until M2-08d's cards reach it.
       - Future impact: Clone's "as it enters" (M2-14) is a choice pausing a zone change from `resolve.ts`, not built.
     - M2-08c, the CR 616.1 choice, no pool cards: superseded by the design above (D-087). The M2-03 review's cases are
       in Open questions; only the Homing Bear one (regeneration and a "would be put into a graveyard" replacement on
       one destroy) is tested now.
     - Now: M2-08d (2026-11-20), in two PRs. M2-08d1 built (D-088): Fog, Safe Passage, Guardian Seraph; 11 scenarios in
       `test/scenarios/cards/m2-08d/`; two golden games. 166 cards; 158 of the 234 Magic 2010 cards. Mutations (6/6
       caught) and a 200-game fuzz are clean; both reviews found no wrong result. Their findings are fixed (dbade33,
       21 scenarios now; a second mutation pass caught 6/6 after one test was tightened). Merged as #48. The new effect
       ids changed no golden log: pool-181 casts Fog as its last action, and no later id shows.
       What the fixes were:
       - Bug: identical candidates (two Seraphs) beside a different one (Fog) are offered as separate options. Group
         candidates by identity: one option per group, all its members applied when chosen.
       - A choice's `for` becomes a union (an object, or a damage entry by its index in the event, source and
         recipient), so the CLI can say which damage is asked about; `affectedKey` becomes a switch.
       - Tests: Seraph against two attackers (per-entry choices, CR 615.10), the creature chooser and APNAP across
         entries, partial prevention with lifelink and a damage trigger, Fog with first strike and deathtouch, Fog
         ending at cleanup, Safe Passage after damage, sharper Seraph-and-Fog expectations.
       - State effect ids from `newObjectId`, the op moved to `effects/prevention.ts`; entries that can't be dealt
         damage dropped before prevention (shields must not be used up by them, CR 609.7b); drop the unread
         `fromOpponents`; one engine helper naming a state effect's card; citations (CR 120.2b); stale docs.
       - Damage is replaced per recipient: a `dealDamage` event's entries (one per source and recipient) each get their
         own candidates and their own chooser, the recipient player or the recipient object's controller (CR 616.1).
         Choices become `{ for, ref }` (`for`: an object, or a damage entry), so a global effect's choice for one recipient isn't used for another
         (the M2-08c review). A prevented entry shrinks or goes; lifelink and "deals damage" triggers see what's left
         (CR 615.6, 120.4c). State-held effects get an `id` (two Fogs differ, D-088).
       - M2-08d1: Fog ("prevent all combat damage that would be dealt this turn"), Safe Passage ("all damage that would
         be dealt to you and creatures you control this turn", creatures arriving later too: its ruling), both kept in
         `GameState.replacements` until cleanup; Guardian Seraph ("if a source an opponent controls would deal damage to
         you, prevent 1 of that damage"; a source without a controller counts by its owner: its ruling; several add up), the first
         replacement read from another permanent's text on the battlefield, not the moving card's. Choices arise
         (Seraph with Fog or Safe Passage), though the result is the same; asked anyway (CR 616.1), skipping a choice
         whose outcome can't differ being a later UX question.
       - M2-08d2, Harm's Way: built twice and reverted (1c4fcda, 93f2c4d, 6fd7c9e; reverted in 98b08ed); the owner left
         it out of the pool (D-090, which records what the rules reviews found and what a correct model needs).
       - Golden cover: `chooseReplacement` becomes required once Seraph meets Fog or Safe Passage in agent games, or
         a deck runs both.
     - M2-08d, prevention (CR 615), two shapes in state: a filter checked as each event happens (Fog: all combat damage
       this turn; Safe Passage: you and your creatures, those arriving later too: its ruling), and a static (Guardian
       Seraph: 1 from a source an opponent controls); Harm's Way's "the next N" redirection is left out (D-090). Lifelink and "deals damage" triggers read the damage as dealt after prevention (CR 120.4c).
     - M2-08e, protection (CR 702.16, D-074: damage prevention, targeting, blocking; "can't be enchanted" in M2-12),
       reading the source's characteristics, from last known information if it's gone (snapshot `characteristics()`,
       future-rules): White Knight, Black Knight, Baneslayer Angel (from Demons and from Dragons), Great Sable Stag
       (from blue and from black; "can't be countered", CR 101.2, 113.6g: a counter effect does nothing to it, and
       it's still a legal target).
       Built (D-091): White Knight, Black Knight, Baneslayer Angel, Great Sable Stag; 11 scenarios in
       `test/scenarios/cards/m2-08e/`, a unit test for a source that left; golden pool-197 and pool-537. 170 cards;
       162 of the 234 Magic 2010 cards. Mutations 7/7, fuzz clean, reviews (no wrong results) fixed in e5d7287:
       15 scenarios, unit tests in `test/rules/protection.test.ts`, protection in the interaction matrix. PR next, with
       the M2-08d docs; then M2-09 (layers). Merged as #49.
     - Now: M2-09, the full layer system (CR 613, 604, 611), 24 cards, in three PRs. Plan (2026-11-20):
       - M2-09a, the board-wide layer pass and anthems: `rules/layers.ts` computes every object's characteristics once
         per state, layer by layer (CR 613.1), each continuous effect with its timestamp (CR 613.7) and its affected set
         fixed in the first layer it applies in (CR 613.6); static abilities' effects find their set as they apply
         (CR 611.3a), resolved effects keep theirs (CR 611.2c). The per-layer readers (`controllerOf`, `cardTypesOf`,
         `colorsOf`, `keywordsOf`, `protectionsOf`, `staticAbilitiesOf`, `powerAndToughness`) read it, so callers don't
         change. Memoized per state object if the benchmark asks (architecture.md). Layer 6 grants keywords, layer 7c
         adds. Cards: Honor of the Pure, Veteran Armorsmith, Veteran Swordsmith, Elvish Archdruid, Merfolk Sovereign,
         Goblin Chieftain, Rhox Pikemaster, Levitation, Coat of Arms, Relentless Rats; Glorious Charge, Overrun,
         Trumpet Blast, Kindled Fury, Jump, Burst of Speed. A CR 613.8 dependency example as a unit test.
       - Step 1 done (D-092): the readers read one pass in `rules/layers.ts`, no behavior change (no golden log
         changed), kept per its inputs; a fuzz check compares it with a fresh pass. A random game is 98.5 ms against
         its 100 ms budget (61 before): watch it as the slices add layers.
       - Paper review of the pass (rules-judge, 2026-11-20): boards A-E right; no same-layer dependency in the pool, nor
         a case where timestamp order or CR 613.6 is visible (so they're unit tests on test effects, or `later:`).
         Needs: CDAs work in every zone (Nightmare in hand), so the per-card cache for other zones and the "no printed
         P/T" early return go (base from 7a/7b, else printed, at the start of layer 7); locked sets (CR 611.2c) are
         found from fully computed characteristics as the effect begins, and stay on an object that stops being a
         creature; "for as long as" durations tied to an object (Awakener Druid; none made if it's gone, CR 611.2b);
         Rise from the Grave's effect made with the move, on the new id (CR 611.2e), "under your control" is the
         stored controller, not layer 2; layer 2 inside the pass before the rest, every "you" read after it; a
         changed controller removes a creature from combat (CR 506.4); Coat of Arms counts creature types only
         (CR 205.3m: subtypes are one flat list today); Silence and Spellbook stay out of the pass (CR 613.10-11);
         drop "attacking" from the pass (no static reads it; it would need combat in the inputs). Last known
         information must be the computed characteristics, snapshotted as it leaves (CR 608.2h): Polymorph on a
         stolen creature, Inferno Elemental risen black against White Knight, Stone Giant's power. The judge's
         scenario list is in its report; the ones for each slice are written with it.
       - Step 2 done (D-093): 16 cards (Honor of the Pure, Veteran Armorsmith, Veteran Swordsmith, Elvish Archdruid,
         Merfolk Sovereign, Goblin Chieftain, Rhox Pikemaster, Levitation, Coat of Arms, Relentless Rats, Glorious
         Charge, Overrun, Trumpet Blast, Kindled Fury, Jump, Burst of Speed); 16 scenarios in
         `test/scenarios/cards/m2-09a/`; the Anthems row of the interaction matrix; golden pool-329 and pool-685. 186
         cards. Mutations 10/10 (two scenarios strengthened), fuzz 200 clean. Code review (no wrong results) found, to
         fix with the rules review's findings: the cache key misses the rule modifiers (reproduced: a pass kept across
         a changed modifier); a bad anthem filter throws inside the pass (definition check, and `creaturesGet` should
         require creatures itself); `fitsOnBoard` duplicates `matchesFilter` (extract a pure core); `controllerOf`
         and `Layered.controller` are two sources (a fuzz check now; layer 2 and the signature change in 09c, as
         Mind Control in M2-12 needs the card database); the `alone` cache is outside the safety check (replace it);
         no tests of the memo itself; benchmarks time only cache hits (add a fresh-pass measure); stale reader
         comments and docs (future-rules, architecture.md, rules README); `inspect` doesn't say where a granted
         keyword came from; scenario gaps (Coat of Arms across players, Levitation not on p2's creatures, effects
         ending at cleanup, Archdruid and auto-pay, Anthems with protection and shroud). Rules review (no wrong
         results): `jump.yaml` and `levitation.yaml` pass without the grant (try a block); CR 613.6 is built (test it
         with a test def, drop `later:`); CR 613.7 and 205.3m are cited as built but aren't (`later:`); cite CR 611.3c;
         Trumpet Blast cites 506.4 (its duration is 611.2a); Elvish Archdruid makes `manaAvailable` undercount X; more
         scenarios (Jump after blocks and at cleanup, Kindled Fury after first strike, Trumpet Blast by the defender and
         before combat, Merfolk Sovereign on an opponent's Merfolk and after blocks, Coat of Arms across players, two
         Coats, Relentless Rats becoming lethal, Archdruid and Pikemaster only yours, Burst of Speed and a tap ability,
         Overrun and a later creature, Glorious Charge on Black Knight, Overrun on Mist Leopard).
       - Review fixes, part 1 (c804684): the cache key with the rule modifiers and a unit test; one filter core
         (`filter-fit.ts`); `creaturesGet` requires creatures and the definition check refuses combat in static
         filters; the `alone` cache replaced by `elsewhere` in the kept pass; CR 613.6 unit-tested; `later:` for 613.7
         and 205.3m; `inspect` names a grant's source; the scenarios both reviews asked for (34 in `m2-09a/`).
         Part 2: Elvish Archdruid counted by `manaAvailable` (scenario `elvish-archdruid-x.yaml`); the
         `layers.freshPass` measure; docs (D-092, architecture.md, future-rules, rules README, reader comments); a
         random game back from 103 ms to 82 ms (D-092: printed values shared, basic land abilities made once, legal
         actions ask only the player's permanents), baseline updated. Code review of part 2 (no wrong results): freeze
         the shared starts and basic land abilities (the fresh pass shares them), one usable-mana-ability search and
         one count for `manaAvailable` and auto pay, a payable Archdruid X and an "only yours" scenario, doc wording,
         `later: CR 602.2` on the controller pre-filter; all fixed (4feab84). Fuzz 200 + 150 clean. Merged as #50.
         Next: M2-09b.
       - M2-09b, split in two PRs (2026-11-21). Plan for b1, characteristic-defining abilities (CR 604.3, 208.2a,
         613.4a): Nightmare, Serpent of the Endless Sea.
         - Printed power and toughness may be `"*"` (`printed.ts`); a card with one must have a CDA (definition check).
         - A static ability `powerToughnessEachEqual { to: { count: filter } }` ("power and toughness are each equal to
           the number of [filter] you control"), applied in layer 7a for its own object in every zone (CR 604.3): the
           base is the CDA's value, else printed; 7c adds as before. "You" is the controller, or the owner elsewhere
           (CR 108.4a, 109.5). The count is read from the board as layers 1-6 left it (`fitsOnBoard`); a CDA's filter
           can't read combat (definition check), nor power or toughness (`ObjectFilter` has no such field). A card outside the battlefield and the
           stack is computed with the board, so Nightmare in hand is X/X (its ruling).
         - `cantAttackUnlessDefenderControls { filter }` (Serpent; CR 508.1c), checked per attacker and defending player
           in `possibleAttacks`.
         - Scenarios: Nightmare's P/T as Swamps come and go, a nonbasic Swamp (a checkland? no: Swamp subtype only on
           basics in the pool, so basic Swamps), 0 Swamps dies (SBA), in hand (inspect/characteristics), only yours,
           with an anthem; Serpent can't attack without a defending Island, can with one; Serpent dies with 0 Islands.
         - Future impact: 7b (Awakener Druid, b2) sets base P/T after 7a in timestamp order; tokens' CDAs come from
           their creating effect (CR 604.3a); a CDA counting creatures by power would need dependency (CR 613.8).
         - b1 built (D-094): Nightmare, Serpent of the Endless Sea; 8 scenarios in `test/scenarios/cards/m2-09b/`
           (Nightmare growing and dying, a pump keeping it alive, in hand and graveyard; Serpent's restriction, its
           count, and Alluring Siren), unit tests for the printed "*" and the definition checks, `inspect` showing
           7a, the Defined P/T column of the interaction matrix, golden pool-231. 188 cards. Mutations 5/5, fuzz 200
           clean. Rules and code reviews (no wrong results): 5 more scenarios (stack, opponent's hand, Coat of Arms,
           damage as it shrinks, Siren when able; 69e40a2); `Layered.base` records 7a's base so `inspect` doesn't
           subtract (7b will set it); both printed P/T must be "*"; stale comments, the 508.1c message, a tripwire on
           `ObjectFilter`, docs (future-rules, card-scripting, rules README). Bench baseline rewritten: the busy-board
           measures take their states from the golden games, which now include pool-231, so `legalActions.busyBoard`
           measures different boards (+12-23%); a random game (fixed decks) is about 3-7% slower, `layerSeven`
           recording the base (main 80 ms, this branch 86 ms standalone, under the 100 ms budget). Merged as #51.
         b2, split again (2026-11-21). Plan for b2a, type, color and setting effects (CR 613.1d-e, 613.4b, 611.2b,
         611.2e, 205.1b): Awakener Druid, Rise from the Grave.
         - A continuous effect change `becomes { addTypes, addSubtypes, colors?: {set}|{add}, setPT? }`, one effect
           applied in each layer it touches (CR 613.6): types and subtypes added in layer 4 ("still a land", "in
           addition to its other types", CR 205.1b), colors in 5, base power and toughness set in 7b after 7a. Within a
           layer, effects apply in timestamp order (CR 613.7), which is `state.effects`' order (each new one is later).
         - Durations: "endOfTurn", "endOfGame" (no duration stated, CR 611.2a: Rise), and "whileSourceOnBattlefield"
           ("for as long as this creature remains on the battlefield": the effect ends as its source leaves, in
           `moveCard`, with EFFECT_ENDED; none is made if the source is already gone, CR 611.2b).
         - Layer 7 for a land that becomes a creature: P/T from 7b although none is printed (the early return goes).
         - Rise from the Grave: `putOntoBattlefield` from a target card in a graveyard, under "your" control (the stored
           controller), with characteristics it has as it enters (CR 611.2e): the effect is made with the move, on the
           new object (CR 400.7), its timestamp after the object's (CR 613.7n).
         - Scenarios: the Druid's Forest is a 4/5 green Treefolk land creature that still taps for {G}, reverts when
           the Druid leaves (and leaves combat, CR 506.4), nothing if the Druid left first (611.2b), an opponent's
           Forest, a Forest that entered this turn is summoning sick, a pump on 7b; Rise: a black Zombie under your
           control, colors added (Ornithopter becomes only black, its ruling), Doom Blade can't target it, it goes to
           its owner's graveyard. New expectations `.colors`, `.types`, `.subtypes`.
         - Not built: subtypes by kind (Coat of Arms counting only creature types, CR 205.3m): no pool pair shows it
           (an animated Forest and another creature share no land type), so it stays `later:`.
         - Future impact: control-changing effects (M2-09c) join the pass as layer 2 the same way; Auras' and
           Equipment's statics (M2-12) set or add in these layers too; tokens (M2-11) are made with characteristics
           like Rise's.
         - b2a built (D-095): Awakener Druid, Rise from the Grave; 12 scenarios in `test/scenarios/cards/m2-09b2/`, a
           unit test for CR 613.7n, `.colors`/`.types`/`.subtypes` expectations, `inspect` and the log showing 7b,
           the Becomes column of the interaction matrix, golden pool-563 and pool-655 (no old one changed). Layer 7
           moved to `rules/layer-seven.ts`. 190 cards. Mutations 6/6 (one after a unit test of 7b's order, 106245b).
           Rules and code reviews: one wrong result, found by both: a Forest removed from combat came back when a
           second Druid animated it again (CR 506.4); now recorded in `Combat.removed` as it happens, scenario
           `awakener-druid-recombat`. Also fixed: "is" applies as the card enters, before triggers (CR 611.2e, `put`'s
           `is`, `putTargetOntoBattlefield` dropped); a creature with no P/T is 0/0 (CR 208.5); unit tests for
           timestamp order in layers 5 and 7b; 8 more scenarios (no Forest, sick Forest can't attack, a blocking
           Forest, Earthquake killing both, Undead Slayer and the Zombie, a noncreature target, statics after layers
           4-5, colors after death); citations, stale comments and READMEs. A re-check: a blocker staying out of
           combat (`awakener-druid-reblocker`), D-095 corrected for tokens. Fuzz 3×200 clean. Merged as #52.
         b2b: Stone Giant (a target compared with the source's power; a delayed trigger that remembers "that
         creature", CR 603.7c) and last known characteristics snapshotted as an object leaves (CR 608.2h).
       - M2-09b, characteristic-defining and setting effects, type and color: 7a (Nightmare, Serpent of the Endless Sea
         and its attack restriction), layers 4, 5 and 7b with "for as long as" (Awakener Druid), Rise from the Grave,
         Stone Giant (flying, then a delayed destroy).
       - M2-09c, control and rules effects: layer 2 (Act of Treason; `controlledSinceTurnStart` becomes a record that
         sees control change, future-rules), "can't cast spells" (Silence, CR 101.2), no maximum hand size (Spellbook).
       - Future impact: copies (layer 1) and text changes (layer 3) slot into the pass; tokens (M2-11) need a
         characteristics source beside the card database; counters (M2-10) stay in 7c; Auras and Equipment (M2-12)
         are statics on the attached object, affecting the one they're attached to.
       Plan (2026-11-20):
       - `CardDef.protections: ProtectionQuality[]` (a color, or a subtype like Demon), one per "from" (CR 702.16g),
         read through `protectionsOf` (layer 6, like `keywordsOf`); `rules/protection.ts`: `isProtectedFrom(state,
         protected, source)`, reading the source's colors and subtypes as it is, or as it last existed if gone
         (printed values: nothing changes colors or types yet). A subtype counts for permanents with it and for
         sources not on the battlefield with it (CR 702.16a).
       - Targeting (CR 702.16b): `legalTargets` drops a permanent protected from the targeting spell, or from an
         ability's source; checked again on resolution (CR 608.2b), so gaining protection makes it an illegal target.
       - Blocking (CR 702.16f): `canBlock` refuses a blocker with the quality.
       - Damage (CR 702.16e): a "prevent all" candidate in `damage-replacements.ts` for damage to a protected
         permanent from a source with the quality; like the others, asked about when another applies too (D-088).
       - "This spell can't be countered" (Great Sable Stag): a counter does nothing to it (CR 101.2, its ruling);
         the spell is still a legal target, and the counterspell's other effects happen.
       - Cards: White Knight, Black Knight, Baneslayer Angel, Great Sable Stag. Scenarios per CR line and ruling, plus
         negatives (other colors, a protected creature still blocking, a gone source's last color).
       - Future impact: protection from players, from everything (CR 702.16j-k), Auras/Equipment (M2-12) and
         granted protection (layers, M2-09) read `protectionsOf`; the source's characteristics move to snapshot
         `characteristics()` when effects can change them.
     - Visibility: shields and prevention effects in state are public and end at cleanup: shown in `playerView` with
       the delayed triggers (Known issues), or added to that issue.
     - Future impact: "if you would draw" needs the draw-several container (D-060, CR 121.2a), when a card needs it (none
       in Magic 2010); copies entering (Clone) are a CR 616.1c choice in the same machinery; layers (M2-09) granting or
       removing replacement abilities read them through one function; tokens (M2-11) use the zone-change helper.
## Handoff notes
- After merging a PR, restart the branch with `git checkout -B <branch> origin/main` and then push with
  `git push -u origin <branch>`: `checkout -B` from `origin/main` makes `main` the upstream, and a plain `git push`
  then fails (it did once; nothing reached `main`).
- Commit only when `pnpm check` exits 0: run it into a log file, use its exit code, never pipe its output through
  `grep` (a red commit went in that way). Edit scripts must fail loudly when a replacement doesn't match.
- **Owner's preference (2026-11-20):** keep looking for ways to speed up iteration, so features land quickly while
  staying accurate and high quality. Slow spots seen so far, to work on as they bite: the 300-game fuzz (about 10
  minutes, one process: could run seeds across worker processes), `golden:cover` (plays up to 800 candidate games:
  could stop at the first game covering each missing unit), the mutation pass (a vitest run per mutant: could run only
  the engine and scenario projects, already done), and reviews waiting on each other (run mutations, fuzz and reviews
  at once, but never edit while mutating).
- **Owner's instruction (2026-11-20):** continue all the way to the end of M2; the owner won't be available much.
  For a decision that needs the owner, notify them with suggestions to choose from, and meanwhile carry on with the
  recommended option (recorded in Open questions, marked "proceeding with ...") so work doesn't stall.
- **Owner's standing instruction (2026-11-19):** keep working through milestone 1, task after task, without waiting for
  a go-ahead. Stop only for a decision that needs the owner (put it in Open questions and ask). Merge each PR once it
  checks out (D-027), restart the branch from `main`, then start the next task.
Anything the next session (or the session after a compaction) needs to pick up the current task:
the plan, what's done so far, what's tricky, what was about to happen next.
- Claude Code on the web: the cloud environment "open-mtg-arena" allows `magic.wizards.com` and `media.wizards.com`.
  Node's `fetch` there only uses the proxy with `NODE_USE_ENV_PROXY=1`, for example
  `NODE_USE_ENV_PROXY=1 node scripts/fetch-rules.mjs`.
- Local setup: Node 26 (`.nvmrc`) and pnpm 10.34.9 (`packageManager`). The "open-mtg-arena" environment's setup
  script installs both into `/opt/node26` and runs `pnpm install`. Shells there start on an older Node, so run
  `export PATH=/opt/node26/bin:$PATH` before `pnpm` commands.
- `pnpm check` is typecheck + lint + tests, which include a short fuzz (seeds 1 to 6, M1-18), the saved replays and
  the golden games. The coverage check joins in M1-19's second PR.
- Scenarios: write new rules tests as YAML in `packages/engine/test/scenarios/<area>/` (testing.md). Extend the runner
  (`packages/scenarios`) and testing.md together when a task adds steps (`play`, `cast`, `activate`, `attack`, `block`).
  The M1-07 stack tests (TypeScript) become YAML scenarios once `cast` exists (M1-09).
- Work queue (D-032): new pauses mid-step (M1-13's attackers and blockers) become work items, like `finishCleanup`.
  `waitFor` throws if a decision is already pending, so a chain can't silently replace one.
- Effects (D-036): test CR 608.2m (a spell that leaves the stack mid-resolution) once an effect can move one. A new op
  goes in `effects/run-effect.ts` and the table in `effects/README.md`.
- Characteristics (D-038): read power, toughness and keywords through `characteristics()` or the per-layer readers
  (`powerAndToughness`, `keywordsOf`, `supertypesOf` for the legend rule, CR 704.5j).
  An effect whose `affected` objects are gone stays until cleanup and does nothing (their ids never come back, CR 400.7).
- Casting, playing a land and activating any ability reset `passesInSuccession` (CR 117.4); cancelling doesn't.
- State-based actions (D-039) run in `givePriority` and the cleanup step's check, never between work items. A new SBA
  is one case in `rules/state-based-actions.ts` and two in `game/state-based-actions.ts` (`lossFrom`,
  `performOnObject`). The repeat of the check (CR 704.3) has no test: nothing in the pool makes one SBA cause another.
  The first card that can (an anthem, a lord) should add one. One that needs a choice
  (the legend rule, CR 704.5j) can wait for it, since a performed check re-queues `givePriority`.
- Combat (D-040): engine tests that pass through combat with creatures must answer `declareAttackers` and
  `declareBlockers` (the turn tests' `playUntilTurn` declares nothing).
- Engine test helpers (`test/support/game.ts`) check invariants on every state and only take actions from
  `legalActions`. Use them in every new engine test. Never name a module export `then` (Vitest treats the module as a
  promise).
- Scenarios the M1-04 rules review asked for, to write in the task that implements each rule:
  M1-08: a Mountain taps for {R} without using the stack (CR 305.6, 605.3b); Llanowar Elves is a mana ability (CR 605.1a)
  and can't be activated while summoning sick (CR 302.6). Also compute mana value from the cost (CR 202.3) and check it
  equals Scryfall's `manaValue` for every pool card. M1-09: Lightning Bolt can't target a land, can target your own
  creature and yourself (CR 115.4); Giant Growth can't target a player (CR 109.2). M1-11: Giant Growth wears off in
  cleanup (CR 514.2). M1-14: firebreathing uses the stack (CR 602.2), stacks three times (CR 613.4c), and resolves after
  the Whelp dies without affecting anything (CR 113.7a, 400.7, 611.2c).
- Done in M1-08 (`mana/elves-still-sick-on-opponents-turn.yaml`). A settled CR 302.6 edge case: a creature that entered on its controller's
  last turn is still summoning sick on the opponent's turn (Llanowar Elves can't tap for mana there), and isn't on
  its controller's next turn.
- Activated abilities (D-041): a stack object is a spell or an ability; read its targets and effects with
  `targetSpecsOf` and `effectsOf`, never from a card directly. No last-known-information store yet (future-rules.md).
- When M3 adds `apps/web`: add `apps/*` to `pnpm-workspace.yaml`, the Vitest projects and the tsconfig include.
- The engine's step names follow the CR (`precombatMain`, `declareBlockers`, see `engine/src/state/turn.ts`).
  `testing.md`'s scenario YAML uses short names (`main1`, `combat.declareBlockers`); the M1-16 runner maps them.
- `main` was created from `claude/eloquent-mayer-qcx0e1` at the owner's request and is now the default branch
  (2026-11-19). From now on, work reaches `main` only through pull requests.
- The "open-mtg-arena" environment also allows Scryfall (`api.scryfall.com`, `data.scryfall.io`). `pnpm cards:fetch`
  passes `--use-env-proxy` itself, so it works behind the proxy with no environment variable.

- CLI (D-043): run games with `pnpm cli` to check behavior by hand (CLAUDE.md step 4): `new --scenario <name>` or
  `--decks`, then `do`, `show`, `log`, `inspect`; `export --scenario` turns a path into a scenario.
- For M1-18: reuse the CLI's agents (`chooseAction`, `playAgents`), `deckGameSetup` and the game file (the failure
  log is a game file, so `pnpm cli replay` opens it). Conceding isn't in `legalActions` (D-042), so the fuzzer never reaches a state after a concession; only
  the game-end scenarios check those. The fuzzer could concede now and then, with a small probability.

## Next up
- After the owner tags `m1`: M2 rules depth (`docs/milestones/m2-rules-depth.md`), starting with M2-01 (the
  hidden-information fix) and M2-02 (the Magic 2010 pool and its mechanics map).

## Done
- Starter docs, Claude Code config and rules scripts added (2026-11-19).
- M1-02 Rules files: `rules/` generated from the CR effective November 6, 2026 (148 sections, 744 glossary terms);
  `rule.mjs 601.2` spot-checked; 702 split into one file per keyword (2026-11-19).
- M1-01 Scaffold the monorepo: pnpm workspaces (`engine`, `cards`, `cli`, `ai`), strict TypeScript 7 with no build
  step (D-018), Vitest 5 with `unit`/`scenarios` projects, Biome 2, GitHub Actions running `pnpm check`,
  `pnpm cli --help`, and a `pnpm fuzz` stub (D-017) (2026-11-19).
- M1-03 Core types and state: `engine/src/state/` (ids, zones, objects, setup, decisions, actions, events, results,
  `GameState`) and `engine/src/rng/` (xoshiro128**, D-024), with type-level, JSON round-trip and known-answer tests.
  Reviewed by rules-judge and code-reviewer; D-020 to D-025 (2026-11-19).
- M1-04 Card data pipeline: `pnpm cards:fetch` / `cards:extract` (Scryfall bulk JSONL), `pool.txt` with the 17 M1
  cards, generated `data/pool.json` and rulings, the engine's card types (D-026), all 17 definitions, ability refs
  (D-028), printing choice for art (D-029), and tests for the pool, the errata check, matching and the parsers (2026-11-19).
- M1-05 Game start: `createGame` with setup validation, the random chooser for the starting player (CR 103.1), shuffling
  (CR 103.3), opening hands and CR 103.5 mulligans as decisions, fixed openings, `applyAction`/`legalActions` for these
  decisions, and the first turn (D-030) (2026-11-19).
- M1-06 Turn structure: the turn sequence as data and one step machine (D-031), every step's turn-based actions, the
  starting player's skipped first draw step (CR 103.8a), the combat skip (CR 508.8), mana emptying (CR 500.5), cleanup
  discard and damage removal (CR 514), passing priority with an empty stack (CR 117.3d, 117.4) (2026-11-19).
- M1-07 Priority and the stack: the work queue and `advance()` (D-032), resolving the top of the stack when all pass
  (CR 117.4, 608): abilities cease to exist, instants and sorceries to the graveyard, permanents onto the battlefield;
  priority to the active player after (CR 117.3b) (2026-11-19).
- M1-16 Scenario runner: `packages/scenarios` (D-033) runs YAML scenarios through `legalActions()`, checking expectations
  and invariants on every state; 16 scenarios for game start and turn structure; a test checks testing.md documents
  every word the runner knows (2026-11-19).
- M1-08 Mana and costs: abilities and mana abilities (CR 305.6, 605.1a), activating them with priority (CR 605.3),
  tapping, summoning sickness for {T} (CR 602.5a), payments checked all or nothing (CR 601.2h), `autoPay` (D-034), the
  runner's `activate` step, 8 mana scenarios (2026-11-19).
- M1-09 Playing lands and casting spells: land plays (CR 305), timing (CR 117.1a), casting as decisions with targets and
  payment (CR 601.2), cancelling reverses it (CR 734.1), CR 608.2b on resolution; the runner's `play` and `cast`; 4 land
  and 16 casting scenarios (D-035) (2026-11-19).

- M1-10 Effects interpreter v0: `effects/` runs `dealDamage`, `addMana` and `modifyPT` (CR 608.2c), all damage through
  `dealDamage` (CR 120), life loss (CR 119.3), continuous effects stored in `GameState.effects` (CR 611.2, 613.7b);
  targets checked once as resolution begins (CR 608.2b); mana abilities use the same interpreter; 7 effect scenarios
  and TS tests with made-up two-target cards (D-036, D-037) (2026-11-19).

- M1-11 Characteristics and layer 7c: `characteristics()` through the layers (CR 613), layer 7 with 7c effects,
  +1/+1 and -1/-1 counters and rule modifiers, no power or toughness for noncreature permanents (CR 208.3),
  "until end of turn" effects ending with damage in cleanup (CR 514.2); scenario `rules:` and `.power`, `.toughness`,
  `.abilities contains`; 6 characteristics scenarios (D-038) (2026-11-19).

- M1-12 State-based actions: CR 704.5a/b/f/g listed as data and performed together (CR 704.3), checked before every
  priority (CR 117.5) and in cleanup with another cleanup step when any happen (CR 514.3a); destroy (CR 701.8);
  players losing and the game ending with a winner or a draw (CR 104.2a, 104.4a); the runner's `winner`; 8 SBA
  scenarios and the CR 608.2b scenario (D-039) (2026-11-19).

- M1-13 Combat: declaring attackers and blockers as incremental decisions (CR 508.1, 509.1), summoning sickness and
  haste (CR 302.6, 702.10), flying and reach (CR 702.9, 702.17), combat damage with free division among several
  blockers (CR 510.1c) dealt at once (CR 510.2), `GameState.combat` for the combat phase; the runner's `attack`,
  `block`, `assign`; 23 combat scenarios (D-040) (2026-11-19).

- M1-14 Activated abilities: non-mana abilities go on the stack through the casting steps (CR 602.2), with targets,
  mana costs, cancelling and resolution from the source's card (CR 113.7a); firebreathing; the runner's `activate`
  with `targets` and `pay`; 8 activated-ability scenarios and TS tests with a targeted test ability (D-041)
  (2026-11-19).

- M1-15 Game end: conceding at any time (CR 104.3a) through the same `playersLose` as state-based losses; results with
  winner, losses and reasons, and turn; the runner's `concede`; 6 game-end scenarios (D-042) (2026-11-19).

- M1-17 Headless CLI: `new`, `show`, `actions`, `do`, `ai`, `auto`, `log`, `inspect`, `export --scenario`, `replay`;
  the game file (setup + actions, cached state); `first-legal` and `random` agents; the prebuilt decks; exported games
  pass as scenarios (D-043) (2026-11-19).
- M1 coverage gaps closed (D-050: a scenario or a unit test counts): 242 rules cited, 174 tested by scenarios, 68
  only by unit tests, 0 gaps, 50 mentions marked `later:`. New scenarios for the turn's steps, paying, land plays,
  the game ending mid-stack, priority after a resolution and tapped blockers; unit tests for the CR's definitions
  (2026-11-19).
- M1-19 Golden games, coverage report and benchmarks: four golden games with readable logs (D-047), `pnpm
  coverage:rules` with its check in `pnpm check` and the interaction matrix (D-048), `pnpm bench` against a baseline
  (D-049). Accepted: doubled mana shows in the golden diff; removing a scenario fails the coverage check; a slowdown
  fails the bench and five unchanged runs pass. Also the rules-judge M1 exit review of casting, priority, SBAs and
  combat: no rules errors for the pool (2026-11-19).
- M1-18 Fuzzer and replays: player views and event filtering (D-044), card ids numbered in a random order (D-045),
  `pnpm fuzz` with every check after every action and failures written as game files, a short fuzz in `pnpm check`,
  saved replays with `pnpm replays:update` (D-046). Acceptance: `pnpm fuzz --games 1000 --seed 1` clean (0 of 1,000
  failed, 26 minutes); mutants breaking views, events, life, zones and legal actions are caught. One known issue left
  for M2's start (Known issues: card tracking through hidden hands) (2026-11-19).

## Open questions for the owner
- (Asked 2026-11-21, D-092) CLAUDE.md says the engine has "no globals". The layer pass is kept in module-level
  `WeakMap`s (and a last-result value), outside the state, as architecture.md's "memoize per state object" allows: a
  kept result can never differ from a fresh one, and the fuzzer checks that after every action. Options: (a) read "no
  globals" as "no hidden state that can change a result", allowing these kept values (recommended; proceeding with
  this); (b) keep the pass inside a per-call context passed to every reader instead, a signature change across the
  engine; (c) drop keeping it, and accept a random game about five times slower.
- (Asked 2026-11-20, M2-09) The M2-09 spec asks for "at least one dependency example from the CR" (CR 613.8: within a
  layer, an effect that changes what another applies to goes first). No card in the pool, or in M2-09's 24, has two
  effects in one layer where that matters, so it would be machinery only test cards exercise. Options: (a) build
  timestamp order now and leave dependency for the first card that needs it, amending the spec's acceptance line
  (recommended; proceeding with this unless the rules review finds a pool pair); (b) build dependency now with a CR
  example on test cards, as the spec says; (c) build it with M2-14's special-rules batch.
- (Asked 2026-11-20, D-089) Does "modern Magic" mean the Modern format? `game:arena -is:alchemy -is:digital` keeps 13,036
  of 23,012 Modern-legal cards, and 51 keywords on 596 Modern-legal cards appear on no card it keeps (Echo, Dredge,
  Undying, Miracle, Level Up, Fear, Soulbond...; the list is in D-089). (Counts are under the earlier filter; the
  owner's final one, D-089, keeps 14,623.) Options: (a) the filter sets the order, not
  the boundary: Arena's mechanics first, then a later milestone for the Modern-only ones (recommended; nothing needs
  deciding before M3); (b) the filter is the boundary: those mechanics are never built; (c) the owner's final filter
  (`in:arena in:paper -is:alchemy`) already brings back the paper cards Arena had only in digital reprint sets, which
  was the third option first offered here.
- (Asked 2026-11-20, D-089) Magic 2010 cards still to script in M2-14 whose rules may have no counterpart on MTG Arena
  (Hive Mind, Telepathy, Warp World, Sphinx Ambassador's naming a card, Mirror of Fate, and any other M2-14 card): (a)
  check each against Arena when M2-14 starts and skip those whose mechanic no Arena card uses (recommended; proceeding
  with this), (b) script all of Magic 2010 as the spec says, (c) drop every Magic 2010 card not on Arena from M2 (51 of
  the 76 left, though their mechanics are on Arena).
- (Asked 2026-11-20) The M2 spec's M2-08 acceptance list includes three cases from the M2-03 review that no Magic 2010
  card can produce: a dying creature's replacement still applying to the others in its state-based-action batch
  (CR 704.3), a "would die" replacement with regeneration (testable now with a test-only card, done in M2-08c), and
  Worship-style damage results replaced as one event (CR 120.4c). The first and third would need replacement kinds
  written only for tests, which CLAUDE.md treats as speculative. Proposed: defer those two to the first card that
  needs them (noted in future-rules), and count M2-08 done without them. Options: (a) defer them (recommended;
  proceeding with this), (b) add minimal test-only replacement kinds to the engine to test them now, (c) drop them
  from the spec.
- (Asked 2026-11-20, D-087) A regeneration shield and a "would be put into a graveyard ... shuffle into library"
  replacement on one destroy, library one first: the shield still applies and the creature regenerates. Is the library
  still shuffled? (a) No: regeneration replaces the whole modified event, CR 614.6 (recommended; proceeding with
  this). (b) Yes: CR 701.24c shuffles even when the card stays where it is. No Magic 2010 card can reach this.
- (Asked 2026-11-20) The owner asked whether card definitions' raw strings (`op: "dealDamage"`, `step: "end"`...)
  should become enums. Recommended: no TypeScript `enum` (D-018 runs TypeScript by type stripping, and
  `erasableSyntaxOnly` refuses `enum`); the strings are already checked literal unions. Offered instead: named
  constants for whole phrases repeated across cards ("target creature", "until end of turn", "at the beginning of
  the next end step"), in one shared file. Waiting on the owner's answer.
- (Answered 2026-11-20, D-073–D-075: the golden budget raised, the four keywords with their first cards, Goblin
  Artillery's two losses kept.)
- (Answered 2026-11-20, D-078: Dragon Whelp counts an activation as it's activated, and checks the count as each
  activation resolves.)

## Known issues
- (2026-11-20, M2-08d rules reviews) Choices between prevention effects are asked per damage entry (D-088), which is
  finer than CR 616.1's "the way an event affects an object or player": with two attackers, Guardian Seraph and Fog,
  the player is asked once per attacker and can order them differently. Life totals can't differ with today's pool;
  only how `DAMAGE_PREVENTED` splits. Changing it reverses D-088; the owner left Harm's Way out (D-090), so it stays as built until a card needs it.
- (M2-07c2, M2-08b) `playerView` and `pnpm cli show` don't list waiting delayed triggers (`GameState.delayedTriggers`)
  or regeneration shields (`GameState.replacements`), though both players know of them (Dragon Whelp to be sacrificed
  at the next end step, Drudge Skeletons shielded). The match UI (M3) should show them.
- (D-083 review) A golden game's rejection names the action number (`!! action 78 is rejected`), not the stored line,
  and a run of passes folds many actions into one line, so finding it in the JSON takes counting. The decoder could
  report the line too.
- The golden folder's budget is 16 MB through M2 (D-081). With the compact encoding and the mechanics cover (D-082) it's
  1.7 MB for 152 cards, and grows with new mechanics, not new cards.
- (D-071) Two tramplers blocked by one creature (two Stampeding Rhinos into Palace Guard): the attackers' divisions are
  worked out one after the other, so the first can't count the second's damage toward lethal. The player can be dealt
  the same totals, but a split where both Rhinos trample over (2 and 2 each) can't be chosen; that matters only with
  lifelink or similar on a trampler. The CR checks the whole assignment at once (CR 510.1e): that needs a decision that
  can be taken back or checked as a whole (06c's take-back answer may serve).
- Fixed (PR #34, D-069): golden games grew by about 2 MB per M2 task; `pnpm golden:cover` now adds short games. The
  folder is 4.0 MB after M2-06d; the owner raised the budget to 8 MB for M2 (D-073).
- The bench drifted 10–29% over its baseline through M2-05–06b; reset in M2-06c (D-072), when the `random` agent's games
  changed with the declaration list. Measuring is noisy here (two runs of one commit can differ by 30%): compare paired
  against `main` before believing a failure.
- `pnpm fuzz --games 300` takes about 7–8 minutes (it was 2–3 in M1). Profiled (2026-11-20): the engine isn't slower
  (a bare game takes 100–200 ms; the bench is within its baseline). The time is the checks after every action, about
  19 times the games themselves: the leak check (`scrambleHidden` and comparing whole views, ~60%) and the legal-action
  check, times long random games (~45 turns, ~28 priority passes a turn). The fuzzer's picker by kind (D-061) cut it
  by about a fifth. Further cuts would weaken the checks (run the leak check on fewer actions); not worth it yet.
