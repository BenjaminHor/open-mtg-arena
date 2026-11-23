// The main button's label and action (hud/main-button.ts), from the seat view.

import type { SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { mainButton } from "../src/hud/main-button.ts";
import { promptTitle } from "../src/interaction/controls.ts";
import { fixtureView, mulliganView } from "./fixture-views.ts";

const midGame = fixtureView("mid-game");
const finishAction = {
  type: "ANSWER",
  decisionId: "d1",
  player: "p1",
  answer: { kind: "finishDeclaring" },
} as unknown as SeatView["options"][number]["action"];

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

  it("names the next stop in combat, step by step", () => {
    const turn = midGame.view.turn;
    if (turn === null) throw new Error("no turn");
    const attacker = { attacker: "o1", attacked: "p2" };
    const combat = { attacks: [attacker], blocks: [] } as unknown as SeatView["view"]["combat"];
    const at = (
      step: "beginningOfCombat" | "declareAttackers" | "declareBlockers" | "combatDamage" | "postcombatMain",
    ) => mainButton({ ...midGame, view: { ...midGame.view, combat, turn: { ...turn, step } } }).detail;
    expect([
      at("beginningOfCombat"),
      at("declareAttackers"),
      at("declareBlockers"),
      at("combatDamage"),
      at("postcombatMain"),
    ]).toEqual(["To Attackers", "To Blockers", "To Damage", "To Main 2", "To End"]);
  });

  it("heads to main 2 when no creature attacked: blockers and damage are skipped (CR 508.8)", () => {
    const turn = midGame.view.turn;
    if (turn === null) throw new Error("no turn");
    const none = { attacks: [], blocks: [] } as unknown as SeatView["view"]["combat"];
    const shown: SeatView = {
      ...midGame,
      view: { ...midGame.view, combat: none, turn: { ...turn, step: "declareAttackers" } },
    };
    expect(mainButton(shown).detail).toBe("To Main 2");
  });

  it("says Pass on the opponent's turn", () => {
    const turn = midGame.view.turn;
    if (turn === null) throw new Error("no turn");
    const theirs: SeatView = { ...midGame, view: { ...midGame.view, turn: { ...turn, activePlayer: "p2" } } };
    expect(mainButton(theirs).label).toBe("Pass");
  });

  it("finishes a declaration of blockers, saying how many creatures block so far", () => {
    const declaring = (chosen: { blocker: string; attacker: string }[]): SeatView => ({
      ...midGame,
      options: [{ ...(midGame.options[0] as SeatView["options"][number]), action: finishAction }],
      view: {
        ...midGame.view,
        decision: { kind: "declareBlockers", chosen } as unknown as SeatView["view"]["decision"],
      },
    });
    expect(mainButton(declaring([]))).toMatchObject({ label: "No Blocks", detail: "To Damage", action: finishAction });
    // One creature blocking two attackers is one blocker.
    const twice = [
      { blocker: "o1", attacker: "o7" },
      { blocker: "o1", attacker: "o8" },
    ];
    expect(mainButton(declaring(twice)).label).toBe("1 Blocker");
    expect(mainButton(declaring([...twice, { blocker: "o2", attacker: "o7" }])).label).toBe("2 Blockers");
  });

  it("names the creature that must still attack, while the declaration can't finish (CR 508.1d)", () => {
    const creature = midGame.view.zones.battlefield.find((id) => {
      const seen = midGame.seen[id];
      return seen?.kind === "card" && seen.characteristics.types.includes("creature");
    });
    if (creature === undefined) throw new Error("no creature on the battlefield");
    const seen = midGame.seen[creature];
    const name = seen?.kind === "card" ? seen.characteristics.name : "";
    const attack = {
      type: "ANSWER",
      decisionId: "d1",
      player: "p1",
      answer: { kind: "declareAttacker", attack: { attacker: creature, attacked: null } },
    } as unknown as SeatView["options"][number]["action"];
    const option = { ...(midGame.options[0] as SeatView["options"][number]), action: attack, obeys: 1 };
    const declaring: SeatView = {
      ...midGame,
      // Another creature could attack too, but obeys nothing by it: only the one that must is named.
      options: [
        option,
        {
          ...option,
          action: {
            ...attack,
            answer: { kind: "declareAttacker", attack: { attacker: "o999", attacked: null } },
          } as unknown as typeof attack,
          obeys: 0,
        },
      ],
      view: {
        ...midGame.view,
        decision: { kind: "declareAttackers", chosen: [] } as unknown as SeatView["view"]["decision"],
      },
    };
    expect(mainButton(declaring)).toMatchObject({
      label: "No Attacks",
      detail: "Not yet: 1 must attack",
      action: null,
    });
    // The button only counts; the prompt, with room for it, names the creature.
    expect(promptTitle(declaring)).toBe(`${name} must attack`);
  });

  it("sends nothing while a decision other than priority waits", () => {
    expect(mainButton(mulliganView())).toEqual({ label: "Choose", detail: null, action: null, hidden: true });
  });
});
