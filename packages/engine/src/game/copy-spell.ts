// "Copy target instant or sorcery spell. You may choose new targets for the copy." (Twincast): a copy of a spell is put
// on the stack (CR 707.10), then its controller may choose new targets for it (CR 707.10c, 115.7d), one target at a
// time: keep it, even if it's illegal, or a new legal one. The number of targets and the division stay (CR 115.7f).
// The copy is put on the stack first and its targets chosen with it as the source (its color for protection, its
// controller, not itself), the same as choosing first, as nothing can happen between (D-125).

import type { CardDatabase, Effect } from "../cards/types.ts";
import { objectsNamed } from "../effects/subjects.ts";
import { happen } from "../pipeline/happen.ts";
import { legalTargets, sameTarget, targetSpecsOf } from "../rules/targets.ts";
import type { PendingDecision } from "../state/decisions.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { StackChoices, Target } from "../state/objects.ts";
import { detectTriggers } from "../triggers/detect.ts";
import { waitFor } from "./decide.ts";
import type { Progress } from "./progress.ts";

type CopySpell = Extract<Effect, { op: "copySpell" }>;
type ChooseNewTarget = Extract<PendingDecision, { kind: "chooseNewTarget" }>;

/** The copy is put on the stack under the controller's control; then its new targets, if it has any. */
export function copySpell(state: GameState, effect: CopySpell, context: EffectContext, cards: CardDatabase): Progress {
  const [original] = objectsNamed(state, effect.of, context, cards);
  const spell = original === undefined ? undefined : state.objects[original];
  // A spell still on the stack: the target was checked as this resolved (CR 608.2b).
  if (spell?.kind !== "card" || spell.choices === null || !state.zones.stack.includes(spell.id))
    return { state, events: [] };
  const copied = { original: spell.id, oracleId: spell.oracleId, choices: spell.choices };
  const put = happen(state, { kind: "copySpell", player: context.controller, spell: copied }, cards);
  const copy = put.events.find((e) => e.type === "SPELL_COPIED")?.object;
  if (copy === undefined) throw new Error("the copy wasn't put on the stack");
  const asked = askFrom(put.state, context.controller, copy, 0, 0);
  const next = "done" in asked ? becameTargets(asked.state, copy, cards) : asked;
  return { state: next.state, events: [...put.events, ...next.events] };
}

/**
 * The next target of the copy from `instance`/`index` on, asked of its controller; once there are none left, its
 * targets are fixed, and each object it targets becomes the target of the copy, a new spell, kept or new (D-125).
 */
function askFrom(state: GameState, player: ChooseNewTarget["player"], copy: ObjectId, instance: number, index: number) {
  const targets = state.objects[copy]?.choices?.targets ?? [];
  for (let i = instance; i < targets.length; i++) {
    const group = targets[i] ?? [];
    const j = i === instance ? index : 0;
    if (j < group.length) {
      const decision = { kind: "chooseNewTarget", object: copy, instance: i, index: j } as const;
      return { state: waitFor(state, player, decision), events: [] as GameEvent[] };
    }
  }
  return { state, events: [] as GameEvent[], done: true };
}

/**
 * The targets the copy's controller may choose instead (CR 115.7d): the legal ones for that instance of "target", but
 * not one another target of the same instance already has (CR 601.2c).
 */
export function newTargetOptions(state: GameState, pending: ChooseNewTarget, cards: CardDatabase): Target[] {
  const copy = state.objects[pending.object];
  const choices = copy?.choices;
  const spec = targetSpecsOf(state, pending.object, cards)[pending.instance];
  if (copy === undefined || choices == null || spec === undefined) return [];
  const others = (choices.targets[pending.instance] ?? []).filter((_, j) => j !== pending.index);
  const by = { object: pending.object, controller: pending.player };
  return legalTargets(state, spec, by, cards).filter((t) => !others.some((o) => sameTarget(o, t)));
}

/** Why this can't be the new target, or null: keeping it (null) is always allowed. */
export function newTargetProblem(
  state: GameState,
  pending: ChooseNewTarget,
  target: Target | null,
  cards: CardDatabase,
): string | null {
  if (target === null) return null;
  return newTargetOptions(state, pending, cards).some((t) => sameTarget(t, target))
    ? null
    : "not a legal new target for the copy (CR 115.7d)";
}

/** The target is kept or changed (its share of a division goes with it, CR 115.7f); then the next one. */
export function answerNewTarget(
  state: GameState,
  pending: ChooseNewTarget,
  target: Target | null,
  cards: CardDatabase,
): Progress {
  const copy = state.objects[pending.object];
  const choices = copy?.choices;
  if (copy?.kind !== "card" || choices == null) throw new Error(`${pending.object} isn't a copy of a spell`);
  const changed = target === null ? state : withTarget(state, copy.id, choices, pending, target);
  const next = askFrom(changed, pending.player, copy.id, pending.instance, pending.index + 1);
  if (!("done" in next)) return next;
  return becameTargets(next.state, copy.id, cards);
}

function withTarget(
  state: GameState,
  id: ObjectId,
  choices: StackChoices,
  at: ChooseNewTarget,
  target: Target,
): GameState {
  const old = choices.targets[at.instance]?.[at.index];
  const targets = choices.targets.map((group, i) =>
    i === at.instance ? group.map((t, j) => (j === at.index ? target : t)) : group,
  );
  const division =
    choices.division === null || choices.division.instance !== at.instance || old === undefined
      ? choices.division
      : {
          ...choices.division,
          shares: choices.division.shares.map((s) => (sameTarget(s.target, old) ? { ...s, target } : s)),
        };
  const obj = state.objects[id];
  if (obj?.kind !== "card") return state;
  return { ...state, objects: { ...state.objects, [id]: { ...obj, choices: { ...choices, targets, division } } } };
}

/** Each object the copy targets, once, becomes the target of a spell (CR 601.2c's "become the target"; D-125). */
function becameTargets(state: GameState, copy: ObjectId, cards: CardDatabase): Progress {
  const targets = state.objects[copy]?.choices?.targets ?? [];
  const objects: ObjectId[] = [];
  for (const t of targets.flat()) if (t.kind === "object" && !objects.includes(t.object)) objects.push(t.object);
  const events: GameEvent[] = objects.map((object) => ({ type: "BECAME_TARGET", object, by: copy }));
  return { state: events.length === 0 ? state : detectTriggers(state, state, events, cards), events };
}
