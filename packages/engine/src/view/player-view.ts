// What one player may know of the game (CR 400.2: libraries and hands are hidden zones). Hosts give a view, never the
// state, to the UI and the AI. A view must not change when only hidden information changes: the fuzzer's
// `viewsLeakNothing` check (packages/cli/src/fuzz/checks.ts) tests that after every action of every game.

import type { Combat } from "../state/combat.ts";
import type { PendingDecision } from "../state/decisions.ts";
import type { ContinuousEffect } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { DecisionId, ObjectId, PlayerId } from "../state/ids.ts";
import type { GameObject } from "../state/objects.ts";
import type { PlayerState } from "../state/players.ts";
import type { Pregame } from "../state/pregame.ts";
import type { GameResult } from "../state/result.ts";
import type { RuleModifier } from "../state/setup.ts";
import type { Turn } from "../state/turn.ts";
import type { ZoneRef } from "../state/zones.ts";
import { zoneList } from "../zones/zone-list.ts";
import { type ViewDecision, viewDecision } from "./view-decision.ts";
import { canSee } from "./visibility.ts";

/**
 * One player's view. It shares structure with the state it came from (D-021), so it must never be changed in place:
 * sort a copy, not `zones.battlefield`.
 */
export type PlayerView = {
  viewer: PlayerId;
  turn: Turn | null;
  turnOrder: PlayerId[];
  /** Extra turns still to come, the next first (CR 500.7): public, as everyone saw them made. */
  extraTurns: PlayerId[];
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
  /**
   * The viewer's own pending decision; null when nothing is pending or another player must decide. Cards it offers
   * from a zone the viewer can't see are shown by what they are, without ids (D-062).
   */
  decision: ViewDecision | null;
  /** Who must decide what, whoever it is. Another player's choices so far (cards picked to discard) stay hidden. */
  waitingFor: { id: DecisionId; player: PlayerId; kind: PendingDecision["kind"] } | null;
  result: GameResult | null;
};

export type ViewZones = {
  players: Record<
    PlayerId,
    {
      /** Any player may count a library (CR 401.3), but no one may see its cards or their order (CR 401.2). */
      librarySize: number;
      /** Any player may count a hand (CR 402.3). */
      handSize: number;
      /** The cards in the viewer's own hand (CR 402.3); null for another player's. */
      hand: ObjectId[] | null;
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
  const objects: Record<ObjectId, GameObject> = {};
  for (const ref of zoneRefs(state)) {
    if (!canSee(ref, viewer)) continue;
    for (const id of zoneList(state, ref)) {
      const obj = state.objects[id];
      if (obj !== undefined) objects[id] = obj;
    }
  }
  const players: ViewZones["players"] = {};
  for (const p of state.turnOrder) {
    const z = state.zones.players[p];
    if (z === undefined) continue;
    players[p] = {
      librarySize: z.library.length,
      handSize: z.hand.length,
      hand: canSee({ zone: "hand", player: p }, viewer) ? z.hand : null,
      graveyard: z.graveyard,
    };
  }
  const pending = state.pending;
  return {
    viewer,
    turn: state.turn,
    turnOrder: state.turnOrder,
    extraTurns: state.extraTurns,
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
    decision: pending !== null && pending.player === viewer ? viewDecision(state, pending, viewer) : null,
    waitingFor: pending === null ? null : { id: pending.id, player: pending.player, kind: pending.kind },
    result: state.result,
  };
}

/** Every zone in the game: the shared ones, then each player's, in turn order. */
function zoneRefs(state: GameState): ZoneRef[] {
  return [
    { zone: "battlefield" },
    { zone: "stack" },
    { zone: "exile" },
    { zone: "command" },
    ...state.turnOrder.flatMap((player): ZoneRef[] => [
      { zone: "library", player },
      { zone: "hand", player },
      { zone: "graveyard", player },
    ]),
  ];
}
