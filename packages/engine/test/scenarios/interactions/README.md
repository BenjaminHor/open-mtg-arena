# Interaction matrix

How the combat mechanics combine (docs/testing.md, "Interaction scenarios"). Each cell links the scenarios that cover the
pair, or says "n/a" (the pair can't meet in the pool, or the CR treats it no differently from either alone: haste
only changes attacking, CR 302.6, so it never meets blocking) or "not yet" (worth a scenario, not written).
`pnpm coverage:rules` lists "not yet" and empty cells as gaps. Only the upper half is filled in; the matrix is
symmetric.

Scenario paths are relative to `packages/engine/test/scenarios/`.

| | Flying | Reach | Haste | Blocking | Burn | Pump | Firebreathing | First strike | Double strike | Trample | Deathtouch | Lifelink | Vigilance | Defender | Landwalk | Unblockable | Block any number | Can't block |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Flying | — | [reach-blocks-flyer](../combat/reach-blocks-flyer.yaml) | n/a | [flyer-blocks-flyer](../combat/flyer-blocks-flyer.yaml), [flyer-blocks-ground-creature](../combat/flyer-blocks-ground-creature.yaml), [flyer-cant-be-blocked-by-ground-creature](../combat/flyer-cant-be-blocked-by-ground-creature.yaml) | n/a | n/a | n/a | n/a | n/a | n/a | [deadly-recluse-deathtouch](../cards/m2-06a/deadly-recluse-deathtouch.yaml) | n/a | n/a | n/a | n/a | [phantom-warrior](../cards/m2-06b/phantom-warrior.yaml) | n/a | n/a |
| Reach | | — | n/a | [reach-blocks-flyer](../combat/reach-blocks-flyer.yaml) | n/a | n/a | n/a | n/a | n/a | n/a | [deadly-recluse-deathtouch](../cards/m2-06a/deadly-recluse-deathtouch.yaml) | n/a | n/a | n/a | n/a | [phantom-warrior](../cards/m2-06b/phantom-warrior.yaml) | n/a | n/a |
| Haste | | | — | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Blocking | | | | — | [blocker-of-a-removed-attacker-deals-no-damage](../combat/blocker-of-a-removed-attacker-deals-no-damage.yaml), [removed-attacker-still-counts-as-declared](../combat/removed-attacker-still-counts-as-declared.yaml), [one-of-two-blockers-dies](../combat/one-of-two-blockers-dies.yaml) | [giant-growth-after-blocks](pump/giant-growth-after-blocks.yaml) | [firebreathing-in-response-to-a-block](../activated/firebreathing-in-response-to-a-block.yaml) | [viashino-spearhunter-first-strike](../cards/m2-06a/viashino-spearhunter-first-strike.yaml), [first-strike-blocker-survives](../cards/m2-06a/first-strike-blocker-survives.yaml), [first-strikers-on-both-sides](../cards/m2-06a/first-strikers-on-both-sides.yaml), [first-strike-blocker](../cards/m2-06a/first-strike-blocker.yaml) | [strikes-and-trample.test.ts](../../combat/strikes-and-trample.test.ts) | [stampeding-rhino-trample](../cards/m2-06a/stampeding-rhino-trample.yaml), [stampeding-rhino-two-blockers](../cards/m2-06a/stampeding-rhino-two-blockers.yaml), [stampeding-rhino-two-blockers-short](../cards/m2-06a/stampeding-rhino-two-blockers-short.yaml), [stampeding-rhino-no-excess](../cards/m2-06a/stampeding-rhino-no-excess.yaml), [stampeding-rhino-blocking](../cards/m2-06a/stampeding-rhino-blocking.yaml) | [deathtouch-big-creature](../cards/m2-06a/deathtouch-big-creature.yaml) | [child-of-night-blocking](../cards/m2-06a/child-of-night-blocking.yaml), [child-of-night-lifelink-blocked](../cards/m2-06a/child-of-night-lifelink-blocked.yaml) | n/a | [wall-of-faith-defender](../cards/m2-06b/wall-of-faith-defender.yaml) | [bog-wraith-swampwalk](../cards/m2-06b/bog-wraith-swampwalk.yaml), [bog-wraith-no-swamp](../cards/m2-06b/bog-wraith-no-swamp.yaml), [emerald-oryx-forestwalk](../cards/m2-06b/emerald-oryx-forestwalk.yaml) | [phantom-warrior](../cards/m2-06b/phantom-warrior.yaml), [dread-warlock](../cards/m2-06b/dread-warlock.yaml) | [palace-guard](../cards/m2-06b/palace-guard.yaml), [palace-guard-one-blocker-each](../cards/m2-06b/palace-guard-one-blocker-each.yaml) | [panic-attack](../cards/m2-06b/panic-attack.yaml), [panic-attack-ends](../cards/m2-06b/panic-attack-ends.yaml) |
| Burn | | | | | — | [pump-saves-a-damaged-creature](../state-based-actions/pump-saves-a-damaged-creature.yaml), [damage-and-pump-end-together](../characteristics/damage-and-pump-end-together.yaml) | n/a | n/a | n/a | [stampeding-rhino-blocker-gone](../cards/m2-06a/stampeding-rhino-blocker-gone.yaml) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Pump | | | | | | — | [giant-growth-and-firebreathing](pump/giant-growth-and-firebreathing.yaml) | [pump-between-damage-steps](first-strike/pump-between-damage-steps.yaml) | n/a | [pumped-blocker-needs-more](trample/pumped-blocker-needs-more.yaml) | [pump-doesnt-save](deathtouch/pump-doesnt-save.yaml) | [pump-gains-more](lifelink/pump-gains-more.yaml) | n/a | [wall-of-faith-defender](../cards/m2-06b/wall-of-faith-defender.yaml) | n/a | n/a | n/a | n/a |
| Firebreathing | | | | | | | — | n/a | n/a | n/a | n/a | n/a | n/a | [wall-of-fire](../cards/m2-06b/wall-of-fire.yaml) | n/a | n/a | n/a | n/a |
| First strike | | | | | | | | — | [strikes-and-trample.test.ts](../../combat/strikes-and-trample.test.ts) | n/a | [first-strike-kills-deathtouch-blocker](../cards/m2-06a/first-strike-kills-deathtouch-blocker.yaml) | [lifelink-too-late](../cards/m2-06a/lifelink-too-late.yaml) | n/a | n/a | n/a | n/a | [palace-guard-and-first-strike](block-any-number/palace-guard-and-first-strike.yaml) | n/a |
| Double strike | | | | | | | | | — | [strikes-and-trample.test.ts](../../combat/strikes-and-trample.test.ts) | n/a | [strikes-and-trample.test.ts](../../combat/strikes-and-trample.test.ts) | n/a | n/a | n/a | n/a | n/a | n/a |
| Trample | | | | | | | | | | — | [stampeding-rhino-deathtouch-blocker](../cards/m2-06a/stampeding-rhino-deathtouch-blocker.yaml), [strikes-and-trample.test.ts](../../combat/strikes-and-trample.test.ts) | n/a | n/a | n/a | n/a | n/a | [palace-guard-trample-example](../cards/m2-06b/palace-guard-trample-example.yaml) | n/a |
| Deathtouch | | | | | | | | | | | — | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| Lifelink | | | | | | | | | | | | — | n/a | n/a | n/a | [dread-warlock](../cards/m2-06b/dread-warlock.yaml) | n/a | n/a |
| Vigilance | | | | | | | | | | | | | — | n/a | n/a | n/a | n/a | n/a |
| Defender | | | | | | | | | | | | | | — | n/a | n/a | n/a | n/a |
| Landwalk | | | | | | | | | | | | | | | — | n/a | n/a | n/a |
| Unblockable | | | | | | | | | | | | | | | | — | n/a | n/a |
| Block any number | | | | | | | | | | | | | | | | | — | n/a |
| Can't block | | | | | | | | | | | | | | | | | | — |

