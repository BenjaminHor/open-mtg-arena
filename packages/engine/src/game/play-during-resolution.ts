// "You may play that card without paying its mana cost" (Djinn of Wishes): playing a card while a spell or ability
// resolves. A land is played, counting toward the land plays (CR 305.2a); a spell is cast, following the casting steps
// with no priority after (CR 608.2g), for no mana cost (CR 118.9) and so with X as 0 (CR 107.3b). The resolution goes on
// once it's done: "if you don't, exile it" then finds the card gone, a new object (CR 400.7). A cast cancelled goes back
// to the choice (`cancelCasting`).

import type { CardDatabase, Effect } from "../cards/types.ts";
import { objectsNamed } from "../effects/subjects.ts";
import { happen } from "../pipeline/happen.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { cantCastSpells } from "../rules/casting-prohibitions.ts";
import { targetSpecsOf, targetsProblem } from "../rules/targets.ts";
import { hasLandPlayLeft } from "../rules/timing.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { beginCast } from "./cast.ts";
import { waitFor } from "./decide.ts";
import type { Progress } from "./progress.ts";

type MayPlay = Extract<Effect, { op: "mayPlayWithoutPaying" }>;

/**
 * The controller is asked whether to play the card, only if it can be played now; else nothing happens. The card was
 * revealed, so there's nothing to hide by not asking.
 */
export function mayPlayWithoutPaying(
  state: GameState,
  effect: MayPlay,
  context: EffectContext,
  cards: CardDatabase,
): Progress {
  const player = context.controller;
  const [card] = objectsNamed(state, effect.of, context, cards).filter((id) => playable(state, player, id, cards));
  if (card === undefined) return { state, events: [] };
  const resume = [{ kind: "playWithoutPaying", player, card } as const];
  return {
    state: waitFor(state, player, { kind: "chooseYesNo", purpose: "optional", canSayYes: true, resume }),
    events: [],
  };
}

/**
 * Whether the player may play this card while something resolves: still in a library; a land only on their own turn
 * (CR 305.3) with a land play left (CR 305.2b), and a card that's also a land only as a land (later: CR 305.9); a spell only if
 * no effect forbids casting (CR 601.3) and each instance of "target" has a legal choice (CR 601.2c, 115.6). The
 * timing permissions don't apply (CR 608.2g; its ruling).
 */
function playable(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): boolean {
  if (state.objects[card]?.kind !== "card" || zoneOf(state, card).zone !== "library") return false;
  if (cardTypesOf(state, card, cards).includes("land"))
    return state.turn?.activePlayer === player && hasLandPlayLeft(state, player);
  if (cantCastSpells(state, player)) return false;
  return targetsProblem(state, targetSpecsOf(state, card, cards), { object: card, controller: player }, cards) === null;
}

/** Yes: a land is played (the `playLand` event, which counts it, CR 305.2a); a spell's cast begins. */
export function playWithoutPaying(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): Progress {
  if (cardTypesOf(state, card, cards).includes("land"))
    return happen(state, { kind: "playLand", player, object: card }, cards);
  return startFreeCast(state, player, card, cards);
}

/** The cast from the top of the library: its origin says it's free, X 0, and gives no priority after (`casting-steps.ts`). */
function startFreeCast(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): Progress {
  const obj = state.objects[card];
  const from = zoneOf(state, card);
  if (obj?.kind !== "card" || from.zone !== "library") throw new Error(`Can't cast ${card}`);
  return beginCast(state, player, card, { kind: "resolution", card: obj, library: from.player }, cards);
}
