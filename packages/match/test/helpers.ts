// Building matches by hand for the host's tests: card names to ids, a fixed opening, and a person's actions.

import { cardDatabase } from "@mtg/cards";
import {
  type Action,
  type Answer,
  type GameSetup,
  legalActions,
  type OracleId,
  type PlayerId,
  type Step,
} from "@mtg/engine";
import { advance, type MatchState, submit } from "../src/index.ts";

export const cards = cardDatabase();

export const id = (name: string): OracleId => {
  const found = Object.values(cards).find((c) => c.printed.name === name);
  if (found === undefined) throw new Error(`no card ${name}`);
  return found.oracleId;
};

const permanent = (name: string) => ({
  oracleId: id(name),
  tapped: false,
  summoningSick: false,
  damage: 0,
  counters: {},
});

type Side = { hand?: string[]; battlefield?: string[]; library?: string };

/** p1 and p2 as given (libraries of five of one card, Plains by default), on p1's turn 3 at `step`. */
export function handMade(p1: Side, p2: Side, step: Step): GameSetup {
  const player = (pid: PlayerId, side: Side) => ({
    id: pid,
    life: 20,
    library: Array.from({ length: 5 }, () => id(side.library ?? "Plains")),
    hand: (side.hand ?? []).map(id),
    battlefield: (side.battlefield ?? []).map(permanent),
    graveyard: [],
    exile: [],
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  });
  return {
    seed: 1,
    players: [player("p1", p1), player("p2", p2)],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step } },
    ruleModifiers: [],
  };
}

/** The person who must decide takes the first legal action that fits, then the host goes on. */
export function act(match: MatchState, fits: (a: Action) => boolean): MatchState {
  const pending = match.state.pending;
  if (pending === null) throw new Error("nothing pending");
  const action = legalActions(match.state, pending.player, cards).find(fits);
  if (action === undefined) throw new Error(`no such action for ${pending.player} (${pending.kind})`);
  const result = submit(match, action, cards);
  if (!result.ok) throw new Error(result.error.message);
  return advance(result.match, cards);
}

export const passes = (a: Action) => a.type === "PASS_PRIORITY";
export const answers = (kind: Answer["kind"]) => (a: Action) => a.type === "ANSWER" && a.answer.kind === kind;
