// "The next 2 damage that a source of your choice would deal to you and/or permanents you control this turn is dealt to
// any target instead" (Harm's Way): the source is chosen as the spell resolves (CR 609.7a), then a redirection effect
// is kept in `GameState.replacements` until it's used up or the cleanup step ends it (CR 614.9, 514.2). Using it is
// the pipeline's (`pipeline/redirection.ts`, `damage-replacements.ts`).

import type { CardDatabase, Effect } from "../cards/types.ts";
import { newObjectId } from "../game/ids.ts";
import type { Progress } from "../game/progress.ts";
import type { SingleEvent } from "../pipeline/proposed.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { askToChoose } from "./choose-cards.ts";
import { effectCardOf } from "./effect-card.ts";
import { subject } from "./subjects.ts";

/**
 * With no source chosen yet, asks for one (CR 609.7a): a permanent, a spell on the stack, or the source of an ability on
 * the stack, even one that has left (a pinger bounced in response: its ability deals the damage as it last existed,
 * CR 113.7a). Objects referred to otherwise (by a waiting effect or delayed trigger) or in the command zone aren't
 * offered yet (later: objects referred to by a waiting effect, the command zone). With the source chosen, makes the effect. Its target is read now: the effect deals the damage to it later even if it
 * stops being a legal target (its ruling), as long as it can be dealt damage then (CR 614.9).
 */
export function redirectNextDamage(
  state: GameState,
  effect: Extract<Effect, { op: "redirectNextDamage" }>,
  context: EffectContext,
  chosen: readonly ObjectId[] | null,
  cards: CardDatabase,
): Progress {
  const [to] = subject(state, effect.to, context, cards);
  if (to === undefined) return { state, events: [] };
  if (chosen === null) {
    const options = damageSources(state);
    const asked = askToChoose(state, {
      chooser: context.controller,
      purpose: "damageSource",
      options,
      min: 1,
      max: 1,
      effect,
      context,
    });
    return { state: asked, events: [] };
  }
  const [from] = chosen;
  if (from === undefined) return { state, events: [] };
  const made = newObjectId(state);
  const redirect = {
    kind: "redirectDamage",
    id: made.id,
    sourceOracleId: effectCardOf(made.state, context),
    controller: context.controller,
    from,
    remaining: effect.amount,
    to,
  } as const;
  return { state: { ...made.state, replacements: [...made.state.replacements, redirect] }, events: [] };
}

/** What may be chosen as a source of damage now (CR 609.7a), each once. */
function damageSources(state: GameState): ObjectId[] {
  const onStack = state.zones.stack.flatMap((id): ObjectId[] => {
    const obj = state.objects[id];
    if (obj === undefined) return [];
    // An ability isn't a source; its source is (CR 113.7a), as it is or as it last existed.
    if (obj.kind === "ability") return (state.objects[obj.source] ?? state.lastKnown[obj.source]) ? [obj.source] : [];
    return [id];
  });
  const all = [...state.zones.battlefield, ...onStack];
  return all.filter((id, i) => all.indexOf(id) === i);
}

/** Damage redirected uses up that much of the effect (like a prevention shield; later: CR 615.7); one used up is gone. */
export function useRedirection(state: GameState, event: Extract<SingleEvent, { kind: "damageRedirected" }>): Progress {
  const replacements = state.replacements.flatMap((r) => {
    if (r.kind !== "redirectDamage" || r.id !== event.effect) return [r];
    const remaining = r.remaining - event.amount;
    return remaining > 0 ? [{ ...r, remaining }] : [];
  });
  const { source, from, to, amount, by } = event;
  return { state: { ...state, replacements }, events: [{ type: "DAMAGE_REDIRECTED", source, from, to, amount, by }] };
}

/**
 * A permanent spell chosen as a source, resolving: the effect applies to the permanent it becomes (CR 609.7a),
 * a new object (CR 400.7), so it follows it there. A state change outside the pipeline, listed in its README.
 */
export function effectsFollowSpellToPermanent(state: GameState, spell: ObjectId, permanent: ObjectId): GameState {
  if (!state.replacements.some((r) => r.kind === "redirectDamage" && r.from === spell)) return state;
  const replacements = state.replacements.map((r) =>
    r.kind === "redirectDamage" && r.from === spell ? { ...r, from: permanent } : r,
  );
  return { ...state, replacements };
}
