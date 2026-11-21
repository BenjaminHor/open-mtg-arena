# Future rules and features: what today's code must not block

Every task checks its design against this list (see "Design for what's coming" in `CLAUDE.md`).
The goal isn't to build these early. It's to avoid choices that would force a rewrite when they arrive.
Each entry says what's coming and what it needs from the code being written now.

When a design choice is made with one of these in mind, note it in `decisions.md`. When an item is
implemented, move it out of this file (or mark it done) in the same commit.

## Rules systems

**Full layer system (CR 613), M2.** Copy effects (layer 1), control (2), text-changing (3), type (4),
color (5), ability adding and removing (6), and power/toughness (7a–7d), with timestamps and dependencies.
*Built (M2-09a, D-092, D-093):* one board-wide pass in `rules/layers.ts`, layer by layer, over the battlefield and the
stack, kept per its inputs; the per-layer readers (`cardTypesOf`, `colorsOf`, `keywordsOf`, `powerAndToughness`...)
read it. Layer 6 grants keywords (resolved effects and static abilities), 7c adds; a static ability's set is found as
it applies (CR 611.3a) and kept from layer 6 to 7c (CR 613.6). Layer 7a applies characteristic-defining abilities in
every zone (M2-09b1, D-094), a card elsewhere computed with the board. Layer 6 sorts its grants and removals by timestamp
since M2-12b (D-103, "loses flying"); dependency (CR 613.8) waits on the open question in status.md. Life totals are
an input since M2-13c2a (D-112), compared only once a pass read one (`lifeRead`, set by `lifeTotalOf`, the one
reader). *Watch out:* each new thing a characteristic-defining ability reads that isn't in `LayerInputs` (cards in
graveyards for Lhurgoyf, hand size for Maro) needs the same: an input, a reader that marks it read, and the comparison;
a general record of what a pass read would scale better once there are several.
*Built (M2-12c1, D-104):* layer 2 lives only in the pass; `controllerOf(state, id, cards)` reads the pass's
controller for a permanent, and controllers are compared after the action and each piece of work, for summoning
sickness (CR 302.6) and removal from combat (CR 506.4). Layers 4, 5 and 7b have resolved effects
(M2-09b2a, D-095), in `state.effects` order; a static ability that sets them (an Aura, M2-12) needs its timestamp
merged into that order (CR 613.7a), as layer 6 does since M2-12b (D-103) and layer 2 since M2-12c2 (D-105: Mind
Control's static control effect takes its Aura's timestamp, renewed when it's attached, CR 613.7e). *Watch out:*
`anyControlEffects` reads static control abilities from printed text, kept per battlefield list (D-105); a copy effect
starting on a permanent (layer 1), a permanent turned face up (CR 708), or a control ability granted in layer 6 would
need it to key on the objects too, or to read the pass. In a simultaneous batch the cards move one by one, so a Druid moving first ends
its Forest's effect before the Forest moves: last known information must be read from the state before the batch
(CR 603.10a, 608.2h). "endOfGame" effects stay in `state.effects` after their object is gone; drop them once nothing
can read them (after the last-known-information snapshot). A gone object's power is read from the snapshot taken as it left (D-096), not worked out from
today's board (a dead Nightmare would count the Swamps left); a granted copy of a
"power and toughness are each equal to" ability isn't characteristic-defining (CR 604.3a) and belongs in 7b; tokens (CR 111) need a characteristics source other than the card database; an effect on a permanent
spell carries over to the permanent it becomes (CR 400.7a), which ids don't do yet. A layer reading more of the state
(combat, for "attacking creatures") adds it to `LayerInputs`, the memo's key.
*Needs now:* every characteristic is read through `characteristics()` or the per-layer readers it composes (D-038),
never from raw object fields. Code that
asks "is this a creature?", "who controls this?" or "does it have flying?" must go through it, even in M1.

**Replacement and prevention effects (CR 614–616), M2.** "If a creature would die, exile it instead",
"prevent the next 3 damage", "enters tapped", "if you would draw a card, ...".
*Needs now:* every game event (draw, damage, life change, zone change, counter placement, tapping) goes
through the single propose → replace → perform → trigger pipeline. Nothing changes state directly
outside it, so replacements can be added in one place later. Built in M2-03 (`engine/src/pipeline/`, D-056): `replace`
is where they go.

*Built (M2-08c, D-087):* `happenOrAsk` stops before performing anything when the affected player must choose the
order of replacements (CR 616.1) and resumes as a work item; only callers that do nothing after the event use it.
*Watch out:* every other caller (the list is in `engine/src/pipeline/README.md`) must queue its rest as work before it
can wait, and mana abilities run outside the work queue. *Built (M2-08d1, D-088):* prevention per damage entry, each
with its own choices and chooser, choices keyed by the entry (`ChoiceFor`), and an id for each state-held effect.
*Left out (owner, D-090):* redirection with an amount (Harm's Way) needs CR 616.1 choices per (effect, recipient), its
split made when it applies against what earlier choices left, and amounts threaded through the event; per-entry
choices (today) are finer than CR 616.1, and per-player ones coarser. D-090 lists what the reviews found. "Prevent the
next N" shields (CR 615.7) will need the same. Each member of a batch is replaced
against the state before the batch (built, D-085), and the results of damage are replaced as part of the damage event
(CR 120.4c), not as life-loss events of their own; a replacement applies once per event (CR 614.5). An instruction to
draw several cards needs a container event, replaced as a whole before the single draws (CR 121.2a, 616.1g, 614.11a):
since M2-05b1 "draw N" is N single draws (D-060), and the container comes with the first replacement that needs it
(M2-08). *Built (M2-08a, D-085):* a card's own replacements about where it goes, read from the moving card in any zone.
*Built (M2-08b, D-086):* regeneration shields in `GameState.replacements`, used by a destroy. *Watch out:* a
replacement is chosen in `replace` against the state before its batch but used up in `perform`; "prevent the next N"
(M2-08d) across a batch must work out the amount used during `replace`, or two members of one batch each see all N.
M2-08c's choice should name candidates by stable references (`{ kind: "ownText", object, index }`,
`{ kind: "regenerationShield", object }`), not copied text, for CR 614.5's "already applied". Every entry is ended in
cleanup: a replacement lasting longer than "this turn" needs a duration, like `ContinuousEffect`'s. Static regeneration
(CR 701.19b, never used up) belongs to static abilities, and "can't be regenerated" as a continuous effect must be
checked in `regeneration()` as well as the destroy's `noRegeneration`.
*Still to come:* replacements from other permanents ("If a card would be put into a graveyard from anywhere, exile it
instead"), found by scanning the battlefield as well as the moving card; tokens and copies with such text
(`replacementsOf` and `ownerOf` read only cards); a shuffle-into-library replacement in a batch with a card put on top at
the same time, where the shuffle must come after the whole batch and leave that card on top (CR 701.24g, its Colossus
example); a discard into a hidden zone with no reveal leaves the card's characteristics undefined (CR 701.9c), so a
"discards a creature card" trigger must read them as they were in the hand. Since each event is performed whole, a "would die" or
"would be put into a graveyard" replacement must recognize every event kind that makes that zone change (`moveCard`,
`destroy`, `sacrifice`, `counterObject`, `discard`, ...): M2-08 needs a small "the zone change this event makes"
helper. Lifelink's life gain (D-070) is performed inside the damage event, one gain per source (CR 702.15e), so a life
gain replacement ("if you would gain life", Boon Reflection) or "can't gain life" must apply to those gains there,
as results of the damage event (CR 120.4c), not as separate `gainLife` events. Lifelink, infect, wither
and "a source you control deals damage" need the damage source's characteristics and controller as it dealt the damage
(CR 120.3, 608.2h), so the last-known-information store must feed `dealDamage`. `DAMAGE_DEALT.source` and `ContinuousEffect.source` are object ids that die when the
spell resolves (CR 400.7); a UI that wants to name the card ("Giant Growth +3/+3") will want a `cardId` beside them.

**Triggered abilities (CR 603), M2.** "When/whenever/at" abilities, including leaves-the-battlefield
triggers that "look back in time" (CR 603.10), delayed triggers, and state triggers.
*Built (M2-07a, D-076):* entering, beginning-of-step and attack triggers, the intervening if, "you may", APNAP
ordering, and last known information of a card leaving the battlefield (`GameState.lastKnown`, CR 608.2h).
*Built (M2-07b, D-077):* casting, drawing, discarding, tapping a land for mana, damage to a player and life gain
triggers; "that much"; "that player controls" in a target; identical triggers put on unasked; cleanup priority for
triggers (CR 514.3a). *Built (M2-07c1, D-079):* "your upkeep", blocks (one trigger per creature blocked or blocking).
Blocks caused by an effect, or a creature put onto the battlefield blocking (CR 509.3b, 509.3d), will need their own
event, matched with the same per-pair `matches`. *Built (M2-07c2, D-084):* delayed triggers (CR 603.7), with their
own `AbilityRef` kind, waiting only for the next beginning of anyone's step with no targets; "becomes the target"
(`BECAME_TARGET`, emitted once per object target as it's chosen). *Still to come:* triggers on activating abilities;
a delayed trigger for "your next upkeep" must match against its own `controller`, not its source's (which may be
gone), and one with targets chooses them as it's put on the stack like any trigger; one spell targeting the same
object twice makes it "become the target" once (CR 601.2c; Bonecrusher Giant's and Tectonic Giant's rulings, D-106). A delayed trigger is matched with its `source` and checked with `onlyIf` against it: a
condition about "this creature" or an intervening if would read an object that may be gone, so such delayed triggers
need their own reading. Cancelling a cast doesn't restore `delayedTriggers`: one that triggered during the cast would
be lost; that can't happen while they wait only for the beginning of a step. Ward (CR 702.21a, "counter that spell
or ability") will need `BECAME_TARGET.by` kept in the `TriggerEvent`. Activation counts (D-078) are keyed by the
printed ability's index; a granted activated ability (layer 6) will need an `AbilityRef` key. A cancelled cast's
`BECAME_TARGET` is still in the log before `CAST_CANCELLED`, though its trigger is dropped (CR 734.1); a UI may want to
hide both. Leaves-the-battlefield triggers (CR 603.10a) are built for "when this creature dies" (D-118): `detectTriggers`
reads a permanent the event moved off the battlefield in `before`. Other leaves-the-battlefield conditions ("when this
leaves the battlefield", "whenever another creature dies") go through the same `leavesTheBattlefield` test, and
`lastKnown` for a card leaving other zones remains; state triggers (CR 603.8); granted triggered abilities (layer 6) through
`triggersOf`. Cancelling a cast empties `pendingTriggers` (CR 734.1). That stays right with "becomes the target" (M2-07c2),
which triggers during a cast: a cast starts only when a player receives priority, which happens only once
`pendingTriggers` is empty (CR 117.5), so everything pending then came from the cast itself. `lastKnown` is emptied when the stack is empty, so an effect that must read a gone object later (a
delayed trigger "its power") must copy what it needs when it's created. `lastKnown` holds the raw `CardObject`,
enough for "tapped"; last known information is the characteristics as last computed by the layers (CR 608.2h), so the
first reader of a gone object's power, keywords or controller (deathtouch or lifelink from a gone source, CR 702.2e,
702.15c; leaves-the-battlefield triggers; Xathrid Demon reads only the sacrificed creature's power, kept in the
resolution's "this way" record as it's sacrificed, D-079) reads the snapshot, not a recomputation with the effects as
they are then. *Built (M2-09b2b, D-096):* `perform` snapshots each permanent an event moves, from the state before the
event (a whole batch, CR 603.10a), into `lastKnownCharacteristics` (controller, types, subtypes, colors, power,
toughness, and since M2-12a keywords); protection, Stone Giant's "this creature's power", a gone object's controller and
a gone damage source's lifelink (CR 702.15c: Siege-Gang Commander with Lifelink sacrificed for its own ability) read it;
deathtouch reads it the same way (M2-12b: a Pyromancer with Gorgon Flail killed in response). A spell leaving the stack keeps no snapshot, which a delayed trigger
made by a spell that deals damage would need. As readers multiply (M2-09c), "computed if it exists, else the snapshot"
should live in one small module rather than in each reader. Putting and resolving a trigger read the printed `def.triggers`,
so granted triggered abilities also need a reference that doesn't index the printed list. `putTriggers` throws for a
controller who left the game; multiplayer (CR 800.4a) must drop that player's triggers instead.

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
`CardDef.keywords`) also holds keyword actions (mill, scry, CR 701) and ability words (landfall, CR 207.2c). Keyword
actions are left out of the comparison by name (`KEYWORD_ACTIONS` in `definition-problems.ts`, since M2-05b); ability
words will need the same before the first card with one.

**Card types beyond the M1 pool.** Tokens (CR 111), auras and equipment (CR 303.4, 301.5), planeswalkers and
battles (CR 306, 310), double-faced, split, adventure and other multi-part cards (CR 709–715), and face-down
permanents such as morph and manifest (CR 708).
*Needs now:* an object's characteristics come from "which face or part is active", not straight from a
single card record; tokens are objects without a deck card. *Built (M2-13, D-108 to D-110):* planeswalkers: printed
loyalty, entering with it, loyalty abilities, damage removing loyalty, CR 704.5i, the legend rule, attacking them, and
[−X] (M2-13c2b, D-113: X bounded by the loyalty as it's announced). *Watch out:* `loyaltyChange` reads the printed
loyalty part; effects that change it (CR 606.4) or add loyalty costs to combine (CR 606.5) need the loyalty amount in
the total cost locked in at CR 601.2f, and CR 606.6 and the bound on X must then read that total. A cost with no mana
is paid at once in `nextCastingStep`, which throws on an unpayable cost rather than refusing it, so every such check
must come before. *Built (M2-12a-b, D-102, D-103):* Auras and Equipment, attached through `attachedTo` and its one reader. *Built (M2-11a, D-101):* tokens are `CardObject`s
carrying their own `CardData` (read through `cardDataOf`), so the `kind` checks below hold for them; "card" filters ask
`isToken` (CR 111.6). *Still to come:* a token's own activated or triggered abilities (the ability object
names its source only by `sourceOracleId`); a token that left the battlefield staying put (CR 111.8); a token in a hidden
zone shown by identity (D-062 shows only an oracle id); copies of permanents (CR 707). Replacements on entering from
other permanents' text ("creatures enter tapped", CR 614.12) and "if you would create" (CR 614.1) must watch the
`createToken` event as well as moves (`moveOf` and `affectedObject` give null for it today). Two different tokens may
share an oracle id (`token:Soldier Token`), so nothing may treat equal oracle ids as the same card (D-077's identical
triggers, name comparisons). Still to come too: a token that can't enter isn't created (CR 111.5); a token created by
a card's name uses that card's Oracle text (CR 111.11); a copy of a permanent spell becomes a token without being
"created" (CR 111.13), so that path must not emit `TOKEN_CREATED`; other "card" filters (in hands, libraries, a count
of creature cards in a graveyard) asking `isToken` once a token can be there when they're read. *Watch out* (rules-judge, M1 exit review): many rules
checks skip any object whose `kind` isn't `"card"` (`rules/state-based-actions.ts`, `rules/combat.ts`,
`rules/power-toughness.ts`, `rules/card-types.ts`, `rules/abilities.ts`, `rules/targets.ts`, `rules/object-filter.ts`,
`game/control-changes.ts`). Tokens are card objects (D-101), so they pass; if spell copies (CR 707.10) become a new
object kind, a copy couldn't be targeted as a spell or match any filter. Make those checks handle every kind, or fail
loudly.

