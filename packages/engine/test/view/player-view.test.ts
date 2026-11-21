// playerView and eventsFor (CR 400.2, 401.2, 401.3, 402.3). That a view doesn't change when only hidden information
// changes is tested as a property after every action of every fuzzed game: the `viewsLeakNothing` check in
// packages/cli/src/fuzz/checks.ts, which `pnpm test` runs on a short fuzz. These tests check the shapes and each case.

import { describe, expect, it } from "vitest";
import {
  type Action,
  eventsFor,
  type GameEvent,
  type GameState,
  type ObjectId,
  type PlayerId,
  playerView,
} from "../../src/index.ts";
import { answer, type Game, passBoth, playerSetup, standardSetup, start, take } from "../support/game.ts";

const hand = (s: GameState, p: PlayerId) => s.zones.players[p]?.hand ?? [];
const library = (s: GameState, p: PlayerId) => s.zones.players[p]?.library ?? [];

/**
 * p1 goes first and keeps; p2 mulligans once and puts a card on the bottom (CR 103.5); then, unless `keepAgain` is
 * false, p2 keeps and turn 1 begins.
 */
function p2Mulligans(keepAgain = true): Game {
  let game = start(standardSetup({ opening: { kind: "standard", firstPlayer: "p1" } }));
  game = answer(game, { kind: "mulligan", choice: "keep" });
  game = answer(game, { kind: "mulligan", choice: "mulligan" });
  game = answer(game, { kind: "mulliganBottom", object: hand(game.state, "p2")[0] as ObjectId });
  if (!keepAgain) return game;
  game = answer(game, { kind: "mulligan", choice: "keep" });
  expect(game.state.turn?.number).toBe(1);
  return game;
}

const handToLibrary = (e: GameEvent, player: PlayerId) =>
  e.type === "ZONE_CHANGED" && e.from.zone === "hand" && e.from.player === player && e.to.zone === "library";

describe("playerView (CR 400.2)", () => {
  const { state } = p2Mulligans();
  const view = playerView(state, "p1");

  it("lists the viewer's own hand; other hands and every library are only counts (CR 401.3, 402.3)", () => {
    expect(view.zones.players.p1).toStrictEqual({
      librarySize: library(state, "p1").length,
      handSize: 7,
      hand: hand(state, "p1"),
      graveyard: [],
    });
    expect(view.zones.players.p2).toStrictEqual({ librarySize: 34, handSize: 6, hand: null, graveyard: [] });
  });

  it("shows the extra turns to come, which everyone saw made (CR 500.7)", () => {
    expect(playerView({ ...state, extraTurns: ["p2", "p1"] }, "p1").extraTurns).toStrictEqual(["p2", "p1"]);
  });

  it("holds exactly the objects in public zones and the viewer's own hand", () => {
    // A board with something in every zone: permanents, graveyards, exile, hands and libraries.
    const permanent = { oracleId: "grizzly-bears", tapped: false, summoningSick: false, damage: 0, counters: {} };
    const zones = { library: ["forest", "forest"], hand: ["shock"], graveyard: ["shock"], exile: ["forest"] };
    const board = start({
      seed: 1,
      players: [
        playerSetup("p1", { ...zones, battlefield: [permanent] }),
        playerSetup("p2", { ...zones, battlefield: [permanent] }),
      ],
      opening: { kind: "fixed", turn: { number: 2, activePlayer: "p1", step: "upkeep" } },
      ruleModifiers: [],
    }).state;
    const visible = [
      ...board.zones.battlefield,
      ...board.zones.exile,
      ...(board.zones.players.p1?.graveyard ?? []),
      ...(board.zones.players.p2?.graveyard ?? []),
      ...hand(board, "p1"),
    ];
    expect(visible).toHaveLength(7);
    expect(Object.keys(playerView(board, "p1").objects).sort()).toStrictEqual([...visible].sort());
  });

  it("leaves out the random generator, the setup and the engine's internals (CR 701.24a)", () => {
    expect(JSON.stringify(view)).not.toMatch(/"rng"|"seed"|"setup"|"work"|"nextId"|"nextTimestamp"/);
  });

  it("keeps public facts: the mulligans taken, while the game is starting", () => {
    expect(playerView(p2Mulligans(false).state, "p1").pregame?.mulligans).toStrictEqual({ p1: 0, p2: 1 });
  });
});

