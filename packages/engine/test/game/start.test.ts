// Game start (CR 103). These are TypeScript for now; they become YAML scenarios when the M1-16 runner exists.

import { describe, expect, it } from "vitest";
import { applyAction, createGame, type GameState, type PlayerId } from "../../src/index.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { answer, type Game, pendingPlayer, playerSetup, standardSetup, start } from "../support/game.ts";

const hand = (s: GameState, p: PlayerId) => s.zones.players[p]?.hand ?? [];
const library = (s: GameState, p: PlayerId) => s.zones.players[p]?.library ?? [];
const cardIdOf = (s: GameState, id: string) => {
  const obj = s.objects[id as `o${number}`];
  if (obj?.kind !== "card") throw new Error(`${id} isn't a card`);
  return obj.cardId;
};

/** Starts a standard game where p1 goes first. */
function p1First(): Game {
  return start(standardSetup({ opening: { kind: "standard", firstPlayer: "p1" } }));
}

describe("choosing the starting player (CR 103.1)", () => {
  it("has a randomly picked player choose, and the same seed picks the same player", () => {
    const game = start(standardSetup());
    expect(game.state.pending?.kind).toBe("chooseStartingPlayer");
    expect(start(standardSetup()).state.pending).toStrictEqual(game.state.pending);
  });

  it("starts turn order with the chosen player, who may be the other player", () => {
    let game = start(standardSetup());
    const chooser = pendingPlayer(game.state);
    const other = chooser === "p1" ? "p2" : "p1";
    game = answer(game, { kind: "chooseStartingPlayer", player: other });
    expect(game.state.turnOrder).toStrictEqual([other, chooser]);
    expect(game.events).toContainEqual({ type: "STARTING_PLAYER_CHOSEN", player: other, chosenBy: chooser });
  });

  it("skips the choice when the setup names the starting player", () => {
    const game = p1First();
    expect(game.events[0]).toStrictEqual({ type: "STARTING_PLAYER_CHOSEN", player: "p1", chosenBy: null });
  });
});

describe("shuffling and opening hands (CR 103.3, 103.5)", () => {
  it("shuffles each library, then each player draws seven", () => {
    const game = p1First();
    const types = game.events.map((e) => e.type);
    expect(types.slice(0, 3)).toStrictEqual(["STARTING_PLAYER_CHOSEN", "LIBRARY_SHUFFLED", "LIBRARY_SHUFFLED"]);
    expect(types.filter((t) => t === "ZONE_CHANGED")).toHaveLength(14);
    for (const p of ["p1", "p2"] as const) {
      expect(hand(game.state, p)).toHaveLength(7);
      expect(library(game.state, p)).toHaveLength(33);
    }
  });

  it("actually reorders the library, deterministically for a seed", () => {
    const order = (seed: number) => {
      const game = start(standardSetup({ seed, opening: { kind: "standard", firstPlayer: "p1" } }));
      return [...hand(game.state, "p1"), ...library(game.state, "p1")].map((id) => cardIdOf(game.state, id));
    };
    const unshuffled = Array.from({ length: 40 }, (_, i) => `c${2 * i + 1}`);
    expect(order(1)).not.toStrictEqual(unshuffled);
    expect([...order(1)].sort()).toStrictEqual([...unshuffled].sort());
    expect(order(1)).toStrictEqual(order(1));
    expect(order(1)).not.toStrictEqual(order(2));
  });
});