**Counters (CR 122), including +1/+1 and -1/-1 annihilation (CR 704.5q).**
*Built (M2-10a, D-099):* counters on permanents as a map of kind to number, put and removed as pipeline events
(`COUNTERS_PUT`, `COUNTERS_REMOVED`); CR 704.5q in the state-based-action batch, the creature dying in it leaving with
its counters as they were before (CR 704.3). *Watch out:* counters on players (poison, CR 122.1f, 704.5c) need a
recipient like damage's `to` and a field on the player: the events name an object only. Entering with counters
(CR 614.1c, `Destination.counters`, M2-10b) emits `COUNTERS_PUT` as the permanent enters; a counter-doubling replacement
(Hardened Scales) would have to modify the destination's counters, not that event. Who puts them (CR 122.6a) isn't on the events yet; "if you would put counters"
replacements need it, and `happenOrAsk` for their CR 616.1 order. Wither and infect put -1/-1 counters inside the
damage event, as lifelink gains life there (D-070). Keyword counters (CR 122.1b) need timestamps (CR 613.7c) for
layer 6, a state migration (`GameState.version`). A prevention that also does something else (Protean Hydra: "prevent
that damage and remove that many +1/+1 counters") does the rest right after the damage event (CR 615.5; built,
M2-10b: a prevention candidate's `afterwards`). Its "that many" is the damage it applied to, which equals what it
prevented until damage can't be prevented (CR 615.12: then it removes counters for damage it couldn't stop); the
`afterwards` events skip replacement, as `after` events do.

