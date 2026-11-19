# M2 — Rules depth

**Goal:** the engine plays a classic core set, about 200 to 250 cards, correctly and fully: the rules systems nearly
every card touches (triggered abilities, replacement and prevention effects, the full layer system, static abilities,
costs, counters, tokens, auras and equipment) and the evergreen keywords, each proven by the cards that use them. Still
headless: the owner playtests through the CLI. The web app and the AI come in M3 (D-051).

**Draft for review with the owner** (M1 exit criterion). Open questions are at the end.

Every task ends with `pnpm check` green, `docs/status.md` updated, and **every rule it implements cited where it's
implemented and backed by a scenario or a unit test** (D-052; the coverage check allows no gaps). Rules come with the
cards that use them: a task builds a system and scripts the pool cards that need it, with scenarios and interaction
tests (D-051). The CR numbers below are starting points: look them up and follow everything they reference.

## Scope

**In:** the systems below, the evergreen keywords and keyword actions the pool uses, and every card in the chosen set
that two-player games can use (cards whose rules are out of scope are listed and left out, not half-built).

**Out:** multiplayer and casual variants (CR 8, 9; D-051), the web app and the AI (M3), mechanics the set doesn't
use (they come with later sets).

## Card pool

One classic core set (open question 1). Each card is in the pool only when it's fully scripted and tested. The pool's
cards drive which rules are built, so the first task maps every card to the mechanics it needs.

## Tasks

Roughly in order: the foundations first (M2-01 to M2-04), then each system with the cards that need it. Each should
fit in one or a few focused sessions; split any that don't.

**M2-01 Hidden information fix.** The known issue in `status.md`: a card's ids let a player follow it through another
player's hidden hand (CR 402.3, 734.1). A card entering a zone some player can't see gets a new card id, and
`eventsFor` hides the old object id of a card leaving a hidden zone and a cancelled cast's restored id. Needs its own
decision (it changes what a card id means, architecture.md "Object identity"). *Accept:* a scenario-level test shows a
cancelled card can't be told apart from another copy; the fuzzer's leak check covers it.

**M2-02 The pool and its mechanics.** Fetch the set's Oracle data (`pnpm cards:fetch` / `cards:extract`), and write
`docs/milestones/m2-pool.md`: every card, the rules and mechanics it needs, which task builds them, and the cards left
out with the reason. Pick two or three prebuilt decks from the pool for the fuzzer and the golden games. *Accept:* the
owner has read the mechanics table; every card maps to a task or to "left out".

**M2-03 Events and last known information.** Every game event goes through one propose → replace → perform → trigger
pipeline (future-rules.md), and a last-known-information store keeps objects as they last existed (CR 608.2h, 603.10).
No card behavior changes yet. *Accept:* the golden games and replays are unchanged; unit tests for the pipeline and
the store.

**M2-04 Targeting and costs with context.** Targeting knows its source and controller (CR 115, 601.2c; needed for
hexproof, shroud, protection and "target creature an opponent controls"). Costs become a list of parts with the total
computed in one place (CR 601.2f–h, 118): X, additional costs (sacrifice, discard, pay life), cost reductions and
increases. Paying mana outside casting (CR 117.1d, 605.3a) where the pool needs it. *Accept:* scenarios for each cost
kind the pool uses, and targeting restrictions with negative cases.

**M2-05 Triggered abilities (CR 603).** "When", "whenever" and "at" triggers: entering, dying and leaving the
battlefield (looking back in time, CR 603.10), attacking and blocking, beginning-of-step triggers, state triggers,
delayed triggers (CR 603.7). Putting them on the stack in APNAP order with each player ordering their own (CR 603.3b),
targets chosen as they're put on the stack, "intervening if" (CR 603.4). *Accept:* scenarios per trigger kind,
including two triggering together, a trigger whose source is gone, and an illegal target on resolution.

**M2-06 Replacement and prevention effects (CR 614–616).** "Enters tapped", "if it would die, ... instead",
regeneration (CR 701.19), damage prevention, and the affected player ordering several replacements (CR 616.1).
*Accept:* scenarios for each kind the pool uses, two replacements on one event, and a replacement applying only once
(CR 614.5).