describe("mulligans (CR 103.5)", () => {
  it("asks the starting player first, then the next player in turn order", () => {
    let game = p1First();
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "mulligan", mulligansTaken: 0 });
    game = answer(game, { kind: "mulligan", choice: "keep" });
    expect(game.state.pending).toMatchObject({ player: "p2", kind: "mulligan", mulligansTaken: 0 });
  });

  it("begins turn 1 for the starting player once everyone keeps", () => {
    let game = p1First();
    game = answer(game, { kind: "mulligan", choice: "keep" });
    game = answer(game, { kind: "mulligan", choice: "keep" });
    expect(game.state.pregame).toBeNull();
    expect(game.state.turn).toStrictEqual({ number: 1, activePlayer: "p1", step: "upkeep" });
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "priority" });
    expect(game.events.at(-1)).toStrictEqual({ type: "TURN_BEGAN", turn: 1, activePlayer: "p1" });
  });

  it("has a first mulligan draw a new seven and put one card on the bottom", () => {
    let game = p1First();
    const firstHand = hand(game.state, "p1").map((id) => cardIdOf(game.state, id));
    game = answer(game, { kind: "mulligan", choice: "mulligan" });
    game = answer(game, { kind: "mulligan", choice: "keep" }); // p2
    // Everyone has declared, so the mulligan happens: a new hand of seven, then one card to the bottom.
    expect(hand(game.state, "p1")).toHaveLength(7);
    expect(hand(game.state, "p1").map((id) => cardIdOf(game.state, id))).not.toStrictEqual(firstHand);
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "mulliganBottom", remaining: 1 });

    const chosen = hand(game.state, "p1")[3] as `o${number}`;
    const chosenCard = cardIdOf(game.state, chosen);
    game = answer(game, { kind: "mulliganBottom", object: chosen });
    expect(hand(game.state, "p1")).toHaveLength(6);
    expect(cardIdOf(game.state, library(game.state, "p1").at(-1) as string)).toBe(chosenCard);
    // A new round: p1 declares again; p2 has kept and isn't asked.
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "mulligan", mulligansTaken: 1 });
    game = answer(game, { kind: "mulligan", choice: "keep" });
    expect(game.state.turn?.number).toBe(1);
    expect(hand(game.state, "p1")).toHaveLength(6);
  });

  it("has a second mulligan put two cards on the bottom, each below the one before", () => {
    let game = p1First();
    game = answer(game, { kind: "mulligan", choice: "keep" });
    game = answer(game, { kind: "mulligan", choice: "mulligan" }); // p2
    game = answer(game, { kind: "mulliganBottom", object: hand(game.state, "p2")[0] as `o${number}` });
    game = answer(game, { kind: "mulligan", choice: "mulligan" }); // p2 again
    expect(game.state.pending).toMatchObject({ player: "p2", kind: "mulliganBottom", remaining: 2 });
    const [a, b] = hand(game.state, "p2") as [`o${number}`, `o${number}`];
    const [cardA, cardB] = [cardIdOf(game.state, a), cardIdOf(game.state, b)];
    game = answer(game, { kind: "mulliganBottom", object: a });
    expect(game.state.pending).toMatchObject({ player: "p2", kind: "mulliganBottom", remaining: 1 });
    game = answer(game, { kind: "mulliganBottom", object: b });
    const bottomTwo = library(game.state, "p2")
      .slice(-2)
      .map((id) => cardIdOf(game.state, id));
    expect(bottomTwo).toStrictEqual([cardA, cardB]);
    expect(hand(game.state, "p2")).toHaveLength(5);
  });

  it("takes simultaneous mulligans together, then puts cards on the bottom in turn order", () => {
    let game = p1First();
    game = answer(game, { kind: "mulligan", choice: "mulligan" });
    game = answer(game, { kind: "mulligan", choice: "mulligan" });
    expect(hand(game.state, "p1")).toHaveLength(7);
    expect(hand(game.state, "p2")).toHaveLength(7);
    expect(game.state.pending).toMatchObject({ player: "p1", kind: "mulliganBottom" });
    game = answer(game, { kind: "mulliganBottom", object: hand(game.state, "p1")[0] as `o${number}` });
    expect(game.state.pending).toMatchObject({ player: "p2", kind: "mulliganBottom" });
  });

  it("allows mulligans down to a zero-card hand, and none after that", () => {
    let game = p1First();
    game = answer(game, { kind: "mulligan", choice: "keep" }); // p1
    for (let taken = 0; taken < 7; taken++) {
      expect(game.state.pending).toMatchObject({ player: "p2", kind: "mulligan", mulligansTaken: taken });
      game = answer(game, { kind: "mulligan", choice: "mulligan" });
      for (let i = 0; i <= taken; i++) {
        game = answer(game, { kind: "mulliganBottom", object: hand(game.state, "p2")[0] as `o${number}` });
      }
    }
    expect(hand(game.state, "p2")).toHaveLength(0);
    expect(game.state.pending).toMatchObject({ player: "p2", kind: "mulligan", mulligansTaken: 7 });
    const pending = game.state.pending;
    if (pending === null) throw new Error("expected a decision");
    const mulliganAgain = applyAction(
      game.state,
      { type: "ANSWER", decisionId: pending.id, player: "p2", answer: { kind: "mulligan", choice: "mulligan" } },
      TEST_CARDS,
    );
    expect(mulliganAgain).toMatchObject({ ok: false, error: { code: "illegalAction" } });
    game = answer(game, { kind: "mulligan", choice: "keep" });
    expect(game.state.turn?.number).toBe(1);
  });
});

