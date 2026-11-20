// Searching libraries (M2-05b2b) and hidden information (D-062): two games that differ only in what one player can't
// see must look the same to that player at every step. Written before the effects, from the rules-judge's list.

import { describe, expect, it } from "vitest";
import {
  type Action,
  applyAction,
  type CardDatabase,
  type Effect,
  eventsFor,
  legalActions,
  type PlayerId,
  playerView,
  type TargetSpec,
} from "../../src/index.ts";
import { BEARS, FOREST, HAMMER, MOUNTAIN, STATUE, TEST_CARDS } from "../support/cards.ts";
import { type Game, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

/** Volcanic Hammer ({1}{R}) with these targets and effects instead of its own. */
function hammerAs(targets: TargetSpec[], effects: Effect[]): CardDatabase {
  const entry = TEST_CARDS[HAMMER];
  if (entry === undefined) throw new Error("no Hammer");
  return { ...TEST_CARDS, [HAMMER]: { ...entry, def: { ...entry.def, spell: { targets, effects } } } };
}

/** "Search your library for an artifact card, reveal it, put it into your hand, then shuffle." */
const FABRICATE = hammerAs(
  [],
  [
    { op: "search", library: "you", filter: { types: ["artifact"] }, count: "one" },
    { op: "reveal", of: "found" },
    { op: "put", of: "found", into: "hand" },
    { op: "shuffle", who: "you" },
  ],
);
/** "Search your library for a card, put that card into your hand, then shuffle." */
const TUTOR = hammerAs(
  [],
  [
    { op: "search", library: "you", count: "one" },
    { op: "put", of: "found", into: "hand" },
    { op: "shuffle", who: "you" },
  ],
);
/** Haunting Echoes: exile all but basic lands from the target's graveyard, then all same-named cards from the library. */
const ECHOES = hammerAs(
  [{ kind: "player" }],
  [
    { op: "exileGraveyard", of: { target: 0 }, filter: { not: { supertypes: ["basic"], types: ["land"] } } },
    { op: "search", library: { target: 0 }, count: "anyNumber", sameNameAsExiled: true },
    { op: "exile", of: "found" },
    { op: "shuffle", who: { target: 0 } },
  ],
);

function game(
  p1Library: string[],
  p2: { library: string[]; graveyard: string[] } = { library: [FOREST], graveyard: [] },
) {
  return start({
    seed: 5,
    players: [
      playerSetup("p1", { library: p1Library, hand: [HAMMER], battlefield: [MOUNTAIN, MOUNTAIN].map(permanent) }),
      playerSetup("p2", { library: p2.library, graveyard: p2.graveyard }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

function act(g: Game, cards: CardDatabase, match: (a: Action) => boolean): Game {
  const player = g.state.pending?.player ?? "p1";
  const action = legalActions(g.state, player, cards).find(match);
  if (action === undefined) throw new Error(`no such action for ${g.state.pending?.kind}`);
  const r = applyAction(g.state, action, cards);
  if (!r.ok) throw new Error(r.error.message);
  return { state: r.state, events: r.events };
}

const seen = (g: Game, viewer: PlayerId) => ({
  view: playerView(g.state, viewer),
  events: eventsFor(g.events, viewer),
});

function sameToViewer(cards: CardDatabase, a: Game, b: Game, viewer: PlayerId, steps: ((x: Action) => boolean)[]) {
  let [x, y] = [a, b];
  expect(seen(x, viewer)).toStrictEqual(seen(y, viewer));
  for (const [i, step] of steps.entries()) {
    [x, y] = [act(x, cards, step), act(y, cards, step)];
    expect(seen(x, viewer), `after step ${i + 1}`).toStrictEqual(seen(y, viewer));
  }
  return [x, y] as const;
}

const cast = (a: Action) => a.type === "CAST_SPELL";
const target = (player: PlayerId) => (a: Action) =>
  a.type === "ANSWER" &&
  a.answer.kind === "chooseTarget" &&
  a.answer.target.kind === "player" &&
  a.answer.target.player === player;
const tapLand = (a: Action) => a.type === "ACTIVATE_ABILITY";
const pay = (a: Action) => a.type === "ANSWER" && a.answer.kind === "payMana";
const pass = (a: Action) => a.type === "PASS_PRIORITY";
const finish = (a: Action) => a.type === "ANSWER" && a.answer.kind === "finishChoosing";
const option = (n: number) => (a: Action) =>
  a.type === "ANSWER" && a.answer.kind === "chooseCard" && a.answer.option === n;
const toResolve = [tapLand, tapLand, pay, pass, pass];

describe("a search tells the other players nothing about the library (CR 401.2, D-062)", () => {
  it("Fabricate finding nothing looks the same to the opponent whether the library has an artifact or not", () => {
    const [x] = sameToViewer(FABRICATE, game([FOREST, STATUE, FOREST]), game([FOREST, FOREST, FOREST]), "p2", [
      cast,
      ...toResolve,
      finish,
    ]);
    expect(x.events.map((e) => e.type)).toContain("LIBRARY_SHUFFLED");
  });

  it("Fabricate shows its chooser the whole library by identity, without ids (CR 701.23a)", () => {
    let g = game([FOREST, STATUE, FOREST]);
    for (const step of [cast, ...toResolve]) g = act(g, FABRICATE, step);
    const decision = playerView(g.state, "p1").decision;
    if (decision?.kind !== "chooseCards") throw new Error("no search");
    expect(decision.seen).toStrictEqual({
      from: { zone: "library", player: "p1" },
      cards: [FOREST, FOREST, STATUE].sort(),
    });
    expect(decision.options).toStrictEqual([{ oracleId: STATUE, object: null }]);
    expect(decision.min).toBe(0);
  });

  it("Diabolic Tutor finding one card or another looks the same to the opponent, and must find one (CR 701.23d)", () => {
    const steps = [cast, ...toResolve];
    let g = game([FOREST, MOUNTAIN]);
    for (const step of steps) g = act(g, TUTOR, step);
    expect(g.state.pending?.kind === "chooseCards" && g.state.pending.min).toBe(1);
    const [a, b] = [act(g, TUTOR, option(0)), act(g, TUTOR, option(1))];
    expect(seen(a, "p2")).toStrictEqual(seen(b, "p2"));
  });

  it("Haunting Echoes leaving copies looks the same to its target as there being none (its ruling, CR 701.23b)", () => {
    const withCopy = { library: [BEARS, FOREST], graveyard: [BEARS] };
    const without = { library: [FOREST, FOREST], graveyard: [BEARS] };
    const [x] = sameToViewer(ECHOES, game([FOREST], withCopy), game([FOREST], without), "p2", [
      cast,
      target("p2"),
      ...toResolve,
      finish,
    ]);
    expect(x.state.zones.exile).toHaveLength(1);
  });

  it("an 'any number' search doesn't end at its maximum, which would tell how many copies there are", () => {
    let g = game([FOREST], { library: [BEARS, FOREST], graveyard: [BEARS] });
    for (const step of [cast, target("p2"), ...toResolve]) g = act(g, ECHOES, step);
    g = act(g, ECHOES, option(0));
    expect(g.state.pending?.kind).toBe("chooseCards");
    g = act(g, ECHOES, finish);
    expect(g.state.zones.exile).toHaveLength(2);
  });

  it("a search for a basic land card doesn't offer a nonbasic land (CR 205.4a)", () => {
    const mountain = TEST_CARDS[MOUNTAIN];
    if (mountain === undefined) throw new Error("no Mountain");
    const rampant = hammerAs(
      [],
      [{ op: "search", library: "you", filter: { supertypes: ["basic"], types: ["land"] }, count: "one" }],
    );
    // Mountain without the basic supertype, as a nonbasic land like Terramorphic Expanse is. (Its mana ability comes
    // from its land type, D-028, so the Mountains paying for the spell still work.)
    const cards = { ...rampant, [MOUNTAIN]: { ...mountain, printed: { ...mountain.printed, supertypes: [] } } };
    let g = game([MOUNTAIN, FOREST]);
    for (const step of [cast, ...toResolve]) g = act(g, cards, step);
    const decision = playerView(g.state, "p1").decision;
    if (decision?.kind !== "chooseCards") throw new Error("no search");
    expect(decision.options.map((o) => o.oracleId)).toStrictEqual([FOREST]);
  });
});

/** "Look at the top three cards of your library, then put them back in any order. You may shuffle. Draw a card." */
const PONDER = hammerAs(
  [],
  [
    { op: "lookAtTop", count: 3 },
    { op: "mayShuffle", who: "you" },
    { op: "draw", who: "you", amount: 1 },
  ],
);
const anyCard = (a: Action) => a.type === "ANSWER" && a.answer.kind === "chooseCard";
const yes = (a: Action) => a.type === "ANSWER" && a.answer.kind === "chooseYesNo" && a.answer.yes;
const no = (a: Action) => a.type === "ANSWER" && a.answer.kind === "chooseYesNo" && !a.answer.yes;

describe("the order things happen in, which `events contains` can't check", () => {
  it("Fabricate reveals the card it found, by identity, before putting it into the hand", () => {
    let g = game([FOREST, STATUE, FOREST]);
    for (const step of [cast, ...toResolve, option(0)]) g = act(g, FABRICATE, step);
    const types = g.events.map((e) => e.type);
    const revealed = g.events.find((e) => e.type === "CARDS_REVEALED");
    expect(revealed).toMatchObject({ from: { zone: "library", player: "p1" }, cards: [STATUE] });
    const intoHand = g.events.findIndex((e) => e.type === "ZONE_CHANGED" && e.to.zone === "hand");
    expect(types.indexOf("CARDS_REVEALED")).toBeLessThan(intoHand);
    expect(intoHand).toBeLessThan(types.indexOf("LIBRARY_SHUFFLED"));
  });

  it("Ponder shuffles before drawing, so the draw comes from the shuffled library (its ruling)", () => {
    let g = game([FOREST, STATUE, MOUNTAIN, FOREST]);
    for (const step of [cast, ...toResolve, anyCard, anyCard, anyCard, yes]) g = act(g, PONDER, step);
    const types = g.events.map((e) => e.type);
    expect(types.indexOf("LIBRARY_SHUFFLED")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("LIBRARY_SHUFFLED")).toBeLessThan(types.indexOf("CARD_DRAWN"));
  });
});

describe("Ponder's order is its caster's secret (CR 401.4, D-062)", () => {
  it("putting the cards back in two different orders looks the same to the opponent", () => {
    const resolve = [cast, ...toResolve];
    let [x, y] = [game([FOREST, STATUE, MOUNTAIN]), game([FOREST, STATUE, MOUNTAIN])];
    for (const step of resolve) [x, y] = [act(x, PONDER, step), act(y, PONDER, step)];
    // One puts them back in the order shown, the other in reverse; then neither shuffles.
    for (const [first, second] of [
      [option(0), option(2)],
      [option(1), option(1)],
      [option(2), option(0)],
      [no, no],
    ] as const) {
      [x, y] = [act(x, PONDER, first), act(y, PONDER, second)];
      expect(seen(x, "p2")).toStrictEqual(seen(y, "p2"));
    }
    expect(x.state.zones.players.p1?.library).not.toStrictEqual(y.state.zones.players.p1?.library);
  });
});
