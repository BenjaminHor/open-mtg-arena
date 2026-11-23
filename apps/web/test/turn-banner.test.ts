// The new turn's banner (the owner's "two lands on one turn": a turn passed by the auto-pass, unseen), and the
// behaviour it covers: one press of the main button can run through the opponent's whole turn, while the engine never
// gives the person two land drops in one turn (CR 305.2).

import type { SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { mainButton } from "../src/hud/main-button.ts";
import { turnBanner } from "../src/interaction/turn-banner.ts";
import { handle, type Session } from "../src/worker/match-session.ts";
import { cards, fixtureView } from "./fixture-views.ts";

describe("turnBanner", () => {
  const midGame = fixtureView("mid-game");

  it("names the turn and whose it is when the turn has changed, and nothing when it hasn't", () => {
    expect(turnBanner(4, midGame)).toBe("Turn 5 · Your turn");
    expect(turnBanner(5, midGame)).toBeNull();
    const turn = midGame.view.turn;
    if (turn === null) throw new Error("a turn");
    const theirs: SeatView = {
      ...midGame,
      view: { ...midGame.view, turn: { ...turn, number: 6, activePlayer: "p2" } },
    };
    expect(turnBanner(5, theirs)).toBe("Turn 6 · Opponent's turn");
  });
});

describe("a seeded game played as the app plays it", () => {
  it("never gives two land drops in one turn, though one press can pass the opponent's whole turn", () => {
    let r = handle(null, { type: "start", decks: ["red-green-beats", "white-soldiers"], seed: 8, human: "p1" }, cards);
    let session: Session | null = r.session;
    const landTurns: number[] = [];
    let crossedTheirTurn = false;
    for (let i = 0; i < 400 && r.reply.type === "update" && r.reply.waitingOn !== null; i++) {
      const shown: SeatView = r.reply.shown;
      if (shown.view.result !== null) break;
      const turn = shown.view.turn?.number ?? 0;
      const land = shown.options.find((o) => o.action.type === "PLAY_LAND")?.action;
      if (land !== undefined) landTurns.push(turn);
      const action = land ?? mainButton(shown).action ?? shown.options[0]?.action;
      if (action === undefined) break;
      r = handle(session, { type: "act", action }, cards);
      session = r.session;
      if (r.reply.type === "update" && land === undefined && (r.reply.shown.view.turn?.number ?? 0) - turn >= 2) {
        crossedTheirTurn = true;
      }
    }
    expect(landTurns.length).toBeGreaterThan(2);
    expect(new Set(landTurns).size).toBe(landTurns.length);
    expect(crossedTheirTurn).toBe(true);
  });
});
