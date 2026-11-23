// The declaration under way (CR 508.1, 509.1): the attackers or blocks the person has picked so far, before they
// finish. The board shows them as if declared already, each with the outline of a pick [R], so the person sees the
// combat they're building (arena-research.md, "The owner's phone screenshots, second set").

import type { SeatView } from "@mtg/engine";
import type { BoardCard } from "./board-model.ts";

export function withPicks(shown: SeatView, cards: readonly BoardCard[]): BoardCard[] {
  const decision = shown.view.decision;
  switch (decision?.kind) {
    case "declareAttackers": {
      const chosen = new Map(decision.chosen.map((a) => [a.attacker, a]));
      return cards.map((c) => {
        const attack = chosen.get(c.id);
        return attack === undefined ? c : { ...c, attacking: true, attacks: attack.attacked ?? null, picked: true };
      });
    }
    case "declareBlockers":
      return cards.map((c) => {
        const blocks = decision.chosen.filter((b) => b.blocker === c.id).map((b) => b.attacker);
        return blocks.length === 0 ? c : { ...c, blocking: [...c.blocking, ...blocks], picked: true };
      });
    default:
      return [...cards];
  }
}
