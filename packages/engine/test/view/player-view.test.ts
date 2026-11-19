// playerView and eventsFor (CR 400.2, 401.2, 401.3, 402.3). That a view doesn't change when only hidden information
// changes is tested as a property after every action of every fuzzed game: the `viewsLeakNothing` check in
// packages/cli/src/fuzz/checks.ts, which `pnpm test` runs on a short fuzz. These tests check the shapes and each case.

import { describe, expect, it } from "vitest";
import {
  eventsFor,
  type GameEvent,
  type GameState,
  type ObjectId,
  type PlayerId,
  playerView,
} from "../../src/index.ts";
import { answer, type Game, standardSetup, start } from "../support/game.ts";

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

  it("holds exactly the objects in public zones and the viewer's own hand", () => {
    const visible = [...state.zones.battlefield, ...hand(state, "p1")];
    expect(Object.keys(view.objects).sort()).toStrictEqual([...visible].sort());
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
    expect(JSON.stringify(view)).not.toContain(picked);
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
      expect(eventsFor([e], "p2")).toStrictEqual([e]);
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
      expect(eventsFor([e], "p2")).toStrictEqual([e]);
    }
  });

  it("shows everyone a move to or from a public zone, and a cancelled cast's card (it was on the stack, CR 734.1)", () => {
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
      object: { ...card, id: "o9999" },
    };
    const cancelled = {
      type: "CAST_CANCELLED",
      player: "p2",
      cardId: card.cardId,
      spell: "o9999",
      restored: card.id,
      untapped: [],
    } as const satisfies GameEvent;
    expect(eventsFor([cast, cancelled], "p1")).toStrictEqual([cast, cancelled]);
  });
});
