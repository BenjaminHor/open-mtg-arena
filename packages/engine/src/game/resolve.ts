// Resolving the top object of the stack (CR 608).

import type { CardDatabase } from "../cards/types.ts";
import { happen } from "../pipeline/happen.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { controllerOf } from "../rules/controller.ts";
import { effectsOf, sameTarget, stillLegalTargets } from "../rules/targets.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { GameObject, Target } from "../state/objects.ts";
import type { WorkItem } from "../state/work.ts";
import { removeAbilityFromStack } from "../zones/stack-abilities.ts";
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
  // CR 608.2b: the targets are checked once, as it starts to resolve. If it has targets and all of them are now
  // illegal, it doesn't resolve; otherwise its effects skip the illegal ones.
  const { chosen, legal } = stillLegalTargets(state, top, cards);
  const allTargetsIllegal = chosen.some((group) => group.length > 0) && legal.every((group) => group.length === 0);
  const items: WorkItem[] = allTargetsIllegal
    ? [
        { kind: "doesNotResolve", object: top },
        { kind: "givePriority", player: active },
      ]
    : [
        ...effectWork(state, top, legal, cards),
        { kind: "finishResolving", object: top },
        { kind: "givePriority", player: active },
      ];
  return { state: queueWork({ ...state, passesInSuccession: 0 }, ...items), events: [] };
}

/**
 * Every target is illegal, so the spell or ability doesn't resolve (CR 608.2b): it does nothing and is removed from the
 * stack. A spell goes to its owner's graveyard; an ability ceases to exist. It isn't countered: nothing countered it.
 */
export function doesNotResolve(state: GameState, id: ObjectId, cards: CardDatabase): Progress {
  const obj = state.objects[id];
  if (obj === undefined || !state.zones.stack.includes(id)) return { state, events: [] };
  switch (obj.kind) {
    case "card": {
      const event = { type: "SPELL_DID_NOT_RESOLVE", object: id, cardId: obj.cardId } as const;
      return andThen({ state, events: [event] }, (s) =>
        happen(s, { kind: "moveCard", object: id, to: { zone: "graveyard" } }, cards),
      );
    }
    case "ability":
      return {
        state: removeAbilityFromStack(state, id),
        events: [{ type: "ABILITY_DID_NOT_RESOLVE", object: id, source: obj.source }],
      };
  }
}

/**
 * One `runEffect` work item per effect, in the order written (CR 608.2c), each knowing the still-legal targets
 * (CR 608.2b) and the controller. Queuing them, rather than running them here, lets a later effect wait for a choice
 * (later: CR 608.2d–e) once one needs to. "This" in a spell's text is the spell; in an ability's, the ability's source,
 * even if it has left the battlefield (CR 113.7a): an effect on a source that's gone then does nothing (CR 101.3,
 * 400.7).
 */
function effectWork(state: GameState, id: ObjectId, legal: Target[][], cards: CardDatabase): WorkItem[] {
  const obj = state.objects[id];
  if (obj === undefined) return [];
  // A divided effect's shares stay with their targets: an illegal target's share is lost, and the others keep theirs
  // (CR 601.2d, 608.2b).
  const divided = obj.choices?.division ?? null;
  const stillLegal = divided === null ? [] : (legal[divided.instance] ?? []);
  const division = (divided?.shares ?? []).filter((share) => stillLegal.some((t) => sameTarget(t, share.target)));
  const x = obj.choices?.x ?? null;
  const context = { self: thisObject(obj), controller: controllerOf(state, id), targets: legal, division, x };
  return effectsOf(state, id, cards).map((effect) => ({ kind: "runEffect", effect, context, chosen: null }));
}

/** What "this" means in the text of a spell (the spell) or an ability (its source, CR 113.7a). */
function thisObject(obj: GameObject): ObjectId {
  switch (obj.kind) {
    case "card":
      return obj.id;
    case "ability":
      return obj.source;
  }
}

/**
 * The final part of resolution (CR 608.2n, 608.3a): an ability ceases to exist; an instant or sorcery goes to its
 * owner's graveyard; a permanent spell enters the battlefield under its controller. If the object already left the
 * stack during its own resolution, it still resolved, and nothing more happens to it here (CR 608.2m; nothing in the
 * pool can do that yet, so a unit test calls this directly).
 */
export function finishResolving(state: GameState, id: ObjectId, cards: CardDatabase): Progress {
  const obj = state.objects[id];
  if (obj === undefined || !state.zones.stack.includes(id)) return { state, events: [] };
  const controller = controllerOf(state, id);
  switch (obj.kind) {
    case "ability":
      // Not a card, so this isn't a zone change: it's removed from the stack and ceases to exist.
      return {
        state: removeAbilityFromStack(state, id),
        events: [{ type: "ABILITY_RESOLVED", object: id, source: obj.source, controller }],
      };
    case "card": {
      const types = cardTypesOf(state, id, cards);
      const destination =
        types.includes("instant") || types.includes("sorcery")
          ? ({ zone: "graveyard" } as const)
          : ({ zone: "battlefield", controller } as const);
      // The resolution is reported before the card moves; triggers on resolving come after both (later: CR 608.2p).
      const resolved = { type: "SPELL_RESOLVED", object: id, cardId: obj.cardId, controller } as const;
      return andThen({ state, events: [resolved] }, (s) =>
        happen(s, { kind: "moveCard", object: id, to: destination }, cards),
      );
    }
  }
}
