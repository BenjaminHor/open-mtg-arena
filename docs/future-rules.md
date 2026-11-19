# Future rules and features: what today's code must not block

Every task checks its design against this list (see "Design for what's coming" in `CLAUDE.md`).
The goal isn't to build these early. It's to avoid choices that would force a rewrite when they arrive.
Each entry says what's coming and what it needs from the code being written now.

When a design choice is made with one of these in mind, note it in `decisions.md`. When an item is
implemented, move it out of this file (or mark it done) in the same commit.

## Rules systems

**Full layer system (CR 613), M3.** Copy effects (layer 1), control (2), text-changing (3), type (4),
color (5), ability adding and removing (6), and power/toughness (7a–7d), with timestamps and dependencies.
*Needs now:* every characteristic is read through `characteristics()`, never from raw object fields. Code that
asks "is this a creature?", "who controls this?" or "does it have flying?" must go through it, even in M1.

**Replacement and prevention effects (CR 614–616), M3.** "If a creature would die, exile it instead",
"prevent the next 3 damage", "enters tapped", "if you would draw a card, ...".
*Needs now:* every game event (draw, damage, life change, zone change, counter placement, tapping) goes
through the single propose → replace → perform → trigger pipeline. Nothing changes state directly
outside it, so replacements can be added in one place later.

**Triggered abilities (CR 603), M3.** "When/whenever/at" abilities, including leaves-the-battlefield
triggers that "look back in time" (CR 603.10), delayed triggers, and state triggers.
*Needs now:* events carry enough information to match triggers later (for a zone change: the object as it
last existed, both ids, from and to zones). Keep the last known information of objects that leave a zone.
Events aren't state, so last known information (CR 608.2h, 603.10) needs its own store in `GameState`, added by
the first task that resolves an effect whose source may be gone (M1-14: firebreathing after the Whelp dies).
Abilities on the stack carry `sourceOracleId` + `abilityIndex`; granted abilities (layer 6) and delayed triggers
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
single card record; tokens are objects without a deck card.

**Counters (CR 122), including +1/+1 and -1/-1 annihilation (CR 704.5q).**
*Needs now:* counters live on objects as a map of counter type to number. Keyword counters (CR 122.1b) will need
timestamps (CR 613.7c) for layer 6, which means a state migration (`GameState.version`).

**Control-changing effects and ownership vs. control (CR 108.3, 110.2).**
*Needs now:* code never assumes the controller is the owner. "Your" in card text means controller.
Control is computed (layer 2), so `controlledSinceTurnStart` (CR 302.6) must reset whenever the computed
controller changes, including when a control effect ends. A bare boolean can't see A→B→A in one turn; expect to
replace it with a `{ player, since }` record when control-changing effects arrive.

**Turn structure changes.** Extra turns and extra combat phases (CR 500.7–500.8), skipped steps, and
"at the beginning of the next end step".
*Needs now:* the turn sequence is data the engine walks, not hard-coded control flow.

**Multiplayer (much later).** Turn order with more than two players, APNAP with several players, a player leaving the game.
*Needs now:* nothing assumes exactly two players. Use player lists and turn order, never "the opponent".

## App and game features

**AI search (M3+).** *Needs now:* the reducer stays pure and fast, and state cloning is cheap (structural sharing).
**Saves and replays across versions.** *Needs now:* `GameState.version` exists and replays record the engine version.
**RPG encounters (M5).** *Needs now:* `GameSetup` supports custom starting life, starting permanents and rule
modifiers; `GameResult` reports what the meta layer needs.
**Deckbuilding and the full card database (M4).** *Needs now:* card identity uses Scryfall's `oracle_id`, so decks
can refer to cards the engine doesn't support yet.
**Animations and the board UI (M2).** *Needs now:* every visible change produces an event, with the `cardId` the UI
uses to track a card between zones.