- **Flying**: CR 702.9 (Furnace Whelp). **Reach**: CR 702.17 (Giant Spider). **Haste**: CR 702.10 (Raging Goblin).
- **Blocking**: declaring blockers, several blockers, removed attackers (CR 509, 510, 506.4).
- **Burn**: damage spells (Shock, Lightning Bolt, Volcanic Hammer; CR 120). **Pump**: Giant Growth (CR 613.4c).
- **Firebreathing**: Furnace Whelp's `{R}: +1/+0 until end of turn` (CR 602).
- **First strike**: CR 702.7, 510.4 (Viashino Spearhunter, Razorfoot Griffin). **Double strike**: CR 702.4 (no Magic
  2010 card; test creatures in a unit test). **Trample**: CR 702.19 (Stampeding Rhino). **Deathtouch**: CR 702.2
  (Deadly Recluse). **Lifelink**: CR 702.15 (Child of Night). **Vigilance**: CR 702.20 (Serra Angel, Griffin
  Sentinel). A cell links a unit test where no pool card can show the pair.
- **Defender**: CR 702.3 (Wall of Faith, Wall of Fire). **Landwalk**: CR 702.14 (Bog Wraith, Emerald Oryx).
  **Unblockable**: "can't be blocked (except by ...)" (Phantom Warrior, Dread Warlock; CR 509.1b). **Block any
  number**: Palace Guard (CR 509.1a, 510.1d). **Can't block**: Panic Attack (CR 509.1b).

When a mechanic arrives, add a row and a column, and fill in every cell before the task is done.
