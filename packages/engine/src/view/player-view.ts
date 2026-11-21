// What one player may know of the game (CR 400.2: libraries and hands are hidden zones). Hosts give a view, never the
// state, to the UI and the AI. A view must not change when only hidden information changes: the fuzzer's
// `viewsLeakNothing` check (packages/cli/src/fuzz/checks.ts) tests that after every action of every game.

import type { CardDatabase } from "../cards/types.ts";
import { handsRevealed, libraryTopsRevealed } from "../rules/revealed.ts";
import type { Combat } from "../state/combat.ts";
import type { PendingDecision } from "../state/decisions.ts";
import type { ContinuousEffect } from "../state/effects.ts";
import type { GameState } from "../state/game-state.ts";
import type { DecisionId, ObjectId, OracleId, PlayerId } from "../state/ids.ts";
import type { GameObject } from "../state/objects.ts";
import type { PlayerState } from "../state/players.ts";
import type { Pregame } from "../state/pregame.ts";
import type { GameResult } from "../state/result.ts";
import type { RuleModifier } from "../state/setup.ts";
import type { Turn } from "../state/turn.ts";
import type { ZoneRef } from "../state/zones.ts";
import { inShownOrder, oracleIdOf } from "../zones/shown-order.ts";
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
      /**
       * What the cards in this hand are, while it's revealed to every player (Telepathy, CR 701.20a); else null. By
       * identity only, in a fixed order (D-062): ids and the hand's order record when each card came, which a reveal
       * doesn't show.
       */
      revealedHand: OracleId[] | null;
      /**
       * What the library's top card is, while it's revealed to every player (Vampire Nocturnus, CR 401.5); else null,
       * also for an empty library. By identity only: a shuffle keeps object ids, so an id would let a player follow the
       * card through it (a reordered revealed card becomes a new object, later: CR 701.20d).
       */
      revealedTop: OracleId | null;
      graveyard: ObjectId[];
    }
  >;
  battlefield: ObjectId[];
  stack: ObjectId[];
  exile: ObjectId[];
  command: ObjectId[];
};

/**
 * The game as `viewer` may see it, with the cards an ability reveals (`rules/revealed.ts`). Left out: other players' hands, every library's cards and order, the random
 * generator's state and the setup (its seed and decklists would predict every shuffle, CR 701.24a), and the engine's
 * work queue and id counters.
 */
export function playerView(state: GameState, viewer: PlayerId, cards: CardDatabase): PlayerView {
  const objects: Record<ObjectId, GameObject> = {};
  for (const ref of zoneRefs(state)) {
    if (!canSee(ref, viewer)) continue;
    for (const id of zoneList(state, ref)) {
      const obj = state.objects[id];
      if (obj !== undefined) objects[id] = obj;
    }
  }
  const players: ViewZones["players"] = {};
  const hands = handsRevealed(state, cards);
  const tops = libraryTopsRevealed(state, cards);
  for (const p of state.turnOrder) {
    const z = state.zones.players[p];
    if (z === undefined) continue;
    const top = z.library[0];
    players[p] = {
      librarySize: z.library.length,
      handSize: z.hand.length,
      hand: canSee({ zone: "hand", player: p }, viewer) ? z.hand : null,
      revealedHand: hands.includes(p) ? inShownOrder(state, z.hand).map((id) => oracleIdOf(state, id)) : null,
      // A new top card waits until a spell is cast (later: CR 601.2i); no card in the pool changes it while casting.
      revealedTop: tops.includes(p) && top !== undefined ? oracleIdOf(state, top) : null,
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
