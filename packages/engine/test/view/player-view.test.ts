// playerView and eventsFor (CR 400.2, 401.2, 402.3): a view must not change when only hidden information changes, and
// events that would reveal a hidden card don't.

import { describe, expect, it } from "vitest";
import {
  type Action,
  applyAction,
  createGame,
  eventsFor,
  type GameEvent,
  type GameState,
  legalActions,
  type ObjectId,
  type PlayerId,
  playerView,
} from "../../src/index.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { playerSetup } from "../support/game.ts";

/** A little game between two decks of the test cards, played by picking legal actions with a simple seeded LCG. */
function playedStates(seed: number, actions: number): { states: GameState[]; events: GameEvent[][] } {
  const deck = (cards: string[]) => Array.from({ length: 20 }, (_, i) => cards[i % cards.length] as string);
  const created = createGame(
    {
      seed,
      players: [
        playerSetup("p1", { library: deck(["mountain", "shock", "grizzly-bears", "mountain", "volcanic-hammer"]) }),
        playerSetup("p2", { library: deck(["forest", "llanowar-elves", "giant-growth", "forest", "grizzly-bears"]) }),
      ],
      opening: { kind: "standard", firstPlayer: null },
      ruleModifiers: [],
    },
    TEST_CARDS,
  );
  if (!created.ok) throw new Error(created.error.message);
  const states = [created.state];
  const events = [created.events];
  let state = created.state;
  let r = seed;
  for (let i = 0; i < actions && state.pending !== null; i++) {
    const options = legalActions(state, state.pending.player, TEST_CARDS);
    r = (r * 1103515245 + 12345) % 2147483648;
    const result = applyAction(state, options[r % options.length] as Action, TEST_CARDS);
    if (!result.ok) throw new Error(result.error.message);
    state = result.state;
    states.push(state);
    events.push(result.events);
  }
  return { states, events };
}

/** The same game with everything `viewer` can't see changed: hidden cards' identities, library order, seed, RNG. */
function scrambled(state: GameState, viewer: PlayerId): GameState {
  const objects = { ...state.objects };
  const hidden: ObjectId[] = state.turnOrder.flatMap((p) => [
    ...(state.zones.players[p]?.library ?? []),
    ...(p === viewer ? [] : (state.zones.players[p]?.hand ?? [])),
  ]);
  for (const [i, id] of hidden.entries()) {
    const obj = objects[id];
    if (obj?.kind === "card")
      objects[id] = { ...obj, oracleId: i % 2 === 0 ? "forest" : "shock", cardId: `c${9000 + i}` };
  }
  const players = { ...state.zones.players };
  for (const p of state.turnOrder) {
    const z = players[p];
    if (z !== undefined) players[p] = { ...z, library: [...z.library].reverse() };
  }
  return {
    ...state,
    objects,
    zones: { ...state.zones, players },
    rng: [state.rng[0] ^ 0x5a5a5a5a, state.rng[1], state.rng[2], state.rng[3]],
    setup: {
      ...state.setup,
      seed: state.setup.seed + 1,
      players: state.setup.players.map((p) => ({ ...p, library: [] })),
    },
    nextId: state.nextId + 1000,
    work: [],
  };
}

describe("playerView (CR 400.2)", () => {
  it("doesn't change when only what the viewer can't see changes, at every state of a game", () => {
    for (const seed of [1, 2, 3]) {
      const { states } = playedStates(seed, 400);
      for (const state of states) {
        for (const viewer of state.turnOrder) {
          expect(playerView(scrambled(state, viewer), viewer)).toStrictEqual(playerView(state, viewer));
        }
      }
    }
  });

  it("shows the viewer's own hand, other hands and every library only as counts, and no RNG or setup", () => {
    const { states } = playedStates(4, 30);
    const state = states.at(-1) as GameState;
    const view = playerView(state, "p1");
    expect(view.zones.players.p1?.hand).toStrictEqual(state.zones.players.p1?.hand);
    expect(view.zones.players.p2?.hand).toBe(state.zones.players.p2?.hand.length);
    expect(view.zones.players.p1?.library).toBe(state.zones.players.p1?.library.length);
    for (const id of state.zones.players.p2?.hand ?? []) expect(view.objects[id]).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/"rng"|"seed"|"work"/);
  });
});

describe("another player's decision", () => {
  it("shows only who must decide what, not its details (a hand being discarded, picks so far)", () => {
    const { states } = playedStates(6, 300);
    const theirs = states.filter(
      (s) => s.pending !== null && s.pending.player === "p2" && Object.keys(s.pending).length > 3,
    );
    expect(theirs.length).toBeGreaterThan(0);
    for (const state of theirs) {
      const pending = state.pending;
      expect(playerView(state, "p1").pending).toStrictEqual({ id: pending?.id, player: "p2", kind: pending?.kind });
      expect(playerView(state, "p2").pending).toStrictEqual(pending);
    }
  });
});

describe("eventsFor", () => {
  it("hides another player's draws and hidden moves, but not the viewer's own or public ones", () => {
    const { events } = playedStates(5, 200);
    const all = events.flat();
    const draws = all.filter((e) => e.type === "CARD_DRAWN");
    expect(draws.length).toBeGreaterThan(0);
    for (const e of draws) {
      const seen = eventsFor([e], "p1")[0];
      expect(seen).toStrictEqual(e.player === "p1" ? e : { type: "HIDDEN_CARD_DRAWN", player: e.player });
    }
    for (const e of all) {
      if (e.type !== "ZONE_CHANGED") continue;
      const [seen] = eventsFor([e], "p1");
      const opponentsHiddenMove =
        e.from.zone === "library" && e.to.zone === "hand" && "player" in e.to && e.to.player === "p2";
      if (opponentsHiddenMove) expect(seen).toStrictEqual({ type: "HIDDEN_CARD_MOVED", from: e.from, to: e.to });
      if (e.to.zone === "stack" || e.to.zone === "battlefield") expect(seen).toStrictEqual(e);
    }
    // A card put on the bottom after a mulligan moves from hand to library: its owner saw it in hand, so sees the move;
    // the other player doesn't.
    const bottom = all.find((e) => e.type === "ZONE_CHANGED" && e.from.zone === "hand" && e.to.zone === "library");
    if (bottom?.type === "ZONE_CHANGED" && "player" in bottom.from) {
      const owner = bottom.from.player;
      const other: PlayerId = owner === "p1" ? "p2" : "p1";
      expect(eventsFor([bottom], owner)[0]).toStrictEqual(bottom);
      expect(eventsFor([bottom], other)[0]).toMatchObject({ type: "HIDDEN_CARD_MOVED" });
    }
  });
});
