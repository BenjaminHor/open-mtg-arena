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
import { cardOf } from "./prevention.ts";
import { subject } from "./subjects.ts";

/**
 * With no source chosen yet, asks for one: a permanent, or a spell on the stack (CR 609.7a). Objects only referred to by
 * something on the stack, or in the command zone, can be chosen too (later: CR 609.7a); no pool card needs them.
 * With the source chosen, makes the effect. Its target is read now: the effect deals the damage to it later even if it
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
    const spells = state.zones.stack.filter((id) => state.objects[id]?.kind === "card");
    const options = [...state.zones.battlefield, ...spells];
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
    sourceOracleId: cardOf(made.state, context),
    controller: context.controller,
    from,
    remaining: effect.amount,
    to,
  } as const;
  return { state: { ...made.state, replacements: [...made.state.replacements, redirect] }, events: [] };
}

/** Damage redirected uses up that much of the effect (like CR 615.7's shields); one used up is gone. */
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
 * A permanent spell chosen as a source, resolving: the effect applies to the permanent it becomes (CR 609.7a), a new
 * object (CR 400.7), so it follows it there.
 */
export function followOntoBattlefield(state: GameState, spell: ObjectId, permanent: ObjectId): GameState {
  if (!state.replacements.some((r) => r.kind === "redirectDamage" && r.from === spell)) return state;
  const replacements = state.replacements.map((r) =>
    r.kind === "redirectDamage" && r.from === spell ? { ...r, from: permanent } : r,
  );
  return { ...state, replacements };
}
