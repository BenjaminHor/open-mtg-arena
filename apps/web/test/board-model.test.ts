// The board model (ui.md, "Board structure"): where each card the person can see goes, tested without drawing.

import { cardDatabase } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { boardModel } from "../src/board-model/board-model.ts";
import { handle } from "../src/worker/match-session.ts";
import type { FromWorker, ToWorker } from "../src/worker/protocol.ts";

const cards = cardDatabase();

function firstView() {
  const start: ToWorker = { type: "start", decks: ["red-green-beats", "white-soldiers"], seed: 7, human: "p1" };
  const reply: FromWorker = handle(null, start, cards).reply;
  if (reply.type !== "update") throw new Error(reply.message);
  return reply.shown;
}

describe("the board model", () => {
  const size = { width: 900, height: 420 };

  it("lays out the person's hand along the bottom, every card inside the board", () => {
    const model = boardModel(firstView(), size);
    const hand = model.cards.filter((c) => c.zone === "hand");
    expect(hand).toHaveLength(7);
    for (const card of model.cards) {
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(size.width);
      expect(card.y + card.height).toBeLessThanOrEqual(size.height);
    }
    const lowest = Math.min(...hand.map((c) => c.y));
    expect(lowest).toBeGreaterThan(size.height / 2);
  });

  it("shows the opponent's hand only as a count", () => {
    const model = boardModel(firstView(), size);
    expect(model.opponentHandSize).toBe(7);
    expect(model.cards.every((c) => c.mine || c.zone === "battlefield")).toBe(true);
  });

  it("squeezes a full row together rather than run off the edge", () => {
    const narrow = boardModel(firstView(), { width: 320, height: 420 });
    const hand = narrow.cards.filter((c) => c.zone === "hand");
    expect(Math.max(...hand.map((c) => c.x + c.width))).toBeLessThanOrEqual(320);
  });
});
