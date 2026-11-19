// Resolving the top object of the stack (CR 608).

import type { CardDatabase } from "../cards/types.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { controllerOf } from "../rules/controller.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { WorkItem } from "../state/work.ts";
import { moveCard } from "../zones/move-card.ts";
import { andThen, type Progress } from "./progress.ts";
import { currentTurn } from "./turn.ts";
import { queueWork } from "./work.ts";

/**
 * The top object of the stack starts to resolve (CR 405.5, 608.1). Its whole resolution is queued in one call, in order
 * (D-032): its effects, then the final part (`finishResolving`), then priority for the active player (CR 117.3b). Every
 * player has to pass again before anything else resolves or the step ends (CR 117.4).
 */
export function resolveTopOfStack(state: GameState, cards: CardDatabase): Progress {
  const top = state.zones.stack.at(-1);
  if (top === undefined) throw new Error("The stack is empty");
  const active = currentTurn(state).activePlayer;
  const items: WorkItem[] = [
    ...effectWork(state, top, cards),
    { kind: "finishResolving", object: top },
    { kind: "givePriority", player: active },
  ];
  return { state: queueWork({ ...state, passesInSuccession: 0 }, ...items), events: [] };
}

/**
 * The work for what the spell or ability does: first checking its targets are still legal (CR 608.2b), then its effects
 * (CR 608.2c–m). Target checks arrive with M1-09 and the effects interpreter with M1-10; until then there is none.
 * When a spell has no legal targets left, it doesn't resolve (CR 608.2b, 608.3b): that will become a different final step.
 */
function effectWork(_state: GameState, _id: ObjectId, _cards: CardDatabase): WorkItem[] {
  return [];
}

/**
 * The final part of resolution (CR 608.2n, 608.3a): an ability ceases to exist; an instant or sorcery goes to its
 * owner's graveyard; a permanent spell enters the battlefield under its controller. If the object already left the
 * stack during its own resolution, it still resolved, and nothing more happens to it here (CR 608.2m).
 */
export function finishResolving(state: GameState, id: ObjectId, cards: CardDatabase): Progress {
  const obj = state.objects[id];
  if (obj === undefined || !state.zones.stack.includes(id)) return { state, events: [] };
  const controller = controllerOf(state, id);
  switch (obj.kind) {
    case "ability": {
      // Not a card, so this isn't a zone change: it's removed from the stack and ceases to exist.
      const { [id]: _gone, ...objects } = state.objects;
      const stack = state.zones.stack.filter((x) => x !== id);
      return {
        state: { ...state, objects, zones: { ...state.zones, stack } },
        events: [{ type: "ABILITY_RESOLVED", object: id, source: obj.source, controller }],
      };
    }
    case "card": {
      const types = cardTypesOf(state, id, cards);
      const destination =
        types.includes("instant") || types.includes("sorcery")
          ? ({ zone: "graveyard" } as const)
          : ({ zone: "battlefield", controller } as const);
      // The resolution is reported before the card moves; triggers on resolving come after both (CR 608.2p).
      const resolved = { type: "SPELL_RESOLVED", object: id, cardId: obj.cardId, controller } as const;
      return andThen({ state, events: [resolved] }, (s) => moveCard(s, id, destination));
    }
  }
}
