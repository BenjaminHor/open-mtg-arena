// The heuristic AI in a seat of its own (M3-02): the host builds what the seat is shown (`seatView`) and applies its
// choice. Whole games must end without the host's loop reaching its cap (a stateless player that starts and cancels
// the same thing forever would), and their logs replay.

import { cardDatabase, DECKS, type DeckList } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { advance, deckGameSetup, replayLog, type Seat, startMatch, waitingOn } from "../src/index.ts";

const cards = cardDatabase();
const deck = (name: string) => DECKS[name] as DeckList;
const HEURISTIC: Seat = { kind: "heuristic" };

describe("a heuristic seat plays whole matches through the host", () => {
  const names = Object.keys(DECKS);
  for (const [i, a] of names.entries()) {
    const b = names[(i + 1) % names.length] as string;
    it(`${a} (heuristic) vs ${b} (heuristic): the game ends, and its log replays`, () => {
      const setup = deckGameSetup([deck(a), deck(b)], 10 + i, null);
      const match = advance(startMatch(setup, { p1: HEURISTIC, p2: HEURISTIC }, cards), cards);
      expect(match.state.result).not.toBeNull();
      expect(waitingOn(match, cards)).toBeNull();
      expect(replayLog(match.setup, match.actions, cards)).toStrictEqual(match.state);
    });
  }

  it("against an agent that picks any legal action, too", () => {
    const setup = deckGameSetup([deck("blue-black-control"), deck("red-green-beats")], 3, "p2");
    const seats = { p1: HEURISTIC, p2: { kind: "agent", agent: "by-kind", random: 3 } } as const;
    const match = advance(startMatch(setup, seats, cards), cards);
    expect(match.state.result).not.toBeNull();
  });
});
