// Layer 2 (CR 613.1b): effects that change who controls a permanent, from resolved spells and abilities (Act of
// Treason), on the objects they locked in (CR 611.2c), the latest timestamp winning (CR 613.7), which is the order of
// `effects`. Read only by the layer pass; `controllerOf` reads the pass, so there's one layer 2 (D-104). Static control
// effects (an Aura's "you control enchanted creature", M2-12c) join them here, in timestamp order.

import type { ContinuousEffect } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";

/** Who the latest control-changing effect on this permanent gives it to, or null if none applies. */
export function controlFromEffects(effects: readonly ContinuousEffect[], id: ObjectId): PlayerId | null {
  let controller: PlayerId | null = null;
  for (const effect of effects)
    if (effect.change.kind === "gainControl" && effect.affected.includes(id)) controller = effect.change.player;
  return controller;
}

/**
 * Whether anything in the game could change who controls a permanent: a control-changing effect (Act of Treason).
 * Without one, every permanent is controlled by its stored controller, so `controllerOf` and the control-change check
 * skip the pass; with one, who controls what is read from the pass. A static control effect (Mind Control, M2-12c2)
 * must count here too.
 */
export function anyControlEffects(state: Pick<GameState, "effects">): boolean {
  return state.effects.some((e) => e.change.kind === "gainControl");
}
