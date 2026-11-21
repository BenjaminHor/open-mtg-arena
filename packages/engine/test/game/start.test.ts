// Game start (CR 103). These are TypeScript for now; they become YAML scenarios when the M1-16 runner exists.

import { describe, expect, it } from "vitest";
import { applyAction, createGame, type GameState, type PlayerId } from "../../src/index.ts";
import { TEST_CARDS } from "../support/cards.ts";
import { act, answer, type Game, pendingPlayer, playerSetup, standardSetup, start } from "../support/game.ts";

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
    const setupOrder = (seed: number) => {
      const fixed = { kind: "fixed", turn: { number: 1, activePlayer: "p1", step: "upkeep" } } as const;
      const game = start(standardSetup({ seed, opening: fixed }));
      return library(game.state, "p1").map((id) => cardIdOf(game.state, id));
    };
    const unshuffled = setupOrder(1);
    expect(order(1)).not.toStrictEqual(unshuffled);
    expect([...order(1)].sort()).toStrictEqual([...unshuffled].sort());
    expect(order(1)).toStrictEqual(order(1));
    expect(order(1)).not.toStrictEqual(order(2));
  });
});

describe("card ids (D-045)", () => {
  // Numbered in decklist order, a public card's id would hint at the cards next to it in the decklist, which are in a
  // hidden library or hand (CR 400.2).
  const idsInSetupOrder = (seed: number) => {
    const fixed = { kind: "fixed", turn: { number: 1, activePlayer: "p1", step: "upkeep" } } as const;
    const game = start(standardSetup({ seed, opening: fixed }));
    return [...library(game.state, "p1"), ...library(game.state, "p2")].map((id) => cardIdOf(game.state, id));
  };

  it("numbers every card c1 to cN, once each", () => {
    const ids = idsInSetupOrder(1);
    const expected = Array.from({ length: ids.length }, (_, i) => `c${i + 1}`);
    expect([...ids].sort()).toStrictEqual([...expected].sort());
  });

  it("numbers them in a random order, not the setup's, decided by the seed", () => {
    const ids = idsInSetupOrder(1);
    const ascending = ids.filter((id, i) => i > 0 && Number(id.slice(1)) > Number((ids[i - 1] as string).slice(1)));
    // In setup order every id but the first would be one more than the one before; shuffled, about half are larger.
    expect(ascending.length).toBeLessThan(ids.length * 0.75);
    expect(idsInSetupOrder(1)).toStrictEqual(ids);
    expect(idsInSetupOrder(2)).not.toStrictEqual(ids);
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
    // The turn begins with its untap step, where no one gets priority, then the upkeep (M1-06).
    expect(game.events.slice(-3)).toStrictEqual([
      { type: "TURN_BEGAN", turn: 1, activePlayer: "p1", extra: false },
      { type: "STEP_BEGAN", turn: 1, step: "untap", activePlayer: "p1" },
      { type: "STEP_BEGAN", turn: 1, step: "upkeep", activePlayer: "p1" },
    ]);
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
  it("rejects a decision id that isn't pending, the wrong player, and an answer of the wrong kind", () => {
    const game = p1First();
    const pending = game.state.pending;
    if (pending === null) throw new Error("expected a decision");
    const keep = { kind: "mulligan", choice: "keep" } as const;
    expect(
      applyAction(game.state, { type: "ANSWER", decisionId: "d9999", player: "p1", answer: keep }, TEST_CARDS),
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

// Cases from the M1-05 reviews: each proves a rule the tests above don't pin down on their own.
describe("game start, in more detail", () => {
  const decision = (game: Game) => {
    if (game.state.pending === null) throw new Error("expected a decision");
    return game.state.pending;
  };
  const answerAs = (game: Game, answerValue: Parameters<typeof answer>[1]) =>
    applyAction(
      game.state,
      { type: "ANSWER", decisionId: decision(game).id, player: decision(game).player, answer: answerValue },
      TEST_CARDS,
    );
  const cardsOf = (s: GameState, ids: readonly string[]) => ids.map((id) => cardIdOf(s, id)).sort();

  it("lets either player be picked to choose, depending on the seed, and the chooser may choose themselves (CR 103.1)", () => {
    const choosers = new Set(
      Array.from({ length: 20 }, (_, seed) => pendingPlayer(start(standardSetup({ seed })).state)),
    );
    expect([...choosers].sort()).toStrictEqual(["p1", "p2"]);
    let game = start(standardSetup());
    const chooser = pendingPlayer(game.state);
    game = answer(game, { kind: "chooseStartingPlayer", player: chooser });
    expect(game.state.turnOrder[0]).toBe(chooser);
    expect(answerAs(start(standardSetup()), { kind: "chooseStartingPlayer", player: "p9" })).toMatchObject({
      ok: false,
      error: { code: "illegalAction" },
    });
  });

  it("goes in turn order, not seating order, when the second seat starts (CR 103.5, 101.4e)", () => {
    let game = start(standardSetup({ opening: { kind: "standard", firstPlayer: "p2" } }));
    expect(decision(game)).toMatchObject({ player: "p2", kind: "mulligan" });
    game = answer(game, { kind: "mulligan", choice: "mulligan" });
    expect(decision(game)).toMatchObject({ player: "p1", kind: "mulligan" });
    game = answer(game, { kind: "mulligan", choice: "mulligan" });
    expect(decision(game)).toMatchObject({ player: "p2", kind: "mulliganBottom" });
    game = answer(game, { kind: "mulliganBottom", object: hand(game.state, "p2")[0] as `o${number}` });
    expect(decision(game)).toMatchObject({ player: "p1", kind: "mulliganBottom" });
    game = answer(game, { kind: "mulliganBottom", object: hand(game.state, "p1")[0] as `o${number}` });
    expect(decision(game)).toMatchObject({ player: "p2", kind: "mulligan", mulligansTaken: 1 });
  });

  it("shuffles the hand into the library for a mulligan, for both players before anyone bottoms a card", () => {
    let game = p1First();
    const before = game.events.length;
    const p2Hand = hand(game.state, "p2");
    game = answer(game, { kind: "mulligan", choice: "mulligan" });
    game = answer(game, { kind: "mulligan", choice: "mulligan" });
    const round = game.events.slice(before);
    const shuffled = round.flatMap((e) => (e.type === "LIBRARY_SHUFFLED" ? [e.player] : []));
    expect(shuffled).toStrictEqual(["p1", "p2"]);
    // Both new hands are new objects (CR 400.7), drawn after both shuffles; nothing has gone to the bottom yet.
    expect(hand(game.state, "p2").some((id) => p2Hand.includes(id))).toBe(false);
    expect(decision(game)).toMatchObject({ player: "p1", kind: "mulliganBottom", remaining: 1 });
    expect(cardsOf(game.state, [...hand(game.state, "p1"), ...library(game.state, "p1")])).toHaveLength(40);
  });

  it("has both players mulligan twice: round two asks in turn order and each puts two cards on the bottom", () => {
    let game = p1First();
    for (const _ of [1, 2]) {
      game = answer(game, { kind: "mulligan", choice: "mulligan" });
      game = answer(game, { kind: "mulligan", choice: "mulligan" });
      for (const p of ["p1", "p2"] as const) {
        const count =
          decision(game).kind === "mulliganBottom" && decision(game).player === p
            ? (decision(game) as { remaining: number }).remaining
            : 0;
        for (let i = 0; i < count; i++)
          game = answer(game, { kind: "mulliganBottom", object: hand(game.state, p)[0] as `o${number}` });
      }
    }
    expect(hand(game.state, "p1")).toHaveLength(5);
    expect(hand(game.state, "p2")).toHaveLength(5);
    expect(decision(game)).toMatchObject({ player: "p1", kind: "mulligan", mulligansTaken: 2 });
  });

  it("only lets a card from the player's own hand go to the bottom", () => {
    let game = p1First();
    game = answer(game, { kind: "mulligan", choice: "mulligan" });
    game = answer(game, { kind: "mulligan", choice: "keep" });
    expect(decision(game).kind).toBe("mulliganBottom");
    for (const object of [hand(game.state, "p2")[0], library(game.state, "p1")[0], "o9999"] as `o${number}`[]) {
      expect(answerAs(game, { kind: "mulliganBottom", object })).toMatchObject({
        ok: false,
        error: { code: "illegalAction" },
      });
    }
  });

  it("rejects an answer to a decision that's already been answered", () => {
    const game = p1First();
    const keep = {
      type: "ANSWER",
      decisionId: decision(game).id,
      player: "p1",
      answer: { kind: "mulligan", choice: "keep" },
    } as const;
    const after = act(game, keep);
    expect(applyAction(after.state, keep, TEST_CARDS)).toMatchObject({ ok: false, error: { code: "staleDecision" } });
  });

  it("untaps only the starting player's permanents for turn 1, and none counts as controlled since a turn began until then (CR 302.6, 502.3)", () => {
    const tappedBears = { oracleId: "grizzly-bears", tapped: true, summoningSick: false, damage: 0, counters: {} };
    const setup = standardSetup({ opening: { kind: "standard", firstPlayer: "p1" } });
    setup.players = setup.players.map((p) => ({ ...p, battlefield: [tappedBears] }));
    let game = start(setup);
    const [mine, theirs] = game.state.zones.battlefield.map((id) => game.state.objects[id]);
    expect(mine).toMatchObject({ controlledSinceTurnStart: false });
    expect(theirs).toMatchObject({ controlledSinceTurnStart: false });
    game = answer(game, { kind: "mulligan", choice: "keep" });
    game = answer(game, { kind: "mulligan", choice: "keep" });
    const [p1Bears, p2Bears] = game.state.zones.battlefield.map((id) => game.state.objects[id]);
    expect(p1Bears).toMatchObject({ baseController: "p1", tapped: false, controlledSinceTurnStart: true });
    expect(p2Bears).toMatchObject({ baseController: "p2", tapped: true, controlledSinceTurnStart: false });
  });

  it("starts a fixed opening's turn order with the active player on turn 1, and keeps seating order later", () => {
    const fixed = (number: number) =>
      start(standardSetup({ opening: { kind: "fixed", turn: { number, activePlayer: "p2", step: "precombatMain" } } }))
        .state.turnOrder;
    expect(fixed(1)).toStrictEqual(["p2", "p1"]);
    expect(fixed(3)).toStrictEqual(["p1", "p2"]);
  });

  it("rejects the other setups the engine can't start", () => {
    const problem = (setup: Parameters<typeof createGame>[0]) => {
      const result = createGame(setup, TEST_CARDS);
      return result.ok ? "" : result.error.message;
    };
    const base = standardSetup();
    const [p1, p2] = base.players as [ReturnType<typeof playerSetup>, ReturnType<typeof playerSetup>];
    expect(problem({ ...base, players: [p1, { ...p2, id: "p1" }] })).toMatch(/must be different/);
    expect(problem({ ...base, players: [p1, { ...p2, id: "player2" as `p${number}` }] })).toMatch(/isn't a player id/);
    expect(problem({ ...base, players: [p1, { ...p2, manaPool: { ...p2.manaPool, R: 1 } }] })).toMatch(/no mana/);
    const fixed = (step: "declareAttackers" | "cleanup", number = 1, activePlayer: `p${number}` = "p1") =>
      problem({ ...base, opening: { kind: "fixed", turn: { number, activePlayer, step } } });
    expect(fixed("declareAttackers")).toMatch(/can't start in the declareAttackers step/);
    expect(fixed("cleanup")).toMatch(/can't start in the cleanup step/);
    expect(
      problem({ ...base, opening: { kind: "fixed", turn: { number: 0, activePlayer: "p1", step: "upkeep" } } }),
    ).toMatch(/turn number/);
    expect(
      problem({ ...base, opening: { kind: "fixed", turn: { number: 1, activePlayer: "p7", step: "upkeep" } } }),
    ).toMatch(/active player p7/);
  });
});
