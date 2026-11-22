// `brief`: everything one player may know when they decide, as data (M2-15f). An AI agent playing through the CLI reads
// it as JSON; `brief-text.ts` renders the same data for people, so the two can't disagree. Built from the viewer's
// `playerView` (D-044), with characteristics the host computes for the objects the viewer can see (D-135), the events the viewer saw
// since they last acted, and their own legal actions only: another player's pending decision is only "waiting for".

import {
  type CardDatabase,
  cardDataByOracleId,
  type GameState,
  type ManaPool,
  manaAvailable,
  nextStep,
  type ObjectId,
  type OracleId,
  type PlayerId,
  type PlayerView,
  playerView,
  type SeenCard,
  type SeenObject,
  seenObjects,
  type ViewDecision,
} from "@mtg/engine";
import { scenarioStep } from "@mtg/scenarios";
import { numberedActions } from "../commands/actions.ts";
import { type ActionInfo, actionInfos } from "./action-info.ts";
import {
  type CardInfo,
  cardInfo,
  type PermanentInfo,
  permanentInfo,
  type StackInfo,
  stackInfo,
} from "./brief-objects.ts";

export const BRIEF_FORMAT = "open-mtg-arena brief";
/** Raised when a field changes meaning or goes away, so a program reading the JSON can tell. */
export const BRIEF_VERSION = 1;

export type PlayerBrief = {
  id: PlayerId;
  life: number;
  handSize: number;
  librarySize: number;
  manaPool: ManaPool;
  /** How much mana its untapped sources could add now, plus its pool: a quick count, not a payment plan. */
  manaAvailable: number;
  landsPlayedThisTurn: number;
  /** The viewer's own hand; null for another player's. */
  hand: CardInfo[] | null;
  /** Another player's hand while an ability reveals it (Telepathy), by name, sorted (D-122). */
  revealedHand: string[] | null;
  /** The top card of their library while it's revealed (Vampire Nocturnus). */
  revealedTop: string | null;
  battlefield: PermanentInfo[];
  graveyard: CardInfo[];
};

export type Brief = {
  format: typeof BRIEF_FORMAT;
  version: typeof BRIEF_VERSION;
  viewer: PlayerId;
  turn: { number: number; activePlayer: PlayerId; step: string; nextStep: string | null } | null;
  /** The viewer first, then the others in turn order. */
  players: PlayerBrief[];
  /** Bottom to top: the last one resolves first (CR 405.5). */
  stack: StackInfo[];
  exile: CardInfo[];
  /** Who must decide what; null when the game is over. */
  waitingFor: { player: PlayerId; kind: string } | null;
  /** The viewer's own decision, as the engine's view shows it (D-062); null when another player must decide. */
  decision: ViewDecision | null;
  /** The viewer's legal actions, numbered as `actions` and `do <file> <n>` number them; empty when not theirs. */
  actions: ActionInfo[];
  /** What the viewer saw happen since they last acted, one event per line. */
  recent: string[];
  result: { winner: PlayerId | null; losses: { player: PlayerId; reason: string }[] } | null;
};

export function briefOf(state: GameState, viewer: PlayerId, recent: readonly string[], cards: CardDatabase): Brief {
  const view = playerView(state, viewer, cards);
  const seated = [viewer, ...view.turnOrder.filter((p) => p !== viewer)];
  const turn = view.turn;
  const mine = view.waitingFor?.player === viewer;
  // What the viewer sees of each object, derived by the engine (D-135): only objects in the view are there, so a
  // face-down card (later: CR 708) would be left out, not shown.
  const objects = seenObjects(state, view, cards);
  const seen = (ids: readonly ObjectId[]): SeenObject[] => ids.flatMap((id) => objects[id] ?? []);
  const seenCards = (ids: readonly ObjectId[]): SeenCard[] => seen(ids).filter((o): o is SeenCard => o.kind === "card");
  return {
    format: BRIEF_FORMAT,
    version: BRIEF_VERSION,
    viewer,
    turn:
      turn === null
        ? null
        : {
            number: turn.number,
            activePlayer: turn.activePlayer,
            step: scenarioStep(turn.step),
            nextStep: nextStepName(state),
          },
    players: seated.map((p) => playerBrief(state, view, p, seenCards, cards)),
    stack: seen(view.zones.stack).map((o) => stackInfo(state, o, cards)),
    exile: seenCards(view.zones.exile).map((c) => cardInfo(state, c, cards)),
    waitingFor: view.waitingFor === null ? null : { player: view.waitingFor.player, kind: view.waitingFor.kind },
    decision: view.decision,
    // Numbered by the same function as `actions` and `do`, so the numbers always match.
    actions: mine ? actionInfos(state, viewer, numberedActions(state, cards), cards) : [],
    recent: [...recent],
    result:
      view.result === null
        ? null
        : {
            winner: view.result.winner,
            losses: view.result.losses.map((l) => ({ player: l.player, reason: l.reason })),
          },
  };
}

function playerBrief(
  state: GameState,
  view: PlayerView,
  player: PlayerId,
  seenCards: (ids: readonly ObjectId[]) => SeenCard[],
  cards: CardDatabase,
): PlayerBrief {
  const ps = view.players[player];
  const zones = view.zones.players[player];
  if (ps === undefined || zones === undefined) throw new Error(`no player ${player}`);
  const named = (o: OracleId) => cardDataByOracleId(o, cards)?.printed.name ?? o;
  return {
    id: player,
    life: ps.life,
    handSize: zones.handSize,
    librarySize: zones.librarySize,
    manaPool: ps.manaPool,
    manaAvailable: manaAvailable(state, player, cards),
    landsPlayedThisTurn: ps.landsPlayedThisTurn,
    hand: zones.hand === null ? null : seenCards(zones.hand).map((c) => cardInfo(state, c, cards)),
    revealedHand: zones.revealedHand === null ? null : zones.revealedHand.map(named).sort(),
    revealedTop: zones.revealedTop === null ? null : named(zones.revealedTop),
    // Each player's side of the table is what they control now (CR 110.2), not what they own.
    battlefield: seenCards(view.zones.battlefield)
      .map((c) => permanentInfo(state, c, cards))
      .filter((p) => p.controller === player),
    graveyard: seenCards(zones.graveyard).map((c) => cardInfo(state, c, cards)),
  };
}

/** The step that comes next this turn as things stand (skipped ones passed over), by name; null after cleanup. */
function nextStepName(state: GameState): string | null {
  const next = nextStep(state);
  return next === null ? null : scenarioStep(next);
}
