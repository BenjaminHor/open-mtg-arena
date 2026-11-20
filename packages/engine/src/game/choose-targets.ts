// Choosing targets and dividing an effect among them, while casting a spell or activating an ability (CR 601.2c–d,
// 602.2b). Each instance of "target" in turn: how many targets, if the text allows a range, then the targets; then the
// division, if an effect is divided "as you choose". Progress is kept in `Casting.targetCounts` and the stack object's
// `choices`, so every pause is plain data and a cancel can reverse it (D-035).

import type { CardDatabase } from "../cards/types.ts";
import { amountOf } from "../rules/amount.ts";
import { effectsOf, legalTargets, sameTarget, type Targeting, targetCount, targetSpecsOf } from "../rules/targets.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { Division, StackChoices, Target } from "../state/objects.ts";
import { castingOf } from "./casting-state.ts";
import { waitFor } from "./decide.ts";

/**
 * Settles every target choice that needs no player, and waits for the first that does. Returns the state with a pending
 * decision, or with no pending decision once the targets and any division are all chosen.
 */
export function targetStep(state: GameState, cards: CardDatabase): GameState {
  const casting = castingOf(state);
  const id = casting.object;
  const choices = choicesOf(state, id);
  const specs = targetSpecsOf(state, id, cards);
  // Finish the instance being chosen.
  const current = casting.targetCounts.length - 1;
  const count = casting.targetCounts[current];
  if (count !== undefined && (choices.targets[current]?.length ?? 0) < count) {
    return waitFor(state, casting.player, { kind: "chooseTarget", object: id, instance: current });
  }
  // Then the next: its number of targets first (CR 601.2c).
  const next = casting.targetCounts.length;
  const spec = specs[next];
  if (spec !== undefined) {
    const text = targetCount(spec);
    if (text.min === text.max) return targetStep(withTargetCount(state, text.min), cards);
    const { min, max } = targetCountRange(state, next, targetingOf(state), cards);
    return waitFor(state, casting.player, { kind: "chooseTargetCount", object: id, instance: next, min, max });
  }
  return divisionStep(state, cards);
}

/**
 * The numbers of targets the player may announce for this instance: the text's range (CR 601.2c), but no more than
 * there are different legal choices (CR 115.3), and, for a division, no more than the amount, since each target gets
 * at least one (CR 601.2d).
 */
export function targetCountRange(
  state: GameState,
  instance: number,
  by: Targeting,
  cards: CardDatabase,
): { min: number; max: number } {
  const spec = targetSpecsOf(state, by.object, cards)[instance];
  if (spec === undefined) throw new Error(`No target instance ${instance}`);
  const text = targetCount(spec);
  const available = legalTargets(state, spec, by, cards).length;
  const divided = dividedEffect(state, by.object, cards);
  const amount = divided?.instance === instance ? divided.amount : Number.POSITIVE_INFINITY;
  const max = Math.min(text.max === "any" ? Number.POSITIVE_INFINITY : text.max, available, amount);
  return { min: text.min, max };
}

/** The player announces how many targets this instance will have. The casting steps then go on. */
export function chooseTargetCount(state: GameState, count: number): GameState {
  return withTargetCount(state, count);
}

/** Why this number of targets can't be announced, or null: it must be in the decision's range. */
export function targetCountProblem(pending: { min: number; max: number }, count: number): string | null {
  const { min, max } = pending;
  return Number.isInteger(count) && count >= min && count <= max
    ? null
    : `choose from ${min} to ${max} targets (CR 601.2c)`;
}

/**
 * Why this target can't be chosen for the instance being chosen, or null: it must be a legal choice, and not one
 * already chosen for the same instance (CR 115.3).
 */
export function targetProblem(state: GameState, target: Target, cards: CardDatabase): string | null {
  if (!possibleTargets(state, cards).some((t) => sameTarget(t, target))) return "that isn't a legal target (CR 115)";
  return null;
}

/** The targets that can still be chosen for the instance being chosen. */
export function possibleTargets(state: GameState, cards: CardDatabase): Target[] {
  const casting = castingOf(state);
  const instance = casting.targetCounts.length - 1;
  const spec = targetSpecsOf(state, casting.object, cards)[instance];
  if (spec === undefined) return [];
  const chosen = choicesOf(state, casting.object).targets[instance] ?? [];
  return legalTargets(state, spec, targetingOf(state), cards).filter((t) => !chosen.some((c) => sameTarget(c, t)));
}

