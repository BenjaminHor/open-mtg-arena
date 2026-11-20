// createGame: a new game from a GameSetup (docs/architecture.md, "Engine API").

import type { CardDatabase } from "../cards/types.ts";
import { randomInt, seedRng } from "../rng/xoshiro128.ts";
import { newCombat } from "../state/combat.ts";
import type { GameState } from "../state/game-state.ts";
import type { CardId, PlayerId } from "../state/ids.ts";
import type { CardObject } from "../state/objects.ts";
import type { EngineResult } from "../state/result.ts";
import type { GameSetup, PermanentSetup, PlayerSetup } from "../state/setup.ts";
import { phaseOf } from "../state/turn.ts";
import type { ZoneRef } from "../state/zones.ts";
import { ENGINE_VERSION } from "../version.ts";
import { withZoneList, zoneList } from "../zones/zone-list.ts";
import { advance } from "./advance.ts";
import { waitFor } from "./decide.ts";
import { newObjectId, newTimestamp } from "./ids.ts";
import { setStartingPlayer } from "./pregame.ts";
import { setupProblems } from "./setup-validation.ts";
import { rotateTo } from "./turn-order.ts";
import { queueWork } from "./work.ts";

export function createGame(setup: GameSetup, cards: CardDatabase): EngineResult {
  const problems = setupProblems(setup, cards);
  if (problems.length > 0) return { ok: false, error: { code: "invalidSetup", message: problems.join("; ") } };

  let state = emptyGame(setup);
  // Objects are created player by player in seating order, zone by zone, so ids and timestamps are deterministic.
  // Card ids are numbered in a random order (D-045): numbered in setup order, one public card would hint at what its
  // neighbours in a decklist are, in hidden libraries and hands (CR 400.2).
  const numbered = shuffledCardIds(state, setup);
  state = { ...numbered.state, nextCardId: numbered.cardIds.length + 1 };
  const cardIds = [...numbered.cardIds];
  const standard = setup.opening.kind === "standard";
  for (const player of setup.players) state = createCards(state, player, standard, cardIds);

  const opening = setup.opening;
  switch (opening.kind) {
    case "fixed": {
      // The game starts in the given step with its turn-based actions done, and the active player gets priority
      // (CR 117.3a). On turn 1 the active player is the starting player, so turn order starts with them (CR 103.1).
      // On later turns it stays in seating order: the starting player isn't known, and it no longer matters.
      // A fixed opening can start in the beginning of combat step (setup validation allows no later combat step):
      // the combat phase has begun, with no attackers or blockers.
      const inCombat = phaseOf(opening.turn.step) === "combat";
      state = {
        ...state,
        turn: { ...opening.turn },
        turnOrder: opening.turn.number === 1 ? rotateTo(state.turnOrder, opening.turn.activePlayer) : state.turnOrder,
        combat: inCombat ? newCombat() : null,
      };
      const first = queueWork(state, { kind: "givePriority", player: opening.turn.activePlayer });
      return { ok: true, ...advance({ state: first, events: [] }, cards) };
    }
    case "standard": {
      state = {
        ...state,
        pregame: {
          startingPlayer: null,
          mulligans: Object.fromEntries(state.turnOrder.map((p) => [p, 0])) as Record<PlayerId, number>,
          kept: [],
          declarations: [],
          bottom: [],
        },
      };
      if (opening.firstPlayer !== null) {
        return { ok: true, ...advance(setStartingPlayer(state, opening.firstPlayer, null, cards), cards) };
      }
      // CR 103.1: the players determine who chooses who takes the first turn. We pick that player at random.
      const pick = randomInt(state.rng, state.turnOrder.length);
      const chooser = state.turnOrder[pick.value] as PlayerId;
      state = waitFor({ ...state, rng: pick.rng }, chooser, { kind: "chooseStartingPlayer" });
      return { ok: true, ...advance({ state, events: [] }, cards) };
    }
  }
}

