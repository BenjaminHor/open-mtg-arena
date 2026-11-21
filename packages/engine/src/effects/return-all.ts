// "Return all artifact and enchantment cards from all graveyards to the battlefield under their owners' control"
// (Open the Vaults), or "under your control" (Liliana Vess). Everything enters at once (CR 608.2f). An Aura entering
// this way isn't cast, so the player who'll control it (CR 110.2) chooses what it will enchant (CR 303.4f): any
// permanent already on the battlefield it could legally enchant, not one entering with it (its ruling), and without
// targeting. With nothing to enchant, it stays in the graveyard (CR 303.4g). Equipment enters unattached (CR 301.5b).
// The active player announces for their Auras first, then each other player in turn order (CR 101.4); under "you",
// one player announces for all, each knowing the choices before theirs (CR 101.4b). A
// player's own Auras are announced in their graveyard's order, not one the player picks (later: CR 101.4c): the
// choices don't depend on each other, so the order changes nothing. Each answer runs the effect again; the choices so
// far are kept in `state.resolution.auraHosts`.

import type { CardDatabase, Effect } from "../cards/types.ts";
import type { Progress } from "../game/progress.ts";
import { apnapOrder } from "../game/turn-order.ts";
import { happen } from "../pipeline/happen.ts";
import { isAura } from "../rules/attachment.ts";
import { canEnchant } from "../rules/can-enchant.ts";
import { matchesFilter } from "../rules/object-filter.ts";
import type { EffectContext } from "../state/effects.ts";
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
  // Who it enters under, who for an Aura chooses what it enchants (CR 303.4f, 110.2).
  const controllerToBe = (id: ObjectId): PlayerId => (effect.under === "you" ? context.controller : ownerOf(state, id));
  let progress: Progress = { state, events: [] };
  if (chosen !== null) {
    // The answer is for the first Aura without a host yet: the one that was asked about.
    const aura = auras.find((id) => !hasHost(progress.state, id));
    const host = chosen[0];
    if (
      aura === undefined ||
      host === undefined ||
      !possibleHosts(state, aura, controllerToBe(aura), cards).includes(host)
    )
      throw new Error("an answer naming a host no Aura was asked about");
    progress = recordHost(progress, aura, host, controllerToBe(aura));
  }
  for (const aura of auras) {
    if (hasHost(progress.state, aura)) continue;
    const hosts = possibleHosts(progress.state, aura, controllerToBe(aura), cards);
    if (hosts.length > 1) {
      // Two or more to choose from: ask its controller-to-be. The battlefield is public, so one option isn't asked.
      const ask = askToChoose(progress.state, {
        chooser: controllerToBe(aura),
        purpose: "enchant",
        for: aura,
        options: hosts,
        min: 1,
        max: 1,
        effect,
        context,
      });
      return { state: ask, events: progress.events };
    }
    progress = recordHost(progress, aura, hosts[0] ?? null, controllerToBe(aura));
  }
  const auraHosts = progress.state.resolution?.auraHosts ?? [];
  const moves = returning.flatMap((object) => {
    const host = auraHosts.find((e) => e.aura === object)?.host;
    // An Aura with nothing to enchant stays where it is (CR 303.4g).
    if (host === null) return [];
    const attached = host === undefined ? {} : { attachedTo: host };
    const to = { zone: "battlefield", controller: controllerToBe(object), ...attached } as const;
    return [{ kind: "moveCard", object, to } as const];
  });
  // The choices belong to this effect only: a later one in the same resolution starts afresh.
  const cleared = withAuraHosts(progress.state, []);
  if (moves.length === 0) return { state: cleared, events: progress.events };
  // In APNAP order, so they get their timestamps in it (CR 613.7m): with two Mind Controls on one creature, the
  // nonactive player's is later and wins. Under "you" one player controls them all and would choose their order
  // (later: CR 613.7m's "the order of that player's choice"); graveyard order stands in.
  const done = happen(cleared, { kind: "simultaneous", events: moves }, cards);
  return { state: done.state, events: [...progress.events, ...done.events] };
}

/**
 * The cards that fit, from every graveyard: the active player's first, then in turn order (the order Auras are
 * announced in), each graveyard from the bottom (its order, which anyone may see, CR 404.2).
 */
function cardsReturning(state: GameState, effect: ReturnAll, context: EffectContext, cards: CardDatabase): ObjectId[] {
  return apnapOrder(state).flatMap((player) =>
    (state.zones.players[player]?.graveyard ?? []).filter((id) =>
      matchesFilter(state, id, effect.filter, context.controller, cards),
    ),
  );
}

/** The permanents already on the battlefield this Aura could enchant under `you`, who'll control it (CR 303.4f). */
function possibleHosts(state: GameState, aura: ObjectId, you: PlayerId, cards: CardDatabase): ObjectId[] {
  return state.zones.battlefield.filter((host) => canEnchant(state, aura, host, you, cards));
}

function ownerOf(state: GameState, id: ObjectId): PlayerId {
  const obj = state.objects[id];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a card`);
  return obj.owner;
}

function hasHost(state: GameState, aura: ObjectId): boolean {
  return (state.resolution?.auraHosts ?? []).some((e) => e.aura === aura);
}

/** Keeps the Aura's host; a host chosen is announced to everyone (CR 101.4b), so the players choosing later know it. */
function recordHost(progress: Progress, aura: ObjectId, host: ObjectId | null, chosenBy: PlayerId): Progress {
  const state = progress.state;
  const recorded = withAuraHosts(state, [...(state.resolution?.auraHosts ?? []), { aura, host }]);
  if (host === null) return { state: recorded, events: progress.events };
  return { state: recorded, events: [...progress.events, { type: "AURA_HOST_CHOSEN", player: chosenBy, aura, host }] };
}

function withAuraHosts(state: GameState, auraHosts: AuraHost[]): GameState {
  if (state.resolution === null) throw new Error("an Aura's host chosen outside a resolution");
  return { ...state, resolution: { ...state.resolution, auraHosts } };
}