**Control-changing effects and ownership vs. control (CR 108.3, 110.2).**
*Needs now:* code never assumes the controller is the owner. "Your" in card text means controller.
Control is computed (layer 2), so `controlledSinceTurnStart` (CR 302.6) must reset whenever the computed
controller changes, including when a control effect ends. *Built (M2-12c1-2, D-104, D-105):* controllers are compared
after the action and each piece of work, and the flag only ever resets, so A→B→A across pieces of work comes out
sick. Still at risk: a change and its change back inside one piece of work, which nothing in the pool does; a
`{ player, since }` record would catch it.

**Turn structure changes.** Extra combat phases (CR 500.8), skipped steps and turns, and
"at the beginning of the next end step". ("No maximum hand size" is built, D-097.) (First strike's second combat damage
step is built, D-070: `endStep` repeats `combatDamage` once, read from `Combat`.)
*Watch out:* `Turn` stores only a step name and `stepAfter` finds the next one by its position in `TURN_STEPS`, so a turn
with two combat phases or two upkeeps can't be represented yet. That needs a per-turn step list with a position in
`Turn` (a state migration). Extra turns are built (D-116): `GameState.extraTurns`, the latest first, and
`regularTurnPlayer`, the turn order's place, which `endStep` reads through `nextTurn`. "Skip your next turn" (later:
CR 614.10) belongs beside them, as does a player leaving the game: their extra turns don't begin (later: CR 800.4k), and
the turn order's place must step on from their old seat. Storing whether the current turn is an extra one (for "if
it's an extra turn" checks) is a field on `Turn` when a card needs it.
*Needs now:* the turn sequence is data the engine walks, not hard-coded control flow.
"Doesn't untap during [its controller's / that player's] next untap step" is built (D-115): the effect ends when the
untap step it names is over, in `game/untap-step.ts`. A skipped untap step must not end it: "the next"
occurrence waits for the first one that isn't skipped (later: CR 614.10a, 500.11), so skipping should simply not begin
the untap step.