describe("answers that don't fit the decision", () => {
  it("rejects a stale decision id, the wrong player, and a card that isn't in hand, changing nothing", () => {
    const game = p1First();
    const pending = game.state.pending;
    if (pending === null) throw new Error("expected a decision");
    const keep = { kind: "mulligan", choice: "keep" } as const;
    expect(
      applyAction(game.state, { type: "ANSWER", decisionId: "d1", player: "p1", answer: keep }, TEST_CARDS),
    ).toMatchObject({
      ok: false,
      error: { code: "staleDecision" },
    });
    expect(
      applyAction(game.state, { type: "ANSWER", decisionId: pending.id, player: "p2", answer: keep }, TEST_CARDS),
    ).toMatchObject({ ok: false, error: { code: "notYourDecision" } });
    expect(
      applyAction(
        game.state,
        { type: "ANSWER", decisionId: pending.id, player: "p1", answer: { kind: "mulliganBottom", object: "o1" } },
        TEST_CARDS,
      ),
    ).toMatchObject({ ok: false, error: { code: "illegalAction" } });
  });
});

describe("determinism", () => {
  it("gives identical states and events for the same seed and answers", () => {
    const run = () => {
      let game = start(standardSetup({ seed: 7 }));
      game = answer(game, { kind: "chooseStartingPlayer", player: "p2" });
      game = answer(game, { kind: "mulligan", choice: "mulligan" });
      game = answer(game, { kind: "mulligan", choice: "keep" });
      game = answer(game, { kind: "mulliganBottom", object: hand(game.state, "p2")[2] as `o${number}` });
      return answer(game, { kind: "mulligan", choice: "keep" });
    };
    expect(run()).toStrictEqual(run());
  });
});

describe("fixed openings", () => {
  it("starts exactly as described, with the active player holding priority", () => {
    const game = start({
      seed: 1,
      players: [
        playerSetup("p1", {
          library: ["mountain", "forest"],
          hand: ["grizzly-bears"],
          battlefield: [{ oracleId: "forest", tapped: true, summoningSick: false, damage: 0, counters: {} }],
        }),
        playerSetup("p2", {
          life: 7,
          battlefield: [{ oracleId: "grizzly-bears", tapped: false, summoningSick: true, damage: 1, counters: {} }],
        }),
      ],
      opening: { kind: "fixed", turn: { number: 3, activePlayer: "p2", step: "precombatMain" } },
      ruleModifiers: [],
    });
    const s = game.state;
    expect(s.turn).toStrictEqual({ number: 3, activePlayer: "p2", step: "precombatMain" });
    expect(s.pending).toMatchObject({ player: "p2", kind: "priority" });
    expect(s.pregame).toBeNull();
    expect(
      library(s, "p1")
        .map((id) => s.objects[id])
        .map((o) => o?.kind === "card" && o.oracleId),
    ).toStrictEqual(["mountain", "forest"]);
    expect(s.players.p2?.life).toBe(7);
    const [forest, bears] = s.zones.battlefield.map((id) => s.objects[id]);
    expect(forest).toMatchObject({ tapped: true, controlledSinceTurnStart: true, baseController: "p1" });
    expect(bears).toMatchObject({ damage: 1, controlledSinceTurnStart: false, baseController: "p2" });
  });
});

describe("setup validation", () => {
  const problem = (setup: Parameters<typeof createGame>[0]) => {
    const result = createGame(setup, TEST_CARDS);
    return result.ok ? null : result.error;
  };

  it("rejects setups the engine can't start, with a readable reason", () => {
    expect(problem(standardSetup({ seed: -1 }))?.message).toMatch(/seed/);
    expect(problem(standardSetup({ players: [playerSetup("p1")] }))?.message).toMatch(/two-player/);
    const unknown = standardSetup();
    unknown.players[0] = playerSetup("p1", { library: Array.from({ length: 40 }, () => "black-lotus") });
    expect(problem(unknown)?.message).toMatch(/unknown card black-lotus/);
    const small = standardSetup();
    small.players[1] = playerSetup("p2", { library: ["mountain"] });
    expect(problem(small)?.message).toMatch(/at least 7 cards/);
    const withHand = standardSetup();
    withHand.players[0] = { ...(withHand.players[0] ?? playerSetup("p1")), hand: ["forest"] };
    expect(problem(withHand)?.message).toMatch(/hand must be empty/);
    const fixedUntap = standardSetup({
      opening: { kind: "fixed", turn: { number: 1, activePlayer: "p1", step: "untap" } },
    });
    expect(problem(fixedUntap)?.message).toMatch(/can't start in the untap step/);
    expect(problem(standardSetup({ opening: { kind: "standard", firstPlayer: "p9" } }))?.message).toMatch(
      /isn't a player/,
    );
    expect(problem(standardSetup())).toBeNull();
  });
});
