// The effects interpreter: what each effect op does (effects/README.md). Card definitions are data; this is the one
// place that turns them into changes to the game.

import type { CardDatabase, Effect, EffectSubject } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { addMana } from "../mana/pool.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { Target } from "../state/objects.ts";
import { createContinuousEffect } from "./continuous-effect.ts";
import { dealDamage } from "./deal-damage.ts";

/** Carries out one effect of a resolving spell or ability (CR 608.2c). */
export function runEffect(state: GameState, effect: Effect, context: EffectContext, cards: CardDatabase): Progress {
  switch (effect.op) {
    case "dealDamage": {
      // The damage's source is one object (CR 120.2b). If it was an illegal target, that part of the effect can't
      // happen (CR 608.2b: it "fails to determine any such information").
      const [from, ...more] = objectsOf(subject(effect.from, context));
      if (more.length > 0) throw new Error("dealDamage's `from` must name exactly one object");
      if (from === undefined) return { state, events: [] };
      const damage = subject(effect.to, context).map((to) => ({ source: from, to, amount: effect.amount }));
      return dealDamage(state, damage, cards);
    }
    case "addMana":
      // "Add {G}": mana goes into the pool of the player the text calls "you" (CR 106.4, 109.5).
      return addMana(state, context.controller, effect.mana, effect.amount, context.self);
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

/** The players and objects a subject refers to. A target group holds only the targets still legal (CR 608.2b). */
function subject(s: EffectSubject, context: EffectContext): Target[] {
  if (s === "self") return [{ kind: "object", object: context.self }];
  return context.targets[s.target] ?? [];
}

function objectsOf(targets: readonly Target[]): ObjectId[] {
  return targets.flatMap((t) => (t.kind === "object" ? [t.object] : []));
}
