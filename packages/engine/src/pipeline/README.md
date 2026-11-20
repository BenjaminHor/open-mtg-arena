# engine/src/pipeline

The event pipeline (docs/architecture.md, "Effects, events, replacements, triggers"; D-056). Everything that changes the
game goes through `happen`: draw, discard, move a card, destroy, deal damage, lose life, mark damage, tap, untap, add
mana, shuffle, play a land. One path means replacement and prevention effects (CR 614–616, M2-08) and triggered
abilities (CR 603, M2-07) each plug in once, and see everything.

## How an event happens

1. **Propose.** The caller builds a `ProposedEvent` (`proposed.ts`) and calls `happen(state, proposed, cards)`.
2. **Replace** (`happen.ts`, `replace`): replacement and prevention effects modify it. None exist yet.
3. **Perform** (`perform.ts`): a `switch` that calls the primitives in `zones/`, `permanents/`, `effects/` and
   `mana/`, which emit the `GameEvent`s. A compound event proposes its parts back through `next` (`CarryOut`), so each
   gets its own replacement pass: destroying proposes a zone change, drawing and discarding propose zone changes,
   dealing damage proposes life loss and marked damage, and `simultaneous` proposes each of its members.
4. **Trigger** (`happen.ts`, `checkTriggers`): once, after the event and everything it caused. Nothing triggers yet.

`simultaneous` groups events that happen at the same time (the state-based actions of one check, CR 704.3; attackers
tapping, CR 508.1f), so triggered abilities will see them as one batch.

A caller that needs the new object a move made (the spell just cast, the land just played) reads it from the
`ZONE_CHANGED` event with `zoneChangeOf` (`moved.ts`), not from the proposal: a replacement may change where it goes.

## The rule

Only `perform.ts` calls the primitives (`moveCard`, `destroy`, `dealDamage`, `loseLife`, `markDamage`,
`tapPermanent`, `untapPermanents`, `addMana`, `drawCard`, `discardCards`, `shuffleLibrary`).
`test/pipeline/only-the-pipeline-performs.test.ts` fails if any other engine file imports one. Tests may call them,
to set up a board.

Some state changes are bookkeeping rather than game events and stay where they are: emptying mana pools (CR 500.5),
removing damage and ending effects in cleanup (CR 514.2), turn and step changes, and putting a cancelled cast back
(CR 734.1, D-035), which undoes events rather than causing them.

## Not built yet

- Pausing for a choice. When a replacement needs the affected player to choose an order (CR 616.1), `happen` will have
  to stop and resume as a work item; nothing calls back into the caller, so the callers that read results right away
  (casting, land play) are the ones to change.
- Events that triggers will match but that aren't proposed events yet (`STEP_BEGAN`, `SPELL_CAST`,
  `ATTACKERS_DECLARED`, `SPELL_RESOLVED`): M2-07 decides how `checkTriggers` sees them.
- Last known information (CR 608.2h, 603.10), with its first reader.

Tests: `test/pipeline/pipeline.test.ts` (what each event proposes again), `only-the-pipeline-performs.test.ts`, and
every scenario, golden game and replay, which this path runs through unchanged.