**State-based actions beyond M1 (CR 704.5).** The legend rule (704.5j) is built (D-109): its choice is a `keepLegend`
decision asked before the check, so every caller of a check asks it first (`givePriority`, `cleanupCheck`). Names are
read through `characteristics()`, so copies (layer 1, CR 707.2), text changes and face-down permanents (no name,
CR 201.2a) change the sets in one place; split and double-faced names will need a set of names per object. Phased-out
permanents (CR 702.26b) must be left out. (Deathtouch's 704.5h is built, D-070: `dealtDeathtouchDamage`, cleared at
every check.)
*Watch out (D-039):* a listed SBA counts as performed, and a performed check repeats. So anything that stops an SBA
(indestructible ignoring lethal damage, CR 702.12b; "can't lose the game") must keep it off the list in
`rules/state-based-actions.ts`, or the check repeats forever. Creatures dying together are one `simultaneous` event
(D-056), and `checkTriggers` gets the state before it, so leaves-the-battlefield triggers (CR 603.10a) can look back at
the whole group. Players losing is still performed after that event; it's part of the same CR 704.3 event, which only
matters once triggers look back at it. Cards going to a graveyard together go in battlefield or hand order; CR 404.3 lets their
owner choose, so once a card cares about graveyard order, ask with a `PendingDecision`.

