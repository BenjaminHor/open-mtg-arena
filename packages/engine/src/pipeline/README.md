# engine/src/pipeline

The event pipeline (docs/architecture.md, "Effects, events, replacements, triggers"; D-056). Every game event goes
through `happen`: moving a card, destroying, sacrificing, countering, dealing damage, gaining and losing life, tapping,
untapping, adding mana, drawing, discarding, revealing, shuffling, playing a land. One path means replacement and prevention effects (CR 614–616, M2-08) and triggered
abilities (CR 603, M2-07) each plug in once, and see every event.

## How an event happens

1. **Propose.** The caller builds a `ProposedEvent` (`proposed.ts`) and calls `happen(state, proposed, cards)`. A
   `SingleEvent` changes one object or player (or is one damage event, CR 120.4). Events at the same time are one
   `simultaneous` event: the state-based actions of a check, the untap step, the attackers tapping, the cleanup
   discard, a mulligan's hand going back.
2. **Replace** (`happen.ts`, `replace`): replacement and prevention effects modify each event, every member of a
   batch against the state before the batch. Only CR 120.8 is here so far: 0 damage is dropped, so nothing can replace
   it.
3. **Perform** (`perform.ts`): a `switch` that calls the primitives in `zones/`, `permanents/`, `effects/`, `mana/`
   and `game/land-played.ts`, which emit the `GameEvent`s. Each event is performed whole: destroying a permanent is
   its move to the graveyard (CR 701.8a), not a second event.
4. **Trigger** (`happen.ts`, `checkTriggers`): once, after everything, with the state from before, for abilities that
   look back in time (CR 603.10). Nothing triggers yet.

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
- players losing or conceding (CR 104.3) and the game ending;
- `createGame`'s setup, and advancing the seeded RNG for a random pick (`effects/player-effects.ts`'s random discard):
  the pick is made first, then its event goes through `happen`.

## Not built yet

- **Pausing for a choice** (M2-08). `happen` becomes a work item that can wait for a decision; every caller that does
  more after `happen` returns must then queue the rest as work: `startCast` (`game/cast.ts`), `playLand`, `putOnBottom`
  and the pregame loops, `finishAttackers`, `combatDamage`, `checkStateBasedActions`, `finishCleanup`, resolution
  (`game/resolve.ts`), `drawEach` and `discardAtRandom` (`effects/player-effects.ts`), the draw and untap steps, and mana abilities (`mana/activate.ts`), which resolve at once
  (CR 605.3b) and may need their own path.
- **Moves that go elsewhere or nowhere.** `startCast` throws if its card didn't move to the stack; a replacement that
  changes that (CR 614.6) needs a real path.
- **Drawing several cards** as one instruction (CR 121.2a): "draw N" is N single draws for now (D-060); the container
  comes with the first replacement that needs it (M2-08).
- **Events triggers will match that are emitted outside the pipeline:** `TURN_BEGAN`, `STEP_BEGAN`, `SPELL_CAST`,
  `ABILITY_ACTIVATED`, `ATTACKERS_DECLARED`, `BLOCKERS_DECLARED`, `SPELL_RESOLVED`, `PLAYER_LOST`; "becomes the
  target" has no event yet. M2-07 routes them.
- Last known information (CR 608.2h, 603.10), with its first reader.

Tests: `test/pipeline/pipeline.test.ts` (what each event does, and which events the engine batches),
`only-the-pipeline-performs.test.ts`, and every scenario, golden game and replay, which this path runs through
unchanged.
