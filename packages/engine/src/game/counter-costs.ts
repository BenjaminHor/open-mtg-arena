// Costs paid by removing counters from the ability's source ("Remove a wish counter from this creature", Djinn of
// Wishes): checked as it's activated, and paid with the rest of the cost (CR 601.2h, 602.2b). Loyalty counters are a
// loyalty ability's own cost (`loyalty-abilities.ts`).

import type { CardDatabase } from "../cards/types.ts";
import type { SingleEvent } from "../pipeline/proposed.ts";
import { stackAbilityDef } from "../rules/abilities.ts";
import type { GameState } from "../state/game-state.ts";

/**
 * The counters to remove for the ability being activated, as events, or "unpayable" if the source has left the
 * battlefield or no longer has them: a cost can't be paid without the resources (CR 118.3, 601.2h). Checked again at
 * payment as loyalty is, though no pool card can remove counters between the activation and the payment yet (its mana
 * abilities only add mana): the activation's check (`activationBasicsProblem`) is what refuses it today.
 */
export function counterPayments(state: GameState, cards: CardDatabase): SingleEvent[] | "unpayable" {
  const casting = state.casting;
  if (casting === null || casting.origin.kind !== "ability") return [];
  const object = casting.origin.source;
  const parts = stackAbilityDef(state, casting.object, cards).cost.flatMap((part) =>
    part.kind === "removeCounters" ? [part] : [],
  );
  if (parts.length === 0) return [];
  const source = state.objects[object];
  if (source?.kind !== "card" || !state.zones.battlefield.includes(object)) return "unpayable";
  if (parts.some((p) => (source.counters[p.counter] ?? 0) < p.amount)) return "unpayable";
  return parts.map((p) => ({ kind: "removeCounters", object, counter: p.counter, amount: p.amount }));
}
