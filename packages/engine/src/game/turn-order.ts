// Turn order (CR 103.1, 101.4).

import type { PlayerId } from "../state/ids.ts";

/** The players in turn order starting with `first`, keeping their seating order (CR 103.1). */
export function rotateTo(seats: readonly PlayerId[], first: PlayerId): PlayerId[] {
  const at = seats.indexOf(first);
  if (at < 0) throw new Error(`${first} isn't a player`);
  return [...seats.slice(at), ...seats.slice(0, at)];
}
