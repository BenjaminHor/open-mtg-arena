// Lines of the game log (`event-log.ts`) that games rarely produce.

import { cardDatabase } from "@mtg/cards";
import type { GameEvent, ObjectId } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { eventText } from "../src/event-log.ts";

const cards = cardDatabase();
const name = (id: ObjectId) => (id === "o9" ? "Lightning Bolt" : `card ${id}`);

describe("a cancelled cast in the log", () => {
  it("names the card back in hand, or the spell when it went back to a library (D-124)", () => {
    const cancelled = (restored: ObjectId | null): GameEvent => ({
      type: "CAST_CANCELLED",
      player: "p1",
      cardId: "c3",
      spell: "o9",
      restored,
      untapped: [],
    });
    expect(eventText(cancelled("o2"), name, cards)).toBe("p1 cancels casting card o2");
    expect(eventText(cancelled(null), name, cards)).toBe("p1 cancels casting Lightning Bolt");
  });
});