**M2-07 The full layer system and static abilities (CR 613, 604, 611).** Layers 1 to 7 as one board-wide pass with
timestamps and dependencies (CR 613.7, 613.8): control, type, color, ability adding and removing, setting and
modifying power and toughness, switching. Static abilities ("other creatures you control get +1/+1", "can't block").
"Can't" beats "can" (CR 101.2). *Accept:* scenarios for each layer the pool reaches, timestamp order where it matters,
and at least one dependency example from the CR.

**M2-08 Counters (CR 122).** +1/+1 and -1/-1 counters and their annihilation (CR 704.5q), other counters the pool
uses, counters leaving with the object (CR 122.2). *Accept:* scenarios, including a creature with both kinds.

**M2-09 Tokens (CR 111).** Token objects with their own characteristics source, tokens leaving the battlefield and
ceasing to exist (CR 704.5d), and every rules check that skips non-cards today handling them (future-rules.md).
*Accept:* scenarios for creating, dying and copying where the pool does it.

**M2-10 Auras and equipment (CR 303.4, 301.5, 702.6).** Casting an Aura with its enchant target, attaching,
unattaching, equip, and the state-based actions for illegal attachments (CR 704.5m, 704.5n). *Accept:* scenarios for
attaching, the enchanted creature dying, and an illegal attachment.

**M2-11 Combat keywords and restrictions (CR 702, 506–511).** First strike and double strike with the extra damage
step (CR 510.4), trample (with the lethal-damage assignment, CR 702.19), deathtouch (with trample), lifelink,
vigilance, menace, defender, reach and flying already done, landwalk or other evasion the set has, attack and block
restrictions and requirements (CR 508.1c–d, 509.1b–c). *Accept:* scenarios per keyword and the interaction matrix
filled in for every pair.

**M2-12 Other keywords and keyword actions the pool uses.** Flash, hexproof, shroud, protection (the four parts of
CR 702.16), counter, destroy, exile, sacrifice, discard, mill, scry, regenerate, and whatever else M2-02 lists.
*Accept:* scenarios per keyword, interaction matrix updated.

**M2-13 Planeswalkers, if the set has them (CR 306, 606, 704.5i).** Loyalty abilities once per turn at sorcery speed,
damage to planeswalkers, attacking a planeswalker (several possible defenders, CR 508.1b). *Accept:* scenarios for
activating, attacking, and a planeswalker with no loyalty.

**M2-14 Scripting the pool.** The remaining cards in batches with the `add-cards` skill, each with scenarios. New
golden games with the pool's prebuilt decks; the fuzzer plays them and random pool decks. *Accept:* every card in
`m2-pool.md` scripted and tested, or listed as left out with the reason.

**M2-15 Hardening.** Mutation testing on the engine (StrykerJS, testing.md section 7) with surviving mutants in rules
code addressed; `pnpm fuzz --games 10000` clean; `pnpm bench` against the budgets; a CR progress report for the
owner, chapter by chapter, of which rules the engine implements and tests. *Accept:* as written.

## Exit criteria

- All tasks accepted, and `pnpm check` green with no coverage gaps.
- Every pool card fully scripted and tested, interactions included; the interaction matrix has no open cells.
- `pnpm fuzz --games 10000` clean with the pool's decks and random pool decks.
- Mutation testing set up, surviving mutants in rules code addressed.
- `rules-judge` has reviewed each system (triggers, replacements, layers, costs, combat keywords) against the CR.
- The owner has played and spot-checked games through the CLI, and the M3 spec has been revised for the new pool and
  reviewed with the owner.

## Open questions for the owner

1. **Which set?** Recommended: **Magic 2010** (M10). It's the classic core set that brought in the modern rules
   (combat damage no longer uses the stack), it already holds this pool's Lightning Bolt and many M1 cards, and it
   covers the core systems: triggers, auras, equipment, tokens, counters, regeneration, planeswalkers, X spells,
   counterspells, and most evergreen keywords. Alternatives: Core Set 2021 (modern templates, similar mechanics), or
   Tenth Edition (no planeswalkers, older templates).
2. **Planeswalkers in M2 or later?** They need several defenders in combat and loyalty abilities. Recommended: in M2
   if the set has them, since the goal is the full two-player rules.
