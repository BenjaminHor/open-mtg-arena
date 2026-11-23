// How the person reads an object or a player in words: one place, so a prompt, the card view, the zone browser and a
// tap region's label all say the same thing.

import type { ObjectId, PlayerId, SeatView } from "@mtg/engine";
import { nameOf } from "../board-model/card-info.ts";

/** A card by its name; an ability as "Prodigal Pyromancer ability", by its source even once that has left. */
export function objectName(shown: SeatView, id: ObjectId): string {
  const seen = shown.seen[id];
  if (seen?.kind === "card") return seen.characteristics.name;
  // An ability whose source has left (sacrificed for its cost, CR 400.7) is named by the card it came from.
  if (seen?.kind === "ability") {
    const source = shown.seen[seen.source];
    return `${source?.kind === "card" ? source.characteristics.name : (nameOf(seen.sourceOracleId) ?? "An")} ability`;
  }
  return "it";
}

/** A player as the person reads them. Two players for now: later, with more (CR 800), by name. */
export function who(shown: SeatView, player: PlayerId): string {
  return player === shown.player ? "You" : "Your opponent";
}
