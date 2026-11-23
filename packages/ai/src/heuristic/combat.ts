// Attacks and blocks (CR 508.1, 509.1), by simple combat math on what's visible: a creature attacks when no blocker the
// opponent has untapped could kill it and survive, when nothing can block it, or when the attack is lethal however
// they block; a creature blocks when it kills the attacker and lives, trades for something worth as much, or holds it
// off, two together kill what neither could, and it chumps to stay out of danger. The declaration is planned from the
// board, with the picks already made counted as part of the plan, so each answer is the next pick of one plan.

import type {
  Action,
  ActionOption,
  Attack,
  Block,
  CardDatabase,
  Keyword,
  ObjectId,
  SeatView,
  SeenCard,
} from "@mtg/engine";
import {
  cardData,
  controlledBy,
  creaturesOf,
  creatureValue,
  has,
  isLand,
  lifeOf,
  opponents,
  permanents,
  power,
  seenCard,
  toughnessLeft,
} from "./board.ts";
import { canBlock, damageDealt, kills } from "./fights.ts";

type Answer = Extract<Action, { type: "ANSWER" }>;

export function attackAction(shown: SeatView, chosen: readonly Attack[], cards: CardDatabase): Action {
  const planned = attackPlan(shown, chosen, cards)
    .filter((a) => !chosen.some((c) => c.attacker === a.attacker))
    .flatMap((next) => picksWhere(shown, (a) => a.kind === "declareAttacker" && sameAttack(a.attack, next)));
  return nextPick(shown, planned);
}