describe("decisions in a view", () => {
  const { state } = p2Mulligans();
  // p2 is discarding to hand size (CR 514.1) and has picked one card so far.
  const picked = hand(state, "p2")[2] as ObjectId;
  const discarding: GameState = {
    ...state,
    pending: { id: "d9999", player: "p2", kind: "discardToHandSize", remaining: 1, chosen: [picked] },
  };

  it("shows the deciding player their decision in full", () => {
    const view = playerView(discarding, "p2");
    expect(view.decision).toStrictEqual(discarding.pending);
    expect(view.waitingFor).toStrictEqual({ id: "d9999", player: "p2", kind: "discardToHandSize" });
  });

  it("shows another player only who must decide what, not the picks so far", () => {
    const view = playerView(discarding, "p1");
    expect(view.decision).toBeNull();
    expect(view.waitingFor).toStrictEqual({ id: "d9999", player: "p2", kind: "discardToHandSize" });
    expect(JSON.stringify(view)).not.toContain(`"${picked}"`);
  });
});

describe("eventsFor", () => {
  const { events } = p2Mulligans();

  it("hides another player's mulligan: the hand shuffled back and the card put on the bottom (CR 103.5)", () => {
    const moves = events.filter((e) => handToLibrary(e, "p2"));
    expect(moves).toHaveLength(8); // seven shuffled back, one to the bottom
    for (const e of moves) {
      if (e.type !== "ZONE_CHANGED") throw new Error("a zone change");
      expect(eventsFor([e], "p1")).toStrictEqual([{ type: "HIDDEN_CARD_MOVED", from: e.from, to: e.to }]);
      // p2 saw the card in hand, but not where it went: their library is hidden from them too (CR 401.2).
      expect(eventsFor([e], "p2")).toStrictEqual([
        { type: "CARD_LEFT_VIEW", from: e.from, to: e.to, oldId: e.oldId, cardId: e.cardId, object: e.object },
      ]);
    }
  });

  it("hides another player's draws, and shows a player their own (CR 121.1, 402.3)", () => {
    // p2 drew two hands of seven: fourteen CARD_DRAWN events, each with its library-to-hand ZONE_CHANGED.
    const drawn = events.flatMap((e) => (e.type === "CARD_DRAWN" && e.player === "p2" ? [e] : []));
    const moved = events.flatMap((e) =>
      e.type === "ZONE_CHANGED" && e.from.zone === "library" && e.to.zone === "hand" && e.to.player === "p2" ? [e] : [],
    );
    expect(drawn).toHaveLength(14);
    expect(moved).toHaveLength(14);
    for (const e of drawn) {
      expect(eventsFor([e], "p1")).toStrictEqual([{ type: "HIDDEN_CARD_DRAWN", player: "p2" }]);
      expect(eventsFor([e], "p2")).toStrictEqual([e]);
    }
    for (const e of moved) {
      expect(eventsFor([e], "p1")).toStrictEqual([{ type: "HIDDEN_CARD_MOVED", from: e.from, to: e.to }]);
      // p2 sees the card arrive in hand, not the object it was in their library (CR 401.2).
      expect(eventsFor([e], "p2")).toStrictEqual([
        { type: "CARD_CAME_INTO_VIEW", from: e.from, to: e.to, newId: e.newId, cardId: e.newCardId },
      ]);
    }
  });

  it("shows another player only the public side of a card coming out of a hand, and of a cancel (CR 402.3, D-054)", () => {
    const { state } = p2Mulligans();
    const card = state.objects[hand(state, "p2")[0] as ObjectId];
    if (card?.kind !== "card") throw new Error("a card in hand");
    const cast: GameEvent = {
      type: "ZONE_CHANGED",
      from: { zone: "hand", player: "p2" },
      to: { zone: "stack" },
      oldId: card.id,
      newId: "o9999",
      cardId: card.cardId,
      newCardId: "c9999",
      object: card,
    };
    const cancelled = {
      type: "CAST_CANCELLED",
      player: "p2",
      cardId: "c9999",
      spell: "o9999",
      restored: card.id,
      untapped: [],
    } as const satisfies GameEvent;
    // p1 sees the spell arrive and leave, with its new ids only: nothing about the card in p2's hand.
    expect(eventsFor([cast, cancelled], "p1")).toStrictEqual([
      { type: "CARD_CAME_INTO_VIEW", from: cast.from, to: cast.to, newId: "o9999", cardId: "c9999" },
      { ...cancelled, restored: null },
    ]);
    expect(eventsFor([cast, cancelled], "p2")).toStrictEqual([cast, cancelled]);
  });
});

