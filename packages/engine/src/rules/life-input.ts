// Reading a life total inside the layer pass (CR 604.3: "equal to your life total"). The one way to read
// `LayerInputs.life`: it marks the pass as depending on the life totals, so the kept pass is reused only for the same
// ones (`layers.ts`). A reader that read `life` directly would go stale without an error.

import type { PlayerId } from "../state/ids.ts";
import type { LayerInputs } from "./layers.ts";

/** A player's life total, with the pass marked as reading life totals. */
export function lifeTotalOf(input: LayerInputs, player: PlayerId): number {
  input.read.life = true;
  return input.life[player] ?? 0;
}
