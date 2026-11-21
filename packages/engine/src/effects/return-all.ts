// "Return all artifact and enchantment cards from all graveyards to the battlefield under their owners' control"
// (Open the Vaults). Everything enters at once (CR 608.2f). An Aura entering this way isn't cast, so its owner, who'll
// control it (CR 110.2), chooses what it will enchant (CR 303.4f): any permanent already on the battlefield it could
// legally enchant, not one entering with it (its ruling), and without targeting. With nothing to enchant, it stays in
// the graveyard (CR 303.4g). The active player announces for their Auras first, then each other player in turn order
// (its ruling, CR 101.4). Each answer runs the effect again; the choices so far are kept in `state.resolution`.

import type { CardDatabase, Effect } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { apnapOrder } from "../game/turn-order.ts";
import { happen } from "../pipeline/happen.ts";
import { isAura } from "../rules/attachment.ts";
import { canEnchant } from "../rules/can-enchant.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameEvent } from "../state/events.ts";
import type { AuraHost, GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { askToChoose } from "./choose-cards.ts";

type ReturnAll = Extract<Effect, { op: "returnAllToBattlefield" }>;

/**
 * Records the host chosen for the Aura that was asked about (`chosen`, when the effect runs again with an answer), then
 * works out the next Auras' hosts until one needs a choice, and once every Aura has one, moves every card at once.
 * Nothing else happens while it waits, so the cards returning and the Aura asked about are the same each time.
 */
export function returnAllToBattlefield(
  state: GameState,
  effect: ReturnAll,
  context: EffectContext,
  chosen: readonly ObjectId[] | null,
  cards: CardDatabase,
): Progress {
  const returning = cardsReturning(state, effect, context, cards);
  const auras = returning.filter((id) => isAura(state, id, cards));
  let next = state;
  const events: GameEvent[] = [];
  // The answer is for the first Aura without a host yet: the one asked about.
  let answer: ObjectId | undefined = chosen?.[0];
  for (const aura of auras) {
    if (enchantsOf(next).some((e) => e.aura === aura)) continue;
    const hosts = possibleHosts(next, aura, cards);
    const host = answer ?? (hosts.length <= 1 ? (hosts[0] ?? null) : undefined);
    answer = undefined;
    if (host === undefined) {
      // Two or more to choose from: ask its owner. The battlefield is public, so one option isn't asked (like sacrifice).
      const owner = ownerOf(next, aura);
      const ask = askToChoose(next, {
        chooser: owner,
        purpose: "enchant",
        for: aura,
        options: hosts,
        min: 1,
        max: 1,
        effect,
        context,
      });
      return { state: ask, events };
    }
    next = remember(next, { aura, host });
    if (host !== null) events.push({ type: "AURA_HOST_CHOSEN", player: ownerOf(next, aura), aura, host });
  }
  const moves = returning.flatMap((object) => {
    const host = enchantsOf(next).find((e) => e.aura === object)?.host;
    // An Aura with nothing to enchant stays where it is (CR 303.4g).
    if (host === null) return [];
    const attached = host === undefined ? {} : { attachedTo: host };
    const to = { zone: "battlefield", controller: ownerOf(next, object), ...attached } as const;
    return [{ kind: "moveCard", object, to } as const];
  });
  if (moves.length === 0) return { state: next, events };
  const done = happen(next, { kind: "simultaneous", events: moves }, cards);
  return { state: done.state, events: [...events, ...done.events] };
}

/**
 * The cards that fit, from every graveyard: the active player's first, then in turn order (the order Auras are
 * announced in), each graveyard from the bottom (its public order, CR 404.1).
 */
function cardsReturning(state: GameState, effect: ReturnAll, context: EffectContext, cards: CardDatabase): ObjectId[] {
  return apnapOrder(state).flatMap((player) =>
    (state.zones.players[player]?.graveyard ?? []).filter((id) =>
      matchesFilter(state, id, effect.filter, context.controller, cards),
    ),
  );
}

/** The permanents already on the battlefield this Aura could enchant under its owner's control (CR 303.4f). */
function possibleHosts(state: GameState, aura: ObjectId, cards: CardDatabase): ObjectId[] {
  const owner = ownerOf(state, aura);
  return state.zones.battlefield.filter((host) => canEnchant(state, aura, host, owner, cards));
}

function ownerOf(state: GameState, id: ObjectId): PlayerId {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a card`);
  return obj.owner;
}

function enchantsOf(state: GameState): readonly AuraHost[] {
  return state.resolution?.enchants ?? [];
}

function remember(state: GameState, choice: AuraHost): GameState {
  if (state.resolution === null) throw new Error("an Aura's host chosen outside a resolution");
  return { ...state, resolution: { ...state.resolution, enchants: [...state.resolution.enchants, choice] } };
}