**Triggered abilities and the casting steps (CR 603, D-041).** Built (D-076): a `Casting` with origin `trigger` goes
through the target steps with no payment and no cancel. Triggered abilities have their own `def.triggers`, so
`def.abilities` stays activated only.
A non-mana ability's {T} is paid only at the final payment (D-059), so cancelling never has to untap it. The activation events name the source by its id, which dies with the source; a UI that names it later will
want its `cardId` too, and an event announcing the ability as it's created (none yet; a cast has `ZONE_CHANGED`).
*Watch out:* an ability on the stack has the text of the ability that created it (CR 602.2a), but `stackAbilityDef`
reads it from the source's card each time. Copies (layer 1), text changes (layer 3) and granted abilities (layer 6) will
need the text fixed when it's activated.

**More combat (CR 506–511, D-040).**
*Built (M2-08b, D-086):* `Combat.removed`, the creatures an effect removed while they stayed on the battlefield
(regeneration), read through `stillInCombat` in `rules/combat.ts`. *Watch out:* phasing, "remove from combat" effects
and control changes must add to it too. A permanent that stops being a creature is added as `advance` finishes each
piece of work (M2-09b2a), so one that stopped and started again inside a single piece of work (a batch moving an
animator out and another in) would rejoin combat (CR 506.4). Rules about a whole declaration are checked at `finishDeclaring`, offered only when legal, and a `takeBack` answer
removes the last pick (M2-06c, D-072). The most requirements obeyable is worked out directly, which is exact while the
only whole-declaration restriction is "alone"; menace (CR 702.111b) and "no more than one creature can attack"
(CR 508.1d's example) need a search over declarations. Trample and first strike are built (M2-06a, D-070), and a creature blocking several attackers (Palace Guard, M2-06b,
D-071). Two tramplers on one blocker are worked out one after the other, so a split where both trample over can't be
chosen: checking the whole assignment at once (CR 510.1e) needs a decision that can be taken back or checked as a whole.
A "can't block" effect not on targets ("creatures without flying can't block this turn") is a rules effect read live
at declaration (CR 611.2c, 613.11), not an `affected` list. The second step's "remaining attackers and blockers" (CR 510.4) needs the removed-from-combat set too.

