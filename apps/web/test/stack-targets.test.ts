// The stack's targets on the board (M3-04c slice 6b; arena-research.md: "a targeting arc is drawn as a glowing curve
// from the stack item to its target" [R]): an arrow from the top object to each target the board shows, the large
// card made small by a tap (Arena's collapse tab [R]), and a spell on the stack outlined as a counterspell's target.

import type { Action, ObjectId, SeatView } from "@mtg/engine";
import { describe, expect, it } from "vitest";
import { boardModel, NO_INSETS } from "../src/board-model/board-model.ts";
import type { Fixture } from "../src/fixtures/fixtures.ts";
import { controls } from "../src/interaction/controls.ts";
import { COMPACT } from "../src/layout/compact.ts";
import { playFrom } from "./fixture-views.ts";

const PHONE = { width: 812, height: 375 };
const LIBRARY = ["Island", "Island", "Island"];

const board: Fixture = {
  turn: { number: 5, activePlayer: "p1", step: "precombatMain" },
  players: {
    p1: {
      life: 20,
      hand: ["Lightning Bolt", "Cancel"],
      battlefield: [...Array(3).fill("Mountain"), ...Array(3).fill("Island"), "Prodigal Pyromancer"],
      library: LIBRARY,
    },
    p2: { life: 20, hand: [], battlefield: ["Plains", "Elite Vanguard"], library: LIBRARY },
  },
};

function idOf(shown: SeatView, name: string): ObjectId {
  const found = Object.values(shown.seen).find((o) => o.kind === "card" && o.characteristics.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found.id;
}

const targets = (id: ObjectId) => (a: Action) =>
  a.type === "ANSWER" &&
  a.answer.kind === "chooseTarget" &&
  a.answer.target.kind === "object" &&
  a.answer.target.object === id;

function boltAtVanguard() {
  const m = playFrom(board);
  const start = m.shown();
  m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Lightning Bolt"), "cast Lightning Bolt");
  const shown = m.act(targets(idOf(start, "Elite Vanguard")), "target Elite Vanguard");
  return { m, start, shown };
}

const centre = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

describe("arrows from the top of the stack to its targets", () => {
  it("points from the top object to a creature it targets", () => {
    const { shown } = boltAtVanguard();
    const model = boardModel(shown, PHONE);
    const vanguard = model.cards.find((c) => c.name === "Elite Vanguard");
    const top = model.cards.filter((c) => c.zone === "stack").at(-1);
    if (vanguard === undefined || top === undefined) throw new Error("both drawn");
    expect(model.arrows).toHaveLength(1);
    expect(model.arrows[0]?.to).toEqual(centre(vanguard));
    // From the top object's left edge, toward the board.
    expect(model.arrows[0]?.from.x).toBeCloseTo(top.x, 5);
  });

  it("points at a player's info block when a player is the target", () => {
    const m = playFrom(board);
    const start = m.shown();
    m.act((a) => a.type === "ACTIVATE_ABILITY" && a.object === idOf(start, "Prodigal Pyromancer"), "activate");
    const shown = m.act(
      (a) =>
        a.type === "ANSWER" &&
        a.answer.kind === "chooseTarget" &&
        a.answer.target.kind === "player" &&
        a.answer.target.player === "p2",
      "target the opponent",
    );
    const model = boardModel(shown, PHONE);
    expect(model.arrows.map((a) => a.to)).toEqual([centre(model.overlay.player.opponent)]);
  });

  it("draws none for an empty stack, or while the person is still choosing", () => {
    const m = playFrom(board);
    expect(boardModel(m.shown(), PHONE).arrows).toEqual([]);
    const start = m.shown();
    const choosing = m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Lightning Bolt"), "cast");
    expect(boardModel(choosing, PHONE).arrows).toEqual([]);
  });
});

describe("the large stack, made small", () => {
  it("is small at the right edge when the person shrinks it, as while choosing", () => {
    const { shown } = boltAtVanguard();
    const large = boardModel(shown, PHONE)
      .cards.filter((c) => c.zone === "stack")
      .at(-1);
    const small = boardModel(shown, PHONE, NO_INSETS, { handOpen: false, stackSmall: true })
      .cards.filter((c) => c.zone === "stack")
      .at(-1);
    expect(large?.height).toBeGreaterThan(COMPACT.stack.smallMaxH);
    expect(small?.height).toBeLessThanOrEqual(COMPACT.stack.smallMaxH);
    expect((small?.x ?? 0) + (small?.width ?? 0)).toBeGreaterThan(PHONE.width - 20);
  });
});

describe("a spell on the stack as a target", () => {
  it("is outlined as a target where it's drawn, and picked in the prompt by name (Cancel targets a spell, CR 115.1)", () => {
    const { m, start } = boltAtVanguard();
    const bolt = m.shown().view.zones.stack.at(-1);
    if (bolt === undefined) throw new Error("Lightning Bolt on the stack");
    const choosing = m.act((a) => a.type === "CAST_SPELL" && a.object === idOf(start, "Cancel"), "cast Cancel");
    // Under Cancel it shows only a name strip: too small a tap, so the prompt has it.
    expect(controls(choosing, null).cards[bolt]).toBeUndefined();
    expect(controls(choosing, null).prompt?.choices.map((c) => c.label)).toContain("Target Lightning Bolt");
    const drawn = boardModel(choosing, PHONE).cards.find((c) => c.id === bolt);
    expect(drawn?.targetable).toBe(true);
  });
});
