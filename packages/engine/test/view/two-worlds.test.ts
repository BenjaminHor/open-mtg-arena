// Two worlds that differ only in which of two identical hidden cards p2 uses: everything p1 is shown, events and views
// at every step, must be the same in both, or p1 could tell which card it was (CR 402.3, 401.2; D-054). Each world has
// one card from the setup hand and one drawn this turn, so the cards also differ in when they entered the hand.

import { describe, expect, it } from "vitest";
import { type Action, eventsFor, type GameState, type ObjectId, playerView } from "../../src/index.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { type Game, passBoth, playerSetup, start, take } from "../support/game.ts";

const MOUNTAIN = { oracleId: "mountain", tapped: false, summoningSick: false, damage: 0, counters: {} };
type Seen = { events: unknown[]; views: unknown[] };

/** p2's turn from the upkeep to the first main phase, drawing one card; the setup's card in hand and the drawn one. */
function p2DrawsOne(hand: string[], library: string[], battlefield = [MOUNTAIN]) {
  let game = start({
    seed: 3,
    players: [playerSetup("p1", { library: ["forest", "forest"] }), playerSetup("p2", { hand, library, battlefield })],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p2", step: "upkeep" } },
    ruleModifiers: [],
  });
  const fromSetup = handOf(game.state)[0] as ObjectId;
  game = passBoth(passBoth(game)); // the draw step, then the first main phase
  const drawn = handOf(game.state).at(-1) as ObjectId;
  return { game, fromSetup, drawn };
}

const handOf = (s: GameState) => s.zones.players.p2?.hand ?? [];

/** Takes actions, keeping what p1 sees after each. */
function recorder(start: Game) {
  let game = start;
  const views: unknown[] = [playerView(game.state, "p1", TEST_CARDS)];
  return {
    take(match: (a: Action) => boolean): void {
      game = take(game, match);
      views.push(playerView(game.state, "p1", TEST_CARDS));
    },
    get game(): Game {
      return game;
    },
    seen(): Seen {
      return { events: eventsFor(game.events, "p1"), views };
    },
  };
}

function expectSame(worlds: Seen[]): void {
  const [first, ...rest] = worlds as [Seen, ...Seen[]];
  for (const world of rest) {
    expect(world.events).toStrictEqual(first.events);
    expect(world.views).toStrictEqual(first.views);
  }
}

describe("two worlds p1 can't tell apart", () => {
  it("p2 casts a Shock at p1, cancels, and casts again: whichever Shock each time (CR 734.1)", () => {
    const world = (pick: (fromSetup: ObjectId, drawn: ObjectId) => [ObjectId, ObjectId]): Seen => {
      const { game, fromSetup, drawn } = p2DrawsOne(["shock"], ["shock", "mountain"]);
      const r = recorder(game);
      const mountain = game.state.zones.battlefield[0];
      const [cancelled, cast] = pick(fromSetup, drawn);
      const attempts: [ObjectId, "cancelCast" | "payMana"][] = [
        [cancelled, "cancelCast"],
        [cast, "payMana"],
      ];
      for (const [card, finish] of attempts) {
        r.take((a) => a.type === "CAST_SPELL" && a.object === card);
        r.take((a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget" && a.answer.target.kind === "player");
        r.take((a) => a.type === "ACTIVATE_ABILITY" && a.object === mountain);
        r.take((a) => a.type === "ANSWER" && a.answer.kind === finish);
      }
      return r.seen();
    };
    expectSame([world((s) => [s, s]), world((_, d) => [d, d]), world((s, d) => [s, d]), world((s, d) => [d, s])]);
  });

  it("p2 plays a Mountain: the one from the setup or the one just drawn (CR 305.1)", () => {
    const world = (playDrawn: boolean): Seen => {
      const { game, fromSetup, drawn } = p2DrawsOne(["mountain"], ["mountain", "forest"], []);
      const r = recorder(game);
      r.take((a) => a.type === "PLAY_LAND" && a.object === (playDrawn ? drawn : fromSetup));
      return r.seen();
    };
    expectSame([world(false), world(true)]);
  });

  it("p2 discards to hand size: the Shock from the setup or the one just drawn (CR 514.1, 701.9a)", () => {
    const world = (discardDrawn: boolean): Seen => {
      const forests = Array.from({ length: 6 }, () => "forest");
      const { game, fromSetup, drawn } = p2DrawsOne(["shock", ...forests], ["shock", "forest"], []);
      const r = recorder(game);
      while (r.game.state.pending?.kind !== "discardToHandSize") r.take((a) => a.type === "PASS_PRIORITY");
      const card = discardDrawn ? drawn : fromSetup;
      r.take((a) => a.type === "ANSWER" && a.answer.kind === "discardToHandSize" && a.answer.object === card);
      return r.seen();
    };
    expectSame([world(false), world(true)]);
  });
});