export function blockAction(shown: SeatView, chosen: readonly Block[], cards: CardDatabase): Action {
  const planned = blockPlan(shown, chosen, cards)
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
 * The next pick of the plan, as long as the declaration could still be finished after it (`finishable`), then
 * finishing. When a requirement keeps it from finishing now ("attacks each combat if able", "all creatures able to
 * block it do so", CR 508.1d, 509.1c), the finishable pick obeying the most requirements, the plan's first on a tie, so
 * only what the requirement forces joins the plan. It never adds a pick from which no finish is reachable, so it never
 * has to take one back: a stateless player that did would add the same pick again.
 */
function nextPick(shown: SeatView, planned: readonly ActionOption[]): Action {
  const finish = picksWhere(shown, (a) => a.kind === "finishDeclaring")[0];
  const finishable = (o: ActionOption) => o.finishable === true;
  if (finish !== undefined) return (planned.find(finishable) ?? finish).action;
  const picks = [...planned, ...picksWhere(shown, (a) => a.kind === "declareAttacker" || a.kind === "declareBlocker")];
  let best: ActionOption | undefined;
  for (const pick of picks.filter(finishable))
    if (best === undefined || (pick.obeys ?? 0) > (best.obeys ?? 0)) best = pick;
  if (best !== undefined) return best.action;
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

/**
 * Every attack it would make: each creature's attack on a player if it may, else on what it may attack. The attacks
 * already declared count as made: the options no longer list them, but the plan is the same one.
 */
function attackPlan(shown: SeatView, chosen: readonly Attack[], cards: CardDatabase): Attack[] {
  const possible: Record<ObjectId, Attack> = {};
  for (const o of shown.options) {
    if (o.action.type !== "ANSWER" || o.action.answer.kind !== "declareAttacker") continue;
    const attack = o.action.answer.attack;
    const known = possible[attack.attacker];
    if (known === undefined || (known.attacked !== undefined && attack.attacked === undefined)) {
      possible[attack.attacker] = attack;
    }
  }
  const attacks = [...chosen, ...Object.values(possible)].flatMap((a) => {
    const card = seenCard(shown, a.attacker);
    return card === null ? [] : [{ attack: a, card }];
  });
  const blockers = opponents(shown)
    .flatMap((p) => creaturesOf(shown, p))
    .filter((c) => !c.tapped);
  const evades = (c: SeenCard) => unblockable(shown, c, cards);
  if (
    isLethalAnyway(
      shown,
      attacks.map((a) => a.card),
      blockers,
      evades,
    )
  )
    return attacks.map((a) => a.attack);
  return attacks
    .filter((a) => power(a.card) > 0 && (evades(a.card) || attackIsSafe(a.card, blockers)))
    .map((a) => a.attack);
}

/** No blocker that could block it would kill it and live. */
function attackIsSafe(attacker: SeenCard, blockers: readonly SeenCard[]): boolean {
  return blockers.every((b) => !canBlock(b, attacker) || !(kills(b, attacker) && !kills(attacker, b)));
}

/**
 * All in is lethal even if each of their untapped creatures blocks one of the biggest attackers it could block. An
 * attacker no one can block always gets through.
 */
function isLethalAnyway(
  shown: SeatView,
  attackers: readonly SeenCard[],
  blockers: readonly SeenCard[],
  evades: (c: SeenCard) => boolean,
): boolean {
  const through = attackers.filter(evades).reduce((sum, a) => sum + damageDealt(a), 0);
  const powers = attackers
    .filter((a) => !evades(a))
    .map(damageDealt)
    .sort((a, b) => b - a);
  const unblocked = through + powers.slice(blockers.length).reduce((sum, p) => sum + p, 0);
  return opponents(shown).some((p) => unblocked >= lifeOf(shown, p));
}

/**
 * Whether no creature can block it: "can't be blocked" on the card or from what's attached to it (Whispersilk Cloak),
 * or landwalk when a defender controls a land of that type (CR 509.1b, 702.14c). Read from the cards as printed (later:
 * from the seat view, once effects grant such abilities).
 */
function unblockable(shown: SeatView, attacker: SeenCard, cards: CardDatabase): boolean {
  const printed = cardData(attacker, cards)?.def.statics ?? [];
  if (printed.some((st) => st.kind === "cantBeBlocked" && st.except === undefined)) return true;
  const attached = permanents(shown).filter((c) => c.attachedTo === attacker.id);
  const restricts = (c: SeenCard) =>
    (cardData(c, cards)?.def.statics ?? []).some(
      (st) => st.kind === "attachedRestricts" && st.restrictions.includes("cantBeBlocked"),
    );
  if (attached.some(restricts)) return true;
  const walks: [Keyword, string][] = [
    ["forestwalk", "Forest"],
    ["swampwalk", "Swamp"],
  ];
  const theirLands = opponents(shown)
    .flatMap((p) => controlledBy(shown, p))
    .filter(isLand);
  return walks.some(
    ([k, type]) => has(attacker, k) && theirLands.some((l) => l.characteristics.subtypes.includes(type)),
  );
}

/** At this much life or less after a combat, it chump blocks rather than take the damage. */
const DANGER = 3;

/**
 * Blocks that win, trade fairly, or hold the attacker off safely; then chump blocks while the damage left would bring
 * its life to `DANGER` or less. The blocks already declared count as made, and the rest are planned around them.
 */
function blockPlan(shown: SeatView, chosen: readonly Block[], cards: CardDatabase): Block[] {
  const legal = shown.options.flatMap((o) =>
    o.action.type === "ANSWER" && o.action.answer.kind === "declareBlocker" ? [o.action.answer.block] : [],
  );
  const attackers = permanents(shown)
    .filter((c) => c.attacking !== null && c.characteristics.controller !== shown.player)
    .sort((a, b) => damageDealt(b) - damageDealt(a));
  const plan: Block[] = [...chosen];
  const used = (blocker: ObjectId) => plan.some((b) => b.blocker === blocker);
  const blocked = (a: SeenCard) => plan.some((b) => b.attacker === a.id);
  const blockersFor = (attacker: SeenCard) =>
    legal
      .filter((b) => b.attacker === attacker.id && !used(b.blocker))
      .flatMap((b) => seenCard(shown, b.blocker) ?? [])
      .sort((a, b) => creatureValue(a) - creatureValue(b));
  const take = (blocker: SeenCard, attacker: SeenCard) => plan.push({ blocker: blocker.id, attacker: attacker.id });
  for (const attacker of attackers.filter((a) => !blocked(a))) {
    const candidates = blockersFor(attacker);
    const wins = candidates.find((b) => kills(b, attacker) && !kills(attacker, b));
    const trade = candidates.find((b) => kills(b, attacker) && creatureValue(attacker) >= creatureValue(b));
    const blocker = wins ?? trade ?? candidates.find((b) => !kills(attacker, b) || canRegenerate(shown, b, cards));
    if (blocker !== undefined) take(blocker, attacker);
  }
  // Two creatures together kill a big attacker neither could alone, when that's worth what it can kill of theirs. A
  // pair already half declared is completed with the same partner the plan chose then.
  for (const attacker of attackers.filter((a) => !has(a, "indestructible"))) {
    const on = plan.filter((b) => b.attacker === attacker.id).flatMap((b) => seenCard(shown, b.blocker) ?? []);
    if (on.length > 1 || (on.length === 1 && blocksAlone(on[0] as SeenCard, attacker))) continue;
    const pair = gangBlock(
      attacker,
      [...on, ...blockersFor(attacker)].sort((a, b) => creatureValue(a) - creatureValue(b)),
    );
    if (pair === null || (on.length === 1 && !pair.includes(on[0] as SeenCard))) continue;
    for (const blocker of pair) if (!used(blocker.id)) take(blocker, attacker);
  }
  // Still in danger from what's unblocked: chump the biggest attackers with the least valuable creatures.
  const life = lifeOf(shown, shown.player);
  let incoming = attackers.filter((a) => !blocked(a) && attacksMe(shown, a)).reduce((s, a) => s + damageDealt(a), 0);
  for (const attacker of attackers) {
    if (life - incoming > DANGER) break;
    if (blocked(attacker) || !attacksMe(shown, attacker)) continue;
    const chump = blockersFor(attacker)[0];
    if (chump === undefined) continue;
    take(chump, attacker);
    if (!has(attacker, "trample")) incoming -= damageDealt(attacker);
  }
  return plan;
}

/** A good block on its own: it kills the attacker and lives, trades for something worth as much, or holds it off. */
function blocksAlone(blocker: SeenCard, attacker: SeenCard): boolean {
  const wins = kills(blocker, attacker) && !kills(attacker, blocker);
  const trades = kills(blocker, attacker) && creatureValue(attacker) >= creatureValue(blocker);
  return wins || trades || !kills(attacker, blocker);
}

/**
 * It can regenerate itself (Wall of Bone's "{B}: Regenerate"), already shielded or with a land untapped to pay: it lives
 * through the block (CR 701.19a). The heuristic shields it once blockers are declared (`effect-value.ts`).
 */
function canRegenerate(shown: SeatView, creature: SeenCard, cards: CardDatabase): boolean {
  if (creature.regenerationShields > 0) return true;
  const own = cardData(creature, cards)?.def.abilities ?? [];
  const regenerates = own.some((a) => a.effects.some((e) => e.op === "regenerate" && e.of === "self"));
  return regenerates && controlledBy(shown, shown.player).some((c) => isLand(c) && !c.tapped);
}

/**
 * The cheapest two blockers whose damage together is lethal to the attacker (CR 510.1a), if the attacker is worth more
 * than what its damage could kill of them (it divides its damage as it likes, CR 510.1c). First strike is left out:
 * a first striker could kill one before it deals damage.
 */
function gangBlock(attacker: SeenCard, candidates: readonly SeenCard[]): [SeenCard, SeenCard] | null {
  if (has(attacker, "first strike") || has(attacker, "double strike")) return null;
  let best: { pair: [SeenCard, SeenCard]; cost: number } | null = null;
  for (const [i, a] of candidates.entries()) {
    for (const b of candidates.slice(i + 1)) {
      const deathtouch = has(a, "deathtouch") || has(b, "deathtouch");
      if (!deathtouch && damageDealt(a) + damageDealt(b) < toughnessLeft(attacker)) continue;
      const damage = has(attacker, "deathtouch") ? Number.POSITIVE_INFINITY : damageDealt(attacker);
      const killable = [a, b].filter((x) => damage >= toughnessLeft(x));
      const both = damage >= toughnessLeft(a) + toughnessLeft(b) || (has(attacker, "deathtouch") && damage >= 2);
      const cost = both ? creatureValue(a) + creatureValue(b) : Math.max(0, ...killable.map(creatureValue));
      if (cost < creatureValue(attacker) && (best === null || cost < best.cost)) best = { pair: [a, b], cost };
    }
  }
  return best?.pair ?? null;
}

function attacksMe(shown: SeatView, attacker: SeenCard): boolean {
  const attacked = attacker.attacking?.attacked;
  return attacked?.kind === "player" && attacked.player === shown.player;
}
