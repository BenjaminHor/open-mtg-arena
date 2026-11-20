# M2 — Rules depth

**Goal:** the engine plays a classic core set, about 200 to 250 cards, correctly and fully: the rules systems nearly
every card touches (triggered abilities, replacement and prevention effects, the full layer system, static abilities,
costs, counters, tokens, auras and equipment) and the evergreen keywords, each proven by the cards that use them. Still
headless: the owner playtests through the CLI. The web app and the AI come in M3 (D-051).

Reviewed with the owner as an M1 exit criterion; decisions at the end.

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

Magic 2010 (M10), decided with the owner (D-053). Each card is in the pool only when it's fully scripted and tested. The pool's
cards drive which rules are built, so the first task maps every card to the mechanics it needs.

## Tasks

In order: the foundations first (M2-01 to M2-04), then each system. The order comes from M2-02's mechanics map
(`m2-pool.md`): plain effects and keywords come early because most cards wait only on them. **Each system task also
scripts the pool cards that become playable with it** (`m2-pool.md`, "Playable after"), with scenarios, so the pool and
the fuzzer's decks grow task by task. Each task should fit in one or a few focused sessions; split any that don't.

**M2-01 Hidden information fix.** Done (D-054): a card coming out of a hand or library into a public zone gets a new
card id, `eventsFor` shows only the side of a move the viewer can see, and another player's cancel hides the restored
id. *Accept:* engine tests with two worlds (YAML can't compare views) show a cancelled card can't be told apart from
another copy, nor a played land or a discarded card; the fuzzer's leak check covers it.

**M2-02 The pool and its mechanics.** `docs/milestones/m2-pool.md`: every Magic 2010 card, the systems it needs, the
task after which it's playable, the special rules some cards need, and the prebuilt decks. *Accept:* the owner has read
the mechanics table; every card maps to a task.

**M2-03 Events and last known information.** Every game event goes through one propose → replace → perform → trigger
pipeline (future-rules.md), and a last-known-information store keeps objects as they last existed (CR 608.2h, 603.10).
No card behavior changes yet. *Accept:* the golden games and replays are unchanged; unit tests for the pipeline and
the store.

**M2-04 Targeting and costs with context.** Targeting knows its source and controller, and targets can be restricted
(CR 115, 601.2c: "target nonblack creature", "attacking or blocking", a card in a graveyard, a spell), with a variable
number of targets and divided damage (CR 601.2d). Costs become a list of parts with the total computed in one place
(CR 601.2f–h, 118): X, sacrifice and other additional costs, cost increases. Paying mana outside casting (CR 117.1d,
605.3a) where the pool needs it. *Accept:* scenarios for each target restriction and cost kind the pool uses, with
negative cases.

**M2-05 Effects and keyword actions (CR 701).** The effects most cards are made of: destroy, exile, sacrifice, draw,
discard (chosen and at random), mill, search a library and shuffle, reveal, look at the top cards and reorder, return
to hand or to the battlefield, tap and untap, gain and lose life, counter target spell (CR 701.6), damage to each
creature or player, amounts from a count ("for each Swamp you control"), and mana of a chosen color. *Accept:*
scenarios per effect; the cards that become playable are scripted.

**M2-06 Keywords and attack or block restrictions (CR 702, 506–511).** First strike and double strike with the extra
damage step (CR 510.4), trample (with lethal damage, CR 702.19), deathtouch, lifelink, vigilance, defender, landwalk,
flash, shroud, indestructible, "can't be countered"; "can't be blocked (except by ...)", "can block any number",
"can't attack or block alone", and requirements ("attacks each combat if able", lure; CR 508.1c–d, 509.1b–c).
Protection's targeting and blocking parts (CR 702.16b, 702.16f); its damage prevention comes with M2-08, and
"can't be enchanted or equipped" with M2-12. *Accept:* scenarios
per keyword and the interaction matrix filled in for every pair.

**M2-07 Triggered abilities (CR 603).** "When", "whenever" and "at" triggers: entering, dying and leaving the
battlefield (looking back in time, CR 603.10), attacking and blocking, casting, drawing and discarding, damage,
beginning-of-step triggers, "becomes the target", delayed triggers (CR 603.7). Putting them on the stack in APNAP order
with each player ordering their own (CR 603.3b), targets chosen as they're put on the stack, "intervening if"
(CR 603.4), "may". *Accept:* scenarios per trigger kind, including two triggering together, a trigger whose source is
gone, and an illegal target on resolution.

**M2-08 Replacement and prevention effects (CR 614–616).** "Enters tapped (unless)", "as it enters, choose"
(CR 614.12), "if it would ..., ... instead", regeneration (CR 701.19), damage prevention and redirection, protection's
damage prevention (CR 702.16e), and the affected player ordering several replacements (CR 616.1). *Accept:* scenarios
for each kind the pool uses, two replacements on one event, and a replacement applying only once (CR 614.5).

**M2-09 The full layer system and static abilities (CR 613, 604, 611).** Layers 1 to 7 as one board-wide pass with
timestamps and dependencies (CR 613.7, 613.8): control, type, color, ability adding and removing,
characteristic-defining and modified power and toughness. Static abilities (anthems, "creatures you control have
flying", "can't cast spells"); "can't" beats "can" (CR 101.2); effects from resolved spells lock their affected set
(CR 611.2c). *Accept:* scenarios for each layer the pool reaches, timestamp order where it matters, and at least one
dependency example from the CR.

**M2-10 Counters (CR 122).** +1/+1 and -1/-1 counters and their annihilation (CR 704.5q), other counters the pool uses
(wish counters), entering with counters, counters leaving with the object (CR 122.2). *Accept:* scenarios, including a
creature with both kinds.

**M2-11 Tokens (CR 111).** Token objects with their own characteristics source, tokens leaving the battlefield and
ceasing to exist (CR 704.5d), and every rules check that skips non-cards today handling them (future-rules.md).
*Accept:* scenarios for creating tokens and a token dying.

**M2-12 Auras and equipment (CR 303.4, 301.5, 702.6).** Casting an Aura with its enchant target, attaching,
unattaching, equip, protection's "can't be enchanted or equipped" (CR 702.16c–d), and the state-based actions for
illegal attachments (CR 704.5m, 704.5n). *Accept:* scenarios for attaching, the enchanted creature dying, and an
illegal attachment.

**M2-13 Planeswalkers (CR 306, 606, 704.5i).** M10 has five. Loyalty abilities once per turn at sorcery speed,
damage to planeswalkers ("any target" includes them, CR 115.4), attacking a planeswalker (several possible defenders,
CR 508.1b). *Accept:* scenarios for activating, attacking, and a planeswalker with no loyalty.

**M2-14 Special rules and the rest of the pool.** The rules only a few cards need (`m2-pool.md`, "Special rules"):
copies (CR 707), extra turns (CR 500.7), revealed hands and library tops, naming a card, "doesn't untap", "can't lose",
no maximum hand size, and the rest. Then any card not yet scripted. New golden games with the pool's prebuilt decks;
the fuzzer plays them and random pool decks. *Accept:* every card in `m2-pool.md` scripted and tested.

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

## Decided with the owner

1. **The set is Magic 2010 (M10)** (D-053): the classic core set that brought in the modern rules (combat damage no
   longer uses the stack). It already holds Lightning Bolt and many M1 cards, and covers triggers, auras, equipment,
   tokens, counters, regeneration, planeswalkers, X spells, counterspells and most evergreen keywords.
2. **Planeswalkers are in M2** (D-053), since the goal is every two-player rule.