**Milling and losing life, as triggers and replacements arrive (M2-07, M2-08).** Mill is plain `moveCard` events from
library to graveyard (D-060), so "whenever a player mills", "the milled card" (CR 701.17c, 701.17d) and replacements
that change how many are milled can't tell it from another such move (surveil): mark it, as discard is marked, with a
`CARD_MILLED` event or a cause on the batch, when its first trigger or replacement arrives. Losing 0 life is an event (D-065, the owner's ruling): a "whenever a player loses life" trigger sees it. A search
emits no event yet: "whenever a player searches" and Aven Mindcensor's replacement (CR 701.23f) need one from
`search` (`effects/library-effects.ts`), including on an empty library, which is still a search; only Haunting
Echoes with nothing exiled doesn't search (D-063).

**Damage to many, counts and payment restrictions (D-067).** One action dealing damage to several recipients is one
`dealDamage` event (Earthquake, Goblin Artillery): "whenever a source deals damage to you" triggers (M2-07) count
damage events, not `DAMAGE_DEALT` records, which can be two for one player (Goblin Artillery on its controller), and a
prevention shield on Earthquake applies per recipient within the one event (CR 615.10, M2-08). A counted amount used
twice in one resolution (Tendrils of Corruption) is counted twice; once replacements can move things mid-resolution
(M2-08), count it once (CR 107.3i, 608.2h). `xPaidWith` (Consume Spirit) is a narrow stand-in: cost reductions
(CR 118.7a), "black and/or red" (Soul Burn), "colored mana" and X in activation costs need mana tracked with its
restrictions (CR 106.6).

**Hidden information beyond hands and libraries (D-044).** Face-down permanents (CR 708.2; who may look, CR 708.5;
telling them apart, CR 708.6), face-down exile (CR 406.3), a card drawn face down while casting (CR 121.8), revealed
cards (CR 701.20a), looking at cards (CR 701.20e) and scry (CR 701.22), and cards a player has seen
in another's hand (a cancelled cast's card back in hand, CR 734.1) all change what `playerView` shows. *Watch out:*
shuffling keeps object ids (`zones/shuffle.ts`), and they're numbered in setup order. A move from a library to a public
zone no longer shows the old object id or card id (D-054), and since M2-05b2 a reveal, a choice's options, a search
and a "look at" show cards by identity only, in a fixed order, never by id or zone order (D-062): scry must do the
same. Liliana Vess's "search, then shuffle and put that card on top" (CR 701.24b leaves the found card out of the
shuffle) is built as search, shuffle the whole library, then move the found card to the top by reordering, which gives
the same odds (M2-13c1). Moving a card within its own library is a reorder, not a zone change (CR 400.7); "put on the
bottom" (Lurking Predators) still goes through `moveCard`, a new object, and should become a reorder too when a
library trigger (CR 603.10a) or CR 701.20d needs it. So far a reveal is only an event (`CARDS_REVEALED`), and the view doesn't keep it: while Duress's caster
chooses, `playerView` shows only the cards that fit, so a client or AI rebuilt from views mid-choice loses the rest of
the revealed hand, though it stays revealed until the effect is done (CR 701.20a). That, Telepathy, and a third player
who must see a revealed hand need revealed cards in the view, per object. Several players
choosing at once for one effect choose in APNAP order, then it's done at once (CR 608.2e): `discard` and
`sacrifice` name one player until a card needs more (Yawning Fissure in multiplayer: each opponent's choice collected,
then one simultaneous sacrifice). And
`moveCard` decides when to give a new card id by zone (`isHiddenZone`): face-down cards (CR 406.3, 708) need it to use
the same per-object visibility as `canSee`. *Watch out:* `canSee` (`view/visibility.ts`) decides by zone; these need visibility
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
An effect lasting until a player's next untap step (Sleep's `doesntUntap`, D-115) never ends if that player leaves:
leaving must end or drop the effects that name them (later: CR 800.4a).
*Watch out:* a concession (D-042) goes through `playersLose`, so it reaches the same throw; leaving must also remove
the player from `turnOrder` (or mark them) so they can't concede twice, and pass priority on if they had it (CR 800.4a).
`GameResult.winner` is one player: team games (CR 104.2c) and draws for only some players (CR 104.4e) will need a
result per player. Combat (D-040) throws when attacks go to several players; each defending player will declare blockers
(CR 509.1) and attacks will need battles as defenders (CR 506.3; planeswalkers are built, D-108: `Attack.attacked` can name a battle too, with a check per attacked object for restrictions like "can't attack you", which don't cover planeswalkers). `playersLose` (D-039) throws when a player loses with more than one player left. Leaving the game
(CR 800.4a: their objects leave, control effects end, priority passes on) has to be built there first.
*Needs now:* nothing assumes exactly two players. Use player lists and turn order, never "the opponent".

**Mana beyond six counters (CR 106.6, 106.12, 107.4h).** Mana with spending restrictions or riders, "tapped for mana"
triggers and replacements, snow mana, sources that make more than one mana or a choice of colors.
*Needs now:* `ManaPool` is six counters, which these rules will outgrow (a state migration); `MANA_ADDED` already names
its source; `autoPay` handles one-color, two-color ("{G} or {W}", D-085) and any-color sources (D-068) by trying the
sources with the fewest choices first, which always works for a cost of one color (every Magic 2010 cost); it needs a
real search once a cost has two colors and two-color sources could be needed for both, or a source makes several mana
or has a mana cost.

**Cancelling a cast, as rules grow (CR 734.1, D-035).** Cancelling restores a snapshot: the card, its place in hand,
the pool before, and the permanents tapped for mana.
*Watch out:* once triggered abilities exist, any trigger from a cancelled cast (or from mana abilities it reverses)
must be discarded, never put on the stack (CR 734.1: no abilities trigger from an undone action). The snapshot stops
being an exact reversal once a mana ability has another effect or cost (sacrifice, life, a library) or a triggered
mana ability fires; CR 734.1 forbids reversing some of those, so cancel will need to refuse, or reverse less.
A triggered mana ability ("whenever a player taps a land for mana, that player adds one mana of any type that land
produced", CR 605.1b, 605.4a) must resolve at once inside `resolveManaAbility`, not wait in `pendingTriggers` as
Manabarbs' does (D-077), and it reads the land: `landTappedForMana` keeps no land in its `TriggerEvent` so Manabarbs'
triggers stay identical, so such an ability needs the land kept, and the identical-trigger check then must compare only
what each ability reads.
Modal spells and kicker change the target requirements after the mode or cost is chosen (CR 601.2b–c), so the
"every target has a legal choice" pre-check in `castProblem` must then look at the chosen modes.

**Targeting that knows who targets (CR 702.11b hexproof, 702.16b protection, 601.2c).** `legalTargets`,
`isLegalTarget` and `stillLegalTargets` (`rules/targets.ts`, also used for the CR 608.2b check on resolution) take a
`Targeting` (the object and its controller) since M2-05, so "an opponent controls" works, and shroud filters
`legalTargets` (M2-06d), and so does protection from a color or a subtype (M2-08e, D-091), checked against the spell or
the ability's source. Hexproof, and protection for players or "from everything" or "from a player" (CR 702.16b's "or
player", 702.16j-k), need the source's controller too, in the same place. `game/cast.ts` checks targets before the spell object exists. Each target group is one
target today; "two target creatures" needs several per group, and one instance can't choose the same target twice
(CR 601.2c). *Needs now:* nothing.

**Creature types and land types (CR 205.3m).** A permanent's `subtypes` are one list. Coat of Arms compares them
whole, which is right while a creature has only creature types; an animated Forest (Awakener Druid, M2-09b) is a
"Forest Treefolk", and a Forest shared with another animated land would count. Split subtypes by type when a card can
reach that. *Needs now:* nothing (every animated land in the pool is also a Treefolk).

**Protection beyond M2-08e (CR 702.16c-d, 613.1f).** *Built (M2-12a-b, D-102, D-103):* an Aura on a permanent with protection from
it goes to the graveyard (CR 704.5m), and an Equipment becomes unattached (CR 704.5n); equip can't move onto one. *Built
(M2-12d, D-107):* an Aura put onto the battlefield (CR 303.4f) can't be attached to one, through `canEnchant`, which the
CR 704.5m state-based action shares; Aura spells and equip abilities that target are covered by `legalTargets`. Layers (M2-09):
granted or removed protection goes through `protectionsOf`, with the keywords ("loses all abilities" removes both).
Protection for players changes `isProtectedFrom`'s first parameter to a `Target`. *Needs now:* nothing.

**Paying mana outside casting (CR 117.1d, 605.3a).** Mana abilities may be activated whenever a payment is asked
for, including during resolution: costs to attack or block (CR 508.1i–j, 509.1e–f), "counter unless its controller
pays" and ward (CR 702.21a). Today `ACTIVATE_ABILITY` is accepted only with a `priority` or `payMana` decision
pending, and paying (`casting-steps.ts`) assumes something is being cast and finishes by making it cast. These need a
payment context that isn't `Casting`.

**Costs paid while something waits (CR 616.1, 118.11).** `payCost` performs the sacrifices with `happen` at once.
When a replacement effect needs a choice (M2-08), the sacrifice must be able to wait, and the cost still counts as paid
even if the sacrifice is replaced (CR 118.11): make the payment and "becomes cast or activated" (CR 601.2i) work items
then. A spell or ability that targets a creature and sacrifices one: Siege-Gang Commander sacrificing its own target does
nothing (CR 601.5, 608.2b; `cards/m2-11b/siege-gang-sacrifices-its-target.yaml`). The sacrifice is chosen before the mana abilities'
window (CR 601.2g); a mana ability that sacrifices (none in the pool) could take a creature already chosen, leaving
only cancel: then choose sacrifices after the window, or let the player choose again. "Divided as you choose" with an
amount of X must cap the number of targets at X (CR 601.2d), and casting without paying the mana cost forces X = 0
(CR 107.3b).

**Casting from other zones (CR 601.2a, 734.1, 702.34a flashback).** Casting checks the hand
(`game/cast.ts`), the casting origin records a hand index (`state/casting.ts`), and cancelling puts the card back in
the hand. A card cast from a graveyard or exile must go back where it came from. The check before casting
(`targetsProblem` in `castProblem`) uses the card in its zone as what targets; cast from a graveyard, a "target card in
your graveyard" spell would count itself as a choice before it moves to the stack (CR 115.5), so exclude it there.

**Casting prohibitions (M2-09c1, D-097).** Silence's `cantCastSpells` is asked by `castProblem`, after the "it's in
your hand" check. Casting from other zones, and "cast without paying its mana cost" from a resolving effect (cascade),
must ask it before any zone check; suspend (CR 702.62a) asks the same "could begin to cast" question (Silence's ruling).

**Smaller rules noted while closing the coverage gaps (later: in the code).** "Another target" (CR 115.4, Arc Trail) needs targets distinct
across instances, a check across the groups `game/choose-targets.ts` keeps; emblems (CR 114), which the setup's rule
modifiers already behave like; the extra start-of-game steps some formats take (CR 103.2: sideboards, companions).

**Small keywords that touch M1 code.** Vigilance is built (M2-06a: `attackersTap` skips it). Flash (CR 702.8a) is built (M2-07c1): `castTimingProblem` reads it with `keywordsOf`, printed keywords for now; flash
granted by an effect needs the layer-aware reader (layer 6).

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

**Auras entering without being cast, beyond Open the Vaults (CR 303.4f-g, D-107).** Other effects that put an Aura
onto the battlefield (Academy Researchers, Aura tokens such as Roles, CR 111.10j) choose its host through the same
steps as `returnAllToBattlefield`: `canEnchant`, a `chooseCards` decision with purpose `enchant` and `for`, and
`Destination.attachedTo`. The chooser is the controller-to-be (`under: "owners" | "you"`, M2-13c1); a replacement
changing who controls it as it enters still needs reading there (CR 110.2a). An Aura that enchants a player (Curses, later: CR 303.4, 702.5d) needs players among the options, which
`chooseCards` can't offer, and `AuraHost.host` to take a player. The host's legality is judged on the Aura as it is in
the graveyard; an effect that changes it as it enters (CR 614.12) would need it judged as it will be. *Needs now:*
nothing.
