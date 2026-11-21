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
  const kept = { targets: spell.choices.targets, division: spell.choices.division };
  const next = askFrom(
    put.state,
    { player: context.controller, object: copy, instance: 0, index: 0, original: kept },
    cards,
  );
  return { state: next.state, events: [...put.events, ...next.events] };
}

type Slot = Omit<ChooseNewTarget, "kind" | "id">;

/**
 * The copy's target at `slot`, or the next one after it, asked of its controller. Once none is left, the final set is
 * judged (CR 115.7e): naming one object twice in an instance (CR 601.2c), it isn't a legal choice, and the player starts
 * over from what the copy had; else its targets are fixed, and each object it targets becomes the target of the copy.
 */
function askFrom(state: GameState, slot: Slot, cards: CardDatabase): Progress {
  const targets = state.objects[slot.object]?.choices?.targets ?? [];
  for (let i = slot.instance; i < targets.length; i++) {
    const j = i === slot.instance ? slot.index : 0;
    if (j < (targets[i] ?? []).length) {
      const decision = { kind: "chooseNewTarget", ...slot, instance: i, index: j } as const;
      return { state: waitFor(state, slot.player, decision), events: [] };
    }
  }
  if (targets.some((group) => group.some((t, j) => group.findIndex((u) => sameTarget(t, u)) !== j))) {
    const restored = withChoices(state, slot.object, slot.original);
    return askFrom(restored, { ...slot, instance: 0, index: 0 }, cards);
  }
  return becameTargets(state, slot.object, cards);
}

/**
 * The targets the copy's controller may choose instead (CR 115.7d): the legal ones for that instance of "target", with
 * the copy as the source. Another target of the copy may be chosen: only the final set is judged (CR 115.7e).
 */
export function newTargetOptions(state: GameState, pending: ChooseNewTarget, cards: CardDatabase): Target[] {
  const spec = targetSpecsOf(state, pending.object, cards)[pending.instance];
  if (spec === undefined) return [];
  return legalTargets(state, spec, { object: pending.object, controller: pending.player }, cards);
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

/** The target is kept or changed, its share of a division going with its place (CR 115.7f); then the next one. */
export function answerNewTarget(
  state: GameState,
  pending: ChooseNewTarget,
  target: Target | null,
  cards: CardDatabase,
): Progress {
  const choices = state.objects[pending.object]?.choices;
  if (choices == null) throw new Error(`${pending.object} isn't a copy of a spell`);
  const changed = target === null ? state : withChoices(state, pending.object, withTarget(choices, pending, target));
  return askFrom(changed, { ...pending, index: pending.index + 1 }, cards);
}

/** The target at `at` replaced; the share of a division at that place now goes to it (CR 115.7f). */
function withTarget(
  choices: StackChoices,
  at: ChooseNewTarget,
  target: Target,
): Pick<StackChoices, "targets" | "division"> {
  const targets = choices.targets.map((group, i) =>
    i === at.instance ? group.map((t, j) => (j === at.index ? target : t)) : group,
  );
  const division = choices.division;
  if (division === null || division.instance !== at.instance) return { targets, division };
  const shares = division.shares.map((s, j) => (j === at.index ? { ...s, target } : s));
  return { targets, division: { ...division, shares } };
}

function withChoices(state: GameState, id: ObjectId, change: Pick<StackChoices, "targets" | "division">): GameState {
  const obj = state.objects[id];
  if (obj?.kind !== "card" || obj.choices === null) return state;
  return { ...state, objects: { ...state.objects, [id]: { ...obj, choices: { ...obj.choices, ...change } } } };
}

/**
 * Each object the copy targets becomes the target of a spell, kept or new: the copy is a new spell targeting it (judge
 * forum, D-125). Once per object, as when casting (CR 603.2c); not one gone since (CR 400.7).
 */
function becameTargets(state: GameState, copy: ObjectId, cards: CardDatabase): Progress {
  const targets = state.objects[copy]?.choices?.targets ?? [];
  const objects: ObjectId[] = [];
  for (const t of targets.flat())
    if (t.kind === "object" && state.objects[t.object] !== undefined && !objects.includes(t.object))
      objects.push(t.object);
  const events: GameEvent[] = objects.map((object) => ({ type: "BECAME_TARGET", object, by: copy }));
  return { state: events.length === 0 ? state : detectTriggers(state, state, events, cards), events };
}
