// "You may play that card without paying its mana cost" (Djinn of Wishes): playing a card while a spell or ability
// resolves. A land is played, counting toward the land plays (CR 305.2a); a spell is cast, following the casting steps
// with no priority after (CR 608.2g), for no mana cost (CR 118.9) and so with X as 0 (CR 107.3b). The resolution goes on
// once it's done: "if you don't, exile it" then finds the card gone, a new object (CR 400.7).

import type { CardDatabase, Effect } from "../cards/types.ts";
import { objectsNamed } from "../effects/subjects.ts";
import { happen } from "../pipeline/happen.ts";
import { zoneChangeOf } from "../pipeline/moved.ts";
import { cardTypesOf } from "../rules/card-types.ts";
import { cantCastSpells } from "../rules/casting-prohibitions.ts";
import { announcesX } from "../rules/costs.ts";
import { targetSpecsOf, targetsProblem } from "../rules/targets.ts";
import type { Casting } from "../state/casting.ts";
import type { EffectContext } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import { zoneOf } from "../zones/zone-list.ts";
import { castingBegins, nextCastingStep } from "./casting-steps.ts";
import { waitFor } from "./decide.ts";
import type { Progress } from "./progress.ts";

type MayPlay = Extract<Effect, { op: "mayPlay" }>;

/**
 * The controller is asked whether to play the card, only if it can be played now; else nothing happens. The card was
 * revealed, so there's nothing to hide by not asking.
 */
export function mayPlay(state: GameState, effect: MayPlay, context: EffectContext, cards: CardDatabase): Progress {
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
 * (CR 305.3) with a land play left (CR 305.2b), and a card that's also a land only as a land (CR 305.9); a spell only if
 * no effect forbids casting (CR 601.3) and each instance of "target" has a legal choice (CR 601.2c, 115.6). The
 * timing permissions don't apply (CR 608.2g; its ruling).
 */
function playable(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): boolean {
  if (state.objects[card]?.kind !== "card" || zoneOf(state, card).zone !== "library") return false;
  if (cardTypesOf(state, card, cards).includes("land"))
    return state.turn?.activePlayer === player && (state.players[player]?.landsPlayedThisTurn ?? 0) < 1;
  if (cantCastSpells(state, player)) return false;
  return targetsProblem(state, targetSpecsOf(state, card, cards), { object: card, controller: player }, cards) === null;
}

/** Yes: a land is played (the `playLand` event, which counts it, CR 305.2a); a spell's cast begins. */
export function playWithoutPaying(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): Progress {
  if (cardTypesOf(state, card, cards).includes("land"))
    return happen(state, { kind: "playLand", player, object: card }, cards);
  return startFreeCast(state, player, card, cards);
}

/**
 * CR 601.2a: the card moves from the top of its library to the stack, and the cast goes on with its targets and costs.
 * X is 0 (CR 107.3b); no mana cost is paid (`castingCost`).
 */
function startFreeCast(state: GameState, player: PlayerId, card: ObjectId, cards: CardDatabase): Progress {
  const obj = state.objects[card];
  const ps = state.players[player];
  const from = zoneOf(state, card);
  if (obj?.kind !== "card" || ps === undefined || from.zone !== "library") throw new Error(`Can't cast ${card}`);
  const begins = castingBegins(state);
  const moved = happen(state, { kind: "moveCard", object: card, to: { zone: "stack", controller: player } }, cards);
  const change = zoneChangeOf(moved.events, card);
  if (change === null) throw new Error(`${card} didn't move to the stack`);
  const spell = moved.state.objects[change.newId];
  if (spell?.kind !== "card" || spell.choices === null) throw new Error(`${change.newId} isn't a spell`);
  const zeroX = { ...spell, choices: { ...spell.choices, x: 0 } };
  const withX = announcesX(moved.state, change.newId, cards)
    ? { ...moved.state, objects: { ...moved.state.objects, [change.newId]: zeroX } }
    : moved.state;
  const casting: Casting = {
    player,
    object: change.newId,
    origin: { kind: "resolution", card: obj, library: from.player },
    poolBefore: ps.manaPool,
    tappedForMana: [],
    targetCounts: [],
    sacrifices: [],
    ...begins,
  };
  const next = nextCastingStep({ ...withX, casting }, cards);
  return { state: next.state, events: [...moved.events, ...next.events] };
}
