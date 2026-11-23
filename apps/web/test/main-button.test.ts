// The main button's label and action (hud/main-button.ts), from the seat view.

import type { SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { mainButton } from "../src/hud/main-button.ts";
import { fixtureView, mulliganView } from "./fixture-views.ts";

const midGame = fixtureView("mid-game");

describe("the main button", () => {
  it("says Next and where it goes in the person's own main phase, and passes priority", () => {
    const button = mainButton(midGame);
    expect(button).toMatchObject({ label: "Next", detail: "To Combat" });
    expect(button.action?.type).toBe("PASS_PRIORITY");
  });

  it("says Resolve and what resolves while the stack holds something", () => {
    const bolt = (midGame.view.zones.players.p1?.hand ?? []).find((id) => {
      const seen = midGame.seen[id];
      return seen?.kind === "card" && seen.characteristics.name === "Lightning Bolt";
    });
    if (bolt === undefined) throw new Error("no Lightning Bolt in hand");
    const stacked: SeatView = {
      ...midGame,
      view: { ...midGame.view, zones: { ...midGame.view.zones, stack: [bolt] } },
    };
    expect(mainButton(stacked)).toMatchObject({ label: "Resolve", detail: "Lightning Bolt" });
  });

  it("says Pass on the opponent's turn", () => {
    const turn = midGame.view.turn;
    if (turn === null) throw new Error("no turn");
    const theirs: SeatView = { ...midGame, view: { ...midGame.view, turn: { ...turn, activePlayer: "p2" } } };
    expect(mainButton(theirs).label).toBe("Pass");
  });

  it("sends nothing while a decision other than priority waits", () => {
    expect(mainButton(mulliganView())).toEqual({ label: "Choose", detail: null, action: null });
  });
});
