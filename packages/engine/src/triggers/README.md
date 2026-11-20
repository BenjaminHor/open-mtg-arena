# engine/src/triggers

Triggered abilities (CR 603), from the event that triggers one to the ability on the stack. A card's triggered
abilities are data in `CardDef.triggers` (`cards/types.ts`): a condition (`when`), an optional "intervening if"
(`onlyIf`, CR 603.4), "you may" (`optional`), targets and effects. They're read through `triggersOf`
(`rules/abilities.ts`), so an effect that adds or removes abilities (layer 6, CR 613.1f) changes them in one place.

## From event to stack

1. **Detect** (`detect.ts`, `detectTriggers`). Each batch of events is matched against the triggered abilities of the
   permanents on the battlefield (only permanents' abilities trigger, CR 113.6). Called from `checkTriggers` in
   `pipeline/happen.ts` for every event that goes through the pipeline (drawing, discarding, damage, life gain), and
   from the places that emit events outside it, each for its own event only: a step beginning (`game/steps.ts`),
   attackers declared (`combat/declare-attackers.ts`), blockers declared (`combat/declare-blockers.ts`, one trigger per
   creature blocked or blocking, CR 509.3), a spell becoming cast (`game/casting-steps.ts`, CR 601.2i), a
   land tapped for mana (`TAPPED_FOR_MANA`, `mana/activate.ts`, CR 106.12a), a permanent becoming a target as a target
   is chosen (`BECAME_TARGET`, `game/choose-targets.ts`, CR 115.1). An intervening if that's false as the event happens means no trigger. A match
   becomes a `PendingTrigger` (`state/triggers.ts`) in `GameState.pendingTriggers`, remembering its source, the
   source's controller then (CR 603.3a) and what triggered it (the player and object "that player", "it" refer to).
2. **Put on the stack** (`put-on-stack.ts`). The next time a player would receive priority, after state-based actions
   (CR 117.5), `givePriority` (`game/priority.ts`) takes all the waiting triggers as one batch. The active player's go
   on first, then each other player's in turn order (APNAP, CR 603.3b); a player with two or more orders theirs (the
   `orderTriggers` decision), unless they're identical: the same ability of the same source with the same event data,
   which no order can tell apart (D-077). Each chooses its targets as it goes on (CR 603.3d), through the same target steps as a
   spell (`game/casting-steps.ts`, a `Casting` with origin `trigger`) but with no cost, no `ABILITY_ACTIVATED` and no
   cancel; one with too few legal targets is removed instead. Then priority is given again, so state-based actions
   and triggers that came up meanwhile are dealt with first, as a new batch.
3. **Resolve** (`game/resolve.ts`). As for an activated ability, plus: the intervening if is checked again, and if
   it's false the ability is removed and does nothing (CR 603.4, 608.2a); "you may" asks its controller as it resolves
   (`chooseYesNo`, purpose `optional`).

**Delayed triggers** (`delayed.ts`, CR 603.7). An effect (`createDelayedTrigger`) makes one as its spell or ability
resolves, with that spell's or ability's source and controller (CR 603.7d, 603.7e), and it waits in
`GameState.delayedTriggers`. `detectTriggers` matches those first, against the same events, whether or not their
source is still around; one that matches moves to `pendingTriggers` and is gone (CR 603.7b: it triggers only once).
Its `AbilityRef` is `delayed`, carrying its own text, as no card has it printed. For now one waits only for the next
beginning of anyone's step (Dragon Whelp's "at the beginning of the next end step"); the card definitions refuse
anything else.

A source that left the battlefield is read from `GameState.lastKnown` (CR 608.2h): its last known information, kept
from when it left until the stack is next empty. Howling Mine Shattered in response still makes its player draw.

## Entry points

- `detectTriggers(before, after, events, cards)`: adds the triggers these events trigger to the pending list.
- `createDelayedTrigger(state, ability, context)`, `detectDelayed`: make a delayed trigger; trigger the waiting ones.
- `startPuttingTriggers(state, player)`, `putTriggers`, `putOne`: put a batch on the stack, then give `player` priority.
- `orderTriggersProblem`: why a player can't put that trigger next (shared by `legalActions` and `applyAction`).

## Tests

The m2-07a, m2-07b, m2-07c and m2-07c2 scenarios (`test/scenarios/cards/m2-07a/` and so on) show each card and rule;
`test/triggers/delayed.test.ts` a spell's delayed trigger (CR 603.7d); `test/triggers/triggers.test.ts` covers
what the pool's cards can't reach (creatures entering together, a cancelled cast's triggers, the CR 603.3b repeat, an
intervening if turned false before resolving).

## Not built yet

Delayed triggers waiting for anything but the next beginning of a step ("your next upkeep", "when that creature
dies"), or with targets; "leaves the battlefield" abilities, which
look back in time (CR 603.10, M2-14); triggers on activating an ability (no card yet). A trigger
removed for too few legal targets (CR 603.3d) emits no event yet, so a log or the UI doesn't show that it triggered.
