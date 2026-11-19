# Future rules and features: what today's code must not block

Every task checks its design against this list (see "Design for what's coming" in `CLAUDE.md`).
The goal isn't to build these early. It's to avoid choices that would force a rewrite when they arrive.
Each entry says what's coming and what it needs from the code being written now.

When a design choice is made with one of these in mind, note it in `decisions.md`. When an item is
implemented, move it out of this file (or mark it done) in the same commit.

## Rules systems

**Full layer system (CR 613), M2.** Copy effects (layer 1), control (2), text-changing (3), type (4),
color (5), ability adding and removing (6), and power/toughness (7a–7d), with timestamps and dependencies.
*Built (M1-11, D-038):* `characteristics()` composes one reader per layer; layer 7 has 7c. Adding a layer means adding
its effects to the reader for that layer. Sorting within a sublayer by timestamp and dependency arrives with the first
non-additive effect.
*Watch out:* the readers work one object at a time. An effect that starts applying in one layer keeps applying to the
same objects in later layers (CR 613.6), and dependency orders effects across the board (CR 613.8), so full layers will
want one board-wide pass, layer by layer, that records each effect's affected set. Don't let the readers' signatures
harden around per-object evaluation. Also: 7a/7b set the base power and toughness (the early "no printed P/T" return
must become "base from 7a/7b, else printed"); tokens (CR 111) need a characteristics source other than the card
database; an effect on a permanent spell carries over to the permanent it becomes (CR 400.7a), which ids don't do yet.
*Needs now:* every characteristic is read through `characteristics()` or the per-layer readers it composes (D-038),
never from raw object fields. Code that
asks "is this a creature?", "who controls this?" or "does it have flying?" must go through it, even in M1.

**Replacement and prevention effects (CR 614–616), M2.** "If a creature would die, exile it instead",
"prevent the next 3 damage", "enters tapped", "if you would draw a card, ...".
*Needs now:* every game event (draw, damage, life change, zone change, counter placement, tapping) goes
through the single propose → replace → perform → trigger pipeline. Nothing changes state directly
outside it, so replacements can be added in one place later.

*Watch out (D-036):* `dealDamage`, `loseLife` and `runEffect` are synchronous, and mana abilities call `runEffect`
outside the work queue. When the affected player must choose the order of replacements (CR 616.1), damage needs to
become a work item or a resumable step. Lifelink, infect, wither and "a source you control deals damage" need the
damage source's characteristics and controller as it dealt the damage (CR 120.3, 608.2h), so the last-known-information
store must feed `dealDamage`. `DAMAGE_DEALT.source` and `ContinuousEffect.source` are object ids that die when the
spell resolves (CR 400.7); a UI that wants to name the card ("Giant Growth +3/+3") will want a `cardId` beside them.

**Triggered abilities (CR 603), M2.** "When/whenever/at" abilities, including leaves-the-battlefield
triggers that "look back in time" (CR 603.10), delayed triggers, and state triggers.
*Needs now:* events carry enough information to match triggers later (for a zone change: the object as it
last existed, both ids, from and to zones). Keep the last known information of objects that leave a zone.
Events aren't state, so last known information (CR 608.2h, 603.10) needs its own store in `GameState`, added by
the first effect that reads information from an object that may be gone (its power, its controller, lifelink on a
damage source). Firebreathing after the Whelp dies reads nothing from it, so M1-14 didn't need one (D-041).
Abilities on the stack carry `sourceOracleId` + `ability: AbilityRef`; granted abilities (layer 6) and delayed triggers
(CR 603.7) will need another kind of reference.

**Continuous effects from static abilities (CR 604, 611).** "Other creatures you control get +1/+1", "can't attack".
*Needs now:* effects know their source and are recomputed by the layer system, never applied once and stored.

**"Can't" beats "can" (CR 101.2) and restrictions or requirements on attacks and blocks (CR 508.1c–d, 509.1b–c).**
*Needs now:* legality checks for attacking, blocking, casting and targeting are separate, named functions
that a future restriction can plug into, not inline conditions scattered through the code.

**Costs.** Additional and alternative costs, cost increases and reductions, X costs, sacrifice, discard and
life as costs (CR 601.2f–h, 118).
*Needs now:* a cost is data (a list of cost parts), and the total cost is computed in one function following CR 601.2f.

