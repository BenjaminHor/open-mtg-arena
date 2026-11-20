// Choices at resolution and hidden information (D-062), which the YAML scenarios can't check: two games that differ
// only in what one player can't see must look the same to that player, at every step; and the effect that waited runs
// before the rest of the resolution.

import { describe, expect, it } from "vitest";
import {
  type Action,
  applyAction,
  type CardDatabase,
  eventsFor,
  type GameState,
  legalActions,
  type PlayerId,
  playerView,
} from "../../src/index.ts";
import { BEARS, GROWTH, HAMMER, HASTY_ELF, MOUNTAIN, SHOCK, TEST_CARDS } from "../support/cards.ts";
import { type Game, playerSetup, start } from "../support/game.ts";

const permanent = (oracleId: string) => ({ oracleId, tapped: false, summoningSick: false, damage: 0, counters: {} });

function withDef(cards: CardDatabase, id: string, def: Partial<CardDatabase[string]["def"]>): CardDatabase {
  const entry = cards[id];
  if (entry === undefined) throw new Error(`no ${id}`);
  return { ...cards, [id]: { ...entry, def: { ...entry.def, ...def } } };
}

// Volcanic Hammer ({1}{R}) as Duress: "Target opponent reveals their hand. You choose a noncreature, nonland card from
// it. That player discards that card." And the hasty elf with Elvish Piper's ability, without its {G}.
const CARDS = withDef(
  withDef(TEST_CARDS, HAMMER, {
    spell: {
      targets: [{ kind: "opponent" }],
      effects: [
        { op: "revealHand", who: { target: 0 } },
        { op: "discard", who: { target: 0 }, amount: 1, chosenBy: "you", filter: { notTypes: ["creature", "land"] } },
      ],
    },
  }),
  HASTY_ELF,
  {
    abilities: [
      {
        kind: "activated",
        cost: [{ kind: "tap" }],
        targets: [],
        effects: [{ op: "putOntoBattlefield", from: "yourHand", filter: { types: ["creature"] }, optional: true }],
      },
    ],
  },
);

function game(p1: { hand: string[]; battlefield: string[] }, p2Hand: string[]): Game {
  return start({
    seed: 3,
    players: [
      playerSetup("p1", { library: [MOUNTAIN], hand: p1.hand, battlefield: p1.battlefield.map(permanent) }),
      playerSetup("p2", { library: [MOUNTAIN], hand: p2Hand }),
    ],
    opening: { kind: "fixed", turn: { number: 3, activePlayer: "p1", step: "precombatMain" } },
    ruleModifiers: [],
  });
}

/** Takes the first legal action `match` picks, for whoever must decide. */
function act(g: Game, match: (a: Action) => boolean): Game {
  const player = g.state.pending?.player ?? "p1";
  const action = legalActions(g.state, player, CARDS).find(match);
  if (action === undefined) throw new Error(`no such action for ${g.state.pending?.kind}`);
  const r = applyAction(g.state, action, CARDS);
  if (!r.ok) throw new Error(r.error.message);
  return { state: r.state, events: r.events };
}

/** What `viewer` is shown: the view and the events of the last action. */
const seen = (g: Game, viewer: PlayerId) => ({
  view: playerView(g.state, viewer),
  events: eventsFor(g.events, viewer),
});

/** Plays the same actions in two games, checking `viewer` sees the same after each. */
function sameToViewer(a: Game, b: Game, viewer: PlayerId, steps: ((x: Action) => boolean)[]): [Game, Game] {
  let [x, y] = [a, b];
  expect(seen(x, viewer)).toStrictEqual(seen(y, viewer));
  for (const step of steps) {
    [x, y] = [act(x, step), act(y, step)];
    expect(seen(x, viewer)).toStrictEqual(seen(y, viewer));
  }
  return [x, y];
}

const pass = (a: Action) => a.type === "PASS_PRIORITY";
const finish = (a: Action) => a.type === "ANSWER" && a.answer.kind === "finishChoosing";
const firstOption = (a: Action) => a.type === "ANSWER" && a.answer.kind === "chooseCard" && a.answer.option === 0;
const pending = (s: GameState) => s.pending?.kind;

describe("a choice over a hidden hand tells no one what the hand holds (D-062)", () => {
  it("Elvish Piper declined with a creature card in hand looks the same to the opponent as with none", () => {
    const elf = { hand: [BEARS], battlefield: [HASTY_ELF] };
    const noCreature = { hand: [SHOCK], battlefield: [HASTY_ELF] };
    const activate = (a: Action) => a.type === "ACTIVATE_ABILITY";
    const [x] = sameToViewer(game(elf, []), game(noCreature, []), "p2", [activate, pass, pass, finish]);
    expect(pending(x.state)).toBe("priority");
  });

  it("Duress shows a revealed hand the same way whatever order its cards arrived in", () => {
    const caster = { hand: [HAMMER], battlefield: [MOUNTAIN, MOUNTAIN] };
    const cast = (a: Action) => a.type === "CAST_SPELL";
    const target = (a: Action) => a.type === "ANSWER" && a.answer.kind === "chooseTarget";
    const payAll = (a: Action) => a.type === "ACTIVATE_ABILITY";
    const pay = (a: Action) => a.type === "ANSWER" && a.answer.kind === "payMana";
    const [x, y] = sameToViewer(game(caster, [SHOCK, GROWTH, BEARS]), game(caster, [BEARS, GROWTH, SHOCK]), "p1", [
      cast,
      target,
      payAll,
      payAll,
      pay,
      pass,
      pass,
    ]);
    expect(pending(x.state)).toBe("chooseCards");
    // Its options are shown without ids, as what they are: Shock and Giant Growth, in the same order in both games.
    const options = playerView(x.state, "p1").decision;
    expect(options?.kind === "chooseCards" && options.options.every((o) => o.object === null)).toBe(true);
    const [after] = sameToViewer(x, y, "p1", [firstOption]);
    expect(after.state.zones.players.p2?.graveyard).toHaveLength(1);
  });
});

describe("the effect that waited runs before the rest of the resolution (D-032)", () => {
  it("Duress's discard comes before the spell finishes resolving and goes to the graveyard", () => {
    let g = game({ hand: [HAMMER], battlefield: [MOUNTAIN, MOUNTAIN] }, [SHOCK, BEARS]);
    g = act(g, (a) => a.type === "CAST_SPELL");
    g = act(g, (a) => a.type === "ANSWER" && a.answer.kind === "chooseTarget");
    g = act(g, (a) => a.type === "ACTIVATE_ABILITY");
    g = act(g, (a) => a.type === "ACTIVATE_ABILITY");
    g = act(g, (a) => a.type === "ANSWER" && a.answer.kind === "payMana");
    g = act(act(g, pass), pass);
    expect(g.events.map((e) => e.type)).toContain("CARDS_REVEALED");
    g = act(g, firstOption);
    const types = g.events.map((e) => e.type);
    expect(types.indexOf("CARD_DISCARDED")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("CARD_DISCARDED")).toBeLessThan(types.indexOf("SPELL_RESOLVED"));
    expect(pending(g.state)).toBe("priority");
  });
});