/** The player chooses a target for the instance being chosen. The casting steps then go on. */
export function chooseTarget(state: GameState, target: Target): GameState {
  const casting = castingOf(state);
  const instance = casting.targetCounts.length - 1;
  const choices = choicesOf(state, casting.object);
  const targets = [...choices.targets];
  targets[instance] = [...(targets[instance] ?? []), target];
  return withChoices(state, casting.object, { ...choices, targets });
}

/**
 * Why `amount` can't be the next target's share, or null: a whole number, at least one, leaving at least one for each
 * target still to come (CR 601.2d).
 */
export function shareProblem(pending: { amount: number; targets: Target[]; shares: number[] }, amount: number) {
  const max = largestShare(pending);
  return Number.isInteger(amount) && amount >= 1 && amount <= max
    ? null
    : `give this target a whole amount from 1 to ${max} (CR 601.2d)`;
}

export function largestShare(pending: { amount: number; targets: Target[]; shares: number[] }): number {
  const left = pending.amount - pending.shares.reduce((sum, n) => sum + n, 0);
  const after = pending.targets.length - pending.shares.length - 1;
  return left - after;
}

/**
 * The next target gets `amount`, and the next share is asked for. When only the last target is left, it gets the rest
 * and the division is announced, with nothing pending: the caller goes on with the casting steps.
 */
export function divide(
  state: GameState,
  pending: { instance: number; amount: number; targets: Target[]; shares: number[] },
  amount: number,
): GameState {
  const casting = castingOf(state);
  const shares = [...pending.shares, amount];
  if (shares.length < pending.targets.length - 1) {
    const { instance, targets } = pending;
    return waitFor(state, casting.player, {
      kind: "divide",
      object: casting.object,
      instance,
      amount: pending.amount,
      targets,
      shares,
    });
  }
  const rest = pending.amount - shares.reduce((sum, n) => sum + n, 0);
  const all = [...shares, rest];
  const finalShares = pending.targets.map((target, i) => ({ target, amount: all[i] ?? 0 }));
  return withDivision(state, { instance: pending.instance, shares: finalShares });
}

/** After the targets: the division, if an effect is divided as the player chooses (CR 601.2d). */
function divisionStep(state: GameState, cards: CardDatabase): GameState {
  const casting = castingOf(state);
  const choices = choicesOf(state, casting.object);
  const divided = dividedEffect(state, casting.object, cards);
  if (divided === null || choices.division !== null) return state;
  const targets = choices.targets[divided.instance] ?? [];
  // With one target there's nothing to divide: it gets it all.
  if (targets.length <= 1) {
    const shares = targets.map((target) => ({ target, amount: divided.amount }));
    return targetStep(withDivision(state, { instance: divided.instance, shares }), cards);
  }
  return waitFor(state, casting.player, {
    kind: "divide",
    object: casting.object,
    instance: divided.instance,
    amount: divided.amount,
    targets,
    shares: [],
  });
}

/** The effect of this spell or ability that's divided as its controller chooses, if any: its targets and total. */
function dividedEffect(
  state: GameState,
  id: ObjectId,
  cards: CardDatabase,
): { instance: number; amount: number } | null {
  for (const effect of effectsOf(state, id, cards)) {
    if (effect.op === "dealDamage" && effect.divided === "asYouChoose") {
      if (typeof effect.to === "string") throw new Error("A divided effect divides among targets");
      return { instance: effect.to.target, amount: amountOf(effect.amount, choicesOf(state, id).x) };
    }
  }
  return null;
}

function targetingOf(state: GameState): Targeting {
  const casting = castingOf(state);
  return { object: casting.object, controller: casting.player };
}

/**
 * Records an instance's number of targets. Its group of targets starts when the first is chosen; an instance with none
 * gets its empty group now, so later instances keep their places.
 */
function withTargetCount(state: GameState, count: number): GameState {
  const casting = castingOf(state);
  let next = state;
  if (count === 0) {
    const choices = choicesOf(state, casting.object);
    next = withChoices(state, casting.object, { ...choices, targets: [...choices.targets, []] });
  }
  return { ...next, casting: { ...casting, targetCounts: [...casting.targetCounts, count] } };
}

function withDivision(state: GameState, division: Division): GameState {
  const casting = castingOf(state);
  return withChoices(state, casting.object, { ...choicesOf(state, casting.object), division });
}

function choicesOf(state: GameState, id: ObjectId): StackChoices {
  const obj = state.objects[id];
  if (obj === undefined || obj.choices === null) throw new Error("Nothing is being put on the stack");
  return obj.choices;
}

function withChoices(state: GameState, id: ObjectId, choices: StackChoices): GameState {
  const obj = state.objects[id];
  if (obj === undefined) throw new Error(`No object ${id}`);
  return { ...state, objects: { ...state.objects, [id]: { ...obj, choices } } };
}
