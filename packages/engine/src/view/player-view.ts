// What one player may know of the game (CR 400.2: libraries and hands are hidden zones). Hosts give a view, never the
// state, to the UI and the AI. A view must not change when only hidden information changes: the fuzzer (M1-18)
// checks that by scrambling what the viewer can't see.

import type { Combat } from "../state/combat.ts";
import type { PendingDecision } from "../state/decisions.ts";
import type { ContinuousEffect } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { ObjectId, PlayerId } from "../state/ids.ts";
import type { GameObject } from "../state/objects.ts";
import type { PlayerState } from "../state/players.ts";
import type { Pregame } from "../state/pregame.ts";
import type { GameResult } from "../state/result.ts";
import type { RuleModifier } from "../state/setup.ts";
import type { Turn } from "../state/turn.ts";

export type PlayerView = {
  viewer: PlayerId;
  turn: Turn | null;
  turnOrder: PlayerId[];
  /** Life, mana pools and the like: public. */
  players: Record<PlayerId, PlayerState>;
  /** Only the objects the viewer may see: those in public zones and in the viewer's own hand. */
  objects: Record<ObjectId, GameObject>;
  zones: ViewZones;
  effects: ContinuousEffect[];
  combat: Combat | null;
  ruleModifiers: RuleModifier[];
  pregame: Pregame | null;
  /** Who is casting or activating what (the object on the stack is public); the rest is the caster's own business. */
  casting: { player: PlayerId; object: ObjectId } | null;
  passesInSuccession: number;
  /** The viewer's own decision in full; another player's only as who must decide what. */
  pending: PendingDecision | Pick<PendingDecision, "id" | "player" | "kind"> | null;
  result: GameResult | null;
};

export type ViewZones = {
  players: Record<
    PlayerId,
    {
      /** Any player may count a library (CR 401.3), but no one may see its cards or their order (CR 401.2). */
      library: number;
      /** The viewer's own hand, card by card (CR 402.3); another player's, only as a count. */
      hand: ObjectId[] | number;
      graveyard: ObjectId[];
    }
  >;
  battlefield: ObjectId[];
  stack: ObjectId[];
  exile: ObjectId[];
  command: ObjectId[];
};

/**
 * The game as `viewer` may see it. Left out: other players' hands, every library's cards and order, the random
 * generator's state and the setup (its seed and decklists would predict every shuffle, CR 701.24a), and the engine's
 * work queue and id counters.
 */
export function playerView(state: GameState, viewer: PlayerId): PlayerView {
  const visible: ObjectId[] = [
    ...state.zones.battlefield,
    ...state.zones.stack,
    ...state.zones.exile,
    ...state.zones.command,
    ...state.turnOrder.flatMap((p) => state.zones.players[p]?.graveyard ?? []),
    ...(state.zones.players[viewer]?.hand ?? []),
  ];
  const objects: Record<ObjectId, GameObject> = {};
  for (const id of visible) {
    const obj = state.objects[id];
    if (obj !== undefined) objects[id] = obj;
  }
  const players: ViewZones["players"] = {};
  for (const p of state.turnOrder) {
    const z = state.zones.players[p];
    if (z === undefined) continue;
    players[p] = {
      library: z.library.length,
      hand: p === viewer ? [...z.hand] : z.hand.length,
      graveyard: [...z.graveyard],
    };
  }
  const pending = state.pending;
  return {
    viewer,
    turn: state.turn,
    turnOrder: state.turnOrder,
    players: state.players,
    objects,
    zones: {
      players,
      battlefield: state.zones.battlefield,
      stack: state.zones.stack,
      exile: state.zones.exile,
      command: state.zones.command,
    },
    effects: state.effects,
    combat: state.combat,
    ruleModifiers: state.setup.ruleModifiers,
    pregame: state.pregame,
    casting: state.casting === null ? null : { player: state.casting.player, object: state.casting.object },
    passesInSuccession: state.passesInSuccession,
    pending:
      pending === null || pending.player === viewer
        ? pending
        : { id: pending.id, player: pending.player, kind: pending.kind },
    result: state.result,
  };
}