**Spell copies, modal spells, and choices made on resolution (CR 707, 700.2).**
*Needs now:* stack objects aren't assumed to be cards; casting choices (modes, targets, X) are stored on the stack object.
A spell copy has no card and is owned by whoever put it on the stack (CR 707.10, 112.2): a third `GameObject` kind.
Choices a permanent remembers from its spell (kicked, X; CR 400.7d) must be copied when it enters the battlefield.

**Keyword actions and ability words.** Scryfall's `keywords` list (which the definition check compares with
`CardDef.keywords`) also holds keyword actions (scry, CR 701) and ability words (landfall, CR 207.2c). *Needs before
the first such card:* filter Scryfall's list to keyword abilities (CR 702) before comparing, so those don't end up in `Keyword`.

**Card types beyond the M1 pool.** Tokens (CR 111), auras and equipment (CR 303.4, 301.5), planeswalkers and
battles (CR 306, 310), double-faced, split, adventure and other multi-part cards (CR 709–715), and face-down
permanents such as morph and manifest (CR 708).
*Needs now:* an object's characteristics come from "which face or part is active", not straight from a
single card record; tokens are objects without a deck card. *Watch out* (rules-judge, M1 exit review): many rules
checks skip any object whose `kind` isn't `"card"` (`rules/state-based-actions.ts`, `rules/combat.ts`,
`rules/power-toughness.ts`, `rules/card-types.ts`, `rules/abilities.ts`). If tokens become a new object kind, a 0/0
token would quietly not die and token creatures couldn't attack. Make those checks handle every kind, or fail loudly.

**Counters (CR 122), including +1/+1 and -1/-1 annihilation (CR 704.5q).**
*Needs now:* counters live on objects as a map of counter type to number. Keyword counters (CR 122.1b) will need
timestamps (CR 613.7c) for layer 6, which means a state migration (`GameState.version`).

**Control-changing effects and ownership vs. control (CR 108.3, 110.2).**
*Needs now:* code never assumes the controller is the owner. "Your" in card text means controller.
Control is computed (layer 2), so `controlledSinceTurnStart` (CR 302.6) must reset whenever the computed
controller changes, including when a control effect ends. A bare boolean can't see A→B→A in one turn; expect to
replace it with a `{ player, since }` record when control-changing effects arrive.

