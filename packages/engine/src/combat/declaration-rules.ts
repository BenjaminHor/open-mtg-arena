// Rules about a whole declaration of attackers or blockers, checked as it's finished: restrictions ("can't attack or
// block alone", CR 506.5, 508.1c, 509.1b) and requirements ("attacks each combat if able", "all creatures able to block
// it do so", CR 508.1d, 509.1c). One creature's own restrictions (defender, evasion) are in rules/combat.ts and limit
// what can be added at all.
//
// A declaration must obey every restriction and as many requirements as any legal declaration could. The pool's only
// whole-declaration restriction is "alone", which adding a creature never breaks, so that maximum is worked out
// directly rather than by trying every declaration: each requirement that can be obeyed is, unless that leaves one
// "alone" creature declared and nothing else can join it. Restrictions that adding a creature can break (menace,
// "no more than one creature can attack") will need a search over declarations (later: CR 702.111b).

import type { CardDatabase } from "../cards/types.ts";
import { staticAbilitiesOf } from "../rules/abilities.ts";
import type { Attack, Block } from "../state/combat.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { possibleAttacks } from "./declare-attackers.ts";
import { possibleBlocks } from "./declare-blockers.ts";

/** Why this declaration of attackers can't be finished, or null (CR 508.1c–d). */
export function attackDeclarationProblem(
  state: GameState,
  chosen: readonly Attack[],
  cards: CardDatabase,
): string | null {
  const attackers = chosen.map((a) => a.attacker);
  if (declaredAlone(state, attackers, cards)) {
    return "a creature that can't attack alone is the only attacker (CR 508.1c)";
  }
  const options = possibleAttacks(state, [], cards);
  const able = unique(options.map((a) => a.attacker));
  // Each creature's best: the most requirements one of its possible attacks obeys.
  const obeyable = able.map((creature) => ({
    creature,
    count: Math.max(...options.filter((a) => a.attacker === creature).map((a) => attackRequirements(state, a, cards))),
  }));
  const most = mostObeyable(state, obeyable, able, cards);
  const obeyed = chosen.reduce((sum, attack) => sum + attackRequirements(state, attack, cards), 0);
  return obeyed < most
    ? `${most - obeyed} more requirement${most - obeyed === 1 ? "" : "s"} to attack could be obeyed (CR 508.1d)`
    : null;
}

/** Why this declaration of blockers can't be finished, or null (CR 509.1b–c). */
export function blockDeclarationProblem(
  state: GameState,
  chosen: readonly Block[],
  cards: CardDatabase,
): string | null {
  const blockers = unique(chosen.map((b) => b.blocker));
  if (declaredAlone(state, blockers, cards)) return "a creature that can't block alone is the only blocker (CR 509.1b)";
  const options = possibleBlocks(state, [], cards);
  const able = unique(options.map((b) => b.blocker));
  const lures = unique(options.map((b) => b.attacker)).filter((attacker) => isLure(state, attacker, cards));
  const isLureAttacker = (attacker: ObjectId) => lures.includes(attacker);
  const obeyable = able.map((creature) => {
    // "All creatures able to block it do so": one requirement for each such attacker this creature could block. A
    // creature blocks one attacker (Palace Guard, any number), so that's how many it can obey at once.
    const canBlockLures = options.filter((b) => b.blocker === creature && isLureAttacker(b.attacker)).length;
    return { creature, count: canBlockMany(state, creature, cards) ? canBlockLures : Math.min(canBlockLures, 1) };
  });
  const most = mostObeyable(state, obeyable, able, cards);
  const obeyed = chosen.filter((b) => isLure(state, b.attacker, cards)).length;
  return obeyed < most
    ? `${most - obeyed} more requirement${most - obeyed === 1 ? "" : "s"} to block could be obeyed (CR 509.1c)`
    : null;
}

/**
 * Whether this declaration of attackers could still be finished, by adding picks to it: a hint for players
 * (`seatView`), never a rule. Picks are added greedily, each time one obeying the most requirements (CR 508.1d), until
 * the declaration can be finished or nothing can be added. Adding a pick never breaks the pool's one whole-declaration
 * restriction ("can't attack alone", CR 508.1c), so this finds a way to finish when this declaration has one. A
 * restriction that adding can break, such as menace, would need a search (later: CR 702.111b).
 */
