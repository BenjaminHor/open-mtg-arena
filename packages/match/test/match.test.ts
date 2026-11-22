// The match host (M3-01): agent seats play whole games through it, and the log it keeps replays to the same game.

import { cardDatabase, DECKS, type DeckList } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import {
  advance,
  deckGameSetup,
  replayLog,
  type Seat,
  startMatch,
  submit,
  takeEvents,
  waitingOn,
} from "../src/index.ts";

const cards = cardDatabase();
const deck = (name: string) => DECKS[name] as DeckList;
const agent = (random: number): Seat => ({ kind: "agent", agent: "by-kind", random });

describe("agent seats play a whole match through the host (M3-01 acceptance)", () => {
  for (const [a, b, seed] of [
    ["white-soldiers", "red-green-beats", 1],
    ["blue-black-control", "white-soldiers", 2],
    ["red-green-beats", "blue-black-control", 3],
  ] as const) {
    it(`${a} vs ${b}: the game ends, and its log replays to the same state`, () => {
      const setup = deckGameSetup([deck(a), deck(b)], seed, null);
      const match = advance(startMatch(setup, { p1: agent(seed), p2: agent(seed + 100) }, cards), cards);
      expect(match.state.result).not.toBeNull();
      expect(waitingOn(match, cards)).toBeNull();
      expect(replayLog(match.setup, match.actions, cards)).toStrictEqual(match.state);
    });
  }
});

describe("a person's seat", () => {
  it("is asked for real decisions only, and the host does the rest", () => {
    const setup = deckGameSetup([deck("white-soldiers"), deck("red-green-beats")], 4, "p1");
    let match = advance(startMatch(setup, { p1: { kind: "human" }, p2: agent(7) }, cards), cards);
    // The first real decision is p1's mulligan.
    expect(waitingOn(match, cards)).toBe("p1");
    expect(match.state.pending?.kind).toBe("mulligan");
    const pending = match.state.pending;
    if (pending === null) throw new Error("nothing pending");
    const keep = submit(
      match,
      { type: "ANSWER", decisionId: pending.id, player: "p1", answer: { kind: "mulligan", choice: "keep" } },
      cards,
    );
    if (!keep.ok) throw new Error(keep.error.message);
    match = advance(keep.match, cards);
    // Then p1 is asked again only where they have something to do: a main phase with a land to play, say.
    expect(waitingOn(match, cards)).toBe("p1");
    expect(match.state.pending?.kind).toBe("priority");
    expect(match.state.turn?.activePlayer).toBe("p1");
    expect(match.state.turn?.step).toBe("precombatMain");
  });

  it("can't act for an agent's seat", () => {
    const setup = deckGameSetup([deck("white-soldiers"), deck("red-green-beats")], 4, "p1");
    const match = startMatch(setup, { p1: { kind: "human" }, p2: agent(7) }, cards);
    const result = submit(match, { type: "CONCEDE", player: "p2" }, cards);
    expect(result.ok).toBe(false);
  });

  it("is sent the events it saw, each once, never another player's hidden draws", () => {
    const setup = deckGameSetup([deck("white-soldiers"), deck("red-green-beats")], 4, "p1");
    const match = startMatch(setup, { p1: { kind: "human" }, p2: agent(7) }, cards);
    const first = takeEvents(match, "p1");
    expect(first.events.some((e) => e.type === "HIDDEN_CARD_DRAWN" && e.player === "p2")).toBe(true);
    expect(first.events.some((e) => e.type === "CARD_DRAWN" && e.player === "p2")).toBe(false);
    expect(takeEvents(first.match, "p1").events).toStrictEqual([]);
  });
});
