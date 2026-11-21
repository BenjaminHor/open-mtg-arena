// The untap step's turn-based action (CR 502.3): the active player untaps their permanents, except those an effect
// keeps tapped ("doesn't untap during its controller's untap step", "during that player's next untap step"). Then the
// effects that named this untap step end.

import type { CardDatabase } from "../cards/types.ts";
import { happen } from "../pipeline/happen.ts";
import { controllerOf } from "../rules/controller.ts";
import { layeredOf } from "../rules/layers.ts";
import type { ContinuousEffect } from "../state/effects.ts";
import type { GameEvent } from "../state/events.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { andThen, type Progress } from "./progress.ts";
import { currentTurn } from "./turn.ts";

/** The active player untaps all their permanents at once (CR 502.3), but not those kept tapped. */
export function untapStep(state: GameState, cards: CardDatabase): Progress {
  const active = currentTurn(state).activePlayer;
  const untaps = state.zones.battlefield
    .filter((id) => controllerOf(state, id, cards) === active && isTapped(state, id))
    .filter((id) => !keptTapped(state, id, active, cards))
    .map((object) => ({ kind: "untap", object }) as const);
  return andThen(happen(state, { kind: "simultaneous", events: untaps }, cards), (s) =>
    endDoesntUntapEffects(s, active, cards),
  );
}

/**
 * Whether an effect keeps this permanent of the active player's from untapping now: an Aura's "doesn't untap during
 * its controller's untap step", or a "doesn't untap during [this player's / its controller's] next untap step".
 */
function keptTapped(state: GameState, id: ObjectId, active: PlayerId, cards: CardDatabase): boolean {
  if (layeredOf(state, id, cards)?.doesntUntap === true) return true;
  return state.effects.some(
    (e) =>
      e.change.kind === "doesntUntap" &&
      e.affected.includes(id) &&
      (e.change.during === "itsController" || e.change.during === active),
  );
}

/**
 * The "next untap step" effects this untap step used up end, whether or not their permanents were tapped (Wall of
 * Frost's ruling): one naming the active player, and, from one naming "its controller", each permanent the active
 * player controls now. A permanent someone else controls waits for its controller's untap step (Wall of Frost's ruling).
 */
function endDoesntUntapEffects(state: GameState, active: PlayerId, cards: CardDatabase): Progress {
  const effects: ContinuousEffect[] = [];
  const events: GameEvent[] = [];
  let changed = false;
  for (const effect of state.effects) {
    if (effect.change.kind !== "doesntUntap") {
      effects.push(effect);
      continue;
    }
    const during = effect.change.during;
    const left =
      during === active
        ? []
        : during === "itsController"
          ? effect.affected.filter((id) => state.objects[id] !== undefined && controllerOf(state, id, cards) !== active)
          : effect.affected;
    if (left.length === effect.affected.length) effects.push(effect);
    else {
      changed = true;
      if (left.length === 0) events.push({ type: "EFFECT_ENDED", effect });
      else effects.push({ ...effect, affected: left });
    }
  }
  return changed ? { state: { ...state, effects }, events } : { state, events: [] };
}

function isTapped(state: GameState, id: ObjectId): boolean {
  const obj = state.objects[id];
  return obj?.kind === "card" && obj.tapped;
}
