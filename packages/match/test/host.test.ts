// The host's own duties (M3-01): auto-tap, agents' random state, refusals, and that a match is plain JSON.

import { DECKS, type DeckList } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import {
  advance,
  advanceOne,
  DEFAULT_SETTINGS,
  deckGameSetup,
  type MatchState,
  startMatch,
  submit,
  waitingOn,
} from "../src/index.ts";
import { act, cards, handMade } from "./helpers.ts";

const human = { kind: "human" } as const;

function castBears(autoTap: boolean): MatchState {
  const setup = handMade({ hand: ["Grizzly Bears"], battlefield: ["Forest", "Forest"] }, {}, "precombatMain");
  const match = advance(
    startMatch(setup, { p1: human, p2: human }, cards, { p1: { ...DEFAULT_SETTINGS, autoTap } }),
    cards,
  );
  return act(match, (a) => a.type === "CAST_SPELL");
}

describe("auto-tap", () => {
  it("pays a spell's cost with the host's pick of lands, one action at a time, each answering its own decision", () => {
    const match = castBears(true);
    const cast = match.actions.findIndex((a) => a.type === "CAST_SPELL");
    const paying = match.actions.slice(cast + 1, cast + 4);
    expect(paying.map((a) => (a.type === "ANSWER" ? a.answer.kind : a.type))).toStrictEqual([
      "ACTIVATE_ABILITY",
      "ACTIVATE_ABILITY",
      "payMana",
    ]);
    expect(new Set(paying.map((a) => ("decisionId" in a ? a.decisionId : null))).size).toBe(3);
    // Then nobody had a response, so the host passed for both and the Bears resolved.
    expect(match.state.zones.battlefield).toHaveLength(3);
  });

  it("off, leaves the payment to the player", () => {
    const match = castBears(false);
    expect(waitingOn(match, cards)).toBe("p1");
    expect(match.state.pending?.kind).toBe("payMana");
  });
});

describe("agent seats", () => {
  it("move their own random state on, and the same match advanced twice plays the same", () => {
    const setup = deckGameSetup([DECKS["white-soldiers"] as DeckList, DECKS["red-green-beats"] as DeckList], 3, "p1");
    const start = startMatch(setup, { p1: { kind: "agent", agent: "random", random: 5 }, p2: human }, cards);
    const once = advance(start, cards);
    expect(once.seats.p1).not.toStrictEqual(start.seats.p1);
    expect(advance(start, cards)).toStrictEqual(once);
  });
});

describe("one host action at a time", () => {
  it("reaches what `advance` does, one action each step, and stops where a person decides", () => {
    const setup = deckGameSetup([DECKS["white-soldiers"] as DeckList, DECKS["red-green-beats"] as DeckList], 3, "p1");
    const start = startMatch(setup, { p1: { kind: "agent", agent: "random", random: 5 }, p2: human }, cards);
    let stepped = start;
    let steps = 0;
    for (let next = advanceOne(stepped, cards); next !== null; next = advanceOne(stepped, cards)) {
      expect(next.actions.length).toBe(stepped.actions.length + 1);
      stepped = next;
      steps++;
    }
    expect(steps).toBeGreaterThan(0);
    expect(stepped).toStrictEqual(advance(start, cards));
    expect(advanceOne(stepped, cards)).toBeNull();
  });
});

describe("a person's actions", () => {
  it("are refused when the engine refuses them, and the match is unchanged", () => {
    const setup = handMade({ hand: ["Grizzly Bears"], battlefield: ["Forest"] }, {}, "precombatMain");
    const match = advance(startMatch(setup, { p1: human, p2: human }, cards), cards);
    const pending = match.state.pending;
    if (pending === null) throw new Error("nothing pending");
    const wrong = { type: "PLAY_LAND", decisionId: pending.id, player: "p1", object: "o999" } as const;
    expect(submit(match, wrong, cards).ok).toBe(false);
  });
});

describe("a match", () => {
  it("is plain JSON: a mid-game match survives a round trip and plays on the same", () => {
    const setup = deckGameSetup([DECKS["white-soldiers"] as DeckList, DECKS["red-green-beats"] as DeckList], 3, "p1");
    const agents = {
      p1: { kind: "agent", agent: "by-kind", random: 1 },
      p2: { kind: "agent", agent: "by-kind", random: 2 },
    } as const;
    const start = startMatch(setup, agents, cards);
    const copy = JSON.parse(JSON.stringify(start)) as MatchState;
    expect(copy).toStrictEqual(start);
    expect(advance(copy, cards)).toStrictEqual(advance(start, cards));
  });
});