function emptyGame(setup: GameSetup): GameState {
  const ids = setup.players.map((p) => p.id);
  return {
    version: ENGINE_VERSION,
    setup,
    rng: seedRng(setup.seed),
    nextId: 1,
    nextTimestamp: 1,
    nextCardId: 1,
    turn: null,
    turnOrder: ids,
    players: Object.fromEntries(
      setup.players.map((p) => [
        p.id,
        {
          id: p.id,
          life: p.life,
          manaPool: { ...p.manaPool },
          landsPlayedThisTurn: 0,
          attemptedDrawFromEmptyLibrary: false,
        },
      ]),
    ),
    objects: {},
    zones: {
      players: Object.fromEntries(ids.map((id) => [id, { library: [], hand: [], graveyard: [] }])),
      battlefield: [],
      stack: [],
      exile: [],
      command: [],
    },
    effects: [],
    pregame: null,
    passesInSuccession: 0,
    combat: null,
    casting: null,
    resolution: null,
    dealtDeathtouchDamage: [],
    pendingTriggers: [],
    lastKnown: {},
    delayedTriggers: [],
    activationsThisTurn: [],
    work: [],
    pending: null,
    result: null,
  };
}

/** `c1` to `cN` for the setup's N cards, in a random order, drawn from the game's RNG. */
function shuffledCardIds(state: GameState, setup: GameSetup): { state: GameState; cardIds: CardId[] } {
  const total = setup.players.reduce(
    (n, p) => n + p.library.length + p.hand.length + p.graveyard.length + p.exile.length + p.battlefield.length,
    0,
  );
  const cardIds = Array.from({ length: total }, (_, i): CardId => `c${i + 1}`);
  let rng = state.rng;
  // Fisher–Yates, as in shuffling (zones/shuffle.ts).
  for (let i = cardIds.length - 1; i > 0; i--) {
    const pick = randomInt(rng, i + 1);
    rng = pick.rng;
    [cardIds[i], cardIds[pick.value]] = [cardIds[pick.value] as CardId, cardIds[i] as CardId];
  }
  return { state: { ...state, rng }, cardIds };
}

/** Creates the player's cards, taking each one's card id from the front of `cardIds`. */
function createCards(state: GameState, player: PlayerSetup, standard: boolean, cardIds: CardId[]): GameState {
  let next = state;
  const zones: [ZoneRef, string[]][] = [
    [{ zone: "library", player: player.id }, player.library],
    [{ zone: "hand", player: player.id }, player.hand],
    [{ zone: "graveyard", player: player.id }, player.graveyard],
    [{ zone: "exile" }, player.exile],
  ];
  for (const [ref, oracleIds] of zones) {
    for (const oracleId of oracleIds) next = addCard(next, ref, player.id, oracleId, null, nextCardId(cardIds));
  }
  for (const permanent of player.battlefield) {
    // Before the first turn no turn has begun, so no permanent has been controlled since one did (CR 302.6).
    const sick = standard ? { ...permanent, summoningSick: true } : permanent;
    next = addCard(next, { zone: "battlefield" }, player.id, permanent.oracleId, sick, nextCardId(cardIds));
  }
  return next;
}

function addCard(
  state: GameState,
  ref: ZoneRef,
  owner: PlayerId,
  oracleId: string,
  permanent: PermanentSetup | null,
  cardId: CardId,
): GameState {
  const object = newObjectId(state);
  const stamped = newTimestamp(object.state);
  const obj: CardObject = {
    kind: "card",
    id: object.id,
    cardId,
    oracleId,
    owner,
    baseController: owner,
    timestamp: stamped.timestamp,
    tapped: permanent?.tapped ?? false,
    damage: permanent?.damage ?? 0,
    counters: { ...(permanent?.counters ?? {}) },
    controlledSinceTurnStart: permanent !== null && !permanent.summoningSick,
    choices: null,
  };
  const next = { ...stamped.state, objects: { ...stamped.state.objects, [obj.id]: obj } };
  return withZoneList(next, ref, [...zoneList(next, ref), obj.id]);
}

function nextCardId(cardIds: CardId[]): CardId {
  const id = cardIds.shift();
  if (id === undefined) throw new Error("more cards than card ids: shuffledCardIds counts every setup zone");
  return id;
}
