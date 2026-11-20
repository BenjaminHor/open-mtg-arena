// The effects interpreter: what each effect op does (effects/README.md). Card definitions are data; this is the one
// place that turns them into changes to the game.

import type { CardDatabase, Effect, EffectSubject } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { happen } from "../pipeline/happen.ts";
import type { Damage } from "../pipeline/proposed.ts";
import { amountOf } from "../rules/amount.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import { createContinuousEffect } from "./continuous-effect.ts";

/** Carries out one effect of a resolving spell or ability (CR 608.2c). */
export function runEffect(state: GameState, effect: Effect, context: EffectContext, cards: CardDatabase): Progress {
  switch (effect.op) {
    case "dealDamage": {
      // The damage's source is one object (CR 120.2b). If it was an illegal target, that part of the effect can't
      // happen (CR 608.2b: it "fails to determine any such information").
      const [from, ...more] = objectsOf(subject(effect.from, context));
      if (more.length > 0) throw new Error("dealDamage's `from` must name exactly one object");
      if (from === undefined) return { state, events: [] };
      return happen(state, { kind: "dealDamage", damage: damageOf(effect, from, context) }, cards);
    }
    case "addMana": {
      // "Add {G}": mana goes into the pool of the player the text calls "you" (CR 106.4, 109.5).
      const { mana, amount } = effect;
      return happen(state, { kind: "addMana", player: context.controller, mana, amount, source: context.self }, cards);
    }
    case "modifyPT": {
      // The affected objects are fixed now (CR 611.2c). An illegal target isn't among them (CR 608.2b), and neither is
      // one that left the battlefield since resolution began: affecting it is impossible (CR 101.3, 400.7).
      const affected = objectsOf(subject(effect.of, context)).filter((id) => state.zones.battlefield.includes(id));
      if (affected.length === 0) return { state, events: [] };
      const change = { kind: "modifyPT", power: effect.power, toughness: effect.toughness } as const;
      return createContinuousEffect(state, {
        source: context.self,
        controller: context.controller,
        duration: effect.duration,
        affected,
        change,
      });
    }
  }
}

/** Who a damage effect deals how much to, as it resolves. */
function damageOf(effect: Extract<Effect, { op: "dealDamage" }>, from: ObjectId, context: EffectContext): Damage[] {
  const amount = amountOf(effect.amount, context.x);
  const to = subject(effect.to, context);
  if (effect.divided === undefined) return to.map((t) => ({ source: from, to: t, amount, combat: false }));
  switch (effect.divided) {
    case "asYouChoose":
      // Each target still legal is dealt its announced share (CR 601.2d, 608.2b).
      return context.division.map((share) => ({ source: from, to: share.target, amount: share.amount, combat: false }));
    case "evenly": {
      // Divided evenly, rounded down as the text says (CR 107.1a), among the targets still legal as it resolves
      // (Fireball's rulings). With more
      // targets than damage each share is 0, which isn't dealt at all (CR 120.8); with no targets nothing is.
      const share = to.length === 0 ? 0 : Math.floor(amount / to.length);
      return to.map((t) => ({ source: from, to: t, amount: share, combat: false }));
    }
  }
}

/** The players and objects a subject refers to. A target group holds only the targets still legal (CR 608.2b). */
function subject(s: EffectSubject, context: EffectContext): Target[] {
  if (s === "self") return [{ kind: "object", object: context.self }];
  return context.targets[s.target] ?? [];
}

function objectsOf(targets: readonly Target[]): ObjectId[] {
  return targets.flatMap((t) => (t.kind === "object" ? [t.object] : []));
}