describe("views and events through a real game", () => {
  const bearsAndShock = (step: "upkeep" | "precombatMain"): Game =>
    start({
      seed: 1,
      players: [
        playerSetup("p1", {
          library: ["forest"],
          hand: ["shock"],
          battlefield: [{ oracleId: "mountain", tapped: false, summoningSick: false, damage: 0, counters: {} }],
        }),
        playerSetup("p2", {
          library: ["forest"],
          battlefield: [{ oracleId: "grizzly-bears", tapped: false, summoningSick: false, damage: 0, counters: {} }],
        }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step } },
      ruleModifiers: [],
    });
  const castShock = (game: Game): Game => {
    let next = take(game, (a) => a.type === "CAST_SPELL");
    next = take(
      next,
      (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget" && a.answer.target.kind === "object",
    );
    return take(next, (a) => a.type === "ACTIVATE_ABILITY");
  };

  it("hides a draw in the draw step from the other player (CR 121.1, 504.1)", () => {
    const game = passBoth(bearsAndShock("upkeep"));
    const drawn = game.events.filter((e) => e.type === "CARD_DRAWN");
    expect(drawn).toHaveLength(1);
    expect(eventsFor(drawn, "p2")).toStrictEqual([{ type: "HIDDEN_CARD_DRAWN", player: "p1" }]);
    expect(eventsFor(drawn, "p1")).toStrictEqual(drawn);
  });

  it("shows everyone a spell resolving and a creature dying (public zones, CR 400.2)", () => {
    let game = castShock(bearsAndShock("precombatMain"));
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "payMana");
    const before = game.events.length;
    game = passBoth(game);
    const moves = game.events.slice(before).filter((e) => e.type === "ZONE_CHANGED");
    // Shock from the stack to p1's graveyard; the Bears from the battlefield to p2's graveyard.
    expect(moves.map((e) => e.type === "ZONE_CHANGED" && `${e.from.zone}>${e.to.zone}`)).toStrictEqual([
      "stack>graveyard",
      "battlefield>graveyard",
    ]);
    expect(eventsFor(moves, "p1")).toStrictEqual(moves);
    expect(eventsFor(moves, "p2")).toStrictEqual(moves);
  });

  it("after a cancelled cast, shows the other player the hand only as a count again (CR 734.1)", () => {
    let game = castShock(bearsAndShock("precombatMain"));
    game = take(game, (a) => a.type === "ANSWER" && a.answer.kind === "cancelCast");
    const view = playerView(game.state, "p2");
    expect(view.zones.players.p1).toMatchObject({ handSize: 1, hand: null });
    expect(view.objects[hand(game.state, "p1")[0] as ObjectId]).toBeUndefined();
    expect(view.casting).toBeNull();
  });
});

describe("a cancelled spell can't be followed through its owner's hand (CR 402.3, 734.1)", () => {
  // p2 holds two Shocks, starts casting the first and cancels; then casts either the same one (world A) or the other
  // (world B). p1 sees the first cast and the cancel, but can't see p2's hand: everything p1 is shown must be the same
  // in both worlds, or p1 could tell which Shock was cast.
  function play(castSecond: boolean): { views: unknown[]; events: unknown[] } {
    let game = start({
      seed: 1,
      players: [
        playerSetup("p1", { library: ["forest"] }),
        playerSetup("p2", {
          library: ["mountain"],
          hand: ["shock", "shock"],
          battlefield: [{ oracleId: "mountain", tapped: false, summoningSick: false, damage: 0, counters: {} }],
        }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p2", step: "precombatMain" } },
      ruleModifiers: [],
    });
    const views: unknown[] = [playerView(game.state, "p1")];
    const step = (match: (a: Action) => boolean) => {
      game = take(game, match);
      views.push(playerView(game.state, "p1"));
    };
    const [first, second] = hand(game.state, "p2") as [ObjectId, ObjectId];
    const mountain = game.state.zones.battlefield[0];
    const castAtP1 = (card: ObjectId) => {
      step((a) => a.type === "CAST_SPELL" && a.object === card);
      step((a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget" && a.answer.target.kind === "player");
    };
    castAtP1(first);
    step((a) => a.type === "ACTIVATE_ABILITY" && a.object === mountain);
    step((a) => a.type === "ANSWER" && a.answer.kind === "cancelCast");
    castAtP1(castSecond ? second : first);
    step((a) => a.type === "ACTIVATE_ABILITY" && a.object === mountain);
    step((a) => a.type === "ANSWER" && a.answer.kind === "payMana");
    return { views, events: eventsFor(game.events, "p1") };
  }

  it("shows p1 the same events and views whichever Shock p2 casts after cancelling", () => {
    const sameCard = play(false);
    const otherCard = play(true);
    expect(otherCard.events).toStrictEqual(sameCard.events);
    expect(otherCard.views).toStrictEqual(sameCard.views);
  });
});
