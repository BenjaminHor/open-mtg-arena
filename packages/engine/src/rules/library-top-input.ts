// Reading a library's top card inside the layer pass ("as long as the top card of your library is black", Vampire
// Nocturnus). The one way to read `LayerInputs.libraryTops`: it marks the pass as depending on them, so the kept pass
// is reused only for the same tops (`layers.ts`). A shuffle changes a top without changing the objects record, so a
// reader that read `libraryTops` directly would go stale without an error.

import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { LayerInputs } from "./layers.ts";

/** The top card of a player's library (`library[0]`), or null if it's empty, with the pass marked as reading it. */
export function libraryTopOf(input: LayerInputs, player: PlayerId): ObjectId | null {
  input.read.libraryTops = true;
  return input.libraryTops[player] ?? null;
}
