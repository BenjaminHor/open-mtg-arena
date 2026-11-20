// Choosing what to sacrifice to pay a cost, such as "Sacrifice a creature" (CR 601.2h, 602.2b, 701.21a). The choice is
// made once the total cost is locked in (CR 601.2f) and kept in `Casting`; the sacrifice itself happens with the rest of
// the payment (`payCost`), so a cancel never has to undo it (D-035).

import type { CardDatabase, ObjectFilter } from "../cards/types.ts";
import { stackAbilityDef } from "../rules/abilities.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { castingOf } from "./casting-state.ts";

/** The sacrifices this spell's or ability's cost calls for, in order: what each may be. */
export function sacrificeParts(state: GameState, id: ObjectId, cards: CardDatabase): ObjectFilter[] {
  const obj = state.objects[id];
  // Spells have no additional costs in the pool yet (later: CR 601.2f, 118.8).
  if (obj?.kind !== "ability") return [];
  return stackAbilityDef(state, id, cards).cost.flatMap((part) => (part.kind === "sacrifice" ? [part.filter] : []));
}

/**
 * The permanents the player may sacrifice for this part of the cost: only permanents they control (CR 701.21a) that fit
 * it, each at most once. A creature chosen as a target can still be sacrificed (CR 601.5); it's an illegal target by
 * the time the spell or ability resolves (CR 608.2b).
 */
export function possibleSacrifices(
  state: GameState,
  player: PlayerId,
  filter: ObjectFilter,
  chosen: readonly ObjectId[],
  cards: CardDatabase,
): ObjectId[] {
  return state.zones.battlefield.filter(
    (id) => !chosen.includes(id) && matchesFilter(state, id, { ...filter, controller: "you" }, player, cards),
  );
}

/** Why this permanent can't be chosen for the next sacrifice, or null. */
export function sacrificeProblem(state: GameState, object: ObjectId, cards: CardDatabase): string | null {
  const casting = castingOf(state);
  const filter = sacrificeParts(state, casting.object, cards)[casting.sacrifices.length];
  if (filter === undefined) return "nothing more is to be sacrificed";
  return possibleSacrifices(state, casting.player, filter, casting.sacrifices, cards).includes(object)
    ? null
    : `${object} can't be sacrificed for this cost (CR 701.21a)`;
}

/** Whether every sacrifice chosen is still possible as the cost is paid (CR 601.2h: unpayable costs can't be paid). */
export function sacrificesStillPossible(state: GameState, cards: CardDatabase): boolean {
  const casting = castingOf(state);
  const parts = sacrificeParts(state, casting.object, cards);
  return casting.sacrifices.every((id, i) => {
    const filter = parts[i];
    return filter !== undefined && possibleSacrifices(state, casting.player, filter, [], cards).includes(id);
  });
}

/** The player chooses the next permanent to sacrifice. The casting steps then go on. */
export function chooseSacrifice(state: GameState, object: ObjectId): GameState {
  const casting = castingOf(state);
  return { ...state, casting: { ...casting, sacrifices: [...casting.sacrifices, object] } };
}
