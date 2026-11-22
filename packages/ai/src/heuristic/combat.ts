// Attacks and blocks (CR 508.1, 509.1), by simple combat math on what's visible: a creature attacks when no blocker the
// opponent has untapped could kill it and survive, or when the attack is lethal however they block; a creature blocks
// when it kills the attacker and lives, or trades for something worth as much, and chumps only to stay alive.
// The whole declaration is planned from the board, ignoring the picks already made, so each answer is the next pick of
// one fixed plan: a stateless player that re-planned around its own half-made declaration could go back and forth.

import type { Action, ActionOption, Attack, Block, ObjectId, SeatView, SeenCard } from "@mtg/engine";
import { creaturesOf, creatureValue, has, lifeOf, opponents, power, seenCard, toughnessLeft } from "./board.ts";

type Answer = Extract<Action, { type: "ANSWER" }>;

export function attackAction(shown: SeatView, chosen: readonly Attack[]): Action {
  const planned = attackPlan(shown)
    .filter((a) => !chosen.some((c) => c.attacker === a.attacker))
    .flatMap((next) => picksWhere(shown, (a) => a.kind === "declareAttacker" && sameAttack(a.attack, next)));
  return nextPick(shown, planned);
}

export function blockAction(shown: SeatView, chosen: readonly Block[]): Action {
  const planned = blockPlan(shown)
    .filter((b) => !chosen.some((c) => c.blocker === b.blocker))
    .flatMap((next) =>
      picksWhere(
        shown,
        (a) => a.kind === "declareBlocker" && a.block.blocker === next.blocker && a.block.attacker === next.attacker,
      ),
    );
  return nextPick(shown, planned);
}

/**
 * The next pick of the plan, as long as the declaration could still be finished after it; when a requirement keeps it
 * from finishing now ("all creatures able to block it do so", CR 509.1c), a pick that meets it, the plan's first. Then
 * finishing; taking a pick back only when nothing else is left.
 */
function nextPick(shown: SeatView, planned: readonly ActionOption[]): Action {
  const finish = picksWhere(shown, (a) => a.kind === "finishDeclaring")[0];
  const allPicks = picksWhere(shown, (a) => a.kind === "declareAttacker" || a.kind === "declareBlocker");
  const finishing = (o: ActionOption) => o.finishes === true;
  if (finish === undefined) {
    const meets = planned.find(finishing) ?? allPicks.find(finishing) ?? planned[0] ?? allPicks[0];
    if (meets !== undefined) return meets.action;
  } else {
    const next = planned.find(finishing);
    if (next !== undefined) return next.action;
    return finish.action;
  }
  const back = picksWhere(shown, (a) => a.kind === "takeBack")[0];
  if (back === undefined) throw new Error("no way to finish declaring");
  return back.action;
}

function sameAttack(a: Attack, b: Attack): boolean {
  return a.attacker === b.attacker && a.defender === b.defender && a.attacked === b.attacked;
}

function picksWhere(shown: SeatView, fits: (answer: Answer["answer"]) => boolean): ActionOption[] {
  return shown.options.filter((o) => o.action.type === "ANSWER" && fits(o.action.answer));
}

/** Every attack it would make: each creature's attack on a player if it may, else on what it may attack. */
function attackPlan(shown: SeatView): Attack[] {
  const possible: Record<ObjectId, Attack> = {};
  for (const o of shown.options) {
    if (o.action.type !== "ANSWER" || o.action.answer.kind !== "declareAttacker") continue;
    const attack = o.action.answer.attack;
    const known = possible[attack.attacker];
    if (known === undefined || (known.attacked !== undefined && attack.attacked === undefined)) {
      possible[attack.attacker] = attack;
    }
  }
  const attacks = Object.values(possible).flatMap((a) => {
    const card = seenCard(shown, a.attacker);
    return card === null ? [] : [{ attack: a, card }];
  });
  const blockers = opponents(shown)
    .flatMap((p) => creaturesOf(shown, p))
    .filter((c) => !c.tapped);
  if (
    isLethalAnyway(
      shown,
      attacks.map((a) => a.card),
      blockers,
    )
  )
    return attacks.map((a) => a.attack);
  return attacks.filter((a) => attackIsSafe(a.card, blockers)).map((a) => a.attack);
}

