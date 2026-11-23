// What the host did, shown at a pace (D-172): how long each frame holds, and the line saying what it shows, on the
// frames of a real seeded game (the worker's, as the app gets them).

import { cardDatabase } from "@mtg/cards";
import type { ViewEvent } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { eventLine } from "../src/interaction/event-line.ts";
import { eventHold, frameHold, HOLD } from "../src/interaction/pacing.ts";
import { handle } from "../src/worker/match-session.ts";
import type { Frame, FromWorker } from "../src/worker/protocol.ts";

const cards = cardDatabase();

/** The seeded game, the person passing whenever they can: every frame the worker sent, with the view before it. */
function framesOfAGame(): { frame: Frame; before: Frame["shown"] | null }[] {
  const all: { frame: Frame; before: Frame["shown"] | null }[] = [];
  let s = handle(null, { type: "start", decks: ["red-green-beats", "white-soldiers"], seed: 7, human: "p1" }, cards);
  let last: Frame["shown"] | null = null;
  for (let i = 0; i < 80; i++) {
    const reply = s.reply as Extract<FromWorker, { type: "update" }>;
    for (const frame of reply.frames) {
      all.push({ frame, before: last });
      last = frame.shown;
    }
    last = reply.shown;
    const option = reply.shown.options.find((o) => o.action.type === "PASS_PRIORITY") ?? reply.shown.options[0];
    if (option === undefined || reply.shown.view.result !== null) break;
    s = handle(s.session, { type: "act", action: option.action }, cards);
  }
  return all;
}

describe("how long a frame holds", () => {
  it("holds the opponent's spell long enough to read, and not the person's own, which they just made", () => {
    const cast = (player: "p1" | "p2"): ViewEvent => ({ type: "SPELL_CAST", player, object: "o1", cardId: "c1" });
    expect(eventHold(cast("p2"), "p1")).toBe(HOLD.opponentStack);
    expect(eventHold(cast("p1"), "p1")).toBe(0);
    // Arena's floor for an opponent's stack item [R: 0.4 s].
    expect(HOLD.opponentStack).toBeGreaterThanOrEqual(400);
  });

  it("gives an empty step no pause of its own, so a quiet turn doesn't drag", () => {
    const step: ViewEvent = { type: "STEP_BEGAN", turn: 3, step: "upkeep", activePlayer: "p2" };
    expect(frameHold([step, { type: "PRIORITY_PASSED", player: "p2" }], "p1")).toBe(0);
  });
});

describe("the line a frame shows", () => {
  const frames = framesOfAGame();

  it("says what the opponent did, by name", () => {
    const lines = frames.map(({ frame, before }) => eventLine(frame.events, before, frame.shown));
    const opponents = lines.filter((l): l is string => l?.startsWith("Your opponent") ?? false);
    expect(opponents.length).toBeGreaterThan(0);
    // Named, never an id or "a card" for something the person saw.
    for (const line of opponents) expect(line).not.toMatch(/\bo\d+\b/);
    expect(opponents.some((l) => /^Your opponent (played|cast|attacked with) [A-Z]/.test(l))).toBe(true);
  });

  it("has a line for every frame but a new turn's, which has its banner", () => {
    for (const { frame, before } of frames) {
      if (eventLine(frame.events, before, frame.shown) === null)
        expect(frame.events.some((e) => e.type === "TURN_BEGAN")).toBe(true);
    }
  });
});