export function attacksCanFinish(state: GameState, chosen: readonly Attack[], cards: CardDatabase): boolean {
  let current = [...chosen];
  for (;;) {
    if (attackDeclarationProblem(state, current, cards) === null) return true;
    const picks = possibleAttacks(state, current, cards);
    const best = mostObeying(picks, (a) => attackRequirements(state, a, cards));
    if (best === undefined) return false;
    current = [...current, best];
  }
}

/** The same for blockers: blocks of an attacker all able creatures must block come first (CR 509.1c). */
export function blocksCanFinish(state: GameState, chosen: readonly Block[], cards: CardDatabase): boolean {
  let current = [...chosen];
  for (;;) {
    if (blockDeclarationProblem(state, current, cards) === null) return true;
    const picks = possibleBlocks(state, current, cards);
    const best = mostObeying(picks, (b) => (isLure(state, b.attacker, cards) ? 1 : 0));
    if (best === undefined) return false;
    current = [...current, best];
  }
}

/** The first pick obeying the most requirements; undefined when there are none. */
function mostObeying<T>(picks: readonly T[], requirements: (pick: T) => number): T | undefined {
  let best: { pick: T; count: number } | undefined;
  for (const pick of picks) {
    const count = requirements(pick);
    if (best === undefined || count > best.count) best = { pick, count };
  }
  return best?.pick;
}

/**
 * The most requirements a legal declaration could obey: every creature's, except when only one creature has any, it
 * can't be declared alone, and no other creature could be declared with it (CR 508.1c's example: two such creatures may
 * attack together).
 */
function mostObeyable(
  state: GameState,
  obeyable: readonly { creature: ObjectId; count: number }[],
  able: readonly ObjectId[],
  cards: CardDatabase,
): number {
  const withRequirements = obeyable.filter((o) => o.count > 0);
  const total = withRequirements.reduce((sum, o) => sum + o.count, 0);
  const only = withRequirements.length === 1 ? withRequirements[0] : undefined;
  if (only === undefined || !cantBeAlone(state, only.creature, cards)) return total;
  return able.some((id) => id !== only.creature) ? total : total - only.count;
}

/**
 * How many requirements this attack obeys: the creature's "attacks each combat if able" (attacking a planeswalker obeys
 * it too), and each "attacks [player] this turn if able" when it attacks that player, not one of their planeswalkers.
 */
function attackRequirements(state: GameState, attack: Attack, cards: CardDatabase): number {
  const own = staticAbilitiesOf(state, attack.attacker, cards).filter((a) => a.kind === "attacksEachCombat").length;
  const effects = state.effects.filter(
    (e) =>
      e.change.kind === "mustAttack" &&
      e.change.player === attack.defender &&
      attack.attacked === undefined &&
      e.affected.includes(attack.attacker),
  ).length;
  return own + effects;
}

/** One creature declared, and it can't attack or block alone (CR 506.5). */
function declaredAlone(state: GameState, creatures: readonly ObjectId[], cards: CardDatabase): boolean {
  return creatures.length === 1 && cantBeAlone(state, creatures[0] as ObjectId, cards);
}

function cantBeAlone(state: GameState, creature: ObjectId, cards: CardDatabase): boolean {
  return staticAbilitiesOf(state, creature, cards).some((a) => a.kind === "cantAttackOrBlockAlone");
}

function isLure(state: GameState, attacker: ObjectId, cards: CardDatabase): boolean {
  return staticAbilitiesOf(state, attacker, cards).some((a) => a.kind === "mustBeBlockedByAllAble");
}

function canBlockMany(state: GameState, creature: ObjectId, cards: CardDatabase): boolean {
  return staticAbilitiesOf(state, creature, cards).some((a) => a.kind === "canBlockAnyNumber");
}

function unique<T>(items: readonly T[]): T[] {
  return items.filter((x, i) => items.indexOf(x) === i);
}
