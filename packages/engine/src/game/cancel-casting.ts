// Cancelling a cast or an activation: the whole action is reversed (CR 734.1), back to the moment before it was
// proposed (CR 601.2), as if it never happened (D-035).

import type { Casting } from "../state/casting.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import type { ZoneRef } from "../state/zones.ts";
import { removeAbilityFromStack } from "../zones/stack-abilities.ts";
import { withZoneList, zoneList } from "../zones/zone-list.ts";
import { castingOf } from "./casting-state.ts";
import { waitFor } from "./decide.ts";
import type { Progress } from "./progress.ts";
import { queueWork } from "./work.ts";

/**
 * The player cancels. The pool is as it was, permanents tapped for mana during it untap, and nothing triggers. A spell's
 * card returns as the same object: to where it was in the hand, and the player keeps priority (CR 734.2) with the passes
 * not restarted, as nothing was done; or to the top of the library a resolving ability cast it from, and the player is
 * asked again whether to play it, the moment before the cast was proposed, with no priority (CR 608.2g). An ability
 * ceases to exist.
 */
export function cancelCasting(state: GameState): Progress {
  const casting = castingOf(state);
  // Triggers waiting now that weren't as it began came from it (its mana abilities, its targets becoming targets), and
  // nothing triggers from a reversed action (CR 734.1). From priority none were waiting (CR 117.5); a cast during a
  // resolution (CR 608.2g) keeps those that were. Delayed triggers aren't restored: they can't trigger during a cast
  // while they wait only for the beginning of a step (future-rules).
  const undone = untapAndRestorePool({ ...state, casting: null, pendingTriggers: casting.triggersBefore }, casting);
  const priority = (s: GameState) => queueWork(s, { kind: "givePriority", player: casting.player });
  switch (casting.origin.kind) {
    case "card": {
      const { card, handIndex } = casting.origin;
      const hand: ZoneRef = { zone: "hand", player: casting.player };
      const restored = restoreCastCard(undone, casting.object, card, hand, handIndex);
      // The spell's card id, which everyone saw on the stack, not the restored card's, which is hidden (D-054).
      return { state: priority(restored.state), events: [cancelled(casting, restored.cardId, card.id)] };
    }
    case "resolution": {
      const { card, library } = casting.origin;
      const restored = restoreCastCard(undone, casting.object, card, { zone: "library", player: library }, 0);
      const resume = [{ kind: "playWithoutPaying", player: casting.player, card: card.id } as const];
      const decision = { kind: "chooseYesNo", purpose: "optional", canSayYes: true, resume } as const;
      // Its object id isn't shown: an id in a library would let a player follow the card later (D-054), though
      // everyone saw it revealed.
      const event = cancelled(casting, restored.cardId, null);
      return { state: waitFor(restored.state, casting.player, decision), events: [event] };
    }
    case "trigger":
      throw new Error("a triggered ability being put on the stack can't be cancelled (CR 603.3d)");
    case "ability": {
      const event: GameEvent = {
        type: "ACTIVATION_CANCELLED",
        player: casting.player,
        object: casting.object,
        source: casting.origin.source,
        untapped: casting.tappedForMana,
      };
      return { state: priority(removeAbilityFromStack(undone, casting.object)), events: [event] };
    }
  }
}

/** The spell leaves the stack, and the card it was is put back where it came from as the same object. */
function restoreCastCard(
  state: GameState,
  spell: ObjectId,
  card: CardObject,
  to: ZoneRef,
  index: number,
): { state: GameState; cardId: CardObject["cardId"] } {
  const obj = state.objects[spell];
  if (obj?.kind !== "card") throw new Error(`${spell} isn't a spell`);
  const { [spell]: _spell, ...rest } = state.objects;
  let next: GameState = { ...state, objects: { ...rest, [card.id]: card } };
  next = withZoneList(
    next,
    { zone: "stack" },
    next.zones.stack.filter((id) => id !== spell),
  );
  const list = [...zoneList(next, to)];
  list.splice(index, 0, card.id);
  return { state: withZoneList(next, to, list), cardId: obj.cardId };
}

function cancelled(casting: Casting, cardId: CardObject["cardId"], restored: ObjectId | null): GameEvent {
  return {
    type: "CAST_CANCELLED",
    player: casting.player,
    cardId,
    spell: casting.object,
    restored,
    untapped: casting.tappedForMana,
  };
}

function untapAndRestorePool(state: GameState, casting: Casting): GameState {
  const objects = { ...state.objects };
  for (const id of casting.tappedForMana) {
    const obj = objects[id];
    if (obj?.kind === "card") objects[id] = { ...obj, tapped: false };
  }
  const ps = state.players[casting.player];
  const players =
    ps === undefined ? state.players : { ...state.players, [casting.player]: { ...ps, manaPool: casting.poolBefore } };
  return { ...state, objects, players };
}