**Turn structure changes.** Extra turns and extra combat phases (CR 500.7–500.8), skipped steps, and
"at the beginning of the next end step". The second combat damage step for first strike (CR 510.4; `combatDamage` would
then deal only some creatures' damage per step, D-040), and "no maximum hand size" (CR 402.2).
*Watch out:* `Turn` stores only a step name and `stepAfter` finds the next one by its position in `TURN_STEPS`, so a turn
with two combat phases or two upkeeps can't be represented yet. That needs a per-turn step list with a position in
`Turn` (a state migration), and extra turns need a turn queue where `endStep` picks the next player.
*Needs now:* the turn sequence is data the engine walks, not hard-coded control flow.

**State-based actions beyond M1 (CR 704.5).** The legend rule (704.5j) needs a choice; deathtouch (704.5h) needs a
"since the last check" record like `attemptedDrawFromEmptyLibrary`, cleared with it at every check.
*Watch out (D-039):* a listed SBA counts as performed, and a performed check repeats. So anything that stops an SBA
(indestructible ignoring lethal damage, CR 702.12b; "can't lose the game") must keep it off the list in
`rules/state-based-actions.ts`, or the check repeats forever. Creatures dying together move one `moveCard` at a time,
so leaves-the-battlefield triggers (CR 603.10a) must look back at the state before the whole `STATE_BASED_ACTIONS`
group, not after each move. Cards going to a graveyard together go in battlefield or hand order; CR 404.3 lets their
owner choose, so once a card cares about graveyard order, ask with a `PendingDecision`.

**Triggered abilities and the casting steps (CR 603, D-041).** A triggered ability's targets are chosen as it's put on
the stack (CR 603.3d), but it pays nothing and can't be cancelled, and with no legal target it's simply removed. So
`casting-steps.ts` will need an origin kind with no payment step and no cancel. Once `def.abilities` holds triggered or
static definitions, `activationProblem` and the activation list must check `def.kind === "activated"`.
When a non-mana ability has {T} in its cost, cancelling it must untap its source too (`tappedForMana` records only taps
for mana). The activation events name the source by its id, which dies with the source; a UI that names it later will
want its `cardId` too, and an event announcing the ability as it's created (none yet; a cast has `ZONE_CHANGED`).
*Watch out:* an ability on the stack has the text of the ability that created it (CR 602.2a), but `stackAbilityDef`
reads it from the source's card each time. Copies (layer 1), text changes (layer 3) and granted abilities (layer 6) will
need the text fixed when it's activated.

**More combat (CR 506–511, D-040).**
*Watch out:* removal from combat is read from the battlefield (an id that's gone left combat). That can't represent
regeneration, phasing, "remove from combat" effects or control changes, which leave the id on the battlefield, and a
permanent that stops and starts being a creature would rejoin combat: those need a recorded removed-from-combat set
(CR 506.4). Rules about a whole declaration (menace, "can't attack alone", requirements, CR 508.1c–d, 509.1b–c) are
checked at `finishDeclaring`, so a partial declaration can reach a dead end: then `finishDeclaring` must be offered only
when legal, and the player needs a way to take a pick back. Trample (CR 702.19) lets damage go to the player, so a
division names the player too, one blocker asks too, and earlier lethal damage counts. First strike (CR 510.4) needs a
record of which creatures already dealt damage. A creature blocking several attackers needs a list form for the
scenario `block` step.

**Hidden information beyond hands and libraries (D-044).** Face-down permanents (CR 708.2; who may look, CR 708.5;
telling them apart, CR 708.6), face-down exile (CR 406.3), a card drawn face down while casting (CR 121.8), revealed
cards (CR 701.20a), looking at cards (CR 701.20e) and scry (CR 701.22), milling (CR 701.17), and cards a player has seen
in another's hand (a cancelled cast's card back in hand, CR 734.1) all change what `playerView` shows. *Watch out:*
shuffling keeps object ids (`zones/shuffle.ts`), and they're numbered in setup order, so the first move from a library
to a public zone (a mill, a search) would show a setup-order id and hint at decklist neighbours again (D-045). CR
701.20d already makes shuffled revealed cards new objects: give every shuffled card a new object id. *Watch out:* `canSee` (`view/visibility.ts`) decides by zone; these need visibility
per object, so `canSee` will take the object too. A partly known hand doesn't fit `hand: ObjectId[] | null`: another
player's hand will need its known cards listed alongside `handSize`. The fuzzer's scramble (`scrambleHidden`) must
learn to leave known cards alone. Card ids don't carry knowledge through hidden zones (D-054): a card that comes out of
a hand or library gets a new one, so rules that let a player know a hidden card (reveals, "look at", a card seen
going into a hand) must record that knowledge per player explicitly, not rely on ids. Today a player can also follow
their own cards into their own library by id (a mulligan's bottom cards); the view hides library contents, so nothing
uses that yet.

**What a view can compute (M3).** The UI and the AI get views, not states (D-044), but `characteristics()` reads a
`GameState` (objects, the battlefield, effects, rule modifiers). Before M3 uses views, pick one: narrow
`characteristics()` and its helpers to an input type that both `GameState` and `PlayerView` satisfy (keep the view's
field paths the same as the state's for that), or have the host send each visible permanent's characteristics with
the view. Never let the UI read `baseController` or printed power and toughness directly.

**Multiplayer (much later).** Turn order with more than two players, APNAP with several players, a player leaving the game.
*Watch out:* a concession (D-042) goes through `playersLose`, so it reaches the same throw; leaving must also remove
the player from `turnOrder` (or mark them) so they can't concede twice, and pass priority on if they had it (CR 800.4a).
`GameResult.winner` is one player: team games (CR 104.2c) and draws for only some players (CR 104.4e) will need a
result per player. Combat (D-040) throws when attacks go to several players; each defending player will declare blockers
(CR 509.1) and attacks will need planeswalkers and battles as defenders (CR 506.3). `playersLose` (D-039) throws when a player loses with more than one player left. Leaving the game
(CR 800.4a: their objects leave, control effects end, priority passes on) has to be built there first.
*Needs now:* nothing assumes exactly two players. Use player lists and turn order, never "the opponent".

**Mana beyond six counters (CR 106.6, 106.12, 107.4h).** Mana with spending restrictions or riders, "tapped for mana"
triggers and replacements, snow mana, sources that make more than one mana or a choice of colors.
*Needs now:* `ManaPool` is six counters, which these rules will outgrow (a state migration); `MANA_ADDED` already names
its source; `autoPay` will need a real search once a source can make a choice of colors.

**Cancelling a cast, as rules grow (CR 734.1, D-035).** Cancelling restores a snapshot: the card, its place in hand,
the pool before, and the permanents tapped for mana.
*Watch out:* once triggered abilities exist, any trigger from a cancelled cast (or from mana abilities it reverses)
must be discarded, never put on the stack (CR 734.1: no abilities trigger from an undone action). The snapshot stops
being an exact reversal once a mana ability has another effect or cost (sacrifice, life, a library) or a triggered
mana ability fires; CR 734.1 forbids reversing some of those, so cancel will need to refuse, or reverse less.
Modal spells and kicker change the target requirements after the mode or cost is chosen (CR 601.2b–c), so the
"every target has a legal choice" pre-check in `castProblem` must then look at the chosen modes.

**Targeting that knows who targets (CR 702.11b hexproof, 702.16b protection, 601.2c).** `legalTargets`,
`isLegalTarget` and `stillLegalTargets` (`rules/targets.ts`, also used for the CR 608.2b check on resolution) take
only the target spec: no source and no controller, so hexproof, protection, shroud and "target creature an opponent
controls" can't be expressed. `game/cast.ts` checks targets before the spell object exists. Each target group is one
target today; "two target creatures" needs several per group, and one instance can't choose the same target twice
(CR 601.2c). *Needs now:* nothing; add `source` and `controller` parameters when the first such card arrives.

**Paying mana outside casting (CR 117.1d, 605.3a).** Mana abilities may be activated whenever a payment is asked
for, including during resolution: costs to attack or block (CR 508.1i–j, 509.1e–f), "counter unless its controller
pays" and ward (CR 702.21a). Today `ACTIVATE_ABILITY` is accepted only with a `priority` or `payMana` decision
pending, and paying (`casting-steps.ts`) assumes something is being cast and finishes by making it cast. These need a
payment context that isn't `Casting`.

**Casting from other zones (CR 601.2a, 734.1, 702.34a flashback).** Casting checks the hand
(`game/cast.ts`), the casting origin records a hand index (`state/casting.ts`), and cancelling puts the card back in
the hand. A card cast from a graveyard or exile must go back where it came from.

**Smaller rules noted while closing the coverage gaps (later: in the code).** Power or toughness of `*`
(CR 208.2) needs characteristic-defining abilities; dividing an effect among targets as a spell is cast (CR 601.2d)
fits `StackChoices`, which has room for divisions; emblems (CR 114), which the setup's rule modifiers already behave
like; the extra start-of-game steps some formats take (CR 103.2: sideboards, companions); X costs (CR 107.3).

**Small keywords that touch M1 code.** Vigilance (CR 702.20b): `finishAttackers` taps every attacker
(`combat/declare-attackers.ts`). Flash (CR 702.8a): `castTimingProblem` checks only the printed type `instant`
(`rules/timing.ts`).

**Starting the game, beyond the basics (CR 103).** In a match, the loser of the previous game chooses who goes first
(CR 103.1); starting hand size can change (CR 103.5a, RPG rule modifiers); multiplayer's free first mulligan (CR 103.5c);
actions from the opening hand (CR 103.6, Leylines) and "any time you could mulligan" (CR 103.5b).
*Needs now:* the setup can name the starting player; `STARTING_HAND_SIZE` is one constant to make per-player; the
mulligan count is the only thing that sets how many cards go to the bottom; opening-hand actions slot in before
`beginFirstTurn`. A match host keeps `STARTING_PLAYER_CHOSEN.chosenBy` from the events, since `pregame` is cleared.

## App and game features

**AI search (after M3).** *Needs now:* the reducer stays pure and fast, and state cloning is cheap (structural sharing).
**Saves and replays across versions.** *Needs now:* `GameState.version` exists and replays record the engine version.
**RPG encounters (M5).** *Needs now:* `GameSetup` supports custom starting life, starting permanents and rule
modifiers; `GameResult` reports what the meta layer needs.
**Deckbuilding and the full card database (M4).** *Needs now:* card identity uses Scryfall's `oracle_id`, so decks
can refer to cards the engine doesn't support yet.
**Animations and the board UI (M3).** *Needs now:* every visible change produces an event, with the `cardId` the UI
uses to track a card between zones.
