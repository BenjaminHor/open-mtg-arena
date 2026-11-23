// The match worker's logic (M3-03), in Node: messages in, replies out, the person's seat shown and nothing hidden.

import { cardDatabase } from "@mtg/cards";
import { describe, expect, it } from "vitest";
import { handle, type Session } from "../src/worker/match-session.ts";
import type { FromWorker, ToWorker } from "../src/worker/protocol.ts";

const cards = cardDatabase();
const start: ToWorker = { type: "start", decks: ["red-green-beats", "white-soldiers"], seed: 7, human: "p1" };

function update(reply: FromWorker): Extract<FromWorker, { type: "update" }> {
  if (reply.type !== "update") throw new Error(reply.message);
  return reply;
}

describe("the match worker's session", () => {
  it("starts a match and stops at the person's first decision, their mulligan", () => {
    const { session, reply } = handle(null, start, cards);
    const shown = update(reply).shown;
    expect(session?.human).toBe("p1");
    expect(update(reply).waitingOn).toBe("p1");
    expect(shown.view.decision?.kind).toBe("mulligan");
    expect(shown.options.length).toBe(2);
  });

  it("applies the person's action and plays the AI's seat until the person decides again", () => {
    const first = handle(null, start, cards);
    const keep = update(first.reply).shown.options.find(
      (o) => o.action.type === "ANSWER" && o.action.answer.kind === "mulligan" && o.action.answer.choice === "keep",
    );
    if (keep === undefined) throw new Error("no keep option");
    const next = handle(first.session, { type: "act", action: keep.action }, cards);
    expect(update(next.reply).waitingOn).toBe("p1");
    expect(next.session?.match.actions.length).toBeGreaterThan(first.session?.match.actions.length ?? 0);
  });

  it("shows none of the opponent's hidden cards: their hand is only a count (CR 402.3)", () => {
    const { session, reply } = handle(null, start, cards);
    const shown = update(reply).shown;
    const theirHand = (session as Session).match.state.zones.players.p2?.hand ?? [];
    expect(theirHand.length).toBeGreaterThan(0);
    const text = JSON.stringify(reply);
    for (const id of theirHand) expect(text).not.toContain(`"${id}"`);
    expect(shown.view.zones.players.p2?.hand).toBeNull();
  });

  it("refuses an action that isn't legal, and leaves the match as it was", () => {
    const first = handle(null, start, cards);
    const stale = { type: "PASS_PRIORITY", decisionId: "d0", player: "p1" } as const;
    const next = handle(first.session, { type: "act", action: stale }, cards);
    expect(next.reply.type).toBe("error");
    expect(next.session).toBe(first.session);
  });

  it("refuses an action before a match, and an unknown deck", () => {
    expect(handle(null, { type: "act", action: { type: "CONCEDE", player: "p1" } as never }, cards).reply.type).toBe(
      "error",
    );
    const unknown: ToWorker = { type: "start", decks: ["no-such-deck", "white-soldiers"], seed: 7, human: "p1" };
    expect(handle(null, unknown, cards).reply).toMatchObject({ type: "error" });
  });
});