/** No blocker that could block it would kill it and live. */
function attackIsSafe(attacker: SeenCard, blockers: readonly SeenCard[]): boolean {
  if (power(attacker) <= 0) return false;
  return blockers.every((b) => !canBlock(b, attacker) || !(kills(b, attacker) && !kills(attacker, b)));
}

/** All in is lethal even if each of their untapped creatures blocks one of the biggest attackers. */
function isLethalAnyway(shown: SeatView, attackers: readonly SeenCard[], blockers: readonly SeenCard[]): boolean {
  const powers = attackers.map(damageDealt).sort((a, b) => b - a);
  const unblocked = powers.slice(blockers.length).reduce((sum, p) => sum + p, 0);
  return opponents(shown).some((p) => unblocked >= lifeOf(shown, p));
}

/** Blocks that win or trade fairly, then chump blocks only if the damage left would be lethal. */
function blockPlan(shown: SeatView): Block[] {
  const legal = shown.options.flatMap((o) =>
    o.action.type === "ANSWER" && o.action.answer.kind === "declareBlocker" ? [o.action.answer.block] : [],
  );
  const attackers = legal
    .map((b) => b.attacker)
    .filter((id, i, ids) => ids.indexOf(id) === i)
    .flatMap((id) => seenCard(shown, id) ?? [])
    .sort((a, b) => damageDealt(b) - damageDealt(a));
  const plan: Block[] = [];
  const used = (blocker: ObjectId) => plan.some((b) => b.blocker === blocker);
  const blockersFor = (attacker: SeenCard) =>
    legal
      .filter((b) => b.attacker === attacker.id && !used(b.blocker))
      .flatMap((b) => seenCard(shown, b.blocker) ?? [])
      .sort((a, b) => creatureValue(a) - creatureValue(b));
  const take = (blocker: SeenCard, attacker: SeenCard) => plan.push({ blocker: blocker.id, attacker: attacker.id });
  for (const attacker of attackers) {
    const candidates = blockersFor(attacker);
    const wins = candidates.find((b) => kills(b, attacker) && !kills(attacker, b));
    const trade = candidates.find((b) => kills(b, attacker) && creatureValue(attacker) >= creatureValue(b));
    const blocker = wins ?? trade;
    if (blocker !== undefined) take(blocker, attacker);
  }
  // Still dying to what's unblocked: chump the biggest attackers with the least valuable creatures.
  const blocked = (a: SeenCard) => plan.some((b) => b.attacker === a.id);
  let incoming = attackers.filter((a) => !blocked(a) && attacksMe(shown, a)).reduce((s, a) => s + damageDealt(a), 0);
  for (const attacker of attackers) {
    if (incoming < lifeOf(shown, shown.player)) break;
    if (blocked(attacker) || !attacksMe(shown, attacker)) continue;
    const chump = blockersFor(attacker)[0];
    if (chump === undefined) continue;
    take(chump, attacker);
    if (!has(attacker, "trample")) incoming -= damageDealt(attacker);
  }
  return plan;
}

function attacksMe(shown: SeatView, attacker: SeenCard): boolean {
  const attacked = attacker.attacking?.attacked;
  return attacked?.kind === "player" && attacked.player === shown.player;
}

function damageDealt(creature: SeenCard): number {
  return has(creature, "double strike") ? 2 * power(creature) : power(creature);
}

/** Flying can be blocked only by flying or reach (CR 702.9b, 702.17b); other evasion isn't weighed yet. */
function canBlock(blocker: SeenCard, attacker: SeenCard): boolean {
  if (has(attacker, "flying")) return has(blocker, "flying") || has(blocker, "reach");
  return true;
}

/** Whether `a` deals `b` lethal damage in a fight between them, first strike counted (CR 702.7b). */
function kills(a: SeenCard, b: SeenCard): boolean {
  if (power(a) <= 0 || has(b, "indestructible")) return false;
  const strikesFirst = (x: SeenCard) => has(x, "first strike") || has(x, "double strike");
  // Struck down first, `a` deals no regular combat damage.
  if (strikesFirst(b) && !strikesFirst(a) && lethal(b, a)) return false;
  return lethal(a, b);
}

function lethal(a: SeenCard, b: SeenCard): boolean {
  return has(a, "deathtouch") || damageDealt(a) >= toughnessLeft(b);
}
