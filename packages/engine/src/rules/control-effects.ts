// Layer 2 (CR 613.1b): who controls each permanent. Resolved effects (Act of Treason) apply to the objects they locked in
// (CR 611.2c); a static one (Mind Control's "you control enchanted creature") to what its Aura is attached to now
// (CR 611.3a), with its Aura's timestamp (CR 613.7a, 613.7e). All in timestamp order, the latest winning (CR 613.7). Read
// only by the layer pass; `controllerOf` reads the pass, so there's one layer 2 (D-104).

import { cardDataOf } from "../cards/card-data.ts";
import type { CardDatabase } from "../cards/types.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { attachedHostIn } from "./attachment.ts";
import type { LayerInputs } from "./layers.ts";
import { staticTimestamp } from "./static-effects.ts";

/** One layer 2 effect: when it applies, to what, and to whom it gives control (read when it applies). */
type ControlChange = { timestamp: number; affected: readonly ObjectId[]; player: () => PlayerId | undefined };

/** Every permanent's controller after layer 2: its stored controller (CR 110.2), then each control effect in order. */
export function layerTwo(input: LayerInputs, cards: CardDatabase): Record<ObjectId, PlayerId> {
  const controllers: Record<ObjectId, PlayerId> = {};
  for (const id of input.battlefield) {
    const obj = input.objects[id];
    if (obj?.kind === "card") controllers[id] = obj.baseController;
  }
  const changes: ControlChange[] = [];
  for (const effect of input.effects) {
    const change = effect.change;
    if (change.kind === "gainControl")
      changes.push({ timestamp: effect.timestamp, affected: effect.affected, player: () => change.player });
  }
  for (const aura of input.battlefield) {
    if (!hasStaticControl(input, aura, cards)) continue;
    const host = attachedHostIn(input.objects, input.battlefield, aura);
    // "You" is the Aura's controller as layer 2 has it so far (later: CR 613.8 dependency).
    if (host !== null)
      changes.push({ timestamp: staticTimestamp(input, aura), affected: [host], player: () => controllers[aura] });
  }
  changes.sort((a, b) => a.timestamp - b.timestamp);
  for (const change of changes) {
    const player = change.player();
    if (player === undefined) continue;
    for (const id of change.affected) if (id in controllers) controllers[id] = player;
  }
  return controllers;
}

/**
 * Whether a permanent has a static control ability, from its printed text: an ability that removes abilities (layer 6)
 * could only take one away, and no card in the pool does (that dependency, later: CR 613.8).
 */
function hasStaticControl(input: Pick<LayerInputs, "objects">, id: ObjectId, cards: CardDatabase): boolean {
  const obj = input.objects[id];
  return obj?.kind === "card" && (cardDataOf(obj, cards)?.def.statics ?? []).some((s) => s.kind === "attachedControl");
}

/** Per card database, per battlefield list: whether any permanent on it has a static control ability (kept, D-092). */
const staticControlKept = new WeakMap<CardDatabase, WeakMap<readonly ObjectId[], boolean>>();

/**
 * Whether anything in the game could change who controls a permanent: a control-changing effect (Act of Treason), or a
 * permanent with a static control ability (Mind Control). Without either, every permanent is controlled by its stored
 * controller, so `controllerOf` and the control-change check skip the pass (D-104). The battlefield part is kept per
 * battlefield list: an object id always names the same card, so the list decides it.
 */
export function anyControlEffects(
  state: Pick<GameState, "effects" | "objects" | "zones">,
  cards: CardDatabase,
): boolean {
  if (state.effects.some((e) => e.change.kind === "gainControl")) return true;
  let kept = staticControlKept.get(cards);
  if (kept === undefined) {
    kept = new WeakMap();
    staticControlKept.set(cards, kept);
  }
  const battlefield = state.zones.battlefield;
  const known = kept.get(battlefield);
  if (known !== undefined) return known;
  const any = battlefield.some((id) => hasStaticControl(state, id, cards));
  kept.set(battlefield, any);
  return any;
}
