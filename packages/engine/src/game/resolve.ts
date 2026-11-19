// Resolving the top object of the stack (CR 608).

import type { CardDatabase } from "../cards/types.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { controllerOf } from "../rules/controller.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import { moveCard } from "../zones/move-card.ts";
import { andThen, type Progress } from "./progress.ts";
import { currentTurn } from "./turn.ts";
import { queueWork } from "./work.ts";

/**
 * The top object of the stack resolves (CR 405.5, 608.1). Then the active player receives priority (CR 117.3b), and
 * every player has to pass again before anything else resolves or the step ends (CR 117.4).
 */
export function resolveTopOfStack(state: GameState, cards: CardDatabase): Progress {
  const top = state.zones.stack.at(-1);
  if (top === undefined) throw new Error("The stack is empty");
  const obj = state.objects[top];
  if (obj === undefined) throw new Error(`No object ${top}`);
  const controller = controllerOf(state, top);
  const effects = resolveEffects(state, top, cards);

  let progress: Progress;
  if (obj.kind === "ability") {
    // CR 608.2n: as the last part of its resolution, an ability is removed from the stack and ceases to exist. It's not
    // a card, so this isn't a zone change.
    const { [top]: _gone, ...objects } = effects.state.objects;
    const stack = effects.state.zones.stack.filter((id) => id !== top);
    progress = {
      state: { ...effects.state, objects, zones: { ...effects.state.zones, stack } },
      events: [...effects.events, { type: "ABILITY_RESOLVED", object: top, source: obj.source, controller }],
    };
  } else {
    const resolved = { type: "SPELL_RESOLVED", object: top, cardId: obj.cardId, controller } as const;
    const types = cardTypesOf(state, top, cards);
    const destination =
      types.includes("instant") || types.includes("sorcery")
        ? ({ zone: "graveyard" } as const) // CR 608.2n: into its owner's graveyard
        : ({ zone: "battlefield", controller } as const); // CR 608.3a: a permanent under the spell's controller
    progress = andThen({ state: effects.state, events: [...effects.events, resolved] }, (s) =>
      moveCard(s, top, destination),
    );
  }
  const active = currentTurn(progress.state).activePlayer;
  return {
    state: queueWork({ ...progress.state, passesInSuccession: 0 }, { kind: "givePriority", player: active }),
    events: progress.events,
  };
}

/**
 * What the spell or ability does (CR 608.2c–m), including checking its targets are still legal (CR 608.2b). The
 * effects interpreter arrives in M1-10 and target checks with M1-09; until then nothing happens here.
 */
function resolveEffects(state: GameState, _id: ObjectId, _cards: CardDatabase): Progress {
  return { state, events: [] };
}
