# engine/src/pipeline

The event pipeline (docs/architecture.md, "Effects, events, replacements, triggers"; D-056). Every game event goes
through `happen`: moving a card, destroying, sacrificing, countering, dealing damage, gaining and losing life, tapping,
untapping, adding mana, drawing, discarding, revealing, reordering a library's top cards, shuffling, playing a land. One path means replacement and prevention effects (CR 614–616, M2-08) and triggered
abilities (CR 603, M2-07) each plug in once, and see every event.

## How an event happens

1. **Propose.** The caller builds a `ProposedEvent` (`proposed.ts`) and calls `happen(state, proposed, cards)`. A
   `SingleEvent` changes one object or player (or is one damage event, CR 120.4). Events at the same time are one
   `simultaneous` event: the state-based actions of a check, the untap step, the attackers tapping, the cleanup
   discard, a mulligan's hand going back.
2. **Replace** (`happen.ts`, `replace`; `replacements.ts`): replacement and prevention effects modify each event,
   every member of a batch against the state before the batch, as each watches for an event about to happen (CR 614.1;
   a checkland's ruling: it doesn't see lands entering with it). So far: 0 damage is dropped, so nothing can
   replace it (CR 120.8); a destroy an indestructible permanent ignores is dropped (CR 702.12b); and a card's own
   replacements about where it goes (`CardDef.replacements`, D-085): "enters tapped unless" and "if it would be put
   into a graveyard from anywhere, ... instead". Destroy, sacrifice, counter and discard carry where a replacement sends
   the card (`Rerouted`), and are still what they were: a discarded card shuffled into a library instead was discarded.
3. **Perform** (`perform.ts`): a `switch` that calls the primitives in `zones/`, `permanents/`, `effects/`, `mana/`
   and `game/land-played.ts`, which emit the `GameEvent`s. Each event is performed whole: destroying a permanent is
   its move to the graveyard (CR 701.8a), not a second event.
4. **Trigger** (`happen.ts`, `checkTriggers`): once, after everything, with the state from before, for abilities that
   look back in time (CR 603.10). It calls `detectTriggers` (`triggers/`), which adds what triggered to
   `GameState.pendingTriggers`; they go on the stack the next time a player would receive priority (CR 117.5, 603.3).

All replacing comes before any performing, so when a replacement needs a player's choice (CR 616.1), `happen` can stop
with nothing changed yet.

A caller that needs the new object a move made (the spell being cast) reads it from the `ZONE_CHANGED` event with
`zoneChangeOf` (`moved.ts`), not from the proposal: a replacement may send the card elsewhere.

## The rule

Only `perform.ts` (and the files that define them) imports the primitives, and only `happen.ts` imports `perform`.
`test/pipeline/only-the-pipeline-performs.test.ts` fails otherwise, and checks that every primitive `perform.ts` calls is
on its list. Primitives never import `happen`. Tests may call anything, to set up a board.

These change the state outside the pipeline, because they're bookkeeping rather than game events, or not yet events
anything can replace or trigger on:
- the flow of the turn: beginning turns and steps, their resets (land plays, CR 305.2; "controlled since the turn
  began", CR 302.6), emptying mana pools (CR 500.5), cleanup's damage removal and effect ending (CR 514.2);
- priority, the work queue and pending decisions;
- casting and activating: putting a spell's choices on it, spending mana from the pool (CR 601.2h), putting an ability
  on the stack and removing it (CR 602.2a, 608.2n), and putting a cancelled cast back (CR 734.1, D-035), which
  undoes events rather than causing them;
- declaring attackers and blockers (the combat record), and creating continuous effects (CR 611.2);
- triggered abilities waiting and going on the stack (`GameState.pendingTriggers`, CR 603.3), and the last known
  information kept as a card leaves the battlefield (`GameState.lastKnown`, CR 608.2h);
- the resolving object's "this way" record (`GameState.resolution`, CR 608.2c, D-064): set as it starts to resolve,
  results added by `remember` in `effects/library-effects.ts` after their events went through `happen`, cleared when
  it finishes, doesn't resolve, or the game ends;
- players losing or conceding (CR 104.3) and the game ending;
- `createGame`'s setup, and advancing the seeded RNG for a random pick (`effects/player-effects.ts`'s random discard):
  the pick is made first, then its event goes through `happen`.

## Not built yet

- **Several replacements on one event** (M2-08c): `replacements.ts` refuses when two apply; the affected player chooses
  (CR 616.1), each applies once (CR 614.5), the rest are checked again (CR 616.1f).
- **Pausing for a choice** (M2-08c). `happen` becomes a work item that can wait for a decision; every caller that does
  more after `happen` returns must then queue the rest as work: `startCast` (`game/cast.ts`), `playLand`, `putOnBottom`
  and the pregame loops, `finishAttackers`, `combatDamage`, `checkStateBasedActions`, `finishCleanup`, resolution
  (`game/resolve.ts`), `drawEach` and `discardAtRandom` (`effects/player-effects.ts`), the draw and untap steps, and mana abilities (`mana/activate.ts`), which resolve at once
  (CR 605.3b) and may need their own path.
- **Moves that go elsewhere or nowhere.** `startCast` throws if its card didn't move to the stack; a replacement that
  changes that (CR 614.6) needs a real path.
- **Drawing several cards** as one instruction (CR 121.2a): "draw N" is N single draws for now (D-060); the container
  comes with the first replacement that needs it (M2-08).
- **Events triggers will match that are emitted outside the pipeline:** `STEP_BEGAN`, `ATTACKERS_DECLARED`,
  `BLOCKERS_DECLARED`, `SPELL_CAST`, `TAPPED_FOR_MANA` and `BECAME_TARGET` are matched where they're emitted
  (`triggers/README.md`); `ABILITY_ACTIVATED` will be when a card needs it.
- Looking back in time for "leaves the battlefield" abilities (CR 603.10, M2-14). Last known information
  (`GameState.lastKnown`, CR 608.2h) is kept as a card leaves the battlefield (`zones/move-card.ts`).

Tests: `test/pipeline/pipeline.test.ts` (what each event does, and which events the engine batches),
`only-the-pipeline-performs.test.ts`, and every scenario, golden game and replay, which this path runs through
unchanged.
