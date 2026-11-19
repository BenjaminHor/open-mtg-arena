# Interaction matrix

How the M1 mechanics combine (docs/testing.md, "Interaction scenarios"). Each cell links the scenarios that cover the
pair, or says "n/a" (the pair can't meet in the M1 pool, or the CR treats it no differently from either alone) or
"not yet" (worth a scenario, not written). `pnpm coverage:rules` lists "not yet" cells as gaps. Only the upper half is
filled in; the matrix is symmetric.

Scenario paths are relative to `packages/engine/test/scenarios/`.

| | Flying | Reach | Haste | Blocking | Burn | Pump | Firebreathing |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Flying | — | [reach-blocks-flyer](../combat/reach-blocks-flyer.yaml) | n/a | [flyer-blocks-flyer](../combat/flyer-blocks-flyer.yaml), [flyer-blocks-ground-creature](../combat/flyer-blocks-ground-creature.yaml), [flyer-cant-be-blocked-by-ground-creature](../combat/flyer-cant-be-blocked-by-ground-creature.yaml) | n/a | n/a | [firebreathing-in-response-to-a-block](../activated/firebreathing-in-response-to-a-block.yaml) |
| Reach | | — | n/a | [reach-blocks-flyer](../combat/reach-blocks-flyer.yaml), [one-of-two-blockers-dies](../combat/one-of-two-blockers-dies.yaml) | n/a | n/a | [firebreathing-in-response-to-a-block](../activated/firebreathing-in-response-to-a-block.yaml) |
| Haste | | | — | [haste-attacks-right-away](../combat/haste-attacks-right-away.yaml) | n/a | n/a | n/a |
| Blocking | | | | — | [blocker-of-a-removed-attacker-deals-no-damage](../combat/blocker-of-a-removed-attacker-deals-no-damage.yaml), [removed-attacker-still-counts-as-declared](../combat/removed-attacker-still-counts-as-declared.yaml), [one-of-two-blockers-dies](../combat/one-of-two-blockers-dies.yaml) | [giant-growth-after-blocks](pump/giant-growth-after-blocks.yaml) | [firebreathing-in-response-to-a-block](../activated/firebreathing-in-response-to-a-block.yaml) |
| Burn | | | | | — | [pump-saves-a-damaged-creature](../state-based-actions/pump-saves-a-damaged-creature.yaml), [damage-and-pump-end-together](../characteristics/damage-and-pump-end-together.yaml) | n/a |
| Pump | | | | | | — | [giant-growth-and-firebreathing](pump/giant-growth-and-firebreathing.yaml) |
| Firebreathing | | | | | | | — |

- **Flying**: CR 702.9 (Furnace Whelp). **Reach**: CR 702.17 (Giant Spider). **Haste**: CR 702.10 (Raging Goblin).
- **Blocking**: declaring blockers, several blockers, removed attackers (CR 509, 510, 506.4).
- **Burn**: damage spells (Shock, Lightning Bolt, Volcanic Hammer; CR 120). **Pump**: Giant Growth (CR 613.4c).
- **Firebreathing**: Furnace Whelp's `{R}: +1/+0 until end of turn` (CR 602).

When a mechanic arrives, add a row and a column, and fill in every cell before the task is done.
